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
const MAX_CONCURRENT = 4;

// L1 — in-memory: url → base64 dataUrl
const mem = new Map();
const loading = new Set();
const listeners = new Map();

// ── Startup: hydrate L1 from L2 ──
try {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LS_PREFIX)) continue;
    try {
      const { d, t } = JSON.parse(localStorage.getItem(key));
      if (Date.now() - t > TTL) {
        localStorage.removeItem(key);
      } else {
        mem.set(key.slice(LS_PREFIX.length), d);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
} catch { /* localStorage unavailable */ }

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
  } catch {
    return null;
  }
}

function lsSet(url, dataUrl) {
  try {
    localStorage.setItem(LS_PREFIX + url, JSON.stringify({ d: dataUrl, t: Date.now() }));
  } catch {
    // Quota exceeded — evict oldest entries and retry
    evictOldest(10);
    try {
      localStorage.setItem(LS_PREFIX + url, JSON.stringify({ d: dataUrl, t: Date.now() }));
    } catch { /* still full, skip */ }
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
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch { return; }
  entries.sort((a, b) => a.t - b.t);
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    try { localStorage.removeItem(entries[i].key); } catch {}
  }
}

// ── Core fetch: download image → base64 → store both tiers ──
async function fetchAndCache(url) {
  try {
    const res = await fetchImage(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    // Skip very large images (>500KB) to avoid filling localStorage
    if (blob.size > 500 * 1024) {
      // Still decode for in-memory use
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.src = objUrl;
      await img.decode().catch(() => {});
      mem.set(url, objUrl);
      return objUrl;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        mem.set(url, dataUrl);
        lsSet(url, dataUrl);
        resolve(dataUrl);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Notify subscribers ──
function notifySubs(url, dataUrl) {
  const cbs = listeners.get(url);
  if (cbs) {
    cbs.forEach((cb) => cb(dataUrl));
    listeners.delete(url);
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
      if (dataUrl) notifySubs(url, dataUrl);
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
