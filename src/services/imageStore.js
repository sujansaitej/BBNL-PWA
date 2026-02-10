/**
 * imageStore.js — Robust localStorage caching for app logos and advertisement metadata.
 *
 * Logo caching:   Fetches images, converts to base64 data-URLs, and persists them
 *                 so subsequent page loads render instantly without network requests.
 *
 * Ad caching:     Stores ad metadata JSON per page so every page can show ads
 *                 instantly from cache while refreshing in the background.
 */

const LOGO_PREFIX = "cached_logo_";
const AD_PREFIX = "cached_ads_";
const LOGO_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
const AD_EXPIRY = 30 * 60 * 1000; // 30 minutes

// ─── Logo caching ────────────────────────────────────────────────────────────

/**
 * Returns a cached base64 data-URL for the given logo key, or null if expired / missing.
 */
export function getCachedLogo(key) {
  try {
    const raw = localStorage.getItem(LOGO_PREFIX + key);
    if (!raw) return null;
    const { dataUrl, ts } = JSON.parse(raw);
    if (Date.now() - ts > LOGO_EXPIRY) {
      localStorage.removeItem(LOGO_PREFIX + key);
      return null;
    }
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Fetches the image at `url`, converts it to a base64 data-URL, and stores
 * it in localStorage under the given `key`.  Returns the data-URL on success.
 * Silent no-op on failure — the component falls back to the raw URL.
 */
export async function cacheLogoFromUrl(key, url) {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;

    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        try {
          localStorage.setItem(
            LOGO_PREFIX + key,
            JSON.stringify({ dataUrl, ts: Date.now() })
          );
        } catch {
          // localStorage full — silently skip
        }
        resolve(dataUrl);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── Advertisement metadata caching ──────────────────────────────────────────

/**
 * Returns the cached ad list for `page` (e.g. "home", "livetv", "channels"),
 * or an empty array if missing / expired.
 */
export function getCachedAds(page) {
  try {
    const raw = localStorage.getItem(AD_PREFIX + page);
    if (!raw) return [];
    const { ads, ts } = JSON.parse(raw);
    if (Date.now() - ts > AD_EXPIRY) {
      localStorage.removeItem(AD_PREFIX + page);
      return [];
    }
    return ads;
  } catch {
    return [];
  }
}

/**
 * Persists the ad list for `page` with a timestamp.
 */
export function setCachedAds(page, ads) {
  try {
    localStorage.setItem(
      AD_PREFIX + page,
      JSON.stringify({ ads, ts: Date.now() })
    );
  } catch {
    // localStorage full — silently skip
  }
}

/**
 * Preloads ad images into browser memory via Image.decode().
 * Returns a promise that resolves when all images are decoded (or failed).
 */
export function preloadAdImages(ads, proxyFn) {
  if (!ads || ads.length === 0) return Promise.resolve();
  const promises = ads.map((ad) => {
    const src = proxyFn ? proxyFn(ad.adpath) : ad.adpath;
    if (!src) return Promise.resolve();
    const img = new Image();
    img.src = src;
    return img.decode().catch(() => {});
  });
  return Promise.all(promises);
}
