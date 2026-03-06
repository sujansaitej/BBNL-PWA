// Order history API integration
import { lsGet, lsSet } from "./lsCache";

function getBaseUrl() {
  if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL;
  return '/api/'; // Use proxy in development to avoid CORS issues
}

const API_TIMEOUT = 15000; // 15 seconds

/** Fetch with AbortController timeout — prevents indefinite hangs on slow networks */
async function apiFetchWithTimeout(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
        if (err.name === "AbortError") throw new Error("Request timed out. Please check your network and try again.");
        throw err;
    } finally {
        clearTimeout(timer);
    }
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
  const cacheKey = `orderhist_${cid}_${servicekey || 'all'}`;
  const cached = lsGet(cacheKey, 5 * 60 * 1000); // 5 min TTL
  if (cached) return cached;

  const url = `${getBaseUrl()}apis/custpayhistory`;

  // Headers matching client documentation exactly
  const headers = {
    'Authorization': 'c4f79e15f8c6ed0715a8ea44aebc38d8',
    'username': 'e2798af12a7a0f4f70b4d69efbc25f4d',
    'password': 'c1f377afbaa874acbb6b61f66957710a',
    'apptype': 'employee',
    'X-App-Package': 'com.bbnl.smartphone',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Body: form-urlencoded with apiopid, cid, and optional servicekey
  const bodyParams = { apiopid, cid };
  if (servicekey) {
    bodyParams.servicekey = servicekey;
  }
  const body = new URLSearchParams(bodyParams).toString();

  const resp = await apiFetchWithTimeout(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const result = await resp.json();
  lsSet(cacheKey, result);
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
    'X-App-Package': 'com.bbnl.smartphone',
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

  const resp = await apiFetchWithTimeout(url, {
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
