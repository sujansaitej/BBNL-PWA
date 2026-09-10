/**
 * voice-smoke — READ-ONLY live probe for the Voice Call ("voicecall") flow.
 *
 * Usage:  node tools/voice-smoke.cjs                 (staging / .env.test)
 *         node tools/voice-smoke.cjs --op <username> (scope to an operator)
 *         node tools/voice-smoke.cjs --cust <userid> (probe one customer)
 *
 * SAFETY — READ-ONLY, and deliberately narrower than contract-smoke.cjs.
 * `service/paymentinfo/voicecall` is NOT probed here even though it is a
 * "read": every call RESERVES a pending transaction server-side. Nothing in
 * this file debits a wallet, generates an order, or reserves anything.
 * Do NOT add cabletv/generateorder or paymentinfo to it.
 *
 * What it answers:
 *   1. Does servServiceList carry a `voicecall` row, and what is its numeric
 *      `id`?  (resolveVoiceServiceId depends on this — the #1 assumption.)
 *   2. Does getUserAssignedItems {servkey:"voicecall"} answer, and is the
 *      VOIP list really under body.voip[].product_name?
 *   3. Does getMyPlanDetails {servicekey:"voicecall"} answer, and does it
 *      carry planid / priceid / other_service_renewal?
 *   4. Does myWallet accept servicekey "voicecall"?
 *   5. Does registrationNecessities return a `voicecall_plans` array, and do
 *      its rows carry planid / priceid / servid / planrate?
 */

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};
const OP = argOf("--op") || "superadmin";
const CUST = argOf("--cust");

function parseEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
if (!env.VITE_API_BASE_URL) {
  console.error("No VITE_API_BASE_URL in .env.test");
  process.exit(2);
}
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

let pass = 0, fail = 0, warn = 0;
const line = (sym, name, detail) => console.log(`${sym} ${name}${detail ? " — " + detail : ""}`);
const ok = (n, d) => { pass++; line("PASS", n, d); };
const bad = (n, d) => { fail++; line("FAIL", n, d); };
const meh = (n, d) => { warn++; line("WARN", n, d); };

async function post(url, body, { method = "POST" } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* non-JSON */ }
    return { httpStatus: res.status, data, text, ms: Date.now() - started };
  } catch (err) {
    return { httpStatus: 0, data: null, text: String(err && err.message), ms: Date.now() - started };
  }
}

(async () => {
  console.log(`\nvoice-smoke → ${BASE}  (operator scope: ${OP})\n${"=".repeat(64)}\n`);

  // ── 1. servServiceList → the voicecall row and its numeric id ──────
  console.log("[1] servServiceList — is voice provisioned, and what is its servid?");
  const svc = await post(`${BASE}ServiceApis/servServiceList?servtype=all&iskirana=false`, undefined);
  let voiceServid = "";
  if (svc.data?.status?.err_code === 0 && Array.isArray(svc.data.body)) {
    const rows = svc.data.body;
    console.log(`    services returned: ${rows.map((r) => `${r.keyword}(id=${r.id})`).join(", ")}`);
    const voice = rows.find((r) => String(r.keyword || "").toLowerCase() === "voicecall");
    if (voice) {
      voiceServid = String(voice.id);
      ok("voicecall row present", `id=${voiceServid} title="${voice.title}"`);
      if (!/^\d+$/.test(voiceServid)) meh("servid is not numeric", voiceServid);
    } else {
      bad("voicecall row present", "no row with keyword 'voicecall' — resolveVoiceServiceId would return ''");
    }
  } else {
    bad("servServiceList", `http ${svc.httpStatus} ${svc.data?.status?.err_msg || svc.text.slice(0, 120)}`);
  }

  // ── 2. find a customer that actually has a VOIP line ───────────────
  console.log("\n[2] customersList → find a customer with a voicecall connection");
  let candidates = CUST ? [CUST] : [];
  if (!CUST) {
    const cl = await post(`${BASE}ServiceApis/customersList?status=`, {
      username: OP, servid: 1, search: [{ platform: "iptv", providerid: 5 }],
    });
    if (cl.data?.status?.err_code === 0 && Array.isArray(cl.data.body)) {
      candidates = cl.data.body.slice(0, 12).map((c) => c.username || c.customer_id || c.userid).filter(Boolean);
      ok("customersList", `${cl.data.body.length} customers for operator "${OP}", probing first ${candidates.length}`);
    } else {
      meh("customersList", `${cl.data?.status?.err_msg || "no body"} — pass --cust <userid> to probe directly`);
    }
  }

  let voiceCustomer = null, voipNumber = "", fofiBox = "";
  for (const cid of candidates) {
    const ai = await post(`${BASE}ServiceApis/getUserAssignedItems`, { servkey: "voicecall", userid: cid });
    const body = ai.data?.body;
    if (ai.data?.status?.err_code !== 0 || !body) continue;
    const voip = Array.isArray(body.voip) ? body.voip : [];
    if (voip.length > 0) {
      voiceCustomer = cid;
      voipNumber = String(voip[0].product_name || "");
      fofiBox = Array.isArray(body.fofi) && body.fofi.length === 1 ? String(body.fofi[0].product_name || "") : "";
      console.log(`    ${cid}: voip=${voip.length} fofi=${(body.fofi || []).length} internet=${(body.internet || []).length}`);
      break;
    }
  }

  // ── 3. getUserAssignedItems shape ──────────────────────────────────
  console.log("\n[3] getUserAssignedItems {servkey:'voicecall'} — response shape");
  const probeCust = voiceCustomer || candidates[0];
  if (probeCust) {
    const ai = await post(`${BASE}ServiceApis/getUserAssignedItems`, { servkey: "voicecall", userid: probeCust });
    if (ai.data?.status?.err_code === 0) {
      const b = ai.data.body || {};
      ok("accepts servkey 'voicecall'", `buckets: ${Object.keys(b).join(", ") || "(empty body)"}`);
      if ("voip" in b) ok("body.voip bucket exists", `${(b.voip || []).length} row(s)`);
      else meh("body.voip bucket", "absent for this customer — cannot confirm the key name here");
      if (voipNumber) ok("voip rows carry product_name", voipNumber);
    } else {
      meh("getUserAssignedItems", ai.data?.status?.err_msg || `http ${ai.httpStatus}`);
    }
  } else {
    meh("getUserAssignedItems", "no customer id available to probe");
  }

  // ── 4. getMyPlanDetails ────────────────────────────────────────────
  console.log("\n[4] getMyPlanDetails {servicekey:'voicecall'} — the plan card + renewal gate");
  if (voiceCustomer) {
    const pd = await post(`${BASE}ServiceApis/getMyPlanDetails`, {
      fofiboxid: fofiBox, servicekey: "voicecall", userid: voiceCustomer, voipnumber: voipNumber,
    });
    const b = pd.data?.body;
    if (pd.data?.status?.err_code === 0 && b) {
      ok("accepts servicekey 'voicecall'", `customer ${voiceCustomer} / voip ${voipNumber}`);
      console.log(`    planid=${b.planid} priceid=${b.priceid} subscribed_services=${(b.subscribed_services || []).length}`);
      if (b.other_service_renewal) {
        ok("other_service_renewal present", `btn_status="${b.other_service_renewal.btn_status}"`);
      } else {
        meh("other_service_renewal", "absent — PAY BILL would stay disabled");
      }
      const sub = (b.subscribed_services || [])[0];
      if (sub) console.log(`    subscribed[0]: servicekey=${sub.servicekey} title="${sub.title}" plan="${sub.planname}" expiry=${sub.expirydate}`);
    } else {
      meh("getMyPlanDetails", pd.data?.status?.err_msg || `http ${pd.httpStatus}`);
    }
  } else {
    meh("getMyPlanDetails", "no customer with a VOIP line found in the sample — cannot exercise");
  }

  // ── 5. myWallet with the voicecall service key ─────────────────────
  console.log("\n[5] myWallet {servicekey:'voicecall'} — the balance the pay gate reads");
  const w = await post(`${BASE}ServiceApis/myWallet`, { loginuname: OP, servicekey: "voicecall" });
  if (w.data?.status?.err_code === 0) {
    ok("accepts servicekey 'voicecall'", `wallet_balance=${w.data?.body?.wallet_balance}`);
  } else {
    meh("myWallet", w.data?.status?.err_msg || `http ${w.httpStatus}`);
  }

  // ── 6. registrationNecessities → voicecall_plans ───────────────────
  console.log("\n[6] registrationNecessities — does body.voicecall_plans exist?");
  const rn = await post(`${BASE}ServiceApis/registrationNecessities`, {
    userid: voiceCustomer || probeCust || "", moduletype: "upgradation", logUname: OP,
  });
  if (rn.data?.status?.err_code === 0 && rn.data.body) {
    const keys = Object.keys(rn.data.body).filter((k) => k.endsWith("_plans"));
    console.log(`    plan arrays: ${keys.map((k) => `${k}(${(rn.data.body[k] || []).length})`).join(", ")}`);
    const vp = rn.data.body.voicecall_plans;
    if (Array.isArray(vp)) {
      ok("body.voicecall_plans is an array", `${vp.length} plan(s)`);
      if (vp[0]) {
        const p = vp[0];
        console.log(`    plan[0]: planid=${p.planid} priceid=${p.priceid} servid=${p.servid} rate=${p.planrate} name="${p.planname}"`);
        const missing = ["planid", "priceid", "servid", "planname", "planrate"].filter((f) => p[f] === undefined);
        if (missing.length) meh("plan row fields", `missing: ${missing.join(", ")}`);
        else ok("plan rows carry planid/priceid/servid/planname/planrate");
      } else {
        meh("voicecall_plans", "empty for this operator — the UPGRADE list would show 'No voice plans'");
      }
    } else {
      bad("body.voicecall_plans", `absent. present keys: ${keys.join(", ") || "(none)"}`);
    }
  } else {
    meh("registrationNecessities", rn.data?.status?.err_msg || `http ${rn.httpStatus}`);
  }

  // ── 7. validateBeforeFofiBoxReg (the upgrade gate) ─────────────────
  console.log("\n[7] validateBeforeFofiBoxReg — the gate before the plan list opens");
  if (voiceCustomer || probeCust) {
    const v = await post(`${BASE}ServiceApis/validateBeforeFofiBoxReg`, {
      username: voiceCustomer || probeCust, loginuname: OP,
    });
    if (v.data?.status) {
      ok("responds in the STATUS dialect", `err_code=${v.data.status.err_code} msg="${v.data.status.err_msg}"`);
    } else {
      meh("validateBeforeFofiBoxReg", `http ${v.httpStatus} ${v.text.slice(0, 100)}`);
    }
  }

  console.log(`\n${"=".repeat(64)}\n${pass} pass · ${warn} warn · ${fail} fail\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
