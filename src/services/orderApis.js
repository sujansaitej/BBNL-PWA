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
 * Body: apiopid=BBNL_OP49&cid=iptvuser
 */
export async function getOrderHistory({ apiopid, cid }) {
  const url = `${getBaseUrl()}apis/custpayhistory`;
  
  // Headers matching client documentation exactly
  const headers = {
    'Authorization': 'c4f79e15f8c6ed0715a8ea44aebc38d8',
    'username': 'e2798af12a7a0f4f70b4d69efbc25f4d',
    'password': 'c1f377afbaa874acbb6b61f66957710a',
    'apptype': 'employee',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  
  // Body: form-urlencoded with apiopid and cid
  const body = new URLSearchParams({ 
    apiopid, 
    cid 
  }).toString();
  
  console.log('🔵 [custpayhistory] URL:', url);
  console.log('🔵 [custpayhistory] Headers:', headers);
  console.log('🔵 [custpayhistory] Body:', body);
  
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
