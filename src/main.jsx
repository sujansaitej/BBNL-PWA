import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// In dev mode: unregister any stale service workers so they don't
// intercept /stream requests (which must reach the Vite proxy).
// In production: register the PWA service worker normally.
if (import.meta.env.DEV) {
  navigator.serviceWorker?.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
    if (regs.length) console.log("[PWA] Unregistered dev service workers");
  });
} else {
  import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        updateSW(true);
      },
      onOfflineReady() {
        console.log("[PWA] App ready for offline use");
      },
      onRegisteredSW(_swUrl, r) {
        if (r) setInterval(() => r.update(), 60 * 60 * 1000);
      },
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
