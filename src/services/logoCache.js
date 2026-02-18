/**
 * Two-tier image cache: L1 (in-memory Map) + L2 (localStorage base64 data URLs).
 *
 * - L1 gives instant synchronous access during the current session.
 * - L2 persists across page refreshes so logos appear immediately on return visits.
 * - On startup, L2 is hydrated into L1 so everything is instant from the first render.
 * - New images are fetched, converted to base64, and stored in both tiers.
 * - TTL of 7 days. Oldest entries evicted when localStorage is full.
 */

import { fetchImage } from "./iptvImage";

const LS_PREFIX = "lc_";
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CONCURRENT = 20;

// L1 — in-memory: url → base64 dataUrl (populated lazily from L2 on first access)
const mem = new Map();
const loading = new Set();
const listeners = new Map();

// ── localStorage helpers ──
function lsGet(url) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + url);
    if (!raw) return null;
    const { d, t } = JSON.parse(raw);
    if (Date.now() - t > TTL) {
      localStorage.removeItem(LS_PREFIX + url);
      return null;
    }
    return d;
  } catch (_e) {
    return null;
  }
}

function lsSet(url, dataUrl) {
  try {
    localStorage.setItem(LS_PREFIX + url, JSON.stringify({ d: dataUrl, t: Date.now() }));
  } catch (_e) {
    // Quota exceeded — evict oldest entries and retry
    evictOldest(20);
    try {
      localStorage.setItem(LS_PREFIX + url, JSON.stringify({ d: dataUrl, t: Date.now() }));
    } catch (_e2) { /* still full, skip */ }
  }
}

function evictOldest(count) {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LS_PREFIX)) continue;
      try {
        const { t } = JSON.parse(localStorage.getItem(key));
        entries.push({ key, t });
      } catch (_e) {
        localStorage.removeItem(key);
      }
    }
  } catch (_e) { return; }
  entries.sort((a, b) => a.t - b.t);
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    try { localStorage.removeItem(entries[i].key); } catch (_e) {}
  }
}

// ── Core fetch: download → objectURL for instant display → base64 in background for L2 ──
async function fetchAndCache(url) {
  // Retry once on failure for network resilience
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImage(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;

      // Create an object URL for instant display (no base64 wait)
      const objUrl = URL.createObjectURL(blob);
      mem.set(url, objUrl);

      // Persist to localStorage in the background (non-blocking)
      if (blob.size <= 500 * 1024) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          if (dataUrl) {
            mem.set(url, dataUrl);  // upgrade L1 to data URL
            lsSet(url, dataUrl);    // persist to L2
            notifySubs(url, dataUrl); // update any mounted components
            URL.revokeObjectURL(objUrl); // free the blob URL
          }
        };
        reader.readAsDataURL(blob);
      }

      return objUrl;
    } catch (_e) {
      // retry on next iteration
    }
  }
  return null;
}

// ── Notify subscribers ──
function notifySubs(url, dataUrl) {
  const cbs = listeners.get(url);
  if (cbs) {
    cbs.forEach((cb) => cb(dataUrl));
  }
}

// ── Queue for parallel fetch with concurrency limit ──
const queue = [];
let active = 0;

function enqueue(url) {
  return new Promise((resolve) => {
    queue.push({ url, resolve });
    drain();
  });
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const { url, resolve } = queue.shift();
    active++;
    fetchAndCache(url)
      .then((result) => {
        active--;
        resolve(result);
        drain();
      });
  }
}

// ── Public API ──

/** Get a cached data URL synchronously (or null if not yet cached) */
export function getCachedLogo(url) {
  if (!url) return null;
  // L1
  if (mem.has(url)) return mem.get(url);
  // L2 → hydrate L1
  const stored = lsGet(url);
  if (stored) {
    mem.set(url, stored);
    return stored;
  }
  return null;
}

/** Batch-preload an array of image URLs with concurrency control */
export function preloadLogos(urls) {
  if (!urls || urls.length === 0) return;
  urls.forEach((url) => {
    if (!url || mem.has(url) || loading.has(url)) return;

    // Check L2 first — if found, hydrate L1 and notify
    const stored = lsGet(url);
    if (stored) {
      mem.set(url, stored);
      notifySubs(url, stored);
      return;
    }

    loading.add(url);
    enqueue(url).then((dataUrl) => {
      loading.delete(url);
      // Always notify — even null cleans up orphaned listeners
      notifySubs(url, dataUrl);
    });
  });
}

/** Subscribe to a logo URL — calls back with data URL when ready */
export function subscribeLogo(url, callback) {
  if (!url) return () => {};

  // Already in L1
  const cached = getCachedLogo(url);
  if (cached) {
    callback(cached);
    return () => {};
  }

  // Register listener
  if (!listeners.has(url)) listeners.set(url, new Set());
  listeners.get(url).add(callback);

  // Start loading if not already in progress
  if (!loading.has(url)) preloadLogos([url]);

  return () => {
    const cbs = listeners.get(url);
    if (cbs) {
      cbs.delete(callback);
      if (cbs.size === 0) listeners.delete(url);
    }
  };
}
