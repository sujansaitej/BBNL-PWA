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
 * Get the current logged-in user object from localStorage.
 * Never throws — returns {} if missing/corrupted.
 */
export function getUser() {
  return safeGetJSON("user", {});
}
