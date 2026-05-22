/**
 * Safely parse a JSON value from localStorage.
 * Returns `fallback` (default {}) if the key is missing, empty, or corrupted.
 */
export function safeGetJSON(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Convenience: read a key that stores a JSON array. Always returns an
 * array — empty if the key is missing, empty, or corrupted. Use this
 * instead of `JSON.parse(localStorage.getItem(k) || "[]")` which throws
 * on partially-written or truncated values (common under storage quota
 * pressure on low-tier Android phones).
 */
export function safeGetArray(key) {
  const v = safeGetJSON(key, []);
  return Array.isArray(v) ? v : [];
}

/**
 * Get the current logged-in user object from localStorage.
 * Never throws — returns {} if missing/corrupted.
 */
export function getUser() {
  return safeGetJSON("user", {});
}
