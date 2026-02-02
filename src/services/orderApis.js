// Order history API integration

function getBaseUrl() {
  if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL;
  return '/api/'; // Use proxy in development to avoid CORS issues
}

/**
 * Get Order/Payment History
 * API: apis/custpayhistory
 * Method: POST (form-urlencoded)
 * Headers as per client documentation:
 *   Authorization: c4f79e15f8c6ed0715a8ea44aebc38d8
 *   username: e2798af12a7a0f4f70b4d69efbc25f4d
 *   password: c1f377afbaa874acbb6b61f66957710a
 *   apptype: employee
 *   Content-Type: application/x-www-form-urlencoded
 * Body: apiopid=BBNL_OP49&cid=iptvuser&servicekey=fofi
 */
export async function getOrderHistory({ apiopid, cid, servicekey }) {
  const url = `${getBaseUrl()}apis/custpayhistory`;

  // Headers matching client documentation exactly
  const headers = {
    'Authorization': 'c4f79e15f8c6ed0715a8ea44aebc38d8',
    'username': 'e2798af12a7a0f4f70b4d69efbc25f4d',
    'password': 'c1f377afbaa874acbb6b61f66957710a',
    'apptype': 'employee',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Body: form-urlencoded with apiopid, cid, and optional servicekey
  const bodyParams = { apiopid, cid };
  if (servicekey) {
    bodyParams.servicekey = servicekey;
  }
  const body = new URLSearchParams(bodyParams).toString();

  console.log('🔵 [custpayhistory] URL:', url);
  console.log('🔵 [custpayhistory] Headers:', headers);
  console.log('🔵 [custpayhistory] Body:', body);
  console.log('🔵 [custpayhistory] ServiceKey:', servicekey || 'not specified');

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  console.log('🔵 [custpayhistory] Response status:', resp.status, resp.statusText);

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('❌ [custpayhistory] Error:', errorText);
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const result = await resp.json();
  console.log('🟢 [custpayhistory] Response:', JSON.stringify(result, null, 2));
  return result;
}

/**
 * Get FoFi Order History - Specific API for FoFi/CableTV orders
 * API: ServiceApis/cabletv/orderhistory
 * This fetches orders created via the generateorder API
 */
export async function getFofiOrderHistory({ userid, fofiboxid }) {
  const timestamp = Date.now();
  const url = `${getBaseUrl()}ServiceApis/cabletv/orderhistory?_t=${timestamp}`;

  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': import.meta.env.VITE_API_APP_USER_TYPE,
    'appversion': import.meta.env.VITE_API_APP_VERSION,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache'
  };

  const payload = {
    userid: userid || '',
    fofiboxid: fofiboxid || '',
    servid: '3' // FoFi service ID
  };

  console.log('🔵 [fofiOrderHistory] URL:', url);
  console.log('🔵 [fofiOrderHistory] Payload:', JSON.stringify(payload, null, 2));

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store'
  });

  console.log('🔵 [fofiOrderHistory] Response status:', resp.status, resp.statusText);

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('❌ [fofiOrderHistory] Error:', errorText);
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const result = await resp.json();
  console.log('🟢 [fofiOrderHistory] Response:', JSON.stringify(result, null, 2));
  return result;
}
