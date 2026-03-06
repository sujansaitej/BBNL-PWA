/**
 * lsCache — localStorage cache with automatic quota management.
 *
 * Problem: raw localStorage.setItem silently fails at 5 MB quota.
 *          Stale entries accumulate because cleanup only runs on read.
 *
 * Solution:
 *   - All cache keys use a common prefix ("_c:") so we can identify them.
 *   - On QuotaExceededError: evict oldest entries until the write succeeds.
 *   - Lazy cleanup: first get/set call purges all expired entries.
 *   - Keeps non-cache keys (user, theme, loginType, deviceid) untouched.
 *
 * Usage:
 *   import { lsGet, lsSet } from './lsCache';
 *   const data = lsGet('walbal_user_internet', 5 * 60 * 1000);
 *   if (data) return data;
 *   // ... fetch from network ...
 *   lsSet('walbal_user_internet', freshData);
 */

const PREFIX = '_c:';

// Old cache key prefixes from before the _c: migration.
// These need a one-time cleanup so they don't waste quota forever.
const OLD_PREFIXES = ['walbal_', 'custlist_', 'svclist_', 'tktdepts', 'tkts_', 'orderhist_', 'regnec_', 'livetv_', 'channels_', 'ads_'];
const MIGRATE_FLAG = '_c_mig';

// ── Lazy cleanup on first access ──
let _cleaned = false;

function lazyCleanup() {
  if (_cleaned) return;
  _cleaned = true;
  try {
    const now = Date.now();

    // One-time migration: remove old un-prefixed cache keys from previous build
    if (!localStorage.getItem(MIGRATE_FLAG)) {
      localStorage.setItem(MIGRATE_FLAG, '1');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && OLD_PREFIXES.some(p => k.startsWith(p))) {
          localStorage.removeItem(k);
        }
      }
    }

    // Purge expired _c: entries (older than 24 hours)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const entry = JSON.parse(raw);
        if (!entry.ts || now - entry.ts > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(k);
        }
      } catch (_) {
        // Corrupt entry — remove it
        localStorage.removeItem(k);
      }
    }
  } catch (_) { /* localStorage not available */ }
}

/**
 * Read a cached entry.  Returns the stored data if fresh, null otherwise.
 * @param {string} key   Cache key (without prefix)
 * @param {number} ttl   Max age in ms (e.g. 5 * 60 * 1000 for 5 min)
 */
export function lsGet(key, ttl) {
  lazyCleanup();
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (entry.ts && Date.now() - entry.ts < ttl) return entry.data;
    // Expired — clean up immediately
    localStorage.removeItem(PREFIX + key);
  } catch (_) { /* corrupt or unavailable */ }
  return null;
}

/**
 * Read a cached entry even if expired (stale-while-revalidate pattern).
 * Returns { data, fresh } where fresh=true if within TTL, false if stale.
 * Returns null if no entry exists at all.
 * @param {string} key   Cache key (without prefix)
 * @param {number} ttl   Max age in ms
 */
export function lsGetStale(key, ttl) {
  lazyCleanup();
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry.ts || !entry.data) return null;
    return { data: entry.data, fresh: Date.now() - entry.ts < ttl };
  } catch (_) { /* corrupt or unavailable */ }
  return null;
}

/**
 * Write a cache entry.  On quota full, evicts oldest entries and retries.
 * @param {string} key   Cache key (without prefix)
 * @param {*}      data  JSON-serializable data
 */
export function lsSet(key, data) {
  lazyCleanup();
  const value = JSON.stringify({ data, ts: Date.now() });
  const fullKey = PREFIX + key;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      localStorage.setItem(fullKey, value);
      return; // success
    } catch (_) {
      // QuotaExceededError — evict oldest cache entries and retry
      if (!evictOldest()) return; // nothing left to evict
    }
  }
}

/**
 * Remove a specific cache entry.
 */
export function lsRemove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch (_) {}
}

/**
 * Evict the single oldest cache entry.  Returns true if something was evicted.
 */
function evictOldest() {
  let oldest = null;
  let oldestKey = null;

  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const entry = JSON.parse(raw);
        const ts = entry.ts || 0;
        if (oldest === null || ts < oldest) {
          oldest = ts;
          oldestKey = k;
        }
      } catch (_) {
        // Corrupt — evict this one immediately
        localStorage.removeItem(k);
        return true;
      }
    }
    if (oldestKey) {
      localStorage.removeItem(oldestKey);
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Clear ALL cache entries (preserves non-cache keys like user, theme, etc.).
 * Call on logout.
 */
export function lsClearAll() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch (_) {}
}
