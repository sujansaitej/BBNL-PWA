// apiCore — the single request layer for every BBNL backend call.
//
// WHY THIS EXISTS
// ---------------
// This module replaces six copy-pasted implementations of getBaseUrl /
// getHeadersJson / getHeadersForm / apiFetch that lived in generalApis,
// fofiApis, registrationApis, orderApis, ottApi and customer/apis.
//
// Those six copies drifted, and every drift was a bug:
//   - fofiApis omitted the X-App-Package header entirely
//   - ottApi + customer/apis never checked err_code, so a backend error
//     returned with HTTP 200 was reported to the UI as success
//   - registrationApis / orderApis / customer/apis kept a 15s timeout
//     after generalApis raised it to 30s for slow field phones
//   - registrationApis / orderApis / customer/apis were never linked to
//     navigationController, so their requests outlived the page
//   - submitKYC forgot its resp.ok guard
//
// Every one of those was a one-line fix applied to some copies and not
// others. Keeping this file as the ONLY place these concerns live is the
// point — please do not re-inline them.
//
// The canonical implementation here is generalApis' (the richest: dedupe,
// perf, nav-abort, security logging); the other five were strictly poorer.

import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";
import { getServiceSignal, isBackgroundMode } from "./navigationController";
import { isEnvelopeOk, envelopeError } from "./apiEnvelope";
// pendingAuth imports nothing, so this cannot create a cycle.
import { getPendingAuth } from "./pendingAuth";

// Re-exported so callers have one import site. The implementations live in
// apiEnvelope.js because they are pure and covered by apiEnvelope.test.js.
export { isEnvelopeOk, envelopeError };

// ── Timeouts ────────────────────────────────────────────────────────
// Field devices on 3G / patchy 4G see 10-15s baseline latency (DNS + TLS +
// server RTT + retransmits). A 15s cap caused frequent "Request timed out"
// errors on low-tier franchisee phones while working fine on flagships.
// 30s matches measured real-world tail latency without freezing the UI.
export const API_TIMEOUT = 30000;
export const UPLOAD_TIMEOUT = 60000;

// Internet payment endpoints (paymentinfo + savePaymentApi) routinely take
// 20-35s: the backend validates, computes share splits, persists, and
// updates plan/expiry in one request. 15s causes spurious timeouts even on
// 5G, and the operator then risks double-charging on retry.
export const PAYMENT_TIMEOUT = 45000;

// ── Base URL ────────────────────────────────────────────────────────
// PROD hits the absolute origin. NOTE: this only works because the PWA is
// co-hosted with the API on bbnlnetmon.bbnl.in — same-origin, so the custom
// auth headers never trigger a CORS preflight. The legacy PHP server sends
// no Access-Control-* headers, so serving this bundle from ANY other host
// breaks every call. Nothing enforces that coupling; treat it as load-bearing.
export function getBaseUrl() {
  if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL;
  return "/api/";
}

// ── Header profiles ─────────────────────────────────────────────────
// The backend has several independent credential sets. These are NOT
// interchangeable; each endpoint family accepts exactly one.

/**
 * appkeytype selector.
 *
 * Mirrors the Android app, which ships two product flavors (customer /
 * employee) each with appkeytype hardcoded at compile time. The PWA serves
 * both audiences from one deployment, so it picks at runtime from the
 * login-type toggle.
 *
 * SECURITY: this is NOT a trust boundary. localStorage is user-editable, so
 * a client can select `employee` at will. The backend authorizes on the
 * static header credentials below, not on the authenticated identity, so it
 * cannot currently reject that. No client-side change can fix this — it
 * needs a server-issued session token. Do not add validation here and
 * mistake it for a control.
 */
function getAppKeyType() {
  let type = null;
  try {
    type = localStorage.getItem("loginType");
  } catch (_) {}

  // During OTP verification there is deliberately no session, and loginType is
  // a session key — anything that purges the session (logout, expiry, the
  // schema check) removes it. Falling through to the customer default there
  // sends a franchisee's custLoginVerification / custLoginResendOtp with
  // appkeytype=customer, which the backend rejects as "Invalid User
  // Credentials" and then rate-limits. The parked challenge remembers which
  // portal the login started in, so use it as the fallback.
  if (!type) {
    try {
      type = getPendingAuth()?.loginType || null;
    } catch (_) {}
  }

  return type == "franchisee"
    ? import.meta.env.VITE_API_APP_USER_TYPE
    : import.meta.env.VITE_API_APP_USER_TYPE_CUST;
}

/** Default credentials — the vast majority of ServiceApis/* endpoints. */
function mainHeaders() {
  return {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: getAppKeyType(),
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
  };
}

/** Internet-payment credentials — apis/makepayment, apis/savePaymentApi. */
function employeePaymentHeaders() {
  return {
    Authorization:
      import.meta.env.VITE_API_PAYMENT_AUTH_KEY ||
      import.meta.env.VITE_INTERNET_PAYMENT_AUTH_KEY ||
      import.meta.env.VITE_API_AUTH_KEY,
    username:
      import.meta.env.VITE_API_PAYMENT_USERNAME ||
      import.meta.env.VITE_INTERNET_PAYMENT_USERNAME ||
      import.meta.env.VITE_API_USERNAME,
    password:
      import.meta.env.VITE_API_PAYMENT_PASSWORD ||
      import.meta.env.VITE_INTERNET_PAYMENT_PASSWORD ||
      import.meta.env.VITE_API_PASSWORD,
    // Forced employee: these endpoints are operator-driven regardless of
    // which portal the session is in.
    appkeytype:
      import.meta.env.VITE_API_PAYMENT_APP_USER_TYPE ||
      import.meta.env.VITE_INTERNET_PAYMENT_APP_USER_TYPE ||
      import.meta.env.VITE_API_APP_USER_TYPE,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
  };
}

/**
 * New-connection guest funnel credentials.
 *
 * Apis.php gates FIVE urls on its own key (Apis.php:33-35, :51):
 *   registerNewConnection · loginNewCustomer · getAvailableServices
 *   requestNewConnection  · getNewConnectionStatus
 * Any other credential answers "Header Authorization Failed!". It happens to be
 * the same triple as the QR web-login block, so it reuses VITE_WEBLOGIN_*
 * rather than introducing a fifth set of secrets.
 *
 * No appkeytype/appversion — _headerAuth() compares only these three.
 */
function newConnHeaders() {
  return {
    Authorization: import.meta.env.VITE_WEBLOGIN_AUTH_KEY,
    username: import.meta.env.VITE_WEBLOGIN_USERNAME,
    password: import.meta.env.VITE_WEBLOGIN_PASSWORD,
  };
}

/**
 * The `apis/*` block — a FOURTH credential set, distinct from the three above.
 *
 * Constants.java in the customer app calls it CONGIF_*_APIS. It is what
 * apis/cust/clientlatlong (nearby operators) and apis/custpayhistory accept;
 * orderApis.js already hardcoded the same triple before this profile existed.
 *
 * `apptype` here is the literal "customerapp-v1", NOT the employee/customer
 * value the main profile sends as `appkeytype`. Different header, different
 * vocabulary — they are not interchangeable.
 */
function apisHeaders() {
  return {
    Authorization: "c4f79e15f8c6ed0715a8ea44aebc38d8",
    username: "e2798af12a7a0f4f70b4d69efbc25f4d",
    password: "c1f377afbaa874acbb6b61f66957710a",
    apptype: "customerapp-v1",
  };
}

export const PROFILE = {
  MAIN: "main",
  EMPLOYEE_PAYMENT: "employeePayment",
  NEW_CONNECTION: "newConnection",
  APIS: "apis",
};

const PROFILE_BUILDERS = {
  [PROFILE.MAIN]: mainHeaders,
  [PROFILE.EMPLOYEE_PAYMENT]: employeePaymentHeaders,
  [PROFILE.NEW_CONNECTION]: newConnHeaders,
  [PROFILE.APIS]: apisHeaders,
};

/**
 * Build request headers.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.profile=PROFILE.MAIN]  Which credential set.
 * @param {string}  [opts.contentType]  Omit for FormData/multipart — the
 *   browser must set the boundary itself. Passing a Content-Type on a
 *   multipart body produces a request the backend cannot parse.
 */
export function getHeaders({ profile = PROFILE.MAIN, contentType } = {}) {
  const build = PROFILE_BUILDERS[profile];
  if (!build) throw new Error(`apiCore: unknown header profile "${profile}"`);
  const headers = build();
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

/** Convenience: JSON request headers. */
export function getHeadersJson(profile = PROFILE.MAIN) {
  return getHeaders({ profile, contentType: "application/json" });
}

/** Convenience: FormData/multipart headers (no Content-Type — browser sets it). */
export function getHeadersForm(profile = PROFILE.MAIN) {
  return getHeaders({ profile });
}

// ── Request deduplication ───────────────────────────────────────────
// Multiple components (overview mount, prefetch, click handlers) can race
// for the same endpoint+payload. Without dedupe each fires its own request,
// wasting connection slots (browsers cap at 6 per origin over HTTP/1.1).
// The Android app dedupes at the OkHttp client level; we mirror that.
const _inflight = new Map();

export function dedupe(key, fn) {
  if (_inflight.has(key)) return _inflight.get(key);
  const p = (async () => fn())().finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

// ── Load-balancer reassignment retry ────────────────────────────────
//
// netmon sits behind a load balancer that pins a client to one node with a
// `SERVERUSED` cookie. Proven 2026-08-26 against netmontest: send a valid
// `SERVERUSED` and the LB honours it and does not re-set it; send an unknown
// value or none at all and the LB PICKS a node and sets the cookie itself.
//
// Every call from here goes out `credentials: "omit"` (see the note in
// apiFetch — it keeps the ci_session cookie off the wire because PHP holds an
// exclusive lock on the session file for the life of a request, which
// serialises anything sharing a session). That decision also drops
// `SERVERUSED`, so EVERY API request arrives cookie-less and is routed afresh,
// while the page and its assets — ordinary loads that do send cookies — stay
// pinned to whichever node served them. That is why a bad pool member shows up
// as an app that loads perfectly and then fails a random scattering of its API
// calls rather than failing outright.
//
// The signature of one of those failures, from a QA console 2026-08-26:
// HTTP 404 in 87-108ms. Measured against the same host, a REAL application 404
// (a route CodeIgniter does not have) costs ~440ms and a success ~940ms — an
// order of magnitude slower. Those 404s never reached the application.
//
// Retrying is worth doing precisely BECAUSE there is no affinity: a second,
// still cookie-less attempt gets its own routing decision, so it can land on a
// healthy node. It is a mitigation, not a cure — the cure is repairing the
// pool member or giving the LB source-IP persistence.
//
// SAFETY: a retry must never re-run something that changed state, so this is
// STRICTLY OPT-IN — `cfg.idempotent: true`, per call site, nothing inferred.
//
// The obvious design was "retry GET automatically, since GET is idempotent by
// definition". That is wrong HERE: this backend files a complaint over
// `GET apis/raiseTicket/?...` (services/customer/tickets.js). A method-based
// default would have retried it and lodged duplicate tickets — the very thing
// the pending-ticket guard exists to prevent. The HTTP verb says nothing about
// what these endpoints do, so only a human reading the endpoint may declare it
// safe, and the default for everything is NO retry.
const RETRY_STATUSES = new Set([404, 502, 503, 504]);
const RETRY_DELAY_MS = 250;

// ── Fetch wrapper ───────────────────────────────────────────────────
/**
 * fetch + timeout + navigation-abort + perf timing + security logging.
 * Returns the raw Response; callers decide how to read the body.
 *
 * @param {string} url
 * @param {object} options            passed through to fetch
 * @param {string} label              for logs/perf
 * @param {object} [cfg]
 * @param {number} [cfg.timeout=API_TIMEOUT]
 * @param {string} [cfg.group="General"]  perf-monitor grouping
 * @param {boolean} [cfg.linkNavigation=true]  abort when user navigates away
 * @param {boolean} [cfg.idempotent=false]  does this endpoint only READ? Set
 *   it so a load-balancer 404 can be retried onto a healthy node. Judge the
 *   endpoint, not the verb — `raiseTicket` is a GET that files a ticket. NEVER
 *   set it on anything that changes state. See RETRY_STATUSES above.
 */
export async function apiFetch(url, options, label, cfg = {}) {
  const {
    timeout = API_TIMEOUT,
    group = "General",
    linkNavigation = true,
  } = cfg;

  const method = options.method || "GET";
  const idempotent = cfg.idempotent === true;
  const endPerf = perfMonitor.start(method, url, group, label);
  logger.debug("API", `${label} → ${method} ${url}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  // Skip nav-abort for background/prefetch so cache-warming survives navigation.
  const _bg = isBackgroundMode();
  let navSignal, onNavAbort;
  if (linkNavigation && !_bg) {
    navSignal = getServiceSignal();
    onNavAbort = () => ctrl.abort();
    if (navSignal.aborted) {
      clearTimeout(timer);
      endPerf({ status: 0, error: "navigation cancelled" });
      throw new Error("Request cancelled — navigated away.");
    }
    navSignal.addEventListener("abort", onNavAbort, { once: true });
  }

  let resp;
  try {
    // credentials:"omit" — do NOT send the ci_session_prodnew cookie. The API
    // authenticates on the static header credentials, never on the session, so
    // the cookie buys nothing. But PHP holds an exclusive lock on the session
    // file for the life of each request, so any calls sharing a session cookie
    // serialize server-side (measured ~8x on the FoFi mount's parallel batch).
    // Android is fast here only because OkHttp defaults to CookieJar.NO_COOKIES.
    // Placed before the spread so a caller that genuinely needs the session
    // (login handshake) can override via options.credentials.
    resp = await fetch(url, { credentials: "omit", ...options, signal: ctrl.signal });
  } catch (err) {
    const isTimeout = err.name === "AbortError";
    if (isTimeout && navSignal?.aborted) {
      endPerf({ status: 0, error: "navigation cancelled" });
      throw new Error("Request cancelled — navigated away.");
    }
    const errMsg = isTimeout ? "timeout" : `network error: ${err.message}`;
    endPerf({ status: 0, error: errMsg });
    logger.error("API", `${label} ${errMsg}`, { method, url });
    throw new Error(
      isTimeout
        ? "Request timed out. Please check your network and try again."
        : `Network error: ${err.message}`
    );
  } finally {
    clearTimeout(timer);
    if (navSignal) navSignal.removeEventListener("abort", onNavAbort);
  }

  const entry = endPerf({ status: resp.status });
  logger.api(method, url, resp.status, entry.duration);

  if (resp.status === 401 || resp.status === 403) {
    logger.security("API_AUTH_REJECTED", { endpoint: url, status: resp.status, label });
  }

  // One more go on a status that means "this node could not serve you", and
  // only when re-sending is safe. The retry is cookie-less like the first
  // attempt, so the load balancer routes it independently — see the note above
  // RETRY_STATUSES. Bounded to a single extra attempt: if the whole pool is
  // down, hammering it does not help and the caller needs the error.
  if (RETRY_STATUSES.has(resp.status) && idempotent && !cfg._retried) {
    logger.warn("API", `${label} got HTTP ${resp.status} — retrying once for a new route`, {
      method, url, ms: entry.duration,
    });
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return apiFetch(url, options, label, { ...cfg, _retried: true });
  }

  return resp;
}

// ── Response envelope ───────────────────────────────────────────────
// Every BBNL endpoint returns:
//   { "status": { "err_code": 0, "err_msg": "..." }, "body": { ... } }
// err_code 0 = success, non-zero = failure with err_msg. `body` is omitted
// on error. This is the ONLY success discriminator — not HTTP status, not a
// "success" string.
//
// See apiEnvelope.js for isEnvelopeOk/envelopeError and the type-coercion
// rationale (Android's two status models disagree on err_code's type).

/**
 * Read a Response as the standard envelope, throwing on any failure.
 *
 * Handles three distinct failure modes Android conflates:
 *   1. transport failure (non-2xx)   → throw
 *   2. malformed/non-JSON body       → throw (Android NPEs here)
 *   3. envelope err_code != 0        → throw err_msg
 *
 * Android routes 4xx to its SUCCESS handler with a null body, so every 4xx
 * becomes an NPE swallowed by a try/catch and surfaces as a generic error.
 * We deliberately do not reproduce that.
 *
 * @returns {object} the parsed envelope (caller reads `.body`)
 */
export async function readEnvelope(resp, label = "API") {
  const text = await resp.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (_e) {
    logger.error(label, `Invalid JSON response (HTTP ${resp.status})`);
    throw new Error("Server returned an invalid response. Please try again.");
  }

  if (!resp.ok && !data?.status) {
    throw new Error(`HTTP ${resp.status}`);
  }

  if (!isEnvelopeOk(data)) {
    const msg = envelopeError(data);
    logger.warn(label, `API error: ${msg}`);
    throw new Error(msg);
  }

  return data;
}

/**
 * Like readEnvelope but returns the envelope instead of throwing on a
 * non-zero err_code. Use ONLY where the caller genuinely needs to branch on
 * err_msg (e.g. kycRetry inspects operator-sync messages to decide retry).
 * Still throws on transport/parse failure.
 */
export async function readEnvelopeRaw(resp, label = "API") {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (_e) {
    logger.error(label, `Invalid JSON response (HTTP ${resp.status})`);
    throw new Error("Server returned an invalid response. Please try again.");
  }
}
