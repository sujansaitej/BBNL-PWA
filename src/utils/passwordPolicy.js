/**
 * Password policy for customer registration (Add User).
 *
 * Deliberately simple, and matched to the Android operator app
 * (InputValidate.isPasswordValid): a length bound plus a blocklist of
 * literal weak passwords.
 *
 * There is intentionally NO uppercase / lowercase / digit / special-character
 * requirement. Operators set the password on the customer's behalf at the
 * doorstep, and the customer has to remember it — a plain phone number or any
 * random string is fine. Only the two obvious guesses are rejected.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 30; // backend/Android parity

// Matched case-insensitively against the whole (trimmed) password.
export const BLOCKED_PASSWORDS = ["password", "12345678"];

/**
 * @param {string} password
 * @returns {string|null} error message, or null when the password is accepted
 */
export function validatePassword(password) {
  const value = typeof password === "string" ? password : "";

  if (!value) return "Password is required";
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Password must not exceed ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (BLOCKED_PASSWORDS.includes(value.trim().toLowerCase())) {
    return `"${value.trim()}" is too common. Please choose a different password.`;
  }
  return null;
}
