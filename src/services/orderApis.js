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
 * Get service-scoped order history from the dedicated cabletv namespace.
 * API: ServiceApis/cabletv/orderhistory
 *
 * Both FoFi Smart Box (servid=3) and Cable TV / IPTV (servid=1) register
 * their orders through ServiceApis/cabletv/*. This endpoint is filtered
 * SERVER-SIDE by servid, so every row it returns is authoritatively that
 * service — including older records whose generic custpayhistory rows lack
 * the modern servicekey/servid fields. Callers should treat these rows as
 * definitive and never let client-side classification drop them.
 *
 * @param {Object} p
 * @param {string} p.userid  customer username / id
 * @param {string} p.boxid   FoFi box id (servid 3) or cable box id (servid 1)
 * @param {string} p.servid  '3' = FoFi, '1' = Cable TV / IPTV
 */
export async function getServiceOrderHistory({ userid, boxid, servid }) {
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
    fofiboxid: boxid || '',
    servid: String(servid || '3')
  };

  logger.debug("Order", "getServiceOrderHistory request", { userid, boxid, servid });

  const resp = await apiFetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store'
  }, "getServiceOrderHistory");

  if (!resp.ok) {
    const errorText = await resp.text();
    logger.error("Order", "getServiceOrderHistory error", { status: resp.status, error: errorText, servid });
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const result = await resp.json();
  logger.debug("Order", "getServiceOrderHistory response", { errCode: result?.status?.err_code, servid });
  return result;
}

/**
 * Get FoFi Order History (servid=3). Thin wrapper over
 * getServiceOrderHistory kept for existing callers (FofiPayment.jsx).
 */
export async function getFofiOrderHistory({ userid, fofiboxid }) {
  return getServiceOrderHistory({ userid, boxid: fofiboxid, servid: '3' });
}

function getHistoryRows(response) {
  return Array.isArray(response?.body) ? response.body : [];
}

/**
 * Service-aware order history selector.
 *
 * Routes to the most accurate endpoint available for the requested
 * service. Returns the SAME shape as getOrderHistory — `{ status, body }`
 * — so callers do not need to know which endpoint produced the result.
 *
 * - FoFi (servid=3) and Cable TV / IPTV (servid=1) with a box id →
 *   dedicated /ServiceApis/cabletv/orderhistory (server-side filtered by
 *   servid). Every row is authoritatively that service, so we tag it with
 *   `_authoritativeService` and the registry resolver trusts it — older
 *   records are never dropped by client-side classification. On any
 *   failure or empty body we still merge the generic endpoint so operators
 *   are never left with a blank screen during a backend hiccup.
 * - All other services → generic /apis/custpayhistory (returns ALL
 *   payments; caller must filter client-side via the registry resolver).
 */
export async function getOrderHistoryFor(serviceType, { apiopid, cid, userid, fofiboxid, cableboxid } = {}) {
  const normType = String(serviceType || '').toLowerCase();

  // Map service → dedicated cabletv-namespace fetch params. Both FoFi and
  // Cable TV register orders through ServiceApis/cabletv/* under distinct
  // servids; the box id scopes the lookup to this customer's device.
  const dedicatedSpec = (() => {
    if (normType === 'fofi' && fofiboxid) {
      return { servid: '3', boxid: fofiboxid, source: 'fofi-dedicated', service: 'fofi' };
    }
    if (normType === 'cabletv' && (cableboxid || fofiboxid)) {
      return { servid: '1', boxid: cableboxid || fofiboxid, source: 'cabletv-dedicated', service: 'cabletv' };
    }
    return null;
  })();

  let dedicated = null;
  if (dedicatedSpec) {
    try {
      const resp = await getServiceOrderHistory({
        userid: userid || cid,
        boxid: dedicatedSpec.boxid,
        servid: dedicatedSpec.servid,
      });
      const hasUsableBody = Array.isArray(resp?.body) && resp.body.length > 0;
      const noServerError = (resp?.status?.err_code ?? 0) === 0;
      if (hasUsableBody || noServerError) {
        dedicated = { ...resp, _source: dedicatedSpec.source };
      }
      if (!hasUsableBody || !noServerError) {
        logger.warn("Order", `${dedicatedSpec.source} endpoint returned no usable rows; generic history will also be checked`, {
          errCode: resp?.status?.err_code,
          bodyLen: Array.isArray(resp?.body) ? resp.body.length : null,
          servid: dedicatedSpec.servid,
        });
      }
    } catch (err) {
      logger.warn("Order", `${dedicatedSpec.source} endpoint failed, falling back to generic`, { err: err?.message });
    }
  }

  const generic = await getOrderHistory({ apiopid, cid, servicekey: serviceType });
  if (dedicated) {
    return {
      ...generic,
      body: [
        // Dedicated rows are server-filtered by servid → definitively this
        // service. `_authoritativeService` makes the registry resolver
        // return that service so the row is kept under the right tab and
        // never dropped as "unclassified".
        ...getHistoryRows(dedicated).map((row) => ({
          ...row,
          _source: dedicatedSpec.source,
          _authoritativeService: dedicatedSpec.service,
        })),
        ...getHistoryRows(generic).map((row) => ({ ...row, _source: 'generic' })),
      ],
      _source: `${dedicatedSpec.source}+generic`,
      _sources: {
        dedicatedCount: getHistoryRows(dedicated).length,
        genericCount: getHistoryRows(generic).length,
      },
    };
  }
  return { ...generic, _source: 'generic' };
}
