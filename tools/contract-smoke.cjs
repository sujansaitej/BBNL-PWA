/**
 * contract-smoke — READ-ONLY live contract probe for IPTV / FoFi / Internet.
 *
 * Usage:  node tools/contract-smoke.cjs            (staging, default)
 *         node tools/contract-smoke.cjs --prod     (production — read-only, be deliberate)
 *         node tools/contract-smoke.cjs --json     (machine-readable, for fixture capture)
 *
 * WHY THIS EXISTS
 * ---------------
 * The unit tests in src/services/*.test.js assert our BELIEF about the wire
 * contract, derived from the Android ApiInterface. That belief has been wrong
 * before: the audit inferred a single {status:{err_code},body} envelope from
 * Android's Gson models, but real traffic shows apis/* returns {error,result}
 * with no status block at all. A mocked test would have happily asserted the
 * wrong shape forever.
 *
 * This script asks the real backend instead. It is the ground truth the unit
 * tests are calibrated against.
 *
 * SAFETY — READ-ONLY. Every endpoint below is a GET or an info/list POST.
 * Nothing here debits a wallet, generates an order, registers a customer, or
 * uploads a document. Do NOT add savePaymentApi, cabletv/generateorder,
 * custservregistration, custKYC, or upgradeRegistration to this file. If you
 * need to exercise a write path, that is a separate, deliberate script with a
 * confirmation prompt.
 */

const fs = require("fs");
const path = require("path");

const PROD = process.argv.includes("--prod");
const JSON_OUT = process.argv.includes("--json");

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

// Vite's convention is a LEADING DOT (.env.production). The original names
// here omitted it, so parseEnv silently read nothing and the script exited 2
// on every run — it had never actually executed. Try both, dotted first.
const envCandidates = PROD
  ? [".env.production", "env.production"]
  : [".env.development", "env.development"];

let envFile = null;
let env = {};
for (const candidate of envCandidates) {
  const resolved = path.resolve(__dirname, "..", candidate);
  if (!fs.existsSync(resolved)) continue;
  env = parseEnv(resolved);
  envFile = candidate;
  if (env.VITE_API_BASE_URL) break;
}
if (!env.VITE_API_BASE_URL) {
  console.error(`No VITE_API_BASE_URL in any of: ${envCandidates.join(", ")}`);
  process.exit(2);
}

const BASE = env.VITE_API_BASE_URL.replace(/\/$/, "") + "/";
const IPTV_BASE = (env.VITE_IPTV_API_BASE_URL || "").startsWith("http")
  ? env.VITE_IPTV_API_BASE_URL
  : `${BASE}Cabletvapis`;

// ── header profiles (mirrors src/services/apiCore.js) ───────────────
const mainHeaders = (contentType) => ({
  Authorization: env.VITE_API_AUTH_KEY,
  username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE,
  appversion: env.VITE_API_APP_VERSION,
  "X-App-Package": "com.bbnl.smartphone",
  ...(contentType ? { "Content-Type": contentType } : {}),
});

const paymentHeaders = (contentType) => ({
  Authorization: env.VITE_INTERNET_PAYMENT_AUTH_KEY || env.VITE_API_AUTH_KEY,
  username: env.VITE_INTERNET_PAYMENT_USERNAME || env.VITE_API_USERNAME,
  password: env.VITE_INTERNET_PAYMENT_PASSWORD || env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE,
  appversion: env.VITE_API_APP_VERSION,
  "X-App-Package": "com.bbnl.smartphone",
  ...(contentType ? { "Content-Type": contentType } : {}),
});

// The third credential set. VERIFIED 2026-07-17 against staging: apis/
// custpayhistory rejects both the main and internet-payment credentials with
// "Header Authorization Failed!" and accepts ONLY these. They are load-bearing,
// not leftovers — the audit wrongly flagged them as unexplained. Note the
// header is `apptype`, NOT `appkeytype`; that too is required. Mirrors the
// hardcoded set in src/services/orderApis.js.
const orderHistoryHeaders = (contentType) => ({
  Authorization: "c4f79e15f8c6ed0715a8ea44aebc38d8",
  username: "e2798af12a7a0f4f70b4d69efbc25f4d",
  password: "c1f377afbaa874acbb6b61f66957710a",
  apptype: "employee",
  ...(contentType ? { "Content-Type": contentType } : {}),
});

const iptvHeaders = () => ({
  Authorization:
    "Basic " +
    Buffer.from(
      `${env.VITE_IPTV_API_USERNAME}:${env.VITE_IPTV_API_PASSWORD}`
    ).toString("base64"),
  "x-api-key": env.VITE_IPTV_API_AUTH_KEY,
  "Content-Type": "application/json",
});

// ── envelope classification ─────────────────────────────────────────
// The backend speaks THREE dialects, and — verified against live staging on
// 2026-07-17 — the dialect is a property of the ENDPOINT, not the namespace.
// All three of these live under apis/*:
//
//   apis/makepayment     → {error, atomconfig, result}   (ERROR dialect)
//   apis/custpayhistory  → {status:{err_code}, body}     (STATUS dialect)
//   apis/webads          → {count, imglist}              (NONE — no envelope)
//
// So you cannot infer the dialect from the URL prefix. Do not try.
//
// One more trap: an AUTH FAILURE always answers in the STATUS dialect, even
// on an endpoint whose success response is ERROR. Probing apis/custpayhistory
// with the wrong credentials returns {status:{err_code:1,err_msg:"Header
// Authorization Failed!"}} — which is why FofiPayment.jsx checks BOTH
// status.err_code AND error. That code is correct, not confused.
//
// Getting this wrong is the ads() bug: gating a NONE-dialect endpoint on
// status.err_code fails closed and silently blanks the feature.
const ENVELOPE = {
  STATUS: "status/body", //  {status:{err_code,err_msg}, body}
  ERROR: "error/result", //  {error, result}
  NONE: "no-envelope", //   bare payload, e.g. {count, imglist}
  UNKNOWN: "unknown", //    non-JSON / unrecognised
};

function classify(data) {
  if (data && typeof data === "object") {
    if (data.status && "err_code" in data.status) return ENVELOPE.STATUS;
    if ("error" in data) return ENVELOPE.ERROR;
    if (Object.keys(data).length) return ENVELOPE.NONE;
  }
  return ENVELOPE.UNKNOWN;
}

function ok(data, envelope) {
  if (envelope === ENVELOPE.STATUS) return Number(data?.status?.err_code) === 0;
  if (envelope === ENVELOPE.ERROR) return Number(data?.error) === 0;
  // NONE has no success signal beyond HTTP 200 + parseable JSON.
  if (envelope === ENVELOPE.NONE) return true;
  return false;
}

// ── probe runner ────────────────────────────────────────────────────
const results = [];

async function probe({ flow, name, url, method = "GET", headers, body, expect }) {
  const started = Date.now();
  let httpStatus = 0,
    data = null,
    raw = "",
    err = null;
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });
    httpStatus = resp.status;
    raw = await resp.text();
    try {
      data = JSON.parse(raw);
    } catch (_) {
      err = "non-JSON response";
    }
  } catch (e) {
    err = e.name === "TimeoutError" ? "timeout (30s)" : e.message;
  }
  const ms = Date.now() - started;

  const envelope = err ? ENVELOPE.UNKNOWN : classify(data);
  const success = !err && ok(data, envelope);
  const envelopeMatches = expect ? envelope === expect : null;

  results.push({
    flow,
    name,
    url,
    httpStatus,
    ms,
    envelope,
    expectedEnvelope: expect || null,
    envelopeMatches,
    success,
    err,
    errMsg: data?.status?.err_msg ?? data?.result ?? null,
    topLevelKeys: data && typeof data === "object" ? Object.keys(data) : [],
    bodyType: Array.isArray(data?.body)
      ? "array"
      : data?.body && typeof data.body === "object"
      ? "object"
      : data?.body === undefined
      ? "absent"
      : typeof data?.body,
    sample: raw.slice(0, 240),
  });
}

// ── the probes ──────────────────────────────────────────────────────
async function run() {
  const U = env.TEST_USERNAME || "superadmin";
  const UID = env.TEST_USERID || "iptvuser";
  const OP = env.TEST_OP_ID || "BBNL_OP49";
  const MOB = env.VITE_IPTV_DEFAULT_MOBILE || "7019260650";

  // ---- shared / service discovery -------------------------------------
  await probe({
    flow: "CORE",
    name: "servServiceList",
    url: `${BASE}ServiceApis/servServiceList?servtype=all&iskirana=false`,
    headers: mainHeaders(),
    expect: ENVELOPE.STATUS,
  });

  // ---- IPTV (Cabletvapis, Basic auth + x-api-key) ----------------------
  await probe({
    flow: "IPTV",
    name: "ftauserlanglist",
    url: `${IPTV_BASE}/ftauserlanglist`,
    method: "POST",
    headers: iptvHeaders(),
    body: JSON.stringify({ mobile: MOB }),
    expect: ENVELOPE.STATUS,
  });
  await probe({
    flow: "IPTV",
    name: "ftauserchnllist",
    url: `${IPTV_BASE}/ftauserchnllist`,
    method: "POST",
    headers: iptvHeaders(),
    body: JSON.stringify({ mobile: MOB, grid: "", bcid: "", langid: "", search: "" }),
    expect: ENVELOPE.STATUS,
  });
  await probe({
    flow: "IPTV",
    name: "ftauserads",
    url: `${IPTV_BASE}/ftauserads`,
    method: "POST",
    headers: iptvHeaders(),
    body: JSON.stringify({
      mobile: MOB,
      adclient: "",
      srctype: "",
      displayarea: "",
      displaytype: "",
    }),
    expect: ENVELOPE.STATUS,
  });

  // ---- FoFi -----------------------------------------------------------
  await probe({
    flow: "FOFI",
    name: "getFoFiPlans",
    url: `${BASE}ServiceApis/getFoFiPlans`,
    headers: mainHeaders(),
    expect: ENVELOPE.STATUS,
  });
  await probe({
    flow: "FOFI",
    name: "specialInternetPlans",
    url: `${BASE}ServiceApis/specialInternetPlans`,
    method: "POST",
    headers: mainHeaders("application/json"),
    body: JSON.stringify({ logUname: U, isKiranastore: "false" }),
    expect: ENVELOPE.STATUS,
  });
  await probe({
    flow: "FOFI",
    name: "registrationNecessities",
    url: `${BASE}ServiceApis/registrationNecessities`,
    method: "POST",
    headers: mainHeaders("application/json"),
    body: JSON.stringify({ logUname: U, moduletype: "fofi", userid: UID }),
    expect: ENVELOPE.STATUS,
  });
  await probe({
    flow: "FOFI",
    name: "validateBeforeFofiBoxReg",
    url: `${BASE}ServiceApis/validateBeforeFofiBoxReg`,
    method: "POST",
    headers: mainHeaders("application/json"),
    body: JSON.stringify({ username: UID, loginuname: U }),
    expect: ENVELOPE.STATUS,
  });
  await probe({
    flow: "FOFI",
    name: "getMyPlanDetails",
    url: `${BASE}ServiceApis/getMyPlanDetails`,
    method: "POST",
    headers: mainHeaders("application/json"),
    body: JSON.stringify({
      fofiboxid: "",
      servicekey: "fofi",
      userid: UID,
      voipnumber: "",
    }),
    expect: ENVELOPE.STATUS,
  });

  // ---- Internet -------------------------------------------------------
  await probe({
    flow: "INTERNET",
    name: "getUserAssignedItems",
    url: `${BASE}ServiceApis/getUserAssignedItems`,
    method: "POST",
    headers: mainHeaders("application/json"),
    body: JSON.stringify({ servkey: "internet", userid: UID }),
    expect: ENVELOPE.STATUS,
  });
  // apis/* — the OTHER dialect. Expect {error,result}, NOT status/body.
  await probe({
    flow: "INTERNET",
    name: "makepayment (info only, no debit)",
    url: `${BASE}apis/makepayment`,
    method: "POST",
    headers: paymentHeaders("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      apiopid: OP,
      apptype: env.VITE_API_APP_KEY_TYPE || "crmapp",
      apiuserid: UID,
    }).toString(),
    expect: ENVELOPE.ERROR,
  });
  // custpayhistory needs the THIRD credential set and answers in the STATUS
  // dialect — both verified live. Using paymentHeaders here returns
  // "Header Authorization Failed!".
  await probe({
    flow: "INTERNET",
    name: "custpayhistory (3rd cred set)",
    url: `${BASE}apis/custpayhistory`,
    method: "POST",
    headers: orderHistoryHeaders("application/x-www-form-urlencoded"),
    body: new URLSearchParams({ apiopid: OP, cid: UID }).toString(),
    expect: ENVELOPE.STATUS,
  });
  // webads — the endpoint that burned us. Verified: returns {count, imglist}
  // with NO status block, which is why ads() must not use readEnvelope.
  await probe({
    flow: "INTERNET",
    name: "webads (no envelope)",
    url: `${BASE}apis/webads`,
    method: "POST",
    headers: paymentHeaders("application/x-www-form-urlencoded"),
    body: new URLSearchParams({ type: "1" }).toString(),
    expect: ENVELOPE.NONE,
  });

  // ---- Customer tickets ----------------------------------------------
  // SAFETY: only the five READ-ONLY ticket endpoints are probed here.
  // apis/raiseTicket/ and Apis/closeticket are WRITE paths — raising or
  // closing a real customer's complaint from a smoke run is not acceptable.
  // Do not add them. (raiseTicket is especially deceptive: it is a GET, so it
  // looks harmless, but it creates a ticket.)
  //
  // What we are actually validating without a customer login: that each path
  // EXISTS with the casing we ship (a 404 here means the mixed apis/ vs Apis/
  // casing is wrong), that the APIS credential block is accepted (an auth
  // failure answers "Header Authorization Failed!"), and which envelope
  // dialect each speaks. A per-customer err_code for a bogus test id is
  // expected and is NOT a failure.
  const apisTicketHeaders = (contentType) => ({
    Authorization: "c4f79e15f8c6ed0715a8ea44aebc38d8",
    username: "e2798af12a7a0f4f70b4d69efbc25f4d",
    password: "c1f377afbaa874acbb6b61f66957710a",
    apptype: "customerapp-v1",
    ...(contentType ? { "Content-Type": contentType } : {}),
  });
  const SVCKEY = env.TEST_SERVICEKEY || "internet";
  const SERVID = env.TEST_SERVID || "1";

  await probe({
    flow: "TICKETS",
    name: "maintenance (APIS creds)",
    url: `${BASE}apis/maintenance/`,
    method: "POST",
    headers: apisTicketHeaders("application/x-www-form-urlencoded"),
    body: new URLSearchParams({ apiopid: OP, cid: UID, servicekey: SVCKEY }).toString(),
    expect: ENVELOPE.STATUS,
  });
  // subjects returns err_code 1 ON SUCCESS, so the [FAIL] marker below is
  // expected and meaningless for this row — read `body:` and `keys:` instead.
  await probe({
    flow: "TICKETS",
    name: "subjects (err_code 1 = ok)",
    url: `${BASE}apis/subjects/?${new URLSearchParams({ apiopid: OP, cid: UID, servid: SERVID })}`,
    headers: apisTicketHeaders(),
    expect: ENVELOPE.STATUS,
  });
  // Nested pingingstatus/ticketstatus blocks — NOT the standard status/body
  // envelope, so classify() will report it as NONE. That is correct and is
  // exactly why checkPendingTickets must not use readEnvelope.
  await probe({
    flow: "TICKETS",
    name: "cust/pendingticket (nested status)",
    url: `${BASE}apis/cust/pendingticket/`,
    method: "POST",
    headers: apisTicketHeaders("application/x-www-form-urlencoded"),
    body: new URLSearchParams({ userid: UID, servicekey: SVCKEY }).toString(),
  });
  await probe({
    flow: "TICKETS",
    name: "gettickets (capital Apis/, no auth)",
    url: `${BASE}Apis/gettickets/?${new URLSearchParams({
      userid: UID,
      mobile: MOB,
      userstatus: "registereduser",
      totalno: "300",
      servicekey: SVCKEY,
    })}`,
    expect: ENVELOPE.STATUS,
  });
  // Bare-string body. A non-existent ticket id is safe — this only reads.
  await probe({
    flow: "TICKETS",
    name: "getParticularTicketStatus (string body)",
    url: `${BASE}Apis/getParticularTicketStatus/`,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ticketid: env.TEST_TICKETID || "0",
      servicekey: SVCKEY,
    }).toString(),
  });

  // ---- Customer link-account + service home -------------------------
  // SAFETY: read-only probes only. The following are WRITE paths and must
  // NEVER be added here:
  //   ServiceApis/custServiceOtp          — links an account / sends a real OTP
  //   ServiceApis/custServOtpVerification — completes a link
  //   ServiceApis/delServRegCasNos        — UNLINKS an account
  //   apis/cust/resetmac/                 — drops the customer's MAC binding
  //                                          and can disconnect their device
  await probe({
    flow: "LINKACCT",
    name: "getServRegCastNos (linked ids)",
    url: `${BASE}ServiceApis/getServRegCastNos?${new URLSearchParams({ servid: "1", username: U })}`,
    headers: mainHeaders(),
    expect: ENVELOPE.STATUS,
  });
  await probe({
    flow: "LINKACCT",
    name: "pkgCategories",
    url: `${BASE}ServiceApis/pkgCategories?${new URLSearchParams({ username: U, userid: UID })}`,
    method: "POST",
    headers: mainHeaders(),
    expect: ENVELOPE.STATUS,
  });
  // Internet payment history — {error,resultcount,result[]} dialect, no auth.
  await probe({
    flow: "LINKACCT",
    name: "takebill (payment history)",
    url: `${BASE}apis/takebill/`,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ apiopid: OP, apiuserid: UID }).toString(),
    expect: ENVELOPE.ERROR,
  });
  // Data usage lives on a DIFFERENT HOST with no auth. Dates are d-M-yyyy
  // unpadded, exactly as Android sends them.
  // Deliberately the absolute upstream URL, not the app's /usage-api proxy
  // path: this script runs in Node (no CORS) and its job is to verify the
  // UPSTREAM contract. The app itself must go through the proxy — the host
  // returns a static ACAO of https://bbnl.co.in and blocks every browser.
  await probe({
    flow: "LINKACCT",
    name: "overallAvgUsageReport (other host)",
    url: "https://payurbills.co.in/best2/General/overallAvgUsageReport/",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      apiopid: OP,
      apiuserid: UID,
      fromdt: "1-7-2026",
      todt: "18-7-2026",
    }).toString(),
    expect: ENVELOPE.ERROR,
  });

  // ── report ─────────────────────────────────────────────────────────
  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\n  contract-smoke → ${PROD ? "PRODUCTION" : "STAGING"}  (${BASE})`);
  console.log(`  READ-ONLY. ${results.length} probes.\n`);

  let flow = null;
  for (const r of results) {
    if (r.flow !== flow) {
      flow = r.flow;
      console.log(`  ── ${flow} ${"─".repeat(58 - flow.length)}`);
    }
    const mark = r.err ? "ERR " : r.success ? " OK " : "FAIL";
    const envNote =
      r.envelopeMatches === false
        ? `  ⚠ envelope ${r.envelope} (expected ${r.expectedEnvelope})`
        : r.expectedEnvelope === null
        ? `  → envelope: ${r.envelope}`
        : "";
    console.log(
      `  [${mark}] ${r.name.padEnd(34)} HTTP ${String(r.httpStatus).padEnd(4)} ${String(r.ms).padStart(5)}ms  ${r.envelope}${envNote}`
    );
    if (r.err) console.log(`         error: ${r.err}`);
    else if (!r.success && r.errMsg) console.log(`         err_msg: ${JSON.stringify(r.errMsg)}`);
    if (r.envelope === "status/body") console.log(`         body: ${r.bodyType}`);
    if (r.topLevelKeys.length) console.log(`         keys: [${r.topLevelKeys.join(", ")}]`);
  }

  const errs = results.filter((r) => r.err).length;
  const fails = results.filter((r) => !r.err && !r.success).length;
  const mismatches = results.filter((r) => r.envelopeMatches === false).length;
  console.log(
    `\n  ${results.length - errs - fails} ok · ${fails} api-failure · ${errs} transport-error · ${mismatches} envelope-mismatch\n`
  );

  // Envelope mismatches are the ONLY thing that fails this script. An
  // api-failure (err_code != 0) is often legitimate — a test user with no
  // FoFi box genuinely has no plan. A wrong ENVELOPE means our client-side
  // success check is structurally wrong, which is a real bug every time.
  process.exit(mismatches > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("smoke run failed:", e);
  process.exit(2);
});
