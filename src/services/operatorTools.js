// Operator (franchisee) utility screens — PWA port of the Android CRM app's
// `dataUsageReport`, `ResetMacFragment` and the two-tab `OrderHistoryFragment`
// reached from the employee dashboard grid (DashboardLatest.java:175-193).
//
// CREDENTIALS. Both endpoints here live under `apis/` and take the THIRD
// credential set — Android's NEW_AUTH_VALUE / NEW_USERNAME_VALUE /
// NEW_PASSWORD block with an `apptype` header (NOT `appkeytype`). It is the
// same block orderApis.getOrderHistory uses for apis/custpayhistory, and
// that one was verified live: the main and internet-payment credentials are
// both rejected with "Header Authorization Failed!". Do not "tidy" these
// into getHeaders() — that builder emits `appkeytype` and the wrong secrets.
//
//   apis/custusage   ← ApiInterface.getCustomerDataUsage  (apptype: employee)
//   apis/resetmac    ← ApiInterface.getResetMac           (apptype: employee)
//
// The `apptype` value is Android's Constants.CONGIF_APP_TYPE_CUSTOMER_VALUE,
// which in the *employee* flavour is literally the string "employee" — the
// constant is misnamed there, not misused.
//
// NOTE the operator-side reset is a DIFFERENT endpoint from the customer-side
// one: `apis/resetmac` {apiopid, cid, adminuser} here, `apis/cust/resetmac/`
// {userid} in services/customer/serviceHome.js. They are not interchangeable.

import { apiFetch, getBaseUrl, readEnvelopeRaw } from "./apiCore";

const GROUP = "OperatorTools";

/** Android's NEW_* block from employee Constants.java (lines 158-161). */
function apisHeaders() {
  return {
    Authorization: "c4f79e15f8c6ed0715a8ea44aebc38d8",
    username: "e2798af12a7a0f4f70b4d69efbc25f4d",
    password: "c1f377afbaa874acbb6b61f66957710a",
    apptype: "employee",
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

/**
 * Strip the `[OPID]` suffix off a customer id before it goes on the wire.
 *
 * VERIFIED 2026-08-31 against netmontest: `apis/custpayhistory` returns
 * `cid` in the DECORATED form — "testrag7 [BBNL_OP49]" — but every one of
 * these endpoints rejects that exact string:
 *
 *   custusage  → err_code 1 "Enter Valid Customer"
 *   resetmac   → err_code 1 "Enter Valid Customer"
 *   custpayhistory → err_code 1 "No Payments History"
 *
 * whereas the bare "testrag7" works. So an operator who copies an id out of
 * the order-history list into the Data Usage or Reset Mac field gets a
 * flat "invalid customer" for an id that is plainly correct on screen.
 * Normalising here rather than in each page means no caller can miss it.
 *
 * Same regex as helpers.formatCustomerId, but that one returns "N/A" for an
 * empty input, which must never reach the wire.
 */
export function bareCustomerId(cid) {
  return String(cid ?? "").replace(/\s*\[.*\]\s*$/, "").trim();
}

/**
 * Android's date format for these two screens is `d-M-yyyy` with NO zero
 * padding — it is built by string concatenation:
 *
 *   dayOfMonth + "-" + (monthOfYear + 1) + "-" + year      // "5-7-2026"
 *
 * (dataUsageReport.pickdate, CommonOrderHistoryFragment.pickdate). Sending
 * "05-07-2026" is a different string and has never been tested against this
 * backend, so reproduce the unpadded form exactly. Same rule as
 * customer/serviceHome.toUsageDate.
 *
 * @param {Date|string} d  a Date, or a yyyy-mm-dd string from <input type="date">
 */
export function toDMY(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(`${d}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
}

// ── Data usage report (POST · apis/custusage) ────────────────────────
/**
 * Per-customer usage between two dates, for the operator.
 *
 * This is NOT the customer-portal report. That one lives on payurbills.co.in
 * and speaks an {error, result} envelope; this one is on netmon and speaks
 * the ordinary {status, body} envelope, with `status.err_code === 0` for
 * success.
 *
 * Values arrive as display strings with the unit glued on — "29.3G", "512M",
 * "1.2T". Android splits on the unit letter to get a number for its pie
 * chart, which is why `limit` can legitimately be a non-numeric string.
 * Do not parse these as plain numbers.
 *
 * Android REQUIRES both dates before it will call at all (it toasts "select
 * date" otherwise), even though it has a commented-out branch that sends
 * empty strings. Callers should enforce the same.
 *
 * `adminuser` is NOT optional either — VERIFIED 2026-08-31 against
 * netmontest: an empty one returns err_code 1 "Please enter required
 * fields" before the customer is even looked up. It is the operator's
 * `app_username`, i.e. `user.username`.
 *
 * @param {object} p
 * @param {string} p.apiopid    operator id      — Android: prefs "op_id"
 * @param {string} p.cid        customer id typed into the search field
 * @param {string} p.adminuser  operator login   — Android: prefs "app_username"
 * @param {string} p.from       d-M-yyyy (see toDMY)
 * @param {string} p.to         d-M-yyyy (see toDMY)
 */
export async function getCustomerDataUsage({ apiopid, cid, adminuser, from, to }) {
  const url = `${getBaseUrl()}apis/custusage`;
  const body = new URLSearchParams({
    apiopid: apiopid || "",
    cid: bareCustomerId(cid),
    adminuser: adminuser || "",
    from: from || "",
    to: to || "",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: apisHeaders(), body },
    "getCustomerDataUsage",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Could not load the usage report (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "getCustomerDataUsage");
  const ok = Number(data?.status?.err_code) === 0;
  const b = data?.body || {};
  return {
    ok,
    message: data?.status?.err_msg || "",
    download: b.download ?? "",
    upload: b.upload ?? "",
    total: b.total ?? "",
    limit: b.limit ?? "",
    fromdate: b.fromdate ?? "",
    todate: b.todate ?? "",
    raw: data,
  };
}

/**
 * Split a usage string into its number and its unit: "29.3G" → [29.3, "GB"].
 *
 * Android only ever tests for G / M / T and falls through to "Tb" for
 * anything else, including a bare number — so a value with no unit is
 * labelled terabytes there. That is plainly wrong on a screen an operator
 * reads to answer a customer, so an absent unit stays absent here.
 */
export function splitUsage(value) {
  const s = String(value ?? "").trim();
  if (!s) return { num: 0, unit: "" };
  const num = parseFloat(s);
  const m = /([GMTK])/i.exec(s);
  const unit = m ? `${m[1].toUpperCase()}B` : "";
  return { num: Number.isFinite(num) ? num : 0, unit };
}

// ── Reset MAC (POST · apis/resetmac) ─────────────────────────────────
/**
 * Clear the MAC binding on a customer's connection.
 *
 * MUTATION — it drops the current binding and can knock the customer's
 * active session offline, so the caller must confirm first.
 *
 * Android shows `status.err_msg` in a dialog on BOTH branches of its
 * err_code check (ResetMacFragment:84-89) — the two arms are identical — so
 * the message is always the thing worth surfacing. `ok` is returned as well
 * so the UI can colour it.
 *
 * @param {object} p
 * @param {string} p.apiopid    operator id      — Android: prefs "op_id"
 * @param {string} p.cid        customer id
 * @param {string} p.adminuser  operator login   — Android: prefs "app_username"
 */
export async function resetCustomerMac({ apiopid, cid, adminuser }) {
  const url = `${getBaseUrl()}apis/resetmac`;
  const body = new URLSearchParams({
    apiopid: apiopid || "",
    cid: bareCustomerId(cid),
    adminuser: adminuser || "",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: apisHeaders(), body },
    "resetCustomerMac",
    { group: GROUP, linkNavigation: false }   // write path
  );
  if (!resp.ok) throw new Error(`Could not reset the MAC (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "resetCustomerMac");
  const code = Number(data?.status?.err_code);
  return {
    ok: code === 0,
    message: data?.status?.err_msg || "",
    raw: data,
  };
}
