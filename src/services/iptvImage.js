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
 * Fetch an image URL. In production, adds IPTV auth headers for IPTV API URLs.
 */
export function fetchImage(url, options = {}) {
  if (IS_PROD && IPTV_API_BASE && url.startsWith(IPTV_API_BASE)) {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: BASIC_AUTH,
        "x-api-key": IPTV_AUTH_KEY,
      },
    });
  }
  return fetch(url, options);
}
