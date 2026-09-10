/**
 * Pure decision layer for the login screen: given the custlogin response,
 * decide whether a session may be created or an OTP must be verified first.
 *
 * This lives outside the component on purpose. The "logged in without OTP" bug
 * was a two-line ordering mistake inside an async handler in Login.jsx —
 * `login(userDet)` ran before the otpstatus branch — and nothing in the test
 * suite could see it, because vitest runs `environment: "node"` here and the
 * component cannot be rendered. Extracting the decision makes the one question
 * that matters ("does this response grant a session?") directly assertable.
 *
 * See loginFlow.test.js. Do not inline this back into the component.
 */
import { isEnvelopeOk, envelopeError } from "./apiEnvelope";

/** Fields of the login body that make up the app's user identity. */
function pickUser(body) {
  const { username, firstname, lastname, emailid, mobileno, op_id, photo } = body;
  return { username, firstname, lastname, emailid, mobileno, op_id, photo };
}

/** Values that unambiguously mean "a second factor is outstanding". */
const OTP_POSITIVE = new Set(["yes", "y", "true", "1", "sent", "success"]);

/** Values that unambiguously mean "no second factor". */
const OTP_NEGATIVE = new Set(["no", "n", "false", "0", "", "null", "none", "na"]);

/** An otprefid that actually identifies an issued challenge. */
function hasIssuedChallenge(body) {
  const ref = body?.otprefid;
  if (ref == null) return false;
  const s = String(ref).trim();
  return s !== "" && s !== "0" && s.toLowerCase() !== "null";
}

/**
 * True when the backend is telling us a second factor is outstanding.
 *
 * Three tiers, because operators reported receiving the OTP SMS while the app
 * walked them straight to the dashboard — meaning the backend dispatched a code
 * but the response did not say `"yes"`:
 *
 *  1. Recognised positive  → OTP required.
 *     The original code tested `otpstatus === 'yes'` exactly, so `"Yes"`,
 *     `"YES"`, `"1"` or `true` all skipped the gate while the SMS still went
 *     out. That is the leading explanation for the reported behaviour.
 *  2. Recognised negative  → no OTP. Unchanged, so accounts that legitimately
 *     have no second factor keep working.
 *  3. Anything else (an unrecognised value) → OTP required ONLY IF the backend
 *     also returned a usable `otprefid`. Fail closed on the unknown, but never
 *     strand an operator on a screen asking for a code that was never issued —
 *     without an otprefid there is nothing to verify against.
 *
 * A missing otpstatus stays "no OTP": absent means the backend did not ask.
 */
function otpRequired(body) {
  const raw = body?.otpstatus;
  if (raw == null) return false;

  const v = String(raw).trim().toLowerCase();
  if (OTP_POSITIVE.has(v)) return true;
  if (OTP_NEGATIVE.has(v)) return false;

  return hasIssuedChallenge(body);
}

/**
 * True when the response contradicts itself: it claims no second factor, yet
 * carries an issued challenge. Surfaced as a log so the backend team can be
 * shown a concrete case rather than "operators say sometimes".
 *
 * Deliberately NOT treated as OTP-required: if a no-OTP account routinely comes
 * back with a stale otprefid, honouring it would lock out every one of them.
 * That needs a backend answer, not a client guess.
 */
export function otpContradiction(body) {
  const raw = body?.otpstatus;
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return OTP_NEGATIVE.has(v) && hasIssuedChallenge(body);
}

export function homeFor(loginType) {
  return loginType === "customer" ? "/cust/dashboard" : "/";
}

/**
 * Classify why an OTP verification failed.
 *
 * Not every failure is a wrong code. The backend also answers this endpoint
 * with header-auth rejections ("Invalid User Credentials, please enter right
 * userid & password") and its own rate limit ("Login attempts has exhausted,
 * Please try after sometime or contact BBNL 15 min left"). Charging those
 * against the client's 5-attempt cap burns the operator's remaining tries on a
 * problem no code could fix, and appending "— 4 attempts left" to an
 * already-long backend message produces an unreadable wall of red text.
 *
 * Returns "blocked" for anything that is not plausibly a mistyped code.
 */
export function classifyOtpFailure(message) {
  const m = String(message || "").toLowerCase();
  const blocked =
    /credential/.test(m) ||
    /exhaust/.test(m) ||
    /try after/.test(m) ||
    /locked|blocked|too many/.test(m) ||
    /attempts?\s*(left|remaining)/.test(m) ||
    /userid\s*&?\s*password|user\s*id\s*and\s*password/.test(m);
  return blocked ? "blocked" : "wrong-code";
}

/**
 * Trim the backend's message to something an operator can read on a phone.
 * These arrive as several sentences concatenated by the server.
 */
export function firstSentence(message, max = 120) {
  const s = String(message || "").trim();
  if (!s) return "Invalid OTP";
  const cut = s.split(/(?<=[.!?])\s+/)[0] || s;
  return cut.length > max ? `${cut.slice(0, max - 1).trimEnd()}…` : cut;
}

/**
 * How many characters the OTP input should accept.
 *
 * The backend decides this per account and Android honours it
 * (`OTPVerificationActivity.onCreate` → `pinView.setItemCount(otp_totchars)`,
 * defaulting to 4). The PWA used to hardcode 4, so an account configured for a
 * 6-character code could not be entered at all — the 4th keystroke auto-submits
 * a truncated code. Clamped to a sane range so a junk value cannot render
 * hundreds of inputs.
 */
export function otpLength(body) {
  const n = parseInt(body?.otp_totchars, 10);
  if (!Number.isFinite(n) || n < 4 || n > 8) return 4;
  return n;
}

/**
 * "numeric" or "alphanumeric" — Android swaps to a text-capable input for
 * alphanumeric codes. A numeric-only field silently drops letters, which looks
 * to the operator like the keypad is broken.
 */
export function otpDataType(body) {
  return String(body?.otp_datatype || "").trim().toLowerCase() === "alphanumeric"
    ? "alphanumeric"
    : "numeric";
}

/**
 * Decide what the login screen should do next.
 *
 * Returns one of:
 *   { action: "error",   message }
 *   { action: "otp",     user, otprefid, loginType, home }  — create NO session
 *   { action: "session", user, loginType, home }            — safe to log in
 *
 * `action: "otp"` must never be handled by calling AuthContext.login().
 */
export function resolveLoginOutcome(result, loginType) {
  // err_code === 0 is the success contract. Gating on `err_code === 1` (as an
  // earlier version did) let every other non-zero code through as a success.
  if (!isEnvelopeOk(result)) {
    return { action: "error", message: envelopeError(result) };
  }
  if (!result?.body) {
    return { action: "error", message: "Invalid response from server" };
  }

  const user = pickUser(result.body);
  if (!user.username) {
    return { action: "error", message: "Invalid response from server" };
  }

  const home = homeFor(loginType);

  if (otpRequired(result.body)) {
    return {
      action: "otp",
      user,
      otprefid: result.body.otprefid == null ? "" : String(result.body.otprefid),
      otpLength: otpLength(result.body),
      otpDataType: otpDataType(result.body),
      loginType,
      home,
    };
  }

  return { action: "session", user, loginType, home };
}
