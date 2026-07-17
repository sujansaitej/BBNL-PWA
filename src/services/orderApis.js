// Order history API integration
import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";
import { lsGet, lsSet } from "./lsCache";
import { apiFetch, getBaseUrl } from "./apiCore";

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

  const resp = await apiFetch(url, {
    method: 'POST',
    headers,
    body,
  }, "getOrderHistory", { group: "Order" });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const result = await resp.json();
  lsSet(cacheKey, result);
  return result;
}

/**
 * Get service-scoped order history via the REAL endpoint: ServiceApis/ordersList.
 *
 * FIX (2026-07-17): previously called ServiceApis/cabletv/orderhistory, which
 * DOES NOT EXIST — it 404s on prod and staging (verified against the backend
 * source; no such method or route). Every call threw and callers fell back to
 * generic custpayhistory, so cable/FoFi order history never showed its real
 * server-filtered rows. ordersList is the endpoint the Android app actually
 * uses (CABLE_TV_API_REPORT.md 6.15); it is generic, keyed by servid, so it
 * covers both Cable TV (servid=1) and FoFi (servid=3).
 *
 * ordersList returns { status, body: { total_orders, result: [...] } }. We
 * normalize `body` down to the `result` array so the existing array-shape
 * consumers (getHistoryRows / getOrderHistoryFor) keep working unchanged.
 *
 * @param {Object} p
 * @param {string} p.userid  customer username / id
 * @param {string} p.boxid   box id (unused on the wire — ordersList keys on servid)
 * @param {string} p.servid  '3' = FoFi, '1' = Cable TV / IPTV
 */
export async function getServiceOrderHistory({ userid, boxid, servid }) {
  const timestamp = Date.now();
  const url = `${getBaseUrl()}ServiceApis/ordersList?_t=${timestamp}`;

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

  // ordersList body — the Android app always sends the 6 date/filter fields
  // empty (report 6.15). `username` is the employee; `userid` is the customer.
  const payload = {
    userid: userid || '',
    username: import.meta.env.VITE_API_USERNAME || 'superadmin',
    servid: String(servid || '3'),
    ordernumber: '',
    txndatefrom: '',
    txndatetill: '',
    orderdatefrom: '',
    orderdatetill: '',
    paymentmode: '',
  };

  logger.debug("Order", "getServiceOrderHistory (ordersList) request", { userid, boxid, servid });

  const resp = await apiFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store'
  }, "getServiceOrderHistory", { group: "Order" });

  if (!resp.ok) {
    const errorText = await resp.text();
    logger.error("Order", "getServiceOrderHistory error", { status: resp.status, error: errorText, servid });
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const raw = await resp.json();
  // Normalize {status, body:{result:[...], total_orders}} → {status, body:[...]}
  // so getHistoryRows / hasUsableBody (which expect body to be an array) work.
  const rows = Array.isArray(raw?.body?.result) ? raw.body.result : [];
  logger.debug("Order", "getServiceOrderHistory response", { errCode: raw?.status?.err_code, rows: rows.length, servid });
  return { ...raw, body: rows };
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
