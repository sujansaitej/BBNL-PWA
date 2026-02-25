/**
 * sw-api-cache.js — Stale-While-Revalidate for IPTV API POST requests.
 *
 * Imported by the Workbox-generated SW via importScripts.
 * Runs BEFORE Workbox's router.  Only intercepts POST requests to specific
 * IPTV endpoints; everything else falls through to Workbox.
 *
 * Why custom?  Workbox only caches GET by default.  IPTV uses POST for
 * channel lists, language lists, and ads.  Without this, every page
 * navigation waits for a slow API round-trip (2-8 s on Indian mobile).
 *
 * Strategy: Stale-While-Revalidate
 *   - Cache hit + fresh (< FRESH_TTL)  → return cached, skip network
 *   - Cache hit + stale (< MAX_TTL)    → return cached, revalidate in background
 *   - Cache miss or expired            → fetch from network, cache, return
 *   - Network failure + stale cache    → return stale (offline support)
 */

const CACHE_NAME = 'iptv-api-v1';
const MAX_TTL    = 7 * 24 * 60 * 60 * 1000; // 7 days — max stale lifetime

// Connection-aware FRESH_TTL — on slow networks keep cache fresh longer
// so the app doesn't attempt costly refetches over a saturated pipe.
//   2G / slow-2G → 60 min
//   3G           → 30 min
//   4G+          → 15 min (default)
function getFreshTTL() {
  var conn = self.navigator && self.navigator.connection;
  if (conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 60 * 60 * 1000;
    if (conn.effectiveType === '3g') return 30 * 60 * 1000;
  }
  return 15 * 60 * 1000;
}

// Endpoints worth caching (channel lists, languages, ads)
const ENDPOINTS = ['/ftauserchnllist', '/ftauserlanglist', '/ftauserads'];

// FNV-1a 32-bit hash — fast, non-crypto, for cache key derivation
function fnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'POST') return;
  if (!ENDPOINTS.some(function (ep) { return request.url.indexOf(ep) !== -1; })) return;

  event.respondWith(handlePost(event));
});

async function handlePost(event) {
  var request = event.request;
  var body = await request.clone().text();
  var key  = request.url + '?_h=' + fnv1a(body);

  var cache  = await caches.open(CACHE_NAME);
  var cached = await cache.match(key);

  if (cached) {
    var ts  = parseInt(cached.headers.get('x-sw-ts') || '0', 10);
    var age = Date.now() - ts;

    if (age < getFreshTTL()) {
      // Fresh — no network needed
      return cached;
    }

    if (age < MAX_TTL) {
      // Stale — return cached immediately, refresh in background
      event.waitUntil(
        networkAndCache(request.clone(), key, cache).catch(function () {})
      );
      return cached;
    }

    // Expired beyond MAX_TTL — delete and fall through to network
    await cache.delete(key);
  }

  // No usable cache — fetch from network, fall back to stale copy
  try {
    return await networkAndCache(request.clone(), key, cache);
  } catch (err) {
    if (cached) return cached;   // Offline fallback
    throw err;
  }
}

async function networkAndCache(request, key, cache) {
  var res = await fetch(request);

  if (res.ok) {
    var text = await res.clone().text();

    // Only cache successful API responses (err_code === 0)
    try {
      var json = JSON.parse(text);
      if (json && json.status && json.status.err_code === 0) {
        await cache.put(key, new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-sw-ts': String(Date.now()),
          },
        }));
      }
    } catch (_) { /* not valid JSON — skip cache */ }
  }

  return res;
}

// Cleanup expired entries on SW activation
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.keys().then(function (keys) {
        var now = Date.now();
        return Promise.all(
          keys.map(function (req) {
            return cache.match(req).then(function (res) {
              if (!res) return;
              var ts = parseInt(res.headers.get('x-sw-ts') || '0', 10);
              if (now - ts > MAX_TTL) return cache.delete(req);
            });
          })
        );
      });
    })
  );
});
