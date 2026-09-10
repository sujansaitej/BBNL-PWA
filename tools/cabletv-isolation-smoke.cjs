/**
 * cabletv-isolation-smoke — READ-ONLY probe for the Cable TV add-on flow.
 *
 * Usage:  node tools/cabletv-isolation-smoke.cjs <userid> [--env test|production]
 *
 * WHY THIS EXISTS
 * ---------------
 * QA (Aug 2026): buying only a Cable TV add-on also renewed the customer's
 * INTERNET for a month, and the cable bill landed in the Internet Receipt
 * Report. Cause: IPTVService.jsx followed cabletv/generateorder with
 * apis/savePaymentApi — the internet renewal endpoint. Android never does
 * that (EmployeeCommonPaymentInfoFragment.onViewClicked :405-410 branches
 * internet XOR cabletv, and CablePaymentInfoFragment :633-651 goes straight
 * from generateorder to the success dialog).
 *
 * This script captures the customer's INTERNET expiry alongside the cable
 * pricing so the operator can run it before and after a manual cable
 * purchase and prove the internet expiry did not move.
 *
 * SAFETY — READ-ONLY. It calls only info/list endpoints. It does NOT call
 * cabletv/generateorder or apis/savePaymentApi, so it neither places an
 * order nor debits a wallet. Do not add write endpoints here — see the same
 * warning in tools/contract-smoke.cjs.
 */

const fs = require("fs");
const path = require("path");

// ── args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const userid = args.find((a) => !a.startsWith("--"));
const envIdx = args.indexOf("--env");
const envName = envIdx !== -1 ? args[envIdx + 1] : "test";

if (!userid) {
  console.error("usage: node tools/cabletv-isolation-smoke.cjs <userid> [--env test|production]");
  process.exit(2);
}

// ── env ─────────────────────────────────────────────────────────────
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

const envFile = path.resolve(__dirname, "..", `.env.${envName}`);
const env = parseEnv(envFile);
if (!env.VITE_API_BASE_URL) {
  console.error(`No VITE_API_BASE_URL in ${envFile}`);
  process.exit(2);
}

const BASE = env.VITE_API_BASE_URL.endsWith("/") ? env.VITE_API_BASE_URL : env.VITE_API_BASE_URL + "/";
const OPERATOR = env.TEST_OP_USERNAME || "superadmin";

// Mirrors apiCore.mainHeaders().
const mainHeaders = () => ({
  Authorization: env.VITE_API_AUTH_KEY,
  username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE,
  appversion: env.VITE_API_APP_VERSION,
  "X-App-Package": "com.bbnl.smartphone",
  "Content-Type": "application/json",
});

async function post(url, body, headers = mainHeaders()) {
  const started = Date.now();
  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const ms = Date.now() - started;
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* keep raw */ }
  return { httpStatus: resp.status, ms, json, raw: text.slice(0, 400) };
}

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
};

// getUserAssignedItems does NOT return a flat array. Live shape (netmontest,
// 2026-08-14):  body: { fofi: [], voip: [], internet: [] }  — the same box can
// sit under any bucket depending on how the backend classified the customer,
// which is exactly why src/utils/boxId.js exists. Flatten every bucket.
function flattenAssigned(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (typeof body !== "object") return [];
  return Object.values(body).flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []));
}

const BOX_FIELDS = ["fofi_box_id", "fofiboxid", "itemid", "item_id", "boxid", "box_id", "macid", "casid"];
function findBoxId(items) {
  for (const item of items) {
    for (const f of BOX_FIELDS) {
      const v = item && item[f];
      if (v && String(v).trim()) return String(v).trim();
    }
  }
  return "";
}

(async () => {
  console.log(`\nCable-TV isolation probe — env=${envName}  base=${BASE}  userid=${userid}\n`);

  // ── 1. Internet state. This is the value QA must see UNCHANGED after a
  //       cable-only purchase. Read before AND after the purchase.
  const internet = await post(`${BASE}ServiceApis/getUserAssignedItems`, { servkey: "internet", userid });
  const internetItems = flattenAssigned(internet.json?.body);
  console.log("① INTERNET (must not move on a cable-only purchase)");
  console.log(`   HTTP ${internet.httpStatus} in ${internet.ms}ms  err_code=${internet.json?.status?.err_code}  items=${internetItems.length}`);
  for (const item of internetItems) {
    console.log("   ", JSON.stringify(pick(item, [
      "planname", "plan_name", "expirydate", "expiry_date", "expdate", "status", "activationdate",
    ])));
  }
  if (!internetItems.length) console.log("    raw:", internet.raw);

  // ── 2. Cable box + subscription state.
  const cable = await post(`${BASE}ServiceApis/getUserAssignedItems`, { servkey: "cabletv", userid });
  const cableItems = flattenAssigned(cable.json?.body);
  const boxId = findBoxId(cableItems);
  console.log("\n② CABLE TV assigned item");
  console.log(`   HTTP ${cable.httpStatus} in ${cable.ms}ms  err_code=${cable.json?.status?.err_code}  items=${cableItems.length}  boxId=${boxId || "(none)"}`);
  if (!boxId) {
    console.log("   No cable box for this user — pick a userid that has Cable TV assigned.");
    console.log("    raw:", cable.raw);
    process.exit(1);
  }

  // ── 3. Subscription day count. Drives cblextenperiod, and therefore price.
  const periods = await post(`${BASE}ServiceApis/planExtensionPeriods`, {
    userid, servkey: "cabletv", itemid: boxId,
  });
  const maxDays = periods.json?.body?.days_range?.max;
  console.log("\n③ planExtensionPeriods");
  console.log(`   HTTP ${periods.httpStatus} in ${periods.ms}ms  err_code=${periods.json?.status?.err_code}  days_range.max=${maxDays}`);

  // ── 4. Current subscription — the package/channel ids to re-price with.
  const lastSub = await post(`${BASE}ServiceApis/iptvLastSubscribedinfo`, { userid, itemid: boxId });
  const subBody = lastSub.json?.body || {};
  const pkgIds = Array.isArray(subBody.packageid) ? subBody.packageid.map(String) : [];
  const chIds = Array.isArray(subBody.channelid) ? subBody.channelid.map(String) : [];
  console.log("\n④ iptvLastSubscribedinfo");
  console.log(`   HTTP ${lastSub.httpStatus} in ${lastSub.ms}ms  err_code=${lastSub.json?.status?.err_code}  packages=${pkgIds.length} channels=${chIds.length}`);

  // ── 5. THE pricing call the checkout makes. Field-for-field the payload
  //       IPTVService.requestCablePaymentDetails() sends, which mirrors
  //       CablePaymentInfoFragment.IPTVPaymentInfo() :749-764.
  const payload = {
    cblextenperiod: String(maxDays || 30),
    channelid: chIds,
    fofi_box_id: boxId,
    lcochid: chIds,
    packageid: pkgIds,
    pkgcode: pkgIds,
    planid: "",
    priceid: "",
    servapptype: "crmapp",
    servid: "1",
    userid,
    username: OPERATOR,
    voipnumber: "",
  };
  const info = await post(`${BASE}service/paymentinfo/cabletv`, payload);
  const b = info.json?.body || {};
  console.log("\n⑤ service/paymentinfo/cabletv  (pricing — READ ONLY)");
  console.log(`   HTTP ${info.httpStatus} in ${info.ms}ms  err_code=${info.json?.status?.err_code} ${info.json?.status?.err_msg || ""}`);
  console.log("   ", JSON.stringify(pick(b, [
    "total_amt", "paidamount", "grandtotal", "oprtrshare", "optrshare", "transactionid",
  ])));
  if (!info.json?.body) console.log("    raw:", info.raw);

  console.log("\n⑥ WALLET");
  const wallet = await post(`${BASE}ServiceApis/myWallet`, {
    loginuname: OPERATOR, servicekey: "cabletv",
  });
  console.log(`   HTTP ${wallet.httpStatus} in ${wallet.ms}ms  balance=${wallet.json?.body?.wallet_balance}`);

  console.log(`
─────────────────────────────────────────────────────────────────────
HOW TO USE THIS FOR THE QA RE-TEST
  1. Run this script. Note ① internet expirydate and ⑥ wallet balance.
  2. In the PWA test build, buy a Cable TV add-on for this same userid.
  3. Run this script again.
     PASS  → ① internet expirydate is IDENTICAL, ⑥ wallet has dropped.
     FAIL  → ① internet expirydate moved forward ~1 month.
  4. Also confirm the cable bill is absent from the Internet Receipt Report.
─────────────────────────────────────────────────────────────────────
`);
})().catch((err) => {
  console.error("\nProbe failed:", err?.message || err);
  process.exit(1);
});
