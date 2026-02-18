/**
 * PWA cleanup — one-time removal of stale service workers and caches
 * from other apps that previously ran on the same origin
 * (e.g. IPTV project on localhost:5173).
 *
 * Strategy: unregister ALL existing service workers and clear ALL caches.
 * VitePWA will re-register the correct CRM service worker automatically.
 *
 * Runs once EVER per browser (guarded by localStorage flag).
 * Using localStorage (not sessionStorage) so the cleanup never repeats —
 * otherwise every new tab would destroy the PWA cache and force a full
 * re-download of all assets, making subsequent loads slower than the first.
 */

const CLEANUP_KEY = "fofi-crm-pwa-cleanup-v1";

export async function cleanupStalePWA() {
  if (!("serviceWorker" in navigator)) return;

  // Only run once ever — localStorage persists across sessions
  try { if (localStorage.getItem(CLEANUP_KEY)) return; } catch (_e) { return; }

  try {
    // 1. Unregister ALL service workers on this origin
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      await reg.unregister();
    }

    // 2. Delete ALL caches on this origin
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
      }
    }

    // Mark as done so this never runs again
    localStorage.setItem(CLEANUP_KEY, "1");
  } catch (err) {
    console.warn("[PWA Cleanup] Error during cleanup:", err.message);
  }
}
