// Internet (broadband) customer payment endpoints — PWA port of Android's
// InternetPaymentDetailsFragment + PaymentStatusFragment.callGenerateOrderForInternetPayment.
//
// Internet's payment path differs from FoFi/IPTV: it uses apis/makepayment for
// the (server-priced, per-month) breakdown and Apis/savePaymentApi to finalize
// — NOT service/paymentinfo + cabletv/generateorder. BOTH are form-urlencoded
// POSTs with NO auth headers (native declares them with no @Headers block), and
// both speak the {error, result} dialect, not {status, body}. Path casing is
// load-bearing on the case-sensitive backend: makepayment is `apis/`,
// savePaymentApi is `Apis/`. The Easebuzz gateway itself is shared (easebuzz.js).

import { apiFetch, getBaseUrl, readEnvelopeRaw, PAYMENT_TIMEOUT } from "../apiCore";

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

/**
 * Payment breakdown — POST apis/makepayment (form, no auth). Returns
 * { error, result } where result carries merchanttxnid (the Easebuzz txnid),
 * planname, current_expiry, prevbalance, ispending, and planrates_android[]
 * (one server-priced entry per selectable month with its own total / taxes /
 * validity / split). This registers a payment attempt server-side, so treat it
 * as a mutation (linkNavigation:false), matching native.
 */
export async function getInternetMakePayment({ apiuserid, apiopid, apptype = "serviceapp" }) {
  const url = `${getBaseUrl()}apis/makepayment`;
  const body = new URLSearchParams({
    apiuserid: apiuserid || "",
    apiopid: apiopid || "",
    apptype,
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: FORM, body },
    "getInternetMakePayment",
    { group: "InternetPay", timeout: PAYMENT_TIMEOUT, linkNavigation: false }
  );
  if (!resp.ok) throw new Error(`Could not load payment details (HTTP ${resp.status}).`);
  return readEnvelopeRaw(resp, "getInternetMakePayment");
}

/**
 * Finalize the internet order after Easebuzz — POST Apis/savePaymentApi (form,
 * no auth). Field set mirrors native's callGenerateOrderForInternetPayment
 * exactly. Returns { error, result, receipt_link, invoice_link } (error "0" = ok).
 */
export async function saveInternetPayment({
  noofmonth, onl_pymt_typ, banktransid, gatewaycharges, gatewaytransid, bank_name,
  usagecompleted, cashpaid, paydoneby, transstatus, renewstatus, apiopid, apiuserid,
  gtwy_postvals,
}) {
  const url = `${getBaseUrl()}Apis/savePaymentApi`;
  const body = new URLSearchParams({
    noofmonth: String(noofmonth || "1"),
    onl_pymt_typ: onl_pymt_typ || "",
    banktransid: banktransid || "",
    gatewaycharges: gatewaycharges || "",
    gatewaytransid: gatewaytransid || "",
    bank_name: bank_name || "",
    usagecompleted: usagecompleted || "no",
    cashpaid: Number(cashpaid || 0).toFixed(2),
    applicationname: "serviceapp",
    paymode: "online",
    paydoneby: paydoneby || "",
    payreceivedby: "easebuzz",
    transstatus: transstatus || "success",
    renewstatus: renewstatus || "success",
    apiopid: apiopid || "",
    apiuserid: apiuserid || "",
    addprefix: "no",
    formtype: "payment",
    receivedremark: "",
    gtwy_postvals: gtwy_postvals || "",
    services_app: "1",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: FORM, body },
    "saveInternetPayment",
    { group: "InternetPay", timeout: PAYMENT_TIMEOUT, linkNavigation: false }
  );
  if (!resp.ok) throw new Error(`Could not record the payment (HTTP ${resp.status}).`);
  return readEnvelopeRaw(resp, "saveInternetPayment");
}
