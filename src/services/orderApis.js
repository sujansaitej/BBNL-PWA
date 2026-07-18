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
export async function getServiceOrderHistory({ userid, username, boxid, servid }) {
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
    // Native sends the operator's app_username here (scopes the customer's
    // orders to this operator). Fall back to the env user only if unknown.
    username: username || import.meta.env.VITE_API_USERNAME || 'superadmin',
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
 * Service-aware order history selector — mirrors the native app exactly.
 *
 * Native (CustomerCompleteOverviewFragment) branches on service type:
 * - Internet → POST /apis/custpayhistory  { apiopid, cid } — all customer
 *   payments, rendered with the full plan/tax breakdown.
 * - FoFi (servid=3) & Cable TV (servid=1) → POST /ServiceApis/ordersList
 *   { userid: customerId, username: operator, servid } — keyed on the
 *   CUSTOMER id (never a box id), already server-filtered by servid. Native
 *   shows exactly these rows: no generic merge, no client-side filtering.
 *
 * The old PWA gated the ordersList call on a box id that callers usually
 * passed as '' (so it never fired), then merged generic rows the client
 * filter later discarded as "unclassified" — which is why FoFi/Cable showed
 * "No payment history". This restores the native behaviour.
 *
 * ordersList rows use OrderDetails field names; we normalize the few the
 * detail card reads (date / order id / payment mode / cid) and tag each row
 * `_authoritativeService` so the registry resolver keeps it. Plan name and
 * per-tax split are absent from ordersList (native's Order List doesn't show
 * them either) → the card shows N/A there.
 */
const SERVID_BY_TYPE = { fofi: '3', cabletv: '1' };

export async function getOrderHistoryFor(serviceType, { apiopid, cid, userid, username } = {}) {
  const normType = String(serviceType || '').toLowerCase();
  const servid = SERVID_BY_TYPE[normType];

  if (servid) {
    const resp = await getServiceOrderHistory({ userid: userid || cid, username, servid });
    const rows = getHistoryRows(resp).map((row) => ({
      ...row,
      orderid: row.ordernumber ?? row.orderid,
      payment_date: row.orderdate || row.txndate || row.payment_date,
      pymt_mode: row.paymentmode ?? row.pymt_mode,
      cid: cid || userid,
      _authoritativeService: normType,
      _source: `${normType}-ordersList`,
    }));
    return { ...resp, body: rows, _source: `${normType}-ordersList` };
  }

  const generic = await getOrderHistory({ apiopid, cid, servicekey: serviceType });
  return { ...generic, _source: 'generic' };
}

// --- Order view mapping (native parity) -----------------------------------
// Both backends (ordersList for FoFi/Cable, custpayhistory for Internet) are
// collapsed into ONE display shape via field aliases, exactly the set the
// native Order List + Order Details screens render. ponytail: alias OR-chain
// covers both schemas, no per-service branching needed.

const _num = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(String(v).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

const _txt = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
};

/**
 * Map a raw order row (either endpoint) to the native detail/list shape.
 * @returns {{orderNumber,orderDate,totalAmount,taxAmount,discountAmount,otherCharges,paymentMode,status}}
 */
export function mapOrderView(order = {}) {
  const subtaxSum = Array.isArray(order.subtaxes)
    ? order.subtaxes.reduce((s, t) => s + _num(t?.value, t?.amount, t?.tax_amount), 0)
    : 0;
  return {
    orderNumber: _txt(order.ordernumber, order.orderid, order.order_id, order.orderno, order.order_no),
    orderDate: _txt(order.orderdate, order.payment_date, order.txndate, order.paymentdate),
    totalAmount: _num(order.totalamount, order.grandtotal, order.payable_amt, order.paid_amt,
      order.totalpaid, order.total_amt, order.total_amount, order.paidamount, order.subtotal),
    taxAmount: _num(order.taxamount, order.tax_amt, order.taxamt) || (_num(order.cgst) + _num(order.sgst)) || subtaxSum,
    discountAmount: _num(order.discountamount, order.discount, order.discount_amt),
    otherCharges: _num(order.othercharges, order.other_charges, order.other_amt),
    paymentMode: _txt(order.paymentmode, order.pymt_mode, order.payment_mode),
    // Internet's custpayhistory rows are historical successful payments with no
    // status field → default SUCCESS, matching the native "Internet" tab.
    status: _txt(order.txnstatus, order.pymt_status, order.status) || "SUCCESS",
  };
}

// Native opens these server URLs in the external browser (no auth). billnum is
// the plain `ordernumber` appended VERBATIM (native does not URL-encode; order
// numbers are alphanumeric). We only trim stray whitespace — a leading/trailing
// space is enough for the server to answer "Invalid Bill number.".
// Constants.CONGIF_DOWNLOAD_{Reciept,Invoice}_VALUE → prod/cable/{receipt,invoice}.
const _billnum = (orderNumber) => String(orderNumber ?? "").trim();
export const getReceiptUrl = (orderNumber) =>
  `${getBaseUrl()}cable/receipt?billnum=${_billnum(orderNumber)}`;
export const getInvoiceUrl = (orderNumber) =>
  `${getBaseUrl()}cable/invoice?billnum=${_billnum(orderNumber)}`;
