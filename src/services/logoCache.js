/**
 * Workbox-backed image cache with in-memory layer for React.
 *
 * - Workbox (service worker): caches fetch() responses via CacheFirst strategy
 *   in the "channel-assets-v3" Cache API store (500 entries, 60 days).
 *   Return visits get instant cache hits with zero network wait.
 *
 * - L1 (in-memory Map): holds object URLs for the current session so
 *   <img src={objectUrl}> works without re-creating blobs on every render.
 *
 * Flow (nginx HTTP/2 CDN — cdn1.bbnl.in/cable):
 *   fetch(url)                           ← app calls fetchImage()
 *     → Service Worker intercepts        ← Workbox CacheFirst
 *       → cache hit  → instant Response  ← no network needed (old + new users)
 *       → cache miss → network + cache   ← nginx CDN, no auth, HTTP/2 multiplexed
 *     → JS creates objectURL from blob   ← for <img> rendering
 *     → objectURL stored in L1 Map       ← synchronous access for React
 */

import { fetchImage } from "./iptvImage";

// Adapt concurrency to network speed.
// nginx CDN with HTTP/2 multiplexes all requests over a single TCP connection,
// so higher concurrency has minimal overhead (no extra DNS/TCP/TLS per request).
function getMaxConcurrent() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 6;
    if (conn.effectiveType === '3g') return 30;
  }
  // Benchmarked: nginx CDN handles 100/160/180 concurrent with 0 failures.
  // HTTP/2 multiplexes over a single TCP connection — high concurrency is safe.
  // 100 parallel streams loads 275 channels in ~3 batches instead of ~7.
  return 100;
}

// L1 — in-memory: url → objectURL
const mem = new Map();
const loading = new Set();
const listeners = new Map();
const failed = new Map(); // url → { count, ts }

// ── Core fetch ──

// Sentinel: returned when the image permanently doesn't exist (404).
// Distinguishes "try again later" (null) from "never retry" (NOT_FOUND).
const NOT_FOUND = Symbol('NOT_FOUND');
// Sentinel: queue item was cancelled by clearQueue() — don't count as failure.
const CANCELLED = Symbol('CANCELLED');

// CDN URLs lack CORS headers — fetch() always throws TypeError.
// Don't even attempt fetch(); <img src={cdnUrl}> handles display natively,
// and the SW caches opaque responses from <img> requests (statuses: [0, 200]).
const CDN_RE = /cdn1\.bbnl\.in\/cable\//i;

async function fetchAndCache(url) {
  // Skip CDN entirely — no CORS headers, fetch() always fails.
  // Saves 275+ wasted fetch calls per page load.
  if (CDN_RE.test(url)) return NOT_FOUND;

  try {
    const res = await fetchImage(url);
    if (!res.ok) {
      if (res.status === 404 || res.status === 401 || res.status === 403) return NOT_FOUND;
      if (res.status === 0 || res.type === 'opaque') return NOT_FOUND;
      return null; // transient — allow retry
    }
    const blob = await res.blob();
    if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) return null;

    const objUrl = URL.createObjectURL(blob);
    mem.set(url, objUrl);
    return objUrl;
  } catch (_e) {
    // TypeError = CORS (permanent), other = network (transient, allow retry)
    if (_e instanceof TypeError) return NOT_FOUND;
    return null;
  }
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
// Priority items (language logos, ~8-12) bypass the concurrency cap so they
// always start immediately — even when all slots are busy with channel logos.
// HTTP/2 multiplexing on cdn1.bbnl.in handles the burst with no penalty.
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

// Retry timeout IDs — cleared on navigation to prevent orphaned retries
const retryTimers = new Set();

/** Cancel all pending (non-started) queue items and scheduled retries.
 *  Call on page unmount to free resources for the new page's logos.
 *  In-flight requests (active) are not affected — they complete normally. */
export function clearQueue() {
  while (queue.length > 0) {
    const item = queue.shift();
    loading.delete(item.url);
    item.resolve(CANCELLED);
  }
  // Cancel all pending retry timers so they don't enqueue stale URLs
  for (const id of retryTimers) clearTimeout(id);
  retryTimers.clear();
}

/** Get a cached object URL synchronously (or null if not yet fetched this session) */
export function getCachedLogo(url) {
  if (!url) return null;
  return mem.get(url) || null;
}

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY = 2000; // Exponential backoff: 2s, 4s
const FAILED_COOLDOWN = 60 * 1000; // 60 seconds

function getRetryDelay(retryCount) {
  // Exponential backoff: 2s × 2^(retry-1) → 2s, 4s
  return BASE_RETRY_DELAY * Math.pow(2, retryCount - 1);
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

    // Skip URLs still in failed cooldown — avoids wasted 404 requests when
    // user navigates between pages (LiveTV → Languages → LiveTV).
    if (failed.has(url)) return;

    loading.add(url);
    enqueue(url, priority).then((result) => {
      loading.delete(url);
      // CANCELLED = clearQueue() ran (page navigation) — don't count as failure
      if (result === CANCELLED) return;
      // NOT_FOUND = permanent failure (404, CORS, auth) — never retry
      const objUrl = (result === NOT_FOUND) ? null : result;
      if (objUrl) {
        failed.delete(url);
      } else if (result === NOT_FOUND) {
        failed.set(url, { count: MAX_RETRIES + 1, ts: Date.now() });
      } else {
        // Transient failure (network error, timeout) — retry with backoff
        const prev = failed.get(url);
        const retryCount = (prev?.count || 0) + 1;
        failed.set(url, { count: retryCount, ts: Date.now() });
        if (retryCount <= MAX_RETRIES) {
          const timerId = setTimeout(() => {
            retryTimers.delete(timerId);
            if (!mem.has(url) && !loading.has(url)) {
              loading.add(url);
              enqueue(url, true).then((retryResult) => {
                loading.delete(url);
                if (retryResult === CANCELLED) return;
                const retryUrl = (retryResult === NOT_FOUND) ? null : retryResult;
                if (retryUrl) {
                  failed.delete(url);
                } else {
                  const p = failed.get(url);
                  failed.set(url, { count: (p?.count || retryCount) + 1, ts: Date.now() });
                }
                notifySubs(url, retryUrl);
              });
            }
          }, getRetryDelay(retryCount));
          retryTimers.add(timerId);
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
  // Re-trigger if the URL previously failed and cooldown has passed.
  if (!loading.has(url)) {
    resetIfCooledDown(url);
    if (!failed.has(url)) {
      preloadLogos([url]);
    }
  }

  return () => {
    const cbs = listeners.get(url);
    if (cbs) {
      cbs.delete(callback);
      if (cbs.size === 0) listeners.delete(url);
    }
  };
}

// ── One-time cleanup of old caches ──
// 1. Old localStorage logo cache (lc_ prefix) — replaced by Workbox Cache API
// 2. Old Workbox caches (v1, v2) — URLs changed from bbnlnetmon to cdn1.bbnl.in
//    Stale entries would never match new CDN URLs, so delete them to free space.
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

// Purge old Workbox image caches that held bbnlnetmon URLs (now served from cdn1.bbnl.in).
// Runs once — old users free ~5-15MB of dead cache entries on first visit after update.
try {
  if ('caches' in self && !localStorage.getItem('_cache_v3')) {
    localStorage.setItem('_cache_v3', '1');
    ['channel-assets-v1', 'channel-assets-v2'].forEach((name) => {
      caches.delete(name).catch(() => {});
    });
  }
} catch (_e) {}
