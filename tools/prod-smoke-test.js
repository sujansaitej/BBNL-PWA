// Simple production smoke-test (dry-run)
// Usage: node tools/prod-smoke-test.js
// NOTE: This script only calls `internet/paymentinfo` (no debit/savePaymentApi).

const fs = require('fs');
const path = require('path');

function parseEnv(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const idx = l.indexOf('=');
    if (idx === -1) continue;
    const k = l.slice(0, idx).trim();
    let v = l.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

async function run() {
  const envPath = path.resolve(__dirname, '..', '.env.production');
  if (!fs.existsSync(envPath)) {
    console.error('.env.production not found at', envPath);
    process.exit(2);
  }
  const env = parseEnv(envPath);

  const base = env.VITE_INTERNET_PAYMENT_BASE_URL || env.VITE_API_BASE_URL;
  if (!base) {
    console.error('No payment base URL found in .env.production');
    process.exit(2);
  }

  const url = (base.endsWith('/') ? base : base + '/') + 'internet/paymentinfo';

  const headers = {
    Authorization: env.VITE_INTERNET_PAYMENT_AUTH_KEY || env.VITE_API_PAYMENT_AUTH_KEY || env.VITE_API_AUTH_KEY || '',
    username: env.VITE_INTERNET_PAYMENT_USERNAME || env.VITE_API_PAYMENT_USERNAME || env.VITE_API_USERNAME || '',
    password: env.VITE_INTERNET_PAYMENT_PASSWORD || env.VITE_API_PAYMENT_PASSWORD || env.VITE_API_PASSWORD || '',
    appkeytype: env.VITE_API_APP_USER_TYPE || 'employee',
    appversion: env.VITE_API_APP_VERSION || '1.0.0',
    'Content-Type': 'application/json',
  };

  const payload = {
    userid: '',
    loginopid: env.TEST_OP_ID || '',
    noofmonth: '1',
    usagecompleted: '0',
    disctype: '',
    discamt: '',
    othamt: '',
    discreason: '',
    othreason: '',
    paidamount: '0.00',
    apptype: env.VITE_API_APP_KEY_TYPE || 'crmapp',
    paymode: 'cash',
    paydoneby: env.TEST_OP_USERNAME || env.VITE_API_USERNAME || '',
    payreceivedby: env.TEST_OP_USERNAME || env.VITE_API_USERNAME || '',
    receivedremark: 'dry-run',
    transstatus: 'success',
    renewstatus: 'success',
    addprefix: 'no',
    formtype: 'payment',
    bank_name: '',
    chqdate: '',
    chqno: '',
    gtwy_logid: '',
    gatewaytransid: '',
    gatewaycharges: '',
    banktransid: '',
    onl_pymt_typ: '',
    gtwy_postvals: null,
    pymtdate: null,
    updateexpiry: '',
    atomtxngnrt: '',
    loginuname: env.TEST_OP_USERNAME || env.VITE_API_USERNAME || '',
  };

  console.log('→ POST', url);
  console.log('→ headers:', { Authorization: headers.Authorization, username: headers.username });
  console.log('→ payload preview:', { loginopid: payload.loginopid, loginuname: payload.loginuname, paidamount: payload.paidamount });

  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    console.log('HTTP', resp.status, resp.statusText);
    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      console.log('Response JSON:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Response text:', text.slice(0, 2000));
    }
  } catch (err) {
    console.error('Request failed:', err.message || err);
  }
}

run();
