/**
 * Test script: Hit service/paymentinfo/fofi to see the actual data structure
 *
 * Usage: node tools/test-fofi-payment-api.cjs [userid] [fofi_box_id] [planid] [priceid]
 */
const https = require('https');

const BASE_URL = 'https://bbnlnetmon.bbnl.in/prod/service/paymentinfo/fofi';

const HEADERS = {
  'Authorization': 'd66f43b005be6899f4b658aae38c8297',
  'username': 'redh@t',
  'password': 'redh@t@!23',
  'appkeytype': 'employee',
  'appversion': '1.2.0',
  'Content-Type': 'application/json',
};

const userid = process.argv[2] || 'iptvuser';
const fofi_box_id = process.argv[3] || '';
const planid = process.argv[4] || '101';
const priceid = process.argv[5] || '99';

function makeRequest(bodyParams) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyParams);
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
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`Testing service/paymentinfo/fofi for userid=${userid}, planid=${planid}\n`);

  const resp = await makeRequest({
    userid,
    fofi_box_id,
    planid,
    priceid,
    servapptype: 'crmapp',
    servid: '3',
    username: 'superadmin',
    voipnumber: ''
  });
  
  console.log(JSON.stringify(resp, null, 2));
}

main().catch(console.error);
