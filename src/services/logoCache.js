/**
 * Global in-memory logo cache.
 * Preloads and fully decodes images via new Image().decode() so they render
 * instantly without progressive loading. Shared across all pages — load once, use everywhere.
 */

const cache = new Map();       // url → url (ready flag)
const loading = new Set();     // urls currently being decoded
const listeners = new Map();   // url → Set<callback>

/** Get a cached URL (or null if not yet decoded/ready) */
export function getCachedLogo(url) {
  return cache.has(url) ? url : null;
}

/** Batch-preload an array of image URLs into the cache */
export function preloadLogos(urls) {
  urls.forEach((url) => {
    if (!url || cache.has(url) || loading.has(url)) return;
    loading.add(url);

    const img = new Image();
    img.src = url;
    img.decode()
      .then(() => {
        cache.set(url, true);
        loading.delete(url);

        // Notify any components waiting for this logo
        const cbs = listeners.get(url);
        if (cbs) {
          cbs.forEach((cb) => cb(url));
          listeners.delete(url);
        }
      })
      .catch(() => {
        loading.delete(url);
      });
  });
}

/** Subscribe to a logo URL — calls back with the URL when fully decoded */
export function subscribeLogo(url, callback) {
  if (!url) return () => {};

  // Already cached — fire immediately
  if (cache.has(url)) {
    callback(url);
    return () => {};
  }

  // Register listener
  if (!listeners.has(url)) listeners.set(url, new Set());
  listeners.get(url).add(callback);

  // Start loading if not already in progress
  if (!loading.has(url)) preloadLogos([url]);

  // Cleanup
  return () => {
    const cbs = listeners.get(url);
    if (cbs) {
      cbs.delete(callback);
      if (cbs.size === 0) listeners.delete(url);
    }
  };
}
