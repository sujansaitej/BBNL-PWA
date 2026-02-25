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
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
    })()
  );
});
