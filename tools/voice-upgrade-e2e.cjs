/**
 * voice-upgrade-e2e — LIVE end-to-end of the Voice "add plan" upgrade leg.
 *
 * Usage: node tools/voice-upgrade-e2e.cjs --cust <userid> [--op <username>]
 *
 * *** THIS ONE WRITES. *** It reproduces exactly what tapping
 * ADD VOICE PLAN -> <plan> -> SUBMIT does in the PWA:
 *
 *   1. getUserAssignedItems  {servkey:"voicecall"}      read
 *   2. getMyPlanDetails      {servicekey:"voicecall"}   read
 *   3. validateBeforeFofiBoxReg                          read  (privilege gate)
 *   4. registrationNecessities {moduletype:"upgradation"} read (plan catalog)
 *   5. upgradeRegistration   {services:["voicecall"]}   WRITE — registers the
 *                                                        line, SMS + email the
 *                                                        customer, returns voipno
 *   6. service/paymentinfo/voicecall                     WRITE — reserves a
 *                                                        pending transaction
 *   7. killTxn                                           WRITE — releases (6)
 *   8. getUserAssignedItems again                        read  (did the number land?)
 *
 * It STOPS before cabletv/generateorder. No wallet is debited, no order is
 * placed, and the transaction reserved in (6) is released in (7).
 *
 * Run it only against a staging customer whose contact details are dummies —
 * step 5 really does send an SMS and an email to whatever is on the record.
 */

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : null; };
const OP = argOf("--op") || "superadmin";
const CUST = argOf("--cust");
if (!CUST) { console.error("--cust <userid> is required"); process.exit(2); }

function parseEnv(p) {
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i === -1) continue;
    let v = l.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[l.slice(0, i).trim()] = v;
  }
  return env;
}

const env = parseEnv(path.resolve(__dirname, "..", ".env.test"));
const BASE = env.VITE_API_BASE_URL.replace(/\/$/, "") + "/";
const headers = () => ({
  Authorization: env.VITE_API_AUTH_KEY,
  username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE,
  appversion: env.VITE_API_APP_VERSION,
  "X-App-Package": "com.bbnl.smartphone",
  "Content-Type": "application/json",
});

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST", headers: headers(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* non-JSON */ }
  return { httpStatus: res.status, data, text };
}

const KNOWN = new Set(["internet", "ott", "fofi", "voicecall", "games", "cabletv"]);
// Mirrors resolveVoicePlanServices() in src/services/voiceApis.js.
function resolveServices(plan) {
  const pick = (rows) => (Array.isArray(rows) ? rows : [])
    .map((s) => String(s || "").toLowerCase().trim()).filter((s) => KNOWN.has(s));
  const withVoice = (k) => (k.includes("voicecall") ? k : [...k, "voicecall"]);
  const subs = pick(plan?.subscriptions);
  if (subs.length) return withVoice(subs);
  const reg = pick(plan?.reg_serv_keys);
  if (reg.length) return withVoice(reg);
  return ["voicecall"];
}

(async () => {
  console.log(`\nvoice-upgrade-e2e → ${BASE}`);
  console.log(`customer=${CUST}  operator=${OP}`);
  console.log("WRITES: upgradeRegistration, paymentinfo (released), NOT generateorder");
  console.log("=".repeat(70) + "\n");

  // 1 ─────────────────────────────────────────────────────────────────
  const a0 = await post(`${BASE}ServiceApis/getUserAssignedItems`, { servkey: "voicecall", userid: CUST });
  const voip0 = a0.data?.body?.voip || [];
  const fofi0 = a0.data?.body?.fofi || [];
  console.log(`[1] assigned items  voip=${JSON.stringify(voip0.map((v) => v.product_name))} fofi=${JSON.stringify(fofi0)}`);

  // 2 ─────────────────────────────────────────────────────────────────
  const pd0 = await post(`${BASE}ServiceApis/getMyPlanDetails`, {
    servicekey: "voicecall", userid: CUST, fofiboxid: "", voipnumber: voip0[0]?.product_name || "",
  });
  console.log(`[2] plan details    err_code=${pd0.data?.status?.err_code} planid=${pd0.data?.body?.planid}`);
  console.log(`                    other_service_renewal=${JSON.stringify(pd0.data?.body?.other_service_renewal)}`);

  // 3 ─────────────────────────────────────────────────────────────────
  const gate = await post(`${BASE}ServiceApis/validateBeforeFofiBoxReg`, { username: CUST, loginuname: OP });
  console.log(`[3] privilege gate  err_code=${gate.data?.status?.err_code} "${gate.data?.status?.err_msg}"`);
  if (gate.data?.status?.err_code !== 0) { console.log("\nGate closed — the PWA would stop here too. Aborting."); process.exit(1); }

  // 4 ─────────────────────────────────────────────────────────────────
  const nec = await post(`${BASE}ServiceApis/registrationNecessities`, {
    userid: CUST, moduletype: "upgradation", logUname: OP,
  });
  const plans = nec.data?.body?.voicecall_plans || [];
  if (!plans.length) { console.log("[4] no voicecall_plans — aborting"); process.exit(1); }
  const plan = plans[0];
  const services = resolveServices(plan);
  console.log(`[4] plan catalog    ${plans.length} plan(s); using ${plan.planid}/${plan.priceid} "${plan.planname}" servid=${plan.servid}`);
  console.log(`                    resolved services = ${JSON.stringify(services)}`);

  // 5 ── WRITE ────────────────────────────────────────────────────────
  const fofiboxid = fofi0[0]?.product_name || "";
  const regBody = { username: CUST, loginuname: OP, services };
  if (fofiboxid) regBody.fofiboxid = fofiboxid;
  console.log(`\n[5] WRITE upgradeRegistration ${JSON.stringify(regBody)}`);
  const reg = await post(`${BASE}ServiceApis/upgradeRegistration`, regBody);
  console.log(`    -> http ${reg.httpStatus} ${JSON.stringify(reg.data?.status)}`);
  console.log(`    -> body ${JSON.stringify(reg.data?.body)}`);
  const voipno = reg.data?.status?.err_code === 0 ? (reg.data?.body?.voipno || "") : "";
  if (!voipno) { console.log("\nNo voipno allocated — the PWA would stop here and show the message above."); process.exit(1); }
  console.log(`    ALLOCATED VOIP NUMBER: ${voipno}`);

  // 6 ── WRITE (reserves a transaction) ───────────────────────────────
  const infoBody = {
    fofi_box_id: fofiboxid, planid: String(plan.planid), priceid: String(plan.priceid),
    servapptype: "crmapp", servid: String(plan.servid), userid: CUST, username: OP, voipnumber: voipno,
  };
  console.log(`\n[6] WRITE paymentinfo/voicecall ${JSON.stringify(infoBody)}`);
  const info = await post(`${BASE}service/paymentinfo/voicecall`, infoBody);
  console.log(`    -> http ${info.httpStatus} ${JSON.stringify(info.data?.status)}`);
  const txn = info.data?.body?.transactionid || "";
  if (info.data?.status?.err_code === 0) {
    console.log(`    txn=${txn}  total_amt=${info.data?.body?.total_amt}  planname=${info.data?.body?.planname}`);
    console.log(`    final_split_data.OPERATOR=${JSON.stringify(info.data?.body?.final_split_data?.OPERATOR)}`);
  } else {
    console.log(`    body ${JSON.stringify(info.data?.body)}`);
  }

  // 7 ── release the reservation ──────────────────────────────────────
  if (txn) {
    const kill = await post(`${BASE}ServiceApis/killTxn`, {
      userid: CUST, username: OP, servid: String(plan.servid), orderedbytype: "crmapp", transactionid: txn,
    });
    console.log(`\n[7] killTxn ${txn} -> ${JSON.stringify(kill.data?.status)}`);
  } else {
    console.log("\n[7] nothing to release");
  }

  // 8 ─────────────────────────────────────────────────────────────────
  const a1 = await post(`${BASE}ServiceApis/getUserAssignedItems`, { servkey: "voicecall", userid: CUST });
  const voip1 = (a1.data?.body?.voip || []).map((v) => v.product_name);
  console.log(`\n[8] assigned items after  voip=${JSON.stringify(voip1)}`);
  console.log(`    allocated number visible in assigned-items? ${voip1.includes(voipno) ? "YES" : "NO"}`);

  console.log("\n" + "=".repeat(70));
  console.log("STOPPED before cabletv/generateorder. No money moved.");
})().catch((e) => { console.error("\nUNCAUGHT", e); process.exit(1); });
