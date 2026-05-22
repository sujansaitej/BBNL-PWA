// Order history API integration
import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";
import { lsGet, lsSet } from "./lsCache";

function getBaseUrl() {
  if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL;
  return '/api/'; // Use proxy in development to avoid CORS issues
}

const API_TIMEOUT = 15000; // 15 seconds

/** Fetch with AbortController timeout, perf monitoring, and structured logging */
async function apiFetchWithTimeout(url, options, label = "Order") {
    const method = options.method || "POST";
    const endPerf = perfMonitor.start(method, url, "Order", label);
    logger.debug("Order", `${label} → ${method} ${url}`);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT);
    try {
        const resp = await fetch(url, { ...options, signal: ctrl.signal });
        const entry = endPerf({ status: resp.status });
        logger.api(method, url, resp.status, entry.duration);
        return resp;
    } catch (err) {
        const isTimeout = err.name === "AbortError";
        const errMsg = isTimeout ? "timeout" : `network error: ${err.message}`;
        endPerf({ status: 0, error: errMsg });
        logger.error("Order", `${label} ${errMsg}`, { method, url });
        if (isTimeout) throw new Error("Request timed out. Please check your network and try again.");
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Get Order/Payment History
 *
 * Endpoint:  POST /netmon/apis/custpayhistory
 * Body:      form-urlencoded — apiopid + cid only (per netmon contract).
 * Headers:   Authorization / username / password / apptype as per
 *            backend client documentation.
 *
 * The backend does NOT accept a servicekey filter here — it returns
 * every payment for the customer. The `servicekey` parameter we pass
 * in is used ONLY for cache-keying so different service overviews
 * (Internet / Cable TV / FoFi) get isolated caches and a fresh fetch
 * after a service-scoped Pay action. Per-service display filtering
 * happens in PaymentHistory.jsx after the response lands.
 */
export async function getOrderHistory({ apiopid, cid, servicekey }) {
  const cacheKey = `orderhist_${cid}_${servicekey || 'all'}`;
  const cached = lsGet(cacheKey, 5 * 60 * 1000); // 5 min TTL
  if (cached) { perfMonitor.recordCacheHit("Order", "getOrderHistory", cacheKey); return cached; }

  const url = `${getBaseUrl()}apis/custpayhistory`;

  // Headers — exactly match the netmon contract.
  const headers = {
    'Authorization': 'c4f79e15f8c6ed0715a8ea44aebc38d8',
    'username': 'e2798af12a7a0f4f70b4d69efbc25f4d',
    'password': 'c1f377afbaa874acbb6b61f66957710a',
    'apptype': 'employee',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Body — only the two fields the backend reads. servicekey is
  // intentionally NOT sent; backend ignores it and the cache-key
  // captures the service distinction client-side.
  const body = new URLSearchParams({
    apiopid: apiopid || '',
    cid: cid || '',
  }).toString();

  const resp = await apiFetchWithTimeout(url, {
    method: 'POST',
    headers,
    body,
  }, "getOrderHistory");

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
    'appkeytype': localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
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

  logger.debug("Order", "getFofiOrderHistory request", { userid, fofiboxid });

  const resp = await apiFetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store'
  }, "getFofiOrderHistory");

  if (!resp.ok) {
    const errorText = await resp.text();
    logger.error("Order", "getFofiOrderHistory error", { status: resp.status, error: errorText });
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const result = await resp.json();
  logger.debug("Order", "getFofiOrderHistory response", { errCode: result?.status?.err_code });
  return result;
}

/**
 * Service-aware order history selector.
 *
 * Routes to the most accurate endpoint available for the requested
 * service. Returns the SAME shape as getOrderHistory — `{ status, body }`
 * — so callers do not need to know which endpoint produced the result.
 *
 * - FoFi context with fofiboxid → dedicated /ServiceApis/cabletv/orderhistory
 *   (server-side filtered by servid=3). On any failure or empty body we
 *   fall back to the generic endpoint so operators are never left with a
 *   blank screen during a backend hiccup.
 * - All other services → generic /apis/custpayhistory (returns ALL
 *   payments; caller must filter client-side via the registry resolver).
 */
export async function getOrderHistoryFor(serviceType, { apiopid, cid, userid, fofiboxid } = {}) {
  const wantsFofiDedicated =
    String(serviceType || '').toLowerCase() === 'fofi' && fofiboxid;

  if (wantsFofiDedicated) {
    try {
      const fofiResp = await getFofiOrderHistory({ userid: userid || cid, fofiboxid });
      const hasUsableBody = Array.isArray(fofiResp?.body) && fofiResp.body.length > 0;
      const noServerError = (fofiResp?.status?.err_code ?? 0) === 0;
      if (hasUsableBody || noServerError) {
        return { ...fofiResp, _source: 'fofi-dedicated' };
      }
      logger.warn("Order", "FoFi dedicated endpoint returned no usable data, falling back", {
        errCode: fofiResp?.status?.err_code,
        bodyLen: Array.isArray(fofiResp?.body) ? fofiResp.body.length : null,
      });
    } catch (err) {
      logger.warn("Order", "FoFi dedicated endpoint failed, falling back to generic", { err: err?.message });
    }
  }

  const generic = await getOrderHistory({ apiopid, cid, servicekey: serviceType });
  return { ...generic, _source: 'generic' };
}
