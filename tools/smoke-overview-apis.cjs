// Smoke test for the customer-overview + FoFi API contracts and latency.
//
// Guards the exact failure modes fixed on 2026-07-09:
//   1. specialInternetPlans returning body as a BARE ARRAY (the Link FoFi
//      Box dropdown parser must extract >0 rows or the flow shows
//      "No IPTV / Combo plans are available" forever).
//   2. registrationNecessities must carry a non-empty fofi_plans array
//      (feeds ADD FO-FI BOX / UPGRADE plan pickers).
//   3. Latency report for the calls that gate overview first paint —
//      getUserAssignedItems and validateBeforeFofiBoxReg are known to be
//      6-8s server-side; if getMyPlanDetails ever degrades to that class
//      the "paint plan section early" optimisation stops helping.
//
// Usage: node tools/smoke-overview-apis.cjs [userid]
//   Reads credentials from .env.development (falls back to .env.production).
//   Exits non-zero when a contract assertion fails.

const fs = require('fs');
const path = require('path');

function parseEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const idx = l.indexOf('=');
    if (idx === -1) continue;
    env[l.slice(0, idx).trim()] = l.slice(idx + 1).trim().replace(/^"|"$/g, '');
  }
  return env;
}

const root = path.resolve(__dirname, '..');
const env = { ...parseEnv(path.join(root, '.env.production')), ...parseEnv(path.join(root, '.env.development')) };

const BASE = env.VITE_API_BASE_URL;
const USERID = process.argv[2] || env.TEST_USERID || 'iptvuser';
const LOGUNAME = env.TEST_OP_USERNAME || 'superadmin';
const HJSON = {
  Authorization: env.VITE_API_AUTH_KEY,
  username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE || 'employee',
  appversion: env.VITE_API_APP_VERSION || '1.2.0',
  'Content-Type': 'application/json',
};

// MUST mirror getInternetOriginPlanRows in src/pages/services/FoFiSmartBox.jsx —
// if the app parser and this assertion drift apart, this test is lying.
function getInternetOriginPlanRows(response) {
  const body = response?.body || {};
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.internet_plans)) return body.internet_plans;
  for (const key of ['iptv_combo_plans', 'iptv_plans', 'combo_plans', 'internet_combo_plans', 'plans']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

async function post(name, apiPath, payload) {
  const t0 = Date.now();
  const resp = await fetch(BASE + apiPath, { method: 'POST', headers: HJSON, body: JSON.stringify(payload) });
  const ms = Date.now() - t0;
  let json = null;
  try { json = await resp.json(); } catch { /* asserted below */ }
  console.log(`\n${name}: HTTP ${resp.status} in ${ms} ms`);
  return { json, ms, status: resp.status };
}

(async () => {
  if (!BASE) { console.error('No VITE_API_BASE_URL found in env files'); process.exit(2); }
  console.log(`Base: ${BASE}  userid: ${USERID}  logUname: ${LOGUNAME}`);

  // 1) Link FoFi Box (from Internet overview) — plan list contract
  const sip = await post('specialInternetPlans', 'ServiceApis/specialInternetPlans', { logUname: LOGUNAME, isKiranastore: 'no' });
  assert(sip.json?.status?.err_code === 0, 'specialInternetPlans err_code === 0');
  const rows = getInternetOriginPlanRows(sip.json);
  assert(rows.length > 0, `Link-FoFi parser extracts plan rows (got ${rows.length})`);
  assert(rows.every(r => r?.srvid || r?.servid || r?.planid || r?.id), 'every extracted row has a usable plan id');
  assert(rows.every(r => r?.serv_name || r?.planname || r?.plan_name || r?.name), 'every extracted row has a display name');

  // 2) ADD FO-FI BOX plan picker contract
  const reg = await post('registrationNecessities', 'ServiceApis/registrationNecessities', { logUname: LOGUNAME, moduletype: 'upgradation', userid: USERID });
  assert(reg.json?.status?.err_code === 0, 'registrationNecessities err_code === 0');
  assert(Array.isArray(reg.json?.body?.fofi_plans) && reg.json.body.fofi_plans.length > 0,
    `registrationNecessities body.fofi_plans is non-empty (got ${reg.json?.body?.fofi_plans?.length ?? 'missing'})`);

  // 3) Overview-critical latency report (informational thresholds)
  const plan = await post('getMyPlanDetails(internet)', 'ServiceApis/getMyPlanDetails', { servicekey: 'internet', userid: USERID, fofiboxid: '', voipnumber: '' });
  assert(plan.json?.status?.err_code === 0, 'getMyPlanDetails(internet) err_code === 0');
  if (plan.ms > 3000) console.warn(`  WARN  getMyPlanDetails took ${plan.ms} ms — the fast-paint path assumes this stays fast`);

  const uai = await post('getUserAssignedItems(internet)', 'ServiceApis/getUserAssignedItems', { servkey: 'internet', userid: USERID });
  assert(uai.json?.status?.err_code === 0, 'getUserAssignedItems err_code === 0');
  if (uai.ms > 10000) console.warn(`  WARN  getUserAssignedItems took ${uai.ms} ms — worse than the known 6-8s baseline`);

  const val = await post('validateBeforeFofiBoxReg', 'ServiceApis/validateBeforeFofiBoxReg', { username: USERID, loginuname: LOGUNAME });
  assert(val.json?.status?.err_code !== undefined, 'validateBeforeFofiBoxReg returns a status');
  if (val.ms > 10000) console.warn(`  WARN  validateBeforeFofiBoxReg took ${val.ms} ms — worse than the known 6-8s baseline`);

  console.log(failures === 0 ? '\nAll contract checks passed.' : `\n${failures} contract check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Smoke test crashed:', e); process.exit(2); });
