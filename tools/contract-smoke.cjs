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

const envFile = PROD ? "env.production" : "env.development";
const env = parseEnv(path.resolve(__dirname, "..", envFile));
if (!env.VITE_API_BASE_URL) {
  console.error(`No VITE_API_BASE_URL in ${envFile}`);
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
