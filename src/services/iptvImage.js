/**
 * Shared image URL handling — works in both dev and production.
 *
 * Dev:  Strips to relative paths (/showimage/..., /adimage/...) for Vite proxy.
 * Prod: Channel/language logos → production server (bbnlnetmon.bbnl.in).
 *
 * Backend now returns just the logo filename (no /showimage/ prefix).
 * We prepend the IPTV_IMAGE_CDN base to build the full URL.
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

// Legacy showimage token — still handled for backward compatibility
const SHOWIMAGE_TOKEN = "/showimage/";

/**
 * Rewrite IPTV image URLs for the current environment.
 *
 * Extracts the logo filename from any URL format and prepends the production base.
 * Handles: full URLs with /cable/ or /showimage/, plain filenames, dev IP URLs.
 */
export function proxyImageUrl(url) {
  if (!url) return null;

  if (IS_PROD) {
    // Case 1: URL with /cable/ path — extract filename after last /cable/
    if (IPTV_IMAGE_CDN && url.includes('/cable/')) {
      const filename = url.split('/cable/').pop();
      if (filename) return IPTV_IMAGE_CDN + "/" + filename.replace(/^chnl-image\//, '');
    }

    // Case 2: URL with /showimage/ — extract filename after /showimage/
    const idx = url.toLowerCase().indexOf(SHOWIMAGE_TOKEN);
    if (IPTV_IMAGE_CDN && idx !== -1) {
      const filename = url.substring(idx + SHOWIMAGE_TOKEN.length);
      return IPTV_IMAGE_CDN + "/" + filename.replace(/^chnl-image\//, '');
    }

    // Case 3: Just a filename / relative path (no protocol).
    //
    // ServiceApis/channelsList and pkgChannelsList return chlogo as
    // `chnl-image/<filename>` — that's the path on the netmon server
    // (verified: GET /netmon/chnl-image/<filename> returns 200). The
    // CDN at cdn1.bbnl.in/cable, however, flattens those files to
    // the bucket root — `/cable/chnl-image/<filename>` returns 404
    // while `/cable/<filename>` returns 200. So when we have a CDN
    // configured, strip the `chnl-image/` directory before joining;
    // when we don't (e.g. test env), join against the API base
    // which does serve `/netmon/chnl-image/<filename>`.
    if (!url.startsWith("http") && !url.startsWith("/")) {
      if (IPTV_IMAGE_CDN) {
        const filename = url.replace(/^chnl-image\//, '');
        return IPTV_IMAGE_CDN + "/" + filename;
      }
      if (API_BASE) {
        return API_BASE + url;
      }
    }

    // Case 4: Dev IP URL — rewrite to prod IPTV API base
    return url.replace(IPTV_HOST_RE, IPTV_API_BASE);
  }

  // Dev: route relative `chnl-image/...` paths through the /api Vite
  // proxy (which targets /netmon/, where chnl-image lives). Without
  // this the browser tries to resolve them against the page URL and
  // 404s.
  if (!url.startsWith("http") && !url.startsWith("/")) {
    return "/api/" + url;
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

/** Adapt image timeout to connection speed. */
function getImageTimeout() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 20000;
    if (conn.effectiveType === '3g') return 15000;
  }
  return 10000;
}

/**
 * Fetch an image URL with timeout and appropriate auth headers.
 * Production server images need auth. External CDNs do not.
 */
export async function fetchImage(url, options = {}) {
  const timeout = getImageTimeout();

  const fetchWithTimeout = (u, opts) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(u, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

  // External CDN (different domain) → no auth needed
  // Production server (bbnlnetmon.bbnl.in) → auth needed
  const isExternalCdn = IPTV_IMAGE_CDN && url.startsWith(IPTV_IMAGE_CDN) && !IPTV_IMAGE_CDN.includes('bbnlnetmon.bbnl.in');
  const needsAuth = !isExternalCdn && IS_PROD;
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
