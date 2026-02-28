/**
 * Shared image URL handling — works in both dev and production.
 *
 * Dev:  Strips to relative paths (/showimage/..., /adimage/...) for Vite proxy.
 * Prod: Rewrites to full production URLs and adds auth headers to fetch calls.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const IPTV_API_BASE = import.meta.env.VITE_IPTV_API_BASE_URL || "";
const IPTV_USERNAME = import.meta.env.VITE_IPTV_API_USERNAME || "";
const IPTV_PASSWORD = import.meta.env.VITE_IPTV_API_PASSWORD || "";
const IPTV_AUTH_KEY = import.meta.env.VITE_IPTV_API_AUTH_KEY || "";
const BASIC_AUTH = "Basic " + btoa(`${IPTV_USERNAME}:${IPTV_PASSWORD}`);
const IS_PROD = import.meta.env.PROD;

// Matches IPTV-specific paths: http://124.40.244.211/netmon/Cabletvapis/...
const IPTV_HOST_RE = /^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i;

// Matches ANY path on the dev IP: http://124.40.244.211/netmon/...
const DEV_HOST_RE = /^https?:\/\/124\.40\.244\.211\/netmon\//i;

/**
 * Rewrite IPTV image URLs for the current environment.
 * Dev:  http://124.40.244.211/netmon/Cabletvapis/showimage/x.png → /showimage/x.png
 * Prod: http://124.40.244.211/netmon/Cabletvapis/showimage/x.png → {IPTV_API_BASE}/showimage/x.png
 */
export function proxyImageUrl(url) {
  if (!url) return null;
  if (IS_PROD) {
    return url.replace(IPTV_HOST_RE, IPTV_API_BASE);
  }
  return url.replace(IPTV_HOST_RE, "");
}

/**
 * Rewrite ANY dev-IP image URL to the production API base.
 * Use this for CRM ad images and other non-IPTV images from the backend.
 * Dev:  http://124.40.244.211/netmon/ads/img.jpg → /api/ads/img.jpg (via Vite proxy)
 * Prod: http://124.40.244.211/netmon/ads/img.jpg → {API_BASE}ads/img.jpg
 */
export function fixImageUrl(url) {
  if (!url) return null;
  if (IS_PROD) {
    return url.replace(DEV_HOST_RE, API_BASE);
  }
  return url.replace(DEV_HOST_RE, "/api/");
}

/**
 * Fetch an image URL with timeout and auth.
 * IPTV production URLs always need auth headers — send them on the first
 * request to avoid a wasted 401 round-trip (cuts load time in half).
 */
/** Adapt image timeout to connection speed — 5s on 4G, 15s on 2G.
 *  Channel logos are 5-20 KB — even on 3G they should arrive in <5s.
 *  Tighter timeouts let the retry cycle kick in faster on flaky connections. */
function getImageTimeout() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 8000;
    if (conn.effectiveType === '3g') return 5000;
  }
  return 3000; // Logos are 5-20KB — fail fast, let retry cycle recover
}

export async function fetchImage(url, options = {}) {
  const timeout = getImageTimeout();

  const fetchWithTimeout = (u, opts) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(u, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

  // IPTV images in production always require auth — include headers on first try
  const needsAuth = IS_PROD && IPTV_API_BASE && url.startsWith(IPTV_API_BASE);
  return fetchWithTimeout(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(needsAuth && {
        Authorization: BASIC_AUTH,
        "x-api-key": IPTV_AUTH_KEY,
      }),
    },
  });
}
