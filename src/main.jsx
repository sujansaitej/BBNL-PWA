
// import React from 'react'
// import ReactDOM from 'react-dom/client'
// import App from './App.jsx'
// import './index.css'
// import { ThemeProvider } from './ThemeContext.jsx'

// ReactDOM.createRoot(document.getElementById('root')).render(
//   <React.StrictMode>
//     <ThemeProvider>
//       <App />
//     </ThemeProvider>
//   </React.StrictMode>
// )

import "./api-connectivity-test";
import { cleanupStalePWA } from "./pwa-cleanup";
import { setupPwaNavGuard } from "./pwa-nav-guard";
// Start IndexedDB → L1 hydration early so IPTV data is ready before
// lazy chunks load.  channelStore self-hydrates on import (~5 ms).
import "./services/channelStore";
// Background-prefetch IPTV channels, languages, and logos on app startup.
// By the time the user taps "Live TV", data + logos are already cached.
import "./services/iptvPrefetch";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import { ThemeProvider } from "./ThemeContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./components/ui/Toast.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
const basename = import.meta.env.VITE_API_APP_DIR_PATH || '/'

// Remove stale PWAs from other apps (e.g. IPTV) that ran on same origin.
// Returns true if a cleanup reload was triggered (app will reload).
const cleanupTriggeredReload = cleanupStalePWA();

// In standalone PWA mode, intercept external links so they open in browser
setupPwaNavGuard();

// Request persistent storage so Android doesn't evict our caches
// (CacheStorage, localStorage, IndexedDB) when the phone is low on space.
// Without this, all cached logos, channels, and Workbox precache can be
// silently wiped by the OS. persist() is a no-op on iOS Safari.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

// ── Unified reload guard ───────────────────────────────────────────────
// Multiple mechanisms (cleanupStalePWA, cacheHealthCheck, controllerchange,
// lazyRetry) can all trigger a reload after a deployment.  This shared
// flag ensures only ONE reload fires per page lifecycle.  The guard also
// checks sessionStorage so a reload loop across page loads is impossible.
let reloadScheduled = cleanupTriggeredReload; // already reloading if cleanup ran
function scheduleReload() {
  if (reloadScheduled) return;
  reloadScheduled = true;
  window.location.reload();
}

// ── SW update auto-reload ──────────────────────────────────────────────
// When a new service worker activates (e.g. after a deployment), reload
// the page so the app runs with fresh assets instead of stale cached code.
// Skip if cleanupStalePWA already triggered a reload to avoid cascade.
if ("serviceWorker" in navigator && !cleanupTriggeredReload) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    scheduleReload();
  });
}

// ── Cache health check — auto-detect blank-screen-causing stale cache ──
// On every startup, verify the running app version matches the build stamp
// baked in at compile time.  If a mismatch is detected (user has an old
// tab/PWA in memory after a deployment), clear runtime caches and reload.
// Uses sessionStorage to prevent infinite reload loops.
// Skip entirely if cleanupStalePWA already triggered a reload.
if (!cleanupTriggeredReload) {
  (function cacheHealthCheck() {
    const BUILD_ID = import.meta.env.VITE_APP_BUILD_ID || "__dev__";
    const STORED_KEY = "app-build-id";
    const GUARD_KEY  = "cache-health-reload";

    try {
      const stored = localStorage.getItem(STORED_KEY);

      if (stored && stored !== BUILD_ID) {
        if (sessionStorage.getItem(GUARD_KEY)) {
          // Guard is set — we already reloaded once. Don't loop.
          // Accept current state and clear the guard.
          localStorage.setItem(STORED_KEY, BUILD_ID);
          sessionStorage.removeItem(GUARD_KEY);
          return;
        }
        // Version mismatch — stale cache detected
        sessionStorage.setItem(GUARD_KEY, "1");
        localStorage.setItem(STORED_KEY, BUILD_ID);

        // Purge runtime asset caches, then reload
        if ("caches" in window) {
          caches.keys().then((names) => {
            const stale = names.filter(
              (n) => n === "app-assets" || n.startsWith("workbox-precache")
            );
            return Promise.allSettled(stale.map((n) => caches.delete(n)));
          }).then(() => scheduleReload())
            .catch(() => scheduleReload());
        } else {
          scheduleReload();
        }
        return; // Stop — page is reloading
      }

      // Store current build ID & clear guard on successful load
      localStorage.setItem(STORED_KEY, BUILD_ID);
      sessionStorage.removeItem(GUARD_KEY);
    } catch (_) {}
  })();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter basename={basename}>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
