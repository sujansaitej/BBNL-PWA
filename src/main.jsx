
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
const basename = import.meta.env.VITE_API_APP_DIR_PATH || '/'

// Remove stale PWAs from other apps (e.g. IPTV) that ran on same origin
cleanupStalePWA();
// In standalone PWA mode, intercept external links so they open in browser
setupPwaNavGuard();

// Request persistent storage so Android doesn't evict our caches
// (CacheStorage, localStorage, IndexedDB) when the phone is low on space.
// Without this, all cached logos, channels, and Workbox precache can be
// silently wiped by the OS. persist() is a no-op on iOS Safari.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}
// if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
//   document.documentElement.classList.add('dark')
// }

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter basename={basename}>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
