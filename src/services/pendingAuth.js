/**
 * Escrow for a login that has cleared the password check but NOT the OTP.
 *
 * The point of this module is that a pending record grants NOTHING. Authority
 * in this app comes from exactly one place — `localStorage.user`, written by
 * AuthContext.login() — and ~40 call sites read it as proof of identity
 * (`getUser()`, `JSON.parse(localStorage.getItem('user'))`, PrivateRoute via
 * `isAuthenticated`). So the fix for "logged in without OTP" is not a new
 * guard bolted onto the OTP screen; it is refusing to write `user` until the
 * OTP verifies. Everything the OTP screen needs in the meantime — username,
 * otprefid, the user object to eventually commit — parks here.
 *
 * Deliberately sessionStorage, not localStorage: a half-finished login must
 * not survive the app closing. This ships as an installed PWA on shared
 * phones, so reopening the app has to land on /login, not on a resumable
 * challenge someone else can walk past.
 */

const KEY = "pendingOtpAuth";

/** An OTP challenge older than this is dead; the operator starts over. */
export const PENDING_AUTH_MAX_AGE = 10 * 60 * 1000;

/** Wrong-OTP attempts allowed before the challenge is torn down. */
export const MAX_OTP_ATTEMPTS = 5;

// Never throw. sessionStorage access throws in Safari private mode and under
// quota pressure, and a storage error must not become an unhandled rejection
// somewhere up the auth path.
function readRaw() {
  try {
    return sessionStorage.getItem(KEY);
  } catch (_) {
    return null;
  }
}

function writeRaw(value) {
  try {
    sessionStorage.setItem(KEY, value);
    return true;
  } catch (_) {
    return false;
  }
}

export function clearPendingAuth() {
  try {
    sessionStorage.removeItem(KEY);
  } catch (_) {}
}

/**
 * Park a password-verified identity while the OTP is outstanding.
 *
 * Returns false when the record could not be stored. Callers MUST treat that
 * as a failed login and stay on /login — falling back to "just log them in"
 * is the exact bug this module exists to prevent.
 */
export function setPendingAuth(
  { user, otprefid, loginType, otpLength, otpDataType },
  now = Date.now()
) {
  if (!user || !user.username) return false;
  const record = {
    user,
    otprefid: otprefid == null ? "" : String(otprefid),
    loginType: loginType || "franchisee",
    // Shape of the code the backend expects. Carried here because the OTP
    // screen has no other access to the login response.
    otpLength: Number(otpLength) >= 4 && Number(otpLength) <= 8 ? Number(otpLength) : 4,
    otpDataType: otpDataType === "alphanumeric" ? "alphanumeric" : "numeric",
    startedAt: now,
    attempts: 0,
  };
  return writeRaw(JSON.stringify(record));
}

/**
 * The outstanding challenge, or null. Self-cleaning: a malformed, incomplete
 * or expired record is removed and reported as absent, so an unreadable
 * pending state can never be mistaken for a valid one.
 */
export function getPendingAuth(now = Date.now()) {
  const raw = readRaw();
  if (!raw) return null;

  let record;
  try {
    record = JSON.parse(raw);
  } catch (_) {
    clearPendingAuth();
    return null;
  }

  if (!record || typeof record !== "object" || !record.user || !record.user.username) {
    clearPendingAuth();
    return null;
  }

  const startedAt = Number(record.startedAt);
  if (!startedAt || now - startedAt > PENDING_AUTH_MAX_AGE) {
    clearPendingAuth();
    return null;
  }

  return record;
}

export function hasPendingAuth(now = Date.now()) {
  return getPendingAuth(now) !== null;
}

/** Replace the otprefid after a resend issues a new one. No-op if expired. */
export function updatePendingOtpRef(otprefid, now = Date.now()) {
  const record = getPendingAuth(now);
  if (!record) return false;
  record.otprefid = otprefid == null ? "" : String(otprefid);
  return writeRaw(JSON.stringify(record));
}

/**
 * Count a rejected OTP. Returns the number of attempts still allowed; on 0 the
 * challenge has been destroyed and the caller must send the user to /login.
 *
 * A 4-digit code with unlimited guesses is a 10k-space brute force, so the cap
 * is part of the fix, not a nicety.
 */
export function recordFailedOtpAttempt(now = Date.now()) {
  const record = getPendingAuth(now);
  if (!record) return 0;

  const attempts = Number(record.attempts || 0) + 1;
  if (attempts >= MAX_OTP_ATTEMPTS) {
    clearPendingAuth();
    return 0;
  }

  record.attempts = attempts;
  if (!writeRaw(JSON.stringify(record))) {
    // Could not persist the increment — fail closed rather than hand out a
    // challenge whose attempt counter silently resets on every guess.
    clearPendingAuth();
    return 0;
  }
  return MAX_OTP_ATTEMPTS - attempts;
}
