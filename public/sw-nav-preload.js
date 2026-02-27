/**
 * Navigation Preload — fires network request in parallel with SW boot.
 * On Android Chrome, SW startup can take 50-100ms. Without this, the
 * fetch event handler can't respond until SW finishes booting.
 * With Navigation Preload, Chrome sends the network request immediately
 * and makes the response available to the fetch handler via
 * event.preloadResponse, shaving off that startup delay.
 *
 * This file is imported by the Workbox-generated SW via importScripts.
 */
// Stale caches to delete on activation — bumped to v2 to purge corrupted
// opaque (status 0) responses that CacheFirst served forever.
var STALE_CACHES = ['channel-assets-v1'];

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      // Purge old cache buckets that may contain broken opaque responses
      for (var name of STALE_CACHES) {
        await caches.delete(name).catch(function () {});
      }
    })()
  );
});
