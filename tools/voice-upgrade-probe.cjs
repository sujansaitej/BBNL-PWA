/**
 * voice-upgrade-probe — READ-ONLY checks for the four claims the voice
 * upgrade/provisioning rewrite depends on.
 *
 * Usage: node tools/voice-upgrade-probe.cjs [--cust <userid>] [--op <username>]
 *
 * SAFETY — strictly read-only. Does NOT call:
 *   • ServiceApis/upgradeRegistration   (writes voip_customers, SMSes the customer)
 *   • service/paymentinfo/voicecall     (reserves a pending transaction)
 *   • ServiceApis/cabletv/generateorder (takes money)
 * Every call below is a plain lookup. Do not add any of the three above.
 *
 * The claims:
 *   A. getUserAssignedItems returns a HARDCODED empty `fofi` for servkey
 *      "voicecall" — even for a customer that demonstrably owns a box.
 *      (CustomerServiceItems.php:27-29)
 *   B. voicecall_plans rows carry `subscriptions` (real service keys) and
 *      `reg_serv_keys` (display labels), and they are NOT the same thing.
 *   C. The screenshot's state is reproducible: no voip -> getMyPlanDetails
 *      answers err_code 0 with the "contact operator" message.
 *   D. The VOIP number from assigned-items and the one the payment gate
 *      accepts come from different tables, so the list can be non-empty for a
 *      customer the gate rejects.  (Inferred, not directly probeable without
 *      reserving a transaction — reported as such.)
 */

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : null; };
const OP = argOf("--op") || "superadmin";
const CUST = argOf("--cust");

function parseEnv(p) {
  const env = {};
  if (!fs.existsSync(p)) return env;
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
  try {
    const res = await fetch(url, {
      method: "POST", headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* non-JSON */ }
    return { httpStatus: res.status, data, text };
  } catch (err) {
    return { httpStatus: 0, data: null, text: String(err && err.message) };
  }
}

let pass = 0, fail = 0, warn = 0;
const ok = (n, d) => { pass++; console.log(`PASS ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`FAIL ${n}${d ? " — " + d : ""}`); };
const meh = (n, d) => { warn++; console.log(`WARN ${n}${d ? " — " + d : ""}`); };

const assigned = (servkey, userid) =>
  post(`${BASE}ServiceApis/getUserAssignedItems`, { servkey, userid });

(async () => {
  console.log(`\nvoice-upgrade-probe → ${BASE}  (operator: ${OP})`);
  console.log("READ-ONLY: no upgradeRegistration, no paymentinfo, no generateorder\n" + "=".repeat(70) + "\n");

  // ── Find a customer that owns a FoFi box (needed for claim A) ───────
  console.log("[A] Is `fofi` hardcoded empty for servkey 'voicecall'?");
  let boxOwner = null, boxId = "";
  const pool = CUST ? [CUST] : [];
  if (!CUST) {
    const cl = await post(`${BASE}ServiceApis/customersList?status=`, {
      username: OP, servid: 1, search: [{ platform: "iptv", providerid: 5 }],
    });
    const rows = Array.isArray(cl.data?.body?.customers) ? cl.data.body.customers
      : Array.isArray(cl.data?.body) ? cl.data.body : [];
    for (const r of rows.slice(0, 25)) pool.push(r.username || r.userid || r.user_id);
  }

  for (const uid of pool.filter(Boolean)) {
    const viaFofi = await assigned("fofi", uid);
    const boxes = viaFofi.data?.body?.fofi || [];
    if (boxes.length > 0) {
      boxOwner = uid;
      boxId = boxes[0]?.product_name || "";
      break;
    }
  }

  if (!boxOwner) {
    meh("no box-owning customer found in the sample", "claim A not provable from this pool");
  } else {
    const viaVoice = await assigned("voicecall", boxOwner);
    const fofiViaVoice = viaVoice.data?.body?.fofi;
    console.log(`    customer ${boxOwner} owns box ${boxId}`);
    console.log(`    servkey 'fofi'      -> fofi[] length ${(await assigned("fofi", boxOwner)).data?.body?.fofi?.length}`);
    console.log(`    servkey 'voicecall' -> fofi[] length ${Array.isArray(fofiViaVoice) ? fofiViaVoice.length : "(missing)"}`);
    if (Array.isArray(fofiViaVoice) && fofiViaVoice.length === 0) {
      ok("fofi[] is empty on servkey 'voicecall' for a box OWNER",
         "so any 'has a box?' gate on this screen is always false");
    } else {
      bad("fofi[] is NOT empty on servkey 'voicecall'",
          `got ${JSON.stringify(fofiViaVoice)} — the rewrite's premise is wrong`);
    }
  }

  // ── Claim B: subscriptions vs reg_serv_keys ────────────────────────
  console.log("\n[B] voicecall_plans — `subscriptions` vs `reg_serv_keys`");
  const nec = await post(`${BASE}ServiceApis/registrationNecessities`, {
    userid: CUST || boxOwner || OP, moduletype: "upgradation", logUname: OP,
  });
  const plans = nec.data?.body?.voicecall_plans || [];
  if (plans.length === 0) {
    bad("voicecall_plans", "empty — cannot verify");
  } else {
    for (const p of plans) {
      console.log(`    plan ${p.planid}/${p.priceid} "${p.planname}" servid=${p.servid}`);
      console.log(`        subscriptions  = ${JSON.stringify(p.subscriptions)}`);
      console.log(`        reg_serv_keys  = ${JSON.stringify(p.reg_serv_keys)}`);
    }
    const KNOWN = new Set(["internet", "ott", "fofi", "voicecall", "games", "cabletv"]);
    const anyRegKeyIsLabel = plans.some((p) =>
      Array.isArray(p.reg_serv_keys) && p.reg_serv_keys.some((k) => !KNOWN.has(String(k).toLowerCase())));
    const anySubsIsKey = plans.some((p) =>
      Array.isArray(p.subscriptions) && p.subscriptions.some((k) => KNOWN.has(String(k).toLowerCase())));

    if (anyRegKeyIsLabel) {
      ok("reg_serv_keys contains NON-service-key text",
         "sending it as `services` (what Android does) registers nothing");
    } else {
      meh("reg_serv_keys look like real service keys here",
          "Android's field would work on this deployment — ours still does too");
    }
    if (anySubsIsKey) ok("subscriptions contains real service keys", "safe to send as `services`");
    else meh("subscriptions has no recognised key", "resolveVoicePlanServices falls back to ['voicecall']");
  }

  // ── Claim C: reproduce the screenshot state ────────────────────────
  console.log("\n[C] A customer with NO voip — does the screenshot state reproduce?");
  let lineless = CUST && (await assigned("voicecall", CUST)).data?.body?.voip?.length === 0 ? CUST : null;
  if (!lineless) {
    for (const uid of pool.filter(Boolean).slice(0, 25)) {
      const a = await assigned("voicecall", uid);
      if (Array.isArray(a.data?.body?.voip) && a.data.body.voip.length === 0) { lineless = uid; break; }
    }
  }
  if (!lineless) {
    meh("no line-less customer found in the sample", "claim C not probed");
  } else {
    const pd = await post(`${BASE}ServiceApis/getMyPlanDetails`, {
      servicekey: "voicecall", userid: lineless, fofiboxid: "", voipnumber: "",
    });
    const osr = pd.data?.body?.other_service_renewal;
    console.log(`    customer ${lineless} (voip: none)`);
    console.log(`    err_code=${pd.data?.status?.err_code} btn_status=${JSON.stringify(osr?.btn_status)}`);
    console.log(`    message = ${JSON.stringify(osr?.message)}`);
    if (pd.data?.status?.err_code === 0 && osr?.message) {
      ok("plan details answer with the backend's own message on an empty voipnumber",
         "so the not-opted card has real text to show");
    } else {
      bad("plan details did not answer as expected", pd.data?.status?.err_msg || pd.text.slice(0, 120));
    }
    // The gate the operator must pass to open the plan list.
    const gate = await post(`${BASE}ServiceApis/validateBeforeFofiBoxReg`, {
      username: lineless, loginuname: OP,
    });
    console.log(`    validateBeforeFofiBoxReg -> err_code=${gate.data?.status?.err_code} "${gate.data?.status?.err_msg}"`);
    if (gate.data?.status?.err_code === 0) {
      ok("the upgrade privilege gate PASSES for a line-less customer",
         "the CTA this rewrite restored leads somewhere real");
    } else {
      meh("gate rejects this customer", gate.data?.status?.err_msg);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`${pass} pass · ${warn} warn · ${fail} fail`);
  console.log("\n[D] NOT PROBED: the voipnumbers-vs-voip_customers split. Confirming it");
  console.log("    live requires service/paymentinfo/voicecall, which reserves a");
  console.log("    transaction. Source: Voip_model.php:76-88 + ServiceApis.php:510-521.");
  process.exit(fail > 0 ? 1 : 0);
})();
