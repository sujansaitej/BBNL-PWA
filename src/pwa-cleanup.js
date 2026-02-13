/**
 * PWA cleanup — aggressively removes ALL stale service workers and caches
 * from other apps that previously ran on the same origin
 * (e.g. IPTV project on localhost:5173).
 *
 * Strategy: unregister ALL existing service workers and clear ALL caches.
 * VitePWA will re-register the correct CRM service worker automatically.
 *
 * Runs once per session (guarded by sessionStorage flag).
 */

const CLEANUP_KEY = "fofi-crm-pwa-cleanup-done";

export async function cleanupStalePWA() {
  if (!("serviceWorker" in navigator)) return;

  // Only run once per browser session
  if (sessionStorage.getItem(CLEANUP_KEY)) return;
  sessionStorage.setItem(CLEANUP_KEY, "1");

  try {
    // 1. Unregister ALL service workers on this origin
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      console.log(`[PWA Cleanup] Unregistering SW at scope: ${reg.scope}`);
      await reg.unregister();
    }

    // 2. Delete ALL caches on this origin
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        console.log(`[PWA Cleanup] Deleting cache: ${name}`);
        await caches.delete(name);
      }
    }

    if (registrations.length > 0) {
      console.log(
        "[PWA Cleanup] Cleaned up %d service worker(s). VitePWA will re-register the correct one.",
        registrations.length
      );
    }
  } catch (err) {
    console.warn("[PWA Cleanup] Error during cleanup:", err.message);
  }
}
