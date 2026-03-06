/**
 * PWA cleanup — one-time removal of stale service workers and caches
 * from other apps that previously ran on the same origin
 * (e.g. IPTV project on localhost:5173).
 *
 * Strategy: unregister ALL existing service workers and clear ALL caches,
 * then reload so VitePWA re-registers a fresh SW with its own precache.
 *
 * Runs once EVER per browser (guarded by localStorage flag).
 * Uses Promise.allSettled so one failure doesn't abort the rest.
 *
 * @returns {boolean} true if a reload was triggered (caller should skip
 *   other reload mechanisms to prevent cascade).
 */

const CLEANUP_KEY = "fofi-crm-pwa-cleanup-v2";

export function cleanupStalePWA() {
  if (!("serviceWorker" in navigator)) return false;

  // Only run once ever — localStorage persists across sessions
  try { if (localStorage.getItem(CLEANUP_KEY)) return false; } catch (_e) { return false; }

  // Mark as done FIRST — prevents double-execution even if the cleanup
  // is interrupted (e.g. user closes tab mid-cleanup).
  try { localStorage.setItem(CLEANUP_KEY, "1"); } catch (_e) { return false; }

  // Run cleanup async — unregister SWs, delete caches, then reload.
  // The reload ensures VitePWA's registerSW.js can register a fresh SW
  // without racing against this cleanup deleting the just-populated precache.
  (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registrations.map((r) => r.unregister()));
    } catch (_) {}

    try {
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.allSettled(cacheNames.map((n) => caches.delete(n)));
      }
    } catch (_) {}

    // Always reload — even if some cleanup steps failed, a fresh page load
    // lets VitePWA register the correct SW from scratch.
    window.location.reload();
  })();

  // Signal to caller that a reload is in progress — other reload mechanisms
  // (cacheHealthCheck, controllerchange) should NOT also fire.
  return true;
}
