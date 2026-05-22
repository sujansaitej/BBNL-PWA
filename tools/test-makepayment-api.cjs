/**
 * Test script: Hit apis/makepayment with BOTH sets of credentials
 * and compare the full response to find the exact data differences.
 *
 * Usage: node tools/test-makepayment-api.cjs [userid] [opid]
 */
const https = require('https');

const BASE_URL = 'https://bbnlnetmon.bbnl.in/prod/apis/makepayment';

// Credentials set A: General API (what getHeadersForm uses)
const HEADERS_GENERAL = {
  'Authorization': 'd66f43b005be6899f4b658aae38c8297',
  'username': 'redh@t',
  'password': 'redh@t@!23',
  'appkeytype': 'employee',     // franchisee login
  'appversion': '1.2.0',
  'X-App-Package': 'com.bbnl.smartphone',
  'Content-Type': 'application/x-www-form-urlencoded',
};

// Credentials set A2: General API with customer appkeytype
const HEADERS_GENERAL_CUST = {
  ...HEADERS_GENERAL,
  'appkeytype': 'customer',
};

// Credentials set B: Payment-specific (what getEmployeePaymentHeaders uses)
const HEADERS_PAYMENT = {
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

function makeRequest(label, headers, bodyParams) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(bodyParams).toString();
    const url = new URL(BASE_URL);

    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`  ${label}`);
        console.log(`  HTTP ${res.statusCode}`);
        console.log(`${'='.repeat(70)}`);
        console.log('Request body:', bodyParams);
        try {
          const json = JSON.parse(data);
          console.log('\nFull Response JSON:');
          console.log(JSON.stringify(json, null, 2));

          // Extract key fields
          const r = json?.result;
          if (r) {
            console.log('\n--- KEY FIELDS ---');
            console.log('planname:', r.planname);
            console.log('planrate:', r.planrate);
            console.log('total:', r.total);
            console.log('balamt:', r.balamt);
            console.log('cgst:', r.cgst);
            console.log('sgst:', r.sgst);
            
            const pr = r.planrates_android || r.planrates;
            if (Array.isArray(pr)) {
              console.log(`\nplanrates_android (${pr.length} entries):`);
              pr.forEach((entry, i) => {
                console.log(`\n  [${i}]:`);
                console.log('    planname:', entry.planname);
                console.log('    planrate:', entry.planrate || entry.rate);
                console.log('    total:', entry.total || entry.totalamt);
                console.log('    balamt:', entry.balamt);
                console.log('    month:', entry.month);
                console.log('    cgst:', entry.taxdetails?.subtaxes?.CGST?.value || entry.cgst);
                console.log('    sgst:', entry.taxdetails?.subtaxes?.SGST?.value || entry.sgst);
                console.log('    shareinfo:', JSON.stringify(entry.shareinfo, null, 6));
                console.log('    ALL KEYS:', Object.keys(entry).join(', '));
              });
            } else {
              console.log('planrates_android: NOT an array or missing');
            }
          }
          resolve(json);
        } catch (e) {
          console.log('Raw response (not JSON):', data.substring(0, 500));
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`${label} ERROR:`, err.message);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`Testing apis/makepayment for userid=${userid}, opid=${opid}\n`);

  // Test 1: General headers (employee) — what PWA sends if loginType=franchisee
  await makeRequest(
    'A) General Headers (employee appkeytype)',
    HEADERS_GENERAL,
    { apiopid: opid, apptype: 'crmapp', apiuserid: userid }
  );

  // Test 2: General headers (customer) — what PWA sends if loginType!=franchisee
  await makeRequest(
    'B) General Headers (customer appkeytype)',
    HEADERS_GENERAL_CUST,
    { apiopid: opid, apptype: 'crmapp', apiuserid: userid }
  );

  // Test 3: Payment headers (employee) — what our fix now sends
  await makeRequest(
    'C) Payment Headers (employee appkeytype)',
    HEADERS_PAYMENT,
    { apiopid: opid, apptype: 'crmapp', apiuserid: userid }
  );

  // Test 4: Payment headers with loginuname
  await makeRequest(
    'D) Payment Headers + loginuname',
    HEADERS_PAYMENT,
    { apiopid: opid, apptype: 'crmapp', apiuserid: userid, loginuname: 'superadmin' }
  );
}

main().catch(console.error);
