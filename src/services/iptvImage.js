/**
 * Shared image URL handling — works in both dev and production.
 *
 * Dev:  Strips to relative paths (/showimage/..., /adimage/...) for Vite proxy.
 * Prod: Channel/language logos → nginx CDN (cdn1.bbnl.in/cable), other IPTV → API base.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const IPTV_API_BASE = import.meta.env.VITE_IPTV_API_BASE_URL || "";
const IPTV_IMAGE_CDN = import.meta.env.VITE_IPTV_IMAGE_CDN || "";
const IPTV_USERNAME = import.meta.env.VITE_IPTV_API_USERNAME || "";
const IPTV_PASSWORD = import.meta.env.VITE_IPTV_API_PASSWORD || "";
const IPTV_AUTH_KEY = import.meta.env.VITE_IPTV_API_AUTH_KEY || "";
const BASIC_AUTH = "Basic " + btoa(`${IPTV_USERNAME}:${IPTV_PASSWORD}`);
const IS_PROD = import.meta.env.PROD;

// Matches IPTV-specific paths: http://124.40.244.211/netmon/Cabletvapis/...
const IPTV_HOST_RE = /^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i;

// Matches ANY path on the dev IP: http://124.40.244.211/netmon/...
const DEV_HOST_RE = /^https?:\/\/124\.40\.244\.211\/netmon\//i;

// Robust showimage token — matches /showimage/ from ANY origin (dev IP, prod domain, future changes)
const SHOWIMAGE_TOKEN = "/showimage/";

/**
 * Rewrite IPTV image URLs for the current environment.
 *
 * In production, ANY URL containing /showimage/ is rewritten to the CDN.
 * This covers channel logos, language logos, and any future logo types —
 * regardless of whether the API returns the dev IP (124.40.244.211),
 * the prod domain (bbnlnetmon.bbnl.in), or a new backend host.
 *
 * Dev:  http://124.40.244.211/netmon/Cabletvapis/showimage/x.png → /showimage/x.png
 * Prod: http://.../Cabletvapis/showimage/x.png                  → https://cdn1.bbnl.in/cable/x.png
 * Prod: https://bbnlnetmon.bbnl.in/.../showimage/x.png          → https://cdn1.bbnl.in/cable/x.png
 * Prod (other): .../Cabletvapis/adimage/x.png                   → {IPTV_API_BASE}/adimage/x.png
 */
export function proxyImageUrl(url) {
  if (!url) return null;
  if (IS_PROD) {
    // Channel & language logos → nginx CDN (no auth needed)
    // Extracts the filename after /showimage/ and prepends CDN base.
    const idx = url.toLowerCase().indexOf(SHOWIMAGE_TOKEN);
    if (IPTV_IMAGE_CDN && idx !== -1) {
      const filename = url.substring(idx + SHOWIMAGE_TOKEN.length);
      return IPTV_IMAGE_CDN + "/" + filename;
    }
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
 * Fetch an image URL with timeout.
 * CDN images (cdn1.bbnl.in) need no auth — served by nginx.
 * Legacy IPTV API images still get auth headers as fallback.
 */
/** Adapt image timeout to connection speed. */
function getImageTimeout() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 20000;
    if (conn.effectiveType === '3g') return 15000;
  }
  return 10000; // 10s provides headroom for server slowness at low concurrency
}

export async function fetchImage(url, options = {}) {
  const timeout = getImageTimeout();

  const fetchWithTimeout = (u, opts) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(u, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

  // CDN images (cdn1.bbnl.in/cable) served by nginx — no auth needed.
  // After proxyImageUrl(), all logo URLs start with the CDN base.
  const isCdn = IPTV_IMAGE_CDN && url.startsWith(IPTV_IMAGE_CDN);
  const needsAuth = !isCdn && IS_PROD && IPTV_API_BASE && url.startsWith(IPTV_API_BASE);
  return fetchWithTimeout(url, {
    ...options,
    headers: {
      ...options.headers,
      "X-App-Package": "com.bbnl.smartphone",
      ...(needsAuth && {
        Authorization: BASIC_AUTH,
        "x-api-key": IPTV_AUTH_KEY,
      }),
    },
  });
}
