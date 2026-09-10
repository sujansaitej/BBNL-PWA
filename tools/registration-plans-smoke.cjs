/**
 * registration-plans-smoke — READ-ONLY probe of ServiceApis/registrationNecessities.
 *
 * Usage:  node tools/registration-plans-smoke.cjs           (staging)
 *         node tools/registration-plans-smoke.cjs --prod    (production, read-only)
 *         node tools/registration-plans-smoke.cjs --dump    (also print raw rows)
 *
 * WHY
 * ---
 * `Plans.jsx` used to read `body.internet_plans` alone. It now builds the
 * registration list from fofi_plans + multi_plans + internet_plans, matching
 * Android's ServicePlansListAdapter registration constructor (:46-57), because
 * that is the ONLY way a plan carrying a `voicecall` service key — and
 * therefore a VOIP line — can be selected at registration.
 *
 * Everything in src/services/registrationPlans.test.js is asserted against a
 * HAND-WRITTEN fixture. This script asks the real backend whether that fixture
 * is honest: do the buckets exist, do the bundle rows carry `reg_serv_keys`,
 * and does any row actually list "voicecall"?
 *
 * SAFETY — READ-ONLY. registrationNecessities is a plan/config lookup. It
 * creates nothing, debits nothing, and registers nobody. Do NOT add
 * custservregistration or any write endpoint to this file.
 */

const fs = require("fs");
const path = require("path");

const PROD = process.argv.includes("--prod");
const DUMP = process.argv.includes("--dump");

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

const envFile = PROD ? ".env.production" : ".env.development";
const env = parseEnv(path.resolve(__dirname, "..", envFile));
if (!env.VITE_API_BASE_URL) {
  console.error(`No VITE_API_BASE_URL in ${envFile}`);
  process.exit(2);
}

const BASE = env.VITE_API_BASE_URL.endsWith("/")
  ? env.VITE_API_BASE_URL
  : env.VITE_API_BASE_URL + "/";
const U = env.TEST_OP_USERNAME || "superadmin";

const headers = {
  Authorization: env.VITE_API_AUTH_KEY,
  username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE,
  appversion: env.VITE_API_APP_VERSION,
  "X-App-Package": "com.bbnl.smartphone",
  "Content-Type": "application/json",
};

const BUCKETS = ["fofi_plans", "multi_plans", "internet_plans", "voicecall_plans"];
// The three the REGISTRATION list is built from, in Android's order.
const REGISTRATION_BUCKETS = ["fofi_plans", "multi_plans", "internet_plans"];

let failures = 0;
const ok = (m) => console.log(`  [ OK ] ${m}`);
const bad = (m) => { failures++; console.log(`  [FAIL] ${m}`); };
const info = (m) => console.log(`         ${m}`);

(async () => {
  console.log(`\nregistrationNecessities — ${PROD ? "PRODUCTION" : "staging"} (${BASE})`);
  console.log(`logUname: ${U}\n`);

  // Exactly what Plans.jsx sends: submitRegistrationNecessities(logUname).
  const resp = await fetch(`${BASE}ServiceApis/registrationNecessities`, {
    method: "POST",
    headers,
    body: JSON.stringify({ logUname: U }),
    signal: AbortSignal.timeout(30000),
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    bad(`non-JSON response (HTTP ${resp.status}): ${raw.slice(0, 200)}`);
    process.exit(1);
  }

  if (data?.status?.err_code !== 0 && String(data?.status?.err_code) !== "0") {
    bad(`err_code ${data?.status?.err_code}: ${data?.status?.err_msg}`);
    process.exit(1);
  }
  ok(`HTTP ${resp.status}, err_code 0`);

  const body = data.body || {};
  info(`body keys: ${Object.keys(body).join(", ")}`);
  console.log("");

  // ── 1. Do the registration buckets exist? ──────────────────────────────
  for (const b of BUCKETS) {
    const arr = body[b];
    const present = Array.isArray(arr);
    const n = present ? arr.length : 0;
    const required = REGISTRATION_BUCKETS.includes(b);
    if (present) {
      ok(`${b.padEnd(16)} present, ${n} row(s)`);
    } else if (required) {
      bad(`${b.padEnd(16)} MISSING — Plans.jsx expects this bucket`);
    } else {
      info(`${b.padEnd(16)} absent (fine — registration does not list it)`);
    }
  }
  console.log("");

  // ── 2. Do bundle rows carry the service keys we branch on? ─────────────
  const voiceCarrying = [];
  for (const b of ["fofi_plans", "multi_plans"]) {
    const rows = Array.isArray(body[b]) ? body[b] : [];
    for (const r of rows) {
      const keys = Array.isArray(r.reg_serv_keys)
        ? r.reg_serv_keys
        : Array.isArray(r.subscriptions)
          ? r.subscriptions
          : null;
      const label = `${b}[planid=${r.planid}] "${r.planname}"`;
      if (!keys) {
        bad(`${label} has NEITHER reg_serv_keys NOR subscriptions — services would default to ["internet"]`);
        continue;
      }
      info(`${label} → [${keys.join(", ")}]  rate=${r.planrate} priceid=${r.priceid} servid=${r.servid}`);
      if (keys.includes("voicecall")) voiceCarrying.push(label);
      // The fields Subscribe.jsx copies into the registration payload.
      for (const f of ["planid", "priceid", "planname", "servid"]) {
        if (r[f] === undefined || r[f] === null || r[f] === "") {
          bad(`${label} is missing ${f} — the registration payload would send a blank`);
        }
      }
    }
  }
  console.log("");

  // ── 3. internet_plans shape (unchanged path, guard against drift) ──────
  const inet = Array.isArray(body.internet_plans) ? body.internet_plans : [];
  if (inet.length) {
    const r = inet[0];
    const shapeOk =
      (r.servid ?? r.srvid) !== undefined &&
      Array.isArray(r.serv_rates?.prices) &&
      Array.isArray(r.serv_rates?.labels);
    if (shapeOk) ok(`internet_plans shape intact (servid + serv_rates.prices/labels)`);
    else bad(`internet_plans shape changed: ${JSON.stringify(r).slice(0, 220)}`);
    info(`first: servid=${r.servid} "${r.serv_name}" ${r.serv_rates?.prices?.[0]}`);
  } else {
    info("internet_plans empty — cannot verify shape");
  }

  if (Array.isArray(body.groups)) ok(`groups present (${body.groups.length}) — Subscribe.jsx internet group picker`);
  else bad("groups MISSING — the internet group dropdown would be empty");

  console.log("");

  // ── 4. The headline question ──────────────────────────────────────────
  if (voiceCarrying.length) {
    ok(`VOIP-capable registration plans: ${voiceCarrying.length}`);
    voiceCarrying.forEach((v) => info(v));
    info("→ selecting one registers a voice line; the backend returns body.voipno.");
  } else {
    info("NOTE: no plan on this operator carries a `voicecall` service key.");
    info("      The wiring is still correct, but VOIP registration cannot be");
    info("      exercised end-to-end here until BBNL configures such a plan.");
    info("      This is a DATA gap, not a code failure — not counted as a failure.");
  }

  if (DUMP) {
    console.log("\n--- raw buckets ---");
    for (const b of BUCKETS) {
      console.log(`\n${b}:`, JSON.stringify(body[b], null, 2)?.slice(0, 4000));
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : failures + " FAILURE(S)"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("probe error:", e.message);
  process.exit(1);
});
