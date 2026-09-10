// External-exposure smoke test (READ-ONLY).
//
// Purpose: from whatever IP this machine is currently egressing on (here: an
// external, non-org network), prove whether the production API/proxy layer
// will accept our stored credentials and return live DB-backed records.
// This tests NETWORK EXPOSURE only — it makes no writes, no payments, no
// mutations. It stops at the proxy/API layer (no raw DB socket, no injection).
//
// Usage: node tools/ext-exposure-smoke.cjs
//   Reads credentials from .env.production.

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

const env = parseEnv(path.resolve(__dirname, '..', '.env.production'));
const BASE = env.VITE_API_BASE_URL;
const LOGUNAME = env.TEST_OP_USERNAME || 'superadmin';

const HJSON = {
  Authorization: env.VITE_API_AUTH_KEY,
  username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE || 'employee',
  appversion: env.VITE_API_APP_VERSION || '1.2.0',
  'Content-Type': 'application/json',
};

// --- redaction helpers: prove records returned WITHOUT dumping raw PII ---
function mask(v) {
  if (v == null) return v;
  const s = String(v);
  if (s.length <= 2) return '*'.repeat(s.length);
  return s.slice(0, 2) + '*'.repeat(Math.max(1, s.length - 3)) + s.slice(-1);
}
function redactRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, val] of Object.entries(row)) {
    if (/name|mobile|phone|email|addr|aadhaar|pan|kyc|acc|user/i.test(k)) out[k] = mask(val);
    else out[k] = val;
  }
  return out;
}

async function post(name, apiPath, payload) {
  const t0 = Date.now();
  let status = 0, json = null, err = null;
  try {
    const resp = await fetch(BASE + apiPath, { method: 'POST', headers: HJSON, body: JSON.stringify(payload) });
    status = resp.status;
    try { json = await resp.json(); } catch { json = null; }
  } catch (e) { err = e.message || String(e); }
  const ms = Date.now() - t0;
  return { name, apiPath, status, ms, json, err };
}

(async () => {
  console.log('================ EXTERNAL DB-EXPOSURE SMOKE (read-only) ================');
  // 0) confirm the egress IP the request will actually leave from
  try {
    const ipResp = await fetch('https://ipinfo.io/json');
    const ip = await ipResp.json();
    console.log(`Egress IP : ${ip.ip}  (${ip.city}, ${ip.region}, ${ip.country} — ${ip.org})`);
  } catch { console.log('Egress IP : <could not determine>'); }
  console.log(`Target    : ${BASE}`);
  console.log(`Auth as   : username=${HJSON.username}  logUname=${LOGUNAME}`);
  console.log('-----------------------------------------------------------------------');

  const tests = [
    ['customersList (customer PII records)', 'ServiceApis/customersList?status=',
      { username: LOGUNAME, servid: 1, search: [{ platform: 'iptv', providerid: 5 }] }],
    ['servServiceList (service catalog)', 'ServiceApis/servServiceList?servtype=all&iskirana=false', {}],
  ];

  let reachable = false, recordsPulled = false;
  for (const [label, apiPath, payload] of tests) {
    const r = await post(label, apiPath, payload);
    console.log(`\n▶ ${label}`);
    console.log(`  ${r.err ? 'NETWORK ERROR: ' + r.err : 'HTTP ' + r.status} (${r.ms} ms)`);
    if (r.err) continue;
    reachable = true;
    const body = r.json?.body;
    const errCode = r.json?.status?.err_code;
    const errMsg = r.json?.status?.err_msg;
    console.log(`  err_code=${errCode} err_msg=${JSON.stringify(errMsg)}`);
    if (Array.isArray(body)) {
      console.log(`  >>> RECORDS RETURNED: ${body.length}`);
      if (body.length > 0) {
        recordsPulled = true;
        console.log('  sample[0] (PII masked):');
        console.log('  ' + JSON.stringify(redactRow(body[0])).slice(0, 600));
      }
    } else if (body && typeof body === 'object') {
      console.log(`  body keys: ${Object.keys(body).join(', ')}`);
    }
  }

  console.log('\n=========================== VERDICT ===========================');
  console.log(`Proxy/API layer reachable from this external IP : ${reachable ? 'YES' : 'NO'}`);
  console.log(`Credentials accepted (auth passed)              : ${reachable ? 'YES (or check err_msg above)' : 'N/A'}`);
  console.log(`Live DB records exfiltrated over the internet   : ${recordsPulled ? 'YES — EXPOSED' : 'NO'}`);
  console.log('===============================================================');
})();
