// Customer service-home actions — PWA port of Android's
// CommonHomeScreenFragment and the screens its four action icons open.
//
// THREE CREDENTIAL POSTURES IN ONE FILE. This is not tidiable; it mirrors the
// backend:
//
//   apis/cust/resetmac/   → the "APIS" block (same hardcoded set as
//                           customer/tickets.js, apptype customerapp-v1)
//   apis/takebill/        → NO auth headers at all
//   overallAvgUsageReport → NO auth AND A DIFFERENT HOST entirely
//
// The data-usage report does not live on the netmon backend. Android calls
// ApiClient.changeApiBaseUrl("https://payurbills.co.in/best2/General/")
// immediately before the request and resets it afterwards. We hardcode the
// absolute URL instead — same destination, no global mutation to leak into
// the next call if something throws midway.

import { apiFetch, getBaseUrl, readEnvelopeRaw } from "../apiCore";

const GROUP = "CustServiceHome";

// Same block as customer/tickets.js — Constants.java's *_APIS set.
function apisHeaders(contentType) {
  const h = {
    Authorization: "c4f79e15f8c6ed0715a8ea44aebc38d8",
    username: "e2798af12a7a0f4f70b4d69efbc25f4d",
    password: "c1f377afbaa874acbb6b61f66957710a",
    apptype: "customerapp-v1",
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

// ── Reset MAC (POST · apis/cust/resetmac/ · APIS block) ──────────────
/**
 * Clears the MAC binding on the customer's connection so a new device can
 * authenticate.
 *
 * This is a MUTATION despite how small it is — it drops the current binding
 * and can knock the customer's active session offline. Callers must confirm
 * before invoking. Success is `status.err_code === 0`; the response body
 * carries the new `{ mac, macuserauth }`.
 */
export async function resetMac({ userid }) {
  const url = `${getBaseUrl()}apis/cust/resetmac/`;
  const body = new URLSearchParams({ userid: userid || "" }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: apisHeaders("application/x-www-form-urlencoded"), body },
    "resetMac",
    { group: GROUP, linkNavigation: false }   // write path
  );
  if (!resp.ok) throw new Error(`Could not reset the MAC (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "resetMac");
  const code = Number(data?.status?.err_code);
  return {
    ok: code === 0,
    message: data?.status?.err_msg || "",
    mac: data?.body?.mac ?? "",
    macuserauth: data?.body?.macuserauth ?? "",
    raw: data,
  };
}

// ── Data usage (POST · payurbills.co.in · no auth) ───────────────────
export const DATA_USAGE_URL =
  "https://payurbills.co.in/best2/General/overallAvgUsageReport/";

/**
 * Android formats the dates as `d-M-yyyy` WITHOUT zero padding
 * (`dayOfMonth + "-" + (monthOfYear+1) + "-" + year`), e.g. "5-7-2026".
 * Sending "05-07-2026" is a different string and has never been tested
 * against this endpoint, so we reproduce the unpadded form exactly.
 *
 * @param {Date|string} d - a Date, or a yyyy-mm-dd string from an <input type="date">
 */
export function toUsageDate(d) {
  const date = d instanceof Date ? d : new Date(`${d}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
}

/**
 * Overall average usage between two dates.
 *
 * NOTE the envelope: this endpoint speaks the {error, result} dialect, not
 * {status, body}. `error === 0` is success. Values arrive as display strings
 * with units already attached — "29.3 Gb" — so `balance` can legitimately be
 * the word "Unlimited" rather than a number. Do not parse these as numbers
 * without splitting off the unit.
 */
export async function getDataUsage({ apiopid, apiuserid, fromdt, todt }) {
  const body = new URLSearchParams({
    apiopid: apiopid || "",
    apiuserid: apiuserid || "",
    fromdt: fromdt || "",
    todt: todt || "",
  }).toString();

  const resp = await apiFetch(
    DATA_USAGE_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    "getDataUsage",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Could not load the usage report (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "getDataUsage");
  const ok = Number(data?.error) === 0;
  const r = data?.result || {};
  return {
    ok,
    upload: r.upload ?? "",
    download: r.download ?? "",
    total: r.total ?? "",
    balance: r.balance ?? "",
    raw: data,
  };
}

/** Strip the unit off a usage string ("29.3 Gb" → 29.3). NaN-safe. */
export function usageToNumber(v) {
  const n = parseFloat(String(v ?? "").trim().split(/\s+/)[0]);
  return Number.isFinite(n) ? n : 0;
}

// ── Internet payment history (POST · apis/takebill/ · no auth) ───────
/**
 * Per-payment history for an internet connection.
 *
 * {error, resultcount, result[]} dialect. Android checks `result.length > 0`
 * and ignores `error` entirely (its err_code branch is an empty block); we
 * read `error` but still return rows if they are present, so a non-zero
 * error with data does not blank the screen.
 */
export async function getInternetPaymentHistory({ apiopid, apiuserid }) {
  const url = `${getBaseUrl()}apis/takebill/`;
  const body = new URLSearchParams({
    apiopid: apiopid || "",
    apiuserid: apiuserid || "",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    "getInternetPaymentHistory",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Could not load payment history (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "getInternetPaymentHistory");
  const rows = Array.isArray(data?.result) ? data.result : [];
  return {
    ok: Number(data?.error) === 0 || rows.length > 0,
    count: Number(data?.resultcount) || rows.length,
    rows,
    raw: data,
  };
}

// ── Connection list helper ───────────────────────────────────────────
/**
 * Pick the connection array that matches a service key out of
 * getUserAssignedItems' body — which carries three separate arrays.
 *
 * Android indexes into these without a null check and CRASHES when a
 * customer has zero connections (specificServiceConnectionsList stays null).
 * Returning [] here is the whole point of this helper.
 */
export function connectionsFor(planBody, servicekey) {
  const key = String(servicekey || "").toLowerCase();
  const bucket =
    key === "voicecall" || key === "voice" ? "voip"
    : key === "internet" ? "internet"
    : "fofi";  // fofi AND cabletv both read body.fofi in Android
  const rows = planBody?.[bucket];
  return Array.isArray(rows) ? rows.filter(Boolean) : [];
}

/**
 * Find the subscribed_services row for a service key.
 * Android matches with `servicekey.contains(serviceKey)`, so "internet" also
 * matches a row keyed "internet_fttx". Reproduced.
 */
export function planRowFor(planBody, servicekey) {
  const rows = Array.isArray(planBody?.subscribed_services) ? planBody.subscribed_services : [];
  const key = String(servicekey || "").toLowerCase();
  if (!key) return null;
  return rows.find((r) => String(r?.servicekey || "").toLowerCase().includes(key)) || null;
}

/** Android shows a full expiry date except for voicecall, which it truncates. */
export function formatExpiry(expirydate, servicekey) {
  const v = String(expirydate || "");
  if (!v) return "";
  const key = String(servicekey || "").toLowerCase();
  return key === "voicecall" || key === "voice" ? v.slice(0, 10) : v;
}

/** The Proceed / Renew button is gated on this flag from getMyPlanDetails. */
export function isRenewEnabled(planBody) {
  return String(planBody?.other_service_renewal?.btn_status || "").toLowerCase() === "enable";
}

/**
 * cabletv-only: some boxes renew via PACKAGE selection rather than
 * other_service_renewal. For those, getMyPlanDetails returns
 * other_service_renewal.btn_status = null but chnls_pkgs_selection.btn_status =
 * "enable". Without this, the Proceed button never showed for such boxes even
 * though paymentinfo/cabletv accepts a package renewal.
 */
export function isPkgSelectionEnabled(planBody) {
  return String(planBody?.chnls_pkgs_selection?.btn_status || "").toLowerCase() === "enable";
}

/** Android's per-service display names for the header and the orange label. */
const SERVICE_TITLES = {
  internet: "Internet",
  cabletv: "OTT",
  fofi: "FOFI",
  voicecall: "VOIP",
  voice: "VOIP",
};
export function serviceTitle(servicekey) {
  const key = String(servicekey || "").toLowerCase();
  return SERVICE_TITLES[key] || servicekey || "Service";
}

/** The four action icons exist only for internet (Android: options_ll). */
export function showsInternetActions(servicekey) {
  return String(servicekey || "").toLowerCase() === "internet";
}

/**
 * Route base for a service's customer screens. IPTV's machine key is
 * `cabletv` but its route lives at /cust/iptv, so this cannot be derived from
 * the key by string alone. Single source of truth for the keyword→path map,
 * shared by ServiceLink, ServiceHome and OrderHistory so they never drift.
 */
export function serviceRouteBase(servicekey) {
  const key = String(servicekey || "").toLowerCase();
  if (key === "fofi") return "/cust/fofi";
  if (key === "cabletv") return "/cust/iptv";
  return "/cust/internet";
}
