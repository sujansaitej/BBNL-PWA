/**
 * Workbox-backed image cache with in-memory layer for React.
 *
 * - Workbox (service worker): caches fetch() responses via CacheFirst strategy
 *   in the "channel-assets-v1" Cache API store (300 entries, 30 days).
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

// Adapt concurrency to network speed.  On 2G/slow-2G only 2 parallel
// fetches keeps the pipe from saturating (images are ~5-20 KB each).
// On 4G+ Chrome allows 6 TCP connections per host; 8 keeps 2 batches warm.
function getMaxConcurrent() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 2;
    if (conn.effectiveType === '3g') return 4;
  }
  return 8;
}

// L1 — in-memory: url → objectURL
const mem = new Map();
const loading = new Set();
const listeners = new Map();
const failed = new Map(); // url → retry count

// ── Core fetch ──

async function fetchAndCache(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // This fetch() is intercepted by the service worker.
      // Workbox serves from Cache API if available (instant),
      // otherwise forwards to network and caches the response.
      const res = await fetchImage(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;

      const objUrl = URL.createObjectURL(blob);
      mem.set(url, objUrl);
      return objUrl;
    } catch (_e) {
      // retry on next iteration
    }
  }
  return null;
}

// ── Notify subscribers (batched via microtask to coalesce React re-renders) ──
const pendingNotifications = [];
let notifyScheduled = false;

function flushNotifications() {
  notifyScheduled = false;
  const batch = pendingNotifications.splice(0);
  for (const { url, dataUrl } of batch) {
    const cbs = listeners.get(url);
    if (cbs) cbs.forEach((cb) => cb(dataUrl));
  }
}

function notifySubs(url, dataUrl) {
  pendingNotifications.push({ url, dataUrl });
  if (!notifyScheduled) {
    notifyScheduled = true;
    queueMicrotask(flushNotifications);
  }
}

// ── Queue for parallel fetch with concurrency limit ──
const queue = [];
let active = 0;

function enqueue(url, priority = false) {
  return new Promise((resolve) => {
    if (priority) queue.unshift({ url, resolve });
    else queue.push({ url, resolve });
    drain();
  });
}

function drain() {
  const maxC = getMaxConcurrent();
  while (active < maxC && queue.length > 0) {
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

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY = 1500;

function getRetryDelay() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')) return 4000;
  return BASE_RETRY_DELAY;
}

/** Batch-preload an array of image URLs with concurrency control.
 *  Pass priority=true for small critical sets (e.g. language logos) to load them first. */
export function preloadLogos(urls, priority = false) {
  if (!urls || urls.length === 0) return;
  urls.forEach((url) => {
    if (!url || mem.has(url) || loading.has(url)) return;

    loading.add(url);
    enqueue(url, priority).then((objUrl) => {
      loading.delete(url);
      if (objUrl) {
        failed.delete(url);
      } else {
        // Auto-retry failed fetches after a delay
        const retryCount = (failed.get(url) || 0) + 1;
        failed.set(url, retryCount);
        if (retryCount <= MAX_RETRIES) {
          setTimeout(() => {
            if (!mem.has(url) && !loading.has(url)) {
              loading.add(url);
              enqueue(url, true).then((retryResult) => {
                loading.delete(url);
                if (retryResult) failed.delete(url);
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
