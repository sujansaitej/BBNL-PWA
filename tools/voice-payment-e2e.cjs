/**
 * voice-payment-e2e — LIVE payment test for the Voice Call upgrade leg.
 *
 * Usage: node tools/voice-payment-e2e.cjs --cust <userid> [--op <username>]
 *        node tools/voice-payment-e2e.cjs --cust <userid> --invalid-txn
 *
 * *** THIS ONE SPENDS MONEY. *** It runs cabletv/generateorder, which debits
 * the operator wallet and attaches the plan. Staging only.
 *
 * It reproduces VoicePayment.jsx exactly:
 *   1. myWallet            {servicekey:"voicecall"}   balance BEFORE
 *   2. upgradeRegistration {services:["voicecall"]}   idempotent; gets voipno
 *   3. paymentinfo/voicecall                          reserves txn, quotes
 *   4. the two native gates  (total non-zero; wallet >= total - OPERATOR.amount)
 *   5. cabletv/generateorder  17 fields + paytype:"upgrade"   <-- THE DEBIT
 *   6. myWallet again                                  balance AFTER
 *   7. getMyPlanDetails + getUserAssignedItems         did the plan attach?
 *
 * --invalid-txn instead pays with a FABRICATED transaction id to exercise the
 * "Invalid transaction id" -> killTxn path added to VoicePayment/FofiPayment.
 * That branch charges nothing.
 */

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : null; };
const OP = argOf("--op") || "superadmin";
const CUST = argOf("--cust");
const INVALID = argv.includes("--invalid-txn");
if (!CUST) { console.error("--cust <userid> is required"); process.exit(2); }

function parseEnv(p) {
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("="); if (i === -1) continue;
    let v = l.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[l.slice(0, i).trim()] = v;
  }
  return env;
}
const env = parseEnv(path.resolve(__dirname, "..", ".env.test"));
const BASE = env.VITE_API_BASE_URL.replace(/\/$/, "") + "/";
const H = () => ({
  Authorization: env.VITE_API_AUTH_KEY, username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD, appkeytype: env.VITE_API_APP_USER_TYPE,
  appversion: env.VITE_API_APP_VERSION, "X-App-Package": "com.bbnl.smartphone",
  "Content-Type": "application/json",
});
async function post(u, b) {
  const r = await fetch(BASE + u, { method: "POST", headers: H(), ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch (_) {}
  return { http: r.status, data: d, text: t };
}
const wallet = async () => {
  const w = await post("ServiceApis/myWallet", { loginuname: OP, servicekey: "voicecall" });
  return Number(w?.data?.body?.wallet_balance ?? NaN);
};

(async () => {
  console.log(`\nvoice-payment-e2e → ${BASE}`);
  console.log(`customer=${CUST} operator=${OP}${INVALID ? "  [--invalid-txn: no debit]" : "  *** WILL DEBIT ***"}`);
  console.log("=".repeat(72) + "\n");

  const before = await wallet();
  console.log(`[1] wallet BEFORE = ${before}`);

  // 2 — idempotent: returns the existing number if there is one.
  const reg = await post("ServiceApis/upgradeRegistration", {
    username: CUST, loginuname: OP, services: ["voicecall"],
  });
  const voipno = reg?.data?.status?.err_code === 0 ? (reg?.data?.body?.voipno || "") : "";
  console.log(`[2] upgradeRegistration -> ${JSON.stringify(reg?.data?.status)} voipno=${voipno}`);
  if (!voipno) { console.log("no number — aborting"); process.exit(1); }

  // 3 — the quote (reserves a transaction)
  const nec = await post("ServiceApis/registrationNecessities", { userid: CUST, moduletype: "upgradation", logUname: OP });
  const plan = (nec?.data?.body?.voicecall_plans || [])[0];
  const info = await post("service/paymentinfo/voicecall", {
    fofi_box_id: "", planid: String(plan.planid), priceid: String(plan.priceid),
    servapptype: "crmapp", servid: String(plan.servid), userid: CUST, username: OP, voipnumber: voipno,
  });
  if (info?.data?.status?.err_code !== 0) { console.log(`[3] quote FAILED ${JSON.stringify(info?.data?.status)}`); process.exit(1); }
  const body = info.data.body;
  const realTxn = body.transactionid;
  const total = Number(body.total_amt);
  const optrShare = Number(body?.final_split_data?.OPERATOR?.amount ?? 0);
  const deductable = total - optrShare;
  console.log(`[3] quote -> txn=${realTxn} plan="${body.planname}" total=${total} operatorShare=${optrShare}`);

  // 4 — the two native gates, verbatim
  console.log(`[4] gate 1  total non-zero?      ${total !== 0 && String(total) !== ""}`);
  console.log(`    gate 2  wallet >= deductable ${before} >= ${deductable} -> ${before >= deductable}`);
  if (!(total !== 0 && before >= deductable)) { console.log("a gate blocks — the PWA would stop here"); process.exit(1); }

  // 5 — THE DEBIT (or the invalid-id probe)
  const txnToSend = INVALID ? "SERV-0101-5-9999999" : realTxn;
  const order = {
    bankname: "", banktxnid: "", fofiboxid: "", gateway: "", gatewaytxnid: "",
    orderedbytype: "crmapp", paidamount: Number(total), paymentmode: "offline",
    payresponse: "", planid: String(plan.planid), priceid: String(plan.priceid),
    servid: String(plan.servid), transactionid: txnToSend, txnstatus: "success",
    userid: CUST, username: OP, voipnumber: voipno, paytype: "upgrade",
  };
  console.log(`\n[5] generateorder transactionid=${txnToSend} paidamount=${order.paidamount} paytype=upgrade`);
  const res = await post("ServiceApis/cabletv/generateorder", order);
  console.log(`    -> http ${res.http} ${JSON.stringify(res?.data?.status)}`);

  const errMsg = String(res?.data?.status?.err_msg || "");
  if (res?.data?.status?.err_code !== 0) {
    // The branch VoicePayment/FofiPayment now implement.
    if (errMsg.toLowerCase().includes("invalid")) {
      console.log(`    err_msg contains "invalid" -> closing the stranded reservation (native :398-400)`);
      const k = await post("ServiceApis/killTxn", {
        userid: CUST, username: OP, servid: String(plan.servid),
        orderedbytype: "crmapp", transactionid: txnToSend,
      });
      console.log(`    killTxn(${txnToSend}) -> ${JSON.stringify(k?.data?.status)}`);
    }
    // The real reservation is still open when we paid with a fake id.
    if (INVALID && realTxn) {
      const k2 = await post("ServiceApis/killTxn", {
        userid: CUST, username: OP, servid: String(plan.servid),
        orderedbytype: "crmapp", transactionid: realTxn,
      });
      console.log(`    cleanup: killTxn(${realTxn}) -> ${JSON.stringify(k2?.data?.status)}`);
    }
    const after0 = await wallet();
    console.log(`\n[6] wallet AFTER = ${after0}  (delta ${(after0 - before).toFixed(2)} — expect 0.00)`);
    process.exit(0);
  }

  const after = await wallet();
  console.log(`\n[6] wallet AFTER = ${after}`);
  console.log(`    delta = ${(after - before).toFixed(2)}   expected -${deductable.toFixed(2)} (total ${total} - operator share ${optrShare})`);
  console.log(`    matches deductable? ${Math.abs((before - after) - deductable) < 0.01 ? "YES" : "NO"}`);

  // 7 — did the plan actually attach, and did the SIP extension appear?
  const pd = await post("ServiceApis/getMyPlanDetails", {
    servicekey: "voicecall", userid: CUST, fofiboxid: "", voipnumber: voipno,
  });
  const sub = (pd?.data?.body?.subscribed_services || [])[0];
  console.log(`\n[7] plan after payment: planid=${pd?.data?.body?.planid} name="${sub?.planname}" expiry="${sub?.expirydate}"`);
  console.log(`    other_service_renewal=${JSON.stringify(pd?.data?.body?.other_service_renewal)}`);
  const ai = await post("ServiceApis/getUserAssignedItems", { servkey: "voicecall", userid: CUST });
  console.log(`    assigned-items voip=${JSON.stringify((ai?.data?.body?.voip || []).map((v) => v.product_name))}`);
  console.log("\n" + "=".repeat(72));
})().catch((e) => { console.error("UNCAUGHT", e); process.exit(1); });
