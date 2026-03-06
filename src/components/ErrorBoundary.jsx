import React from "react";

/**
 * Detect if an error is a failed dynamic import (chunk load failure).
 * These happen when a new deployment changes chunk hashes and the old
 * cached index.html references filenames that no longer exist.
 * Covers Chrome, Firefox, Safari, and Webpack/Vite error messages.
 */
function isChunkError(error) {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") || // Chrome
    msg.includes("error loading dynamically imported module") ||   // Firefox
    msg.includes("importing a module script failed") ||            // Safari
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("unexpected token '<'") // HTML 404 page parsed as JS
  );
}

/**
 * Nuke all CacheStorage caches and unregister all service workers.
 * Uses allSettled so one failure doesn't abort the rest.
 */
async function purgeAllCaches() {
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.allSettled(names.map((n) => caches.delete(n)));
    }
  } catch (_) {}
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
  } catch (_) {}
}

// Safe sessionStorage helpers — never throw (Safari private browsing, quota full)
function ssGet(key) {
  try { return sessionStorage.getItem(key); } catch (_) { return null; }
}
function ssSet(key, val) {
  try { sessionStorage.setItem(key, val); } catch (_) {}
}
function ssRemove(key) {
  try { sessionStorage.removeItem(key); } catch (_) {}
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, recovering: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    try { console.error("[ErrorBoundary]", error, errorInfo); } catch (_) {}

    // If this looks like a stale-cache / chunk error, auto-recover once
    if (isChunkError(error)) {
      const key = "eb-cache-recovery";
      if (!ssGet(key)) {
        ssSet(key, "1");
        this.setState({ recovering: true });
        purgeAllCaches().then(() => window.location.reload());
        return;
      }
      // Already tried once this session — fall through to show manual UI
    }
  }

  handleClearAndReload = () => {
    // Set guard so auto-recovery won't fire again after this manual reload
    ssSet("eb-cache-recovery", "1");
    this.setState({ recovering: true });
    purgeAllCaches().then(() => window.location.reload());
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = (import.meta.env.VITE_API_APP_DIR_PATH || "/") + "login";
  };

  render() {
    if (this.state.recovering) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-6 text-center">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
          <p className="text-sm text-gray-500">Updating app, please wait...</p>
        </div>
      );
    }

    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-6 text-center">
          <div className="w-16 h-16 mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-500 mb-6">
            The app encountered an unexpected error. Please try reloading.
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleClearAndReload}
              className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg shadow hover:bg-indigo-700 transition"
            >
              Reload App
            </button>
            <button
              onClick={this.handleGoHome}
              className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg shadow border hover:bg-gray-50 transition"
            >
              Go to Login
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
