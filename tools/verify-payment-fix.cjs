/**
 * Simulate exactly what the FIXED Paynow.jsx does:
 * 1. Call apis/makepayment with employee payment headers
 * 2. Parse the response using the FIXED field mapping logic
 * 3. Print what the payment screen would show
 *
 * Usage: node tools/verify-payment-fix.cjs [userid] [opid]
 */
const https = require('https');

const BASE_URL = 'https://bbnlnetmon.bbnl.in/prod/apis/makepayment';

// Payment-specific headers (getEmployeePaymentHeaders) — what the fix now uses
const HEADERS = {
  'Authorization': '19dbf24362dff8cca8bb1ab10998eb60',
  'username': 'Oracle',
  'password': 'Oracle@123',
  'appkeytype': 'employee',
  'appversion': '1.2.0',
  'X-App-Package': 'com.bbnl.smartphone',
  'Content-Type': 'application/x-www-form-urlencoded',
};

const userid = process.argv[2] || 'iptvuser';
const opid = process.argv[3] || 'BBNL_OP49';
const loginuname = process.argv[4] || 'superadmin';

function makeRequest() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      apiopid: opid,
      apptype: 'crmapp',
      apiuserid: userid,
      loginuname: loginuname,
    }).toString();

    const url = new URL(BASE_URL);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { ...HEADERS, 'Content-Length': Buffer.byteLength(body) },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Bad JSON: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatToDecimals(val) {
  return parseFloat(val || 0).toFixed(2);
}

async function main() {
  console.log(`\n🔵 Calling apis/makepayment for userid=${userid}, opid=${opid}, loginuname=${loginuname}`);
  console.log(`   Using: getEmployeePaymentHeaders (appkeytype=employee, Oracle creds)\n`);

  const data = await makeRequest();
  console.log(`   HTTP response error code: ${data.error}`);

  const result = data?.result;
  if (!result) {
    console.error('❌ No result in API response!');
    return;
  }

  // ===== EXACTLY what the fixed Paynow.jsx does =====
  const planRates = result?.planrates_android || result?.planrates || [];
  const hasPlanRates = Array.isArray(planRates) && planRates.length > 0;

  console.log(`   planrates_android: ${hasPlanRates ? planRates.length + ' entries' : 'MISSING'}`);
  console.log(`   planrates (object): ${result?.planrates ? Object.keys(result.planrates).join(', ') : 'MISSING'}`);

  // Wallet
  const walletBalance = result?.wallet?.avlbal || 0;

  if (hasPlanRates) {
    // FIXED: Pick month=1 entry explicitly
    const det = planRates.find(p => p.month === 1) || planRates[0];
    console.log(`   Selected entry: month=${det.month}, title="${det.title}"`);

    // FIXED: Use ?? for all numeric fields
    const othchargeAmt = result?.othcharge?.amt ?? det?.othcharge?.amt ?? 0;

    const paydet = {
      "Plan Name": result?.planname || det?.planname || "N/A",
      "Plan Rate": det?.planrate ?? det?.rate ?? 0,
      "CGST": det?.taxdetails?.subtaxes?.CGST?.value ?? det?.cgst ?? 0,
      "SGST": det?.taxdetails?.subtaxes?.SGST?.value ?? det?.sgst ?? 0,
      "Other Charges": othchargeAmt,
      "Balance Amount": det?.shareinfo?.balamt ?? det?.balamt ?? 0,
      "Total Amount": det?.total ?? det?.totalamt ?? 0,
    };

    // FIXED: Amount Deductable = totbbnlshare
    const sharedet = {
      "Operator Share": det?.shareinfo?.optrshare ?? det?.optrshare ?? 0,
      "BBNL Share": det?.shareinfo?.bbnlshare ?? det?.bbnlshare ?? 0,
      "Software Charges": det?.shareinfo?.softcharge ?? det?.softcharge ?? 0,
      "TDS": det?.shareinfo?.tds ?? det?.tds ?? 0,
      "Amount Deductable": det?.shareinfo?.totbbnlshare ?? det?.totbbnlshare ?? 0,
    };

    const cashpaid = det?.shareinfo?.totbbnlshare ?? det?.totbbnlshare ?? det?.total ?? 0;

    // ===== DISPLAY =====
    console.log('\n' + '='.repeat(50));
    console.log('  PAYMENT SCREEN (after fix)');
    console.log('='.repeat(50));
    console.log(`\n  Wallet Balance: ₹${formatToDecimals(walletBalance)}\n`);
    console.log('  --- Payment Details ---');
    for (const [k, v] of Object.entries(paydet)) {
      const display = k === 'Plan Name' ? v : `₹${formatToDecimals(v)}`;
      console.log(`  ${k.padEnd(20)}: ${display}`);
    }
    console.log('\n  --- More Details ---');
    for (const [k, v] of Object.entries(sharedet)) {
      console.log(`  ${k.padEnd(20)}: ₹${formatToDecimals(v)}`);
    }
    console.log(`\n  cashpaid (for savePaymentApi): ${cashpaid}`);
    console.log(`  noofmonth: 1`);
    console.log('='.repeat(50));

    // Show all raw shareinfo keys for reference
    console.log('\n📋 Raw shareinfo keys:', Object.keys(det.shareinfo || {}).join(', '));
  } else {
    console.log('⚠️ No planrates_android array — would use fallback path');
  }
}

main().catch(err => console.error('ERROR:', err.message));
