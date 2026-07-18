// Customer account linking — PWA port of the Android customer app's
// LinkCableAccounts_Fragment flow.
//
// WHAT THIS IS FOR
// ----------------
// A customer logs into the app with an APP account (username/password), which
// carries no service identity at all — see Login.jsx, which keeps only
// { username, firstname, lastname, emailid, mobileno, op_id, photo }. Before
// they can do anything service-specific (raise a ticket, see a plan, pay a
// bill) they must LINK a service account by entering its user id. Linking is
// what yields service_user_id / servicekey / servid / opid / address — the
// exact identifiers the ticket endpoints require.
//
// ENDPOINTS (all ServiceApis/, all the MAIN credential block via
// getHeadersForm() — this is the same header set Android calls its
// "CONGIF_*" block: Authorization/username/password/appkeytype. Note that is
// a DIFFERENT block from the "APIS" one used by customer/tickets.js.)
//
//   ServiceApis/custServiceOtp            POST form   link (may demand an OTP)
//   ServiceApis/custServOtpVerification   POST form   confirm the OTP
//   ServiceApis/getServRegCastNos         GET         list already-linked ids
//   ServiceApis/delServRegCasNos          POST form   unlink one id
//
// The last two already existed in generalApis.js (they are also used by the
// operator surface) and are re-exported here rather than duplicated.
//
// SUCCESS DETECTION: numeric `status.err_code === 0`. Unlike the ticket
// endpoints, this family uses the standard envelope — but we still read it
// raw, because err_code 1 carries a user-facing err_msg we want to surface
// rather than throw.

import { apiFetch, getBaseUrl, getHeadersForm, readEnvelopeRaw } from "../apiCore";
import { getServiceList, getServRegCastNos, delServRegCasNos } from "../generalApis";

const GROUP = "CustLinkAccount";

// localStorage key for the currently-active linked account.
// REGISTERED IN AuthContext cleanup (logout + 7-day expiry). If you add
// another key here, add it there too — otherwise one customer's linked
// account leaks into the next session on a shared device.
export const ACTIVE_ACCOUNT_KEY = "custActiveAccount";

/**
 * Normalise a `userdata` object (from custServiceOtp / custServOtpVerification)
 * or a `body[]` row (from getServRegCastNos) into one shape.
 *
 * These two endpoints return the SAME field set, which is why the linked-list
 * rows can be promoted to the active account without a second lookup.
 *
 * Field names are Android's verbatim — `mobileno`, `emailid`, `castregid`.
 * `castregid` in particular is load-bearing: it is the REGISTRATION id and is
 * what delServRegCasNos wants, NOT `userid`.
 */
export function normalizeLinkedAccount(row, servicekey = "") {
  if (!row) return null;
  return {
    userid: row.userid || "",
    name: row.name || "",
    mobileno: row.mobileno || "",
    emailid: row.emailid || "",
    address: row.address || "",
    loginid: row.loginid || "",
    servid: String(row.servid ?? ""),
    opid: String(row.opid ?? ""),
    castregid: row.castregid || "",   // needed to UNLINK — not the userid
    compname: row.compname || "",
    logo: row.logo || "",
    issubscribed: row.issubscribed || "",
    page: row.page || "",             // "indigital" routes to a different home
    servicekey: servicekey || row.servicekey || "",
  };
}

// ── Active account (local) ───────────────────────────────────────────
export function getActiveAccount() {
  try {
    const raw = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.userid ? parsed : null;
  } catch {
    return null; // corrupt value must never break the page
  }
}

export function setActiveAccount(account) {
  if (!account?.userid) return;
  try {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    /* quota — non-fatal, the account is still usable this session */
  }
}

export function clearActiveAccount() {
  try {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    /* ignore */
  }
}

// ── Service lookup ───────────────────────────────────────────────────
/**
 * Resolve a service (id / title / icon) by its keyword, from
 * ServiceApis/servServiceList.
 *
 * The numeric service id is NOT hardcoded anywhere: constants/services.js has
 * `INTERNET.servid = null` because it has never been confirmed, and Android
 * likewise reads it from this list rather than assuming. `keyword` is the
 * field that carries "internet"/"cabletv"/"fofi" — `id` is the numeric id
 * that getServRegCastNos wants as `servid`.
 *
 * Android renders the card icon from the `img` field (NOT `icon` — see
 * PrimaryServicesAdapter), resolved against the API base URL.
 */
export async function resolveService(keyword = "internet") {
  const data = await getServiceList();
  const rows = Array.isArray(data?.body) ? data.body : [];
  const want = String(keyword).toLowerCase();

  const match =
    rows.find((s) => String(s?.keyword || "").toLowerCase() === want) ||
    rows.find((s) => String(s?.title || "").toLowerCase() === want) ||
    null;

  if (!match) return null;
  return {
    servid: String(match.id ?? ""),
    servicekey: String(match.keyword || want),
    title: match.title || "Service",
    description: match.description || "",
    // `img`, not `icon` — matches Android. Relative path off the API base.
    iconUrl: match.img ? `${getBaseUrl()}${String(match.img).replace(/^\//, "")}` : "",
  };
}

// ── 1. Link an account (POST · ServiceApis/custServiceOtp) ───────────
/**
 * Attempt to link `userid` to the logged-in app account.
 *
 * Two outcomes on success (err_code 0):
 *   - body.otpstatus === "yes" → an OTP was dispatched; the caller must
 *     collect it and call verifyServiceOtp(). NOTHING is linked yet.
 *   - otherwise               → already linked, `account` is populated.
 *
 * On err_code 1 the backend's err_msg is the user-facing reason (bad user id,
 * already linked, etc.) and is returned rather than thrown.
 */
export async function linkServiceAccount({ username, servicekey, userid }) {
  const url = `${getBaseUrl()}ServiceApis/custServiceOtp`;
  const body = new URLSearchParams({
    username: username || "",
    servicekey: servicekey || "",
    userid: userid || "",
  });

  const resp = await apiFetch(
    url,
    { method: "POST", headers: getHeadersForm(), body },
    "linkServiceAccount",
    { group: GROUP, linkNavigation: false }   // write path — must not abort on navigation
  );
  if (!resp.ok) throw new Error(`Could not link the account (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "linkServiceAccount");
  const code = Number(data?.status?.err_code);
  const message = data?.status?.err_msg || "";

  if (code !== 0) {
    return { ok: false, needsOtp: false, message, raw: data };
  }

  const b = data?.body || {};
  return {
    ok: true,
    needsOtp: String(b.otpstatus || "").toLowerCase() === "yes",
    otprefid: b.otprefid || "",
    // Drives the OTP input: Android uses these to pick a numeric keypad and
    // the number of boxes.
    otpDataType: b.otp_datatype || "numeric",
    otpTotChars: Number(b.otp_totchars) || 4,
    account: normalizeLinkedAccount(b.userdata, servicekey),
    message,
    raw: data,
  };
}

// ── 2. Verify the OTP (POST · ServiceApis/custServOtpVerification) ───
// Returns the SAME userdata shape as the link call, so the caller treats
// both paths identically once this resolves.
export async function verifyServiceOtp({ username, otprefid, otpcode, servicekey, userid }) {
  const url = `${getBaseUrl()}ServiceApis/custServOtpVerification`;
  const body = new URLSearchParams({
    username: username || "",
    otprefid: otprefid || "",
    otpcode: otpcode || "",
    servicekey: servicekey || "",
    userid: userid || "",
  });

  const resp = await apiFetch(
    url,
    { method: "POST", headers: getHeadersForm(), body },
    "verifyServiceOtp",
    { group: GROUP, linkNavigation: false }
  );
  if (!resp.ok) throw new Error(`Could not verify the OTP (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "verifyServiceOtp");
  const code = Number(data?.status?.err_code);
  const message = data?.status?.err_msg || "";

  return {
    ok: code === 0,
    account: code === 0 ? normalizeLinkedAccount(data?.body, servicekey) : null,
    message,
    raw: data,
  };
}

// ── 3. List linked accounts (GET · ServiceApis/getServRegCastNos) ────
// Android mirrors this into a Room table and renders from there, filtered by
// servid. We render the response directly — same result, no local mirror to
// drift out of sync.
export async function getLinkedAccounts({ servid, username, servicekey = "" }) {
  const data = await getServRegCastNos({ servid, username });
  const rows = Array.isArray(data?.body) ? data.body : [];
  return rows
    .map((r) => normalizeLinkedAccount(r, servicekey))
    .filter((r) => r && r.userid);
}

// ── 4. Unlink (POST · ServiceApis/delServRegCasNos) ──────────────────
/**
 * `regid` is the row's **castregid**, not its userid. Passing the userid
 * silently deletes nothing.
 */
export async function removeLinkedAccount({ regid }) {
  const data = await delServRegCasNos({ regid });
  const code = Number(data?.status?.err_code);
  return { ok: code === 0, message: data?.status?.err_msg || "", raw: data };
}
