// Run internet/paymentinfo dry-run across multiple operator IDs
// Usage: node tools/prod-smoke-test-all.cjs [--debit]
// - Reads TEST_OP_IDS from .env.production (comma-separated) or tools/opids.txt (one per line)
// - Default: dry-run only (no savePaymentApi). Use --debit to also call savePaymentApi (will attempt wallet debit).

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

async function doPost(url, headers, payload) {
  try {
    const fetchFn = global.fetch || (await import('node-fetch')).default;
    const resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch(e){ /* ignore */ }
    return { status: resp.status, text, json };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

async function main() {
  const envPath = path.resolve(__dirname, '..', '.env.production');
  if (!fs.existsSync(envPath)) { console.error('.env.production not found'); process.exit(2); }
  const env = parseEnv(envPath);

  let opids = [];
  if (env.TEST_OP_IDS) {
    opids = env.TEST_OP_IDS.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    const listPath = path.resolve(__dirname, 'opids.txt');
    if (fs.existsSync(listPath)) {
      opids = fs.readFileSync(listPath,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    }
  }
  if (!opids.length) {
    // fallback to single TEST_OP_ID
    if (env.TEST_OP_ID) opids = [env.TEST_OP_ID];
  }
  if (!opids.length) { console.error('No operator IDs found. Set TEST_OP_IDS in .env.production or create tools/opids.txt'); process.exit(2); }

  const base = env.VITE_INTERNET_PAYMENT_BASE_URL || env.VITE_API_BASE_URL;
  if (!base) { console.error('No payment base URL in .env.production'); process.exit(2); }
  const url = (base.endsWith('/') ? base : base + '/') + 'internet/paymentinfo';

  const headers = {
    Authorization: env.VITE_INTERNET_PAYMENT_AUTH_KEY || env.VITE_API_PAYMENT_AUTH_KEY || env.VITE_API_AUTH_KEY || '',
    username: env.VITE_INTERNET_PAYMENT_USERNAME || env.VITE_API_PAYMENT_USERNAME || env.VITE_API_USERNAME || '',
    password: env.VITE_INTERNET_PAYMENT_PASSWORD || env.VITE_API_PAYMENT_PASSWORD || env.VITE_API_PASSWORD || '',
    appkeytype: env.VITE_API_APP_USER_TYPE || 'employee',
    appversion: env.VITE_API_APP_VERSION || '1.0.0',
    'Content-Type': 'application/json',
  };

  const doDebit = process.argv.includes('--debit');
  console.log('Found operator IDs:', opids.join(', '));
  console.log('Dry-run paymentinfo URL:', url);
  console.log('Debit mode:', doDebit ? 'ENABLED (savePaymentApi will be called)' : 'disabled (dry-run only)');

  for (const opid of opids) {
    const payload = {
      userid: env.TEST_USERID || '',
      loginopid: opid,
      noofmonth: '1',
      usagecompleted: '0',
      disctype: '',
      discamt: '',
      othamt: '',
      discreason: '',
      othreason: '',
      paidamount: env.TEST_PAIDAMOUNT || '0.00',
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

    console.log('\n=== OPERATOR:', opid, '===');
    const resp = await doPost(url, headers, payload);
    if (resp.error) {
      console.log('Request error:', resp.error);
      continue;
    }
    console.log('HTTP', resp.status);
    if (resp.json) {
      console.log('status.err_code:', resp.json?.status?.err_code, 'status.err_msg:', resp.json?.status?.err_msg);
    } else {
      console.log('Response text:', resp.text.slice(0,400));
    }

    // Optionally call savePaymentApi if debit requested
    if (doDebit && resp.json && resp.json.status && resp.json.status.err_code === 0) {
      console.log('Would perform savePaymentApi debit for', opid, '\n(IMPLEMENTATION NOTE: savePaymentApi form POST not implemented in this script by default)');
      // Implement savePaymentApi call here only if explicitly required and with caution
    }
  }
}

main();
