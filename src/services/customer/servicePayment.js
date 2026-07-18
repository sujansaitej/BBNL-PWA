// FoFi / IPTV customer payment endpoints — PWA port of Android's
// CommonPaymentInfoFragment + PaymentStatusFragment API calls. All hit the
// existing (read-only) backend exactly as the native app does; the only new
// piece is the client Easebuzz layer in easebuzz.js.
//
// Every endpoint uses the MAIN header profile (getHeadersJson) with the
// customer appkeytype — the same profile the rest of the /cust flow uses.

import { apiFetch, getBaseUrl, getHeadersJson, readEnvelopeRaw, PAYMENT_TIMEOUT } from "../apiCore";

/** fofi=3, cabletv=1 — the numeric servid these endpoints key on. */
export function servidFor(servicekey, fallback) {
  const key = String(servicekey || "").toLowerCase();
  if (key === "fofi") return "3";
  if (key === "cabletv") return "1";
  return String(fallback || "");
}

/**
 * Payment summary — POST service/paymentinfo/{fofi|cabletv}. Creates a pending
 * txn server-side and returns the bill breakdown + transactionid + the Easebuzz
 * credentials block (easebuzzpay_cred.fofieasebuzz.{key,salt}).
 */
export async function getServicePaymentInfo({
  servicekey, userid, username, servid, planid, priceid,
  fofiBoxId = "", voipnumber = "", channelid = [], packageid = [],
  lcochid = [], pkgcode = [], cblextenperiod = "",
}) {
  const svc = String(servicekey).toLowerCase() === "cabletv" ? "cabletv" : "fofi";
  const url = `${getBaseUrl()}service/paymentinfo/${svc}`;
  const payload = {
    planid: String(planid || ""),
    priceid: String(priceid || ""),
    servapptype: "serviceapp",
    servid: String(servid || servidFor(servicekey)),
    userid: userid || "",
    username: username || "",
    fofi_box_id: fofiBoxId || "",
    voipnumber: voipnumber || "",
    channelid,
    packageid,
    lcochid,
    pkgcode,
    ...(svc === "cabletv" ? { cblextenperiod: String(cblextenperiod || "") } : {}),
  };

  const resp = await apiFetch(
    url,
    { method: "POST", headers: getHeadersJson(), body: JSON.stringify(payload) },
    "getServicePaymentInfo",
    { group: "ServicePay", timeout: PAYMENT_TIMEOUT }
  );
  if (!resp.ok) throw new Error(`Could not load payment details (HTTP ${resp.status}).`);
  return readEnvelopeRaw(resp, "getServicePaymentInfo");
}

/**
 * IPTV plan-extension periods — POST ServiceApis/planExtensionPeriods. Native
 * calls this before paymentinfo for cabletv and takes days_range.max as the
 * cblextenperiod. FoFi does not use it.
 */
export async function getPlanExtensionPeriods({ userid, itemid }) {
  const url = `${getBaseUrl()}ServiceApis/planExtensionPeriods`;
  const payload = { itemid: itemid || "", servkey: "cabletv", userid: userid || "" };
  const resp = await apiFetch(
    url,
    { method: "POST", headers: getHeadersJson(), body: JSON.stringify(payload) },
    "getPlanExtensionPeriods",
    { group: "ServicePay" }
  );
  if (!resp.ok) throw new Error(`Could not load plan periods (HTTP ${resp.status}).`);
  return readEnvelopeRaw(resp, "getPlanExtensionPeriods");
}

/**
 * IPTV last-subscription info — POST ServiceApis/iptvLastSubscribedinfo. Drives
 * the direct-renew path: returns the previously subscribed channel/package ids
 * (fed into paymentinfo + the Easebuzz udf5) and a `directpay` flag.
 */
export async function getIptvLastSubscribed({ userid, itemid, validity_status = "" }) {
  const url = `${getBaseUrl()}ServiceApis/iptvLastSubscribedinfo`;
  const payload = { userid: userid || "", itemid: itemid || "", validity_status };
  const resp = await apiFetch(
    url,
    { method: "POST", headers: getHeadersJson(), body: JSON.stringify(payload) },
    "getIptvLastSubscribed",
    { group: "ServicePay" }
  );
  if (!resp.ok) throw new Error(`Could not load subscription info (HTTP ${resp.status}).`);
  return readEnvelopeRaw(resp, "getIptvLastSubscribed");
}

/**
 * Cancel a stale pending txn — POST ServiceApis/killTxn. Native calls this when
 * a returned transactionid matches one it started but never finished.
 */
export async function killServiceTxn({ userid, username, servid, transactionid }) {
  const url = `${getBaseUrl()}ServiceApis/killTxn`;
  const payload = {
    username: username || "",
    userid: userid || "",
    servid: String(servid || ""),
    transactionid: transactionid || "",
    orderedbytype: "serviceapp",
  };
  const resp = await apiFetch(
    url,
    { method: "POST", headers: getHeadersJson(), body: JSON.stringify(payload) },
    "killServiceTxn",
    { group: "ServicePay" }
  );
  if (!resp.ok) throw new Error(`Could not cancel the previous transaction (HTTP ${resp.status}).`);
  return readEnvelopeRaw(resp, "killServiceTxn");
}

/**
 * Finalize the order after payment — POST ServiceApis/cabletv/generateorder
 * (literal path for BOTH fofi and cabletv; servid distinguishes them). Returns
 * receipt_link / invoice_link on success. Mirrors native's onActivityResult →
 * PaymentStatusFragment.generateOrder.
 */
export async function generateServiceOrder({
  userid, username, servid, paidamount, gatewaytxnid, banktxnid, bankname,
  transactionid, fofiboxid = "", planid, priceid, voipnumber = "",
  channelid = [], packageid = [], pkgcode = [], lcochid = [],
  cblextenperiod = "", payrequest = "", payresponse = "", txnstatus = "success",
}) {
  const url = `${getBaseUrl()}ServiceApis/cabletv/generateorder`;
  const payload = {
    userid: userid || "",
    username: username || "",
    servid: String(servid || ""),
    paidamount: Number(paidamount || 0),
    paymentmode: "online",
    gateway: "Easebuzz",
    gatewaytxnid: gatewaytxnid || "",
    banktxnid: banktxnid || "",
    bankname: bankname || "",
    orderedbytype: "serviceapp",
    transactionid: transactionid || "",
    fofiboxid: fofiboxid || "",
    planid: String(planid || ""),
    priceid: String(priceid || ""),
    voipnumber: voipnumber || "",
    channelid,
    packageid,
    pkgcode,
    lcochid,
    cblextenperiod: String(cblextenperiod || ""),
    payrequest: payrequest || "",
    payresponse: payresponse || "",
    txnstatus,
  };

  const resp = await apiFetch(
    url,
    { method: "POST", headers: getHeadersJson(), body: JSON.stringify(payload) },
    "generateServiceOrder",
    { group: "ServicePay", timeout: PAYMENT_TIMEOUT }
  );
  if (!resp.ok) throw new Error(`Could not record the order (HTTP ${resp.status}).`);
  return readEnvelopeRaw(resp, "generateServiceOrder");
}
