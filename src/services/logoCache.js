/**
 * Workbox-backed image cache with in-memory layer for React.
 *
 * - Workbox (service worker): caches fetch() responses via CacheFirst strategy
 *   in the "channel-assets-v1" Cache API store (500 entries, 60 days).
 *   Return visits get instant cache hits with zero network wait.
 *
 * - L1 (in-memory Map): holds object URLs for the current session so
 *   <img src={objectUrl}> works without re-creating blobs on every render.
 *
 * Flow:
 *   fetch(url, {headers: auth})          ← app calls fetchImage()
 *     → Service Worker intercepts        ← Workbox CacheFirst
 *       → cache hit  → instant Response  ← no network needed
 *       → cache miss → network + cache   ← auth headers preserved
 *     → JS creates objectURL from blob   ← for <img> rendering
 *     → objectURL stored in L1 Map       ← synchronous access for React
 */

import { fetchImage } from "./iptvImage";

// Adapt concurrency to network speed.  Production uses HTTPS → HTTP/2
// multiplexing, so we can push more parallel requests than HTTP/1.1's
// 6-per-host limit.  This is the single biggest lever for 275-channel
// logo load time: 275 logos ÷ 14 concurrent ≈ 20 batches vs ÷ 8 = 34.
function getMaxConcurrent() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 3;
    if (conn.effectiveType === '3g') return 6;
  }
  return 14;
}

// L1 — in-memory: url → objectURL
const mem = new Map();
const loading = new Set();
const listeners = new Map();
const failed = new Map(); // url → { count, ts }

// ── Core fetch ──

async function fetchAndCache(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // This fetch() is intercepted by the service worker.
      // Workbox serves from Cache API if available (instant),
      // otherwise forwards to network and caches the response.
      const res = await fetchImage(url);
      if (!res.ok) {
        // On 401/403 retry is pointless — bail immediately
        if (res.status === 401 || res.status === 403) return null;
        continue;
      }
      const blob = await res.blob();
      // Validate: must have content and be an image (not an HTML error page)
      if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) continue;

      const objUrl = URL.createObjectURL(blob);
      mem.set(url, objUrl);
      return objUrl;
    } catch (_e) {
      // retry on next iteration (network timeout, abort, etc.)
    }
  }
  return null;
}

// ── Notify subscribers (batched via rAF to coalesce React re-renders) ──
// Using requestAnimationFrame instead of queueMicrotask so that multiple
// logo fetches completing within the same frame produce ONE React re-render
// instead of one per logo.  On 275 channels this cuts paint-jank significantly.
const pendingNotifications = [];
let notifyScheduled = false;

function flushNotifications() {
  notifyScheduled = false;
  const batch = pendingNotifications.splice(0);
  for (const { url, dataUrl } of batch) {
    const cbs = listeners.get(url);
    if (cbs) {
      // Copy the set before iterating — callbacks may unsubscribe during iteration
      [...cbs].forEach((cb) => cb(dataUrl));
    }
  }
}

function notifySubs(url, dataUrl) {
  pendingNotifications.push({ url, dataUrl });
  if (!notifyScheduled) {
    notifyScheduled = true;
    requestAnimationFrame(flushNotifications);
  }
}

// ── Queue for parallel fetch with concurrency limit ──
// Priority items (language logos, ~8) bypass the concurrency cap so they
// always start immediately — even when all 14 slots are busy with channel logos.
// HTTP/2 multiplexing handles the brief burst (14 + 8 = 22) with no penalty.
const queue = [];
let active = 0;

function enqueue(url, priority = false) {
  return new Promise((resolve) => {
    if (priority) queue.unshift({ url, resolve, pri: true });
    else queue.push({ url, resolve });
    drain();
  });
}

function drain() {
  const maxC = getMaxConcurrent();
  while (queue.length > 0) {
    // Priority items always start; normal items wait for a free slot
    if (active >= maxC && !queue[0].pri) break;
    const { url, resolve } = queue.shift();
    active++;
    fetchAndCache(url).then((result) => {
      active--;
      resolve(result);
      drain();
    });
  }
}

// ── Public API ──

/** Get a cached object URL synchronously (or null if not yet fetched this session) */
export function getCachedLogo(url) {
  if (!url) return null;
  return mem.get(url) || null;
}

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 800;
// After this cooldown, a previously-failed URL is eligible to retry from scratch.
// Prevents permanent blacklisting when the user re-visits the page later.
const FAILED_COOLDOWN = 60 * 1000; // 60 seconds

function getRetryDelay() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')) return 2500;
  if (conn?.effectiveType === '3g') return 1200;
  return BASE_RETRY_DELAY;
}

/** Check if a failed URL's cooldown has expired and reset it if so. */
function resetIfCooledDown(url) {
  const entry = failed.get(url);
  if (entry && Date.now() - entry.ts > FAILED_COOLDOWN) {
    failed.delete(url);
  }
}

/** Batch-preload an array of image URLs with concurrency control.
 *  Pass priority=true for small critical sets (e.g. language logos) to load them first. */
export function preloadLogos(urls, priority = false) {
  if (!urls || urls.length === 0) return;
  urls.forEach((url) => {
    if (!url || mem.has(url) || loading.has(url)) return;

    // Reset failed-URL blacklist if enough time has passed (e.g. user re-visited page)
    resetIfCooledDown(url);

    loading.add(url);
    enqueue(url, priority).then((objUrl) => {
      loading.delete(url);
      if (objUrl) {
        failed.delete(url);
      } else {
        // Auto-retry failed fetches after a delay
        const prev = failed.get(url);
        const retryCount = (prev?.count || 0) + 1;
        failed.set(url, { count: retryCount, ts: Date.now() });
        if (retryCount <= MAX_RETRIES) {
          setTimeout(() => {
            if (!mem.has(url) && !loading.has(url)) {
              loading.add(url);
              enqueue(url, true).then((retryResult) => {
                loading.delete(url);
                if (retryResult) {
                  failed.delete(url);
                } else {
                  const p = failed.get(url);
                  failed.set(url, { count: (p?.count || retryCount) + 1, ts: Date.now() });
                }
                notifySubs(url, retryResult);
              });
            }
          }, getRetryDelay() * retryCount);
        }
      }
      // Always notify — even null cleans up orphaned listeners
      notifySubs(url, objUrl);
    });
  });
}

/** Subscribe to a logo URL — calls back with object URL when ready */
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

  // Start loading if not already in progress.
  // Also re-trigger if the URL previously failed and cooldown has passed.
  if (!loading.has(url)) {
    resetIfCooledDown(url);
    preloadLogos([url]);
  }

  return () => {
    const cbs = listeners.get(url);
    if (cbs) {
      cbs.delete(callback);
      if (cbs.size === 0) listeners.delete(url);
    }
  };
}

// ── One-time cleanup of old localStorage logo cache ──
// Previous version stored base64 data URLs in localStorage with "lc_" prefix.
// Workbox Cache API now handles persistence, so free up the localStorage space.
try {
  if (!localStorage.getItem('_lc_migrated')) {
    localStorage.setItem('_lc_migrated', '1');
    const toRemove = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('lc_')) toRemove.push(k);
    }
    toRemove.forEach((k) => { try { localStorage.removeItem(k); } catch (_e) {} });
  }
} catch (_e) {}
