/**
 * imageStore.js — localStorage caching for advertisement metadata and images.
 *
 * Ad metadata (JSON): cached 30 min so fresh ads rotate in.
 * Ad images (base64): cached 7 days so they render instantly.
 */

import { fetchImage } from "./iptvImage";

const AD_META_PREFIX = "ad_meta_";
const AD_IMG_PREFIX = "ad_img_";
const META_TTL = 30 * 60 * 1000;      // 30 minutes
const IMG_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory cache for ad images (L1)
const adImageMem = new Map();

// ── Startup: hydrate ad images from localStorage ──
try {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(AD_IMG_PREFIX)) continue;
    try {
      const { d, t } = JSON.parse(localStorage.getItem(key));
      if (Date.now() - t > IMG_TTL) {
        localStorage.removeItem(key);
      } else {
        adImageMem.set(key.slice(AD_IMG_PREFIX.length), d);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
} catch {}

// ── localStorage helpers ──
function safeLsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded — evict some ad images and retry
    evictOldAdImages(5);
    try { localStorage.setItem(key, value); } catch {}
  }
}

function evictOldAdImages(count) {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(AD_IMG_PREFIX)) continue;
      try {
        const { t } = JSON.parse(localStorage.getItem(key));
        entries.push({ key, t });
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch { return; }
  entries.sort((a, b) => a.t - b.t);
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    try { localStorage.removeItem(entries[i].key); } catch {}
  }
}

// ── Ad metadata ──

export function getCachedAds(page) {
  try {
    const raw = localStorage.getItem(AD_META_PREFIX + page);
    if (!raw) return [];
    const { ads, ts } = JSON.parse(raw);
    if (Date.now() - ts > META_TTL) {
      localStorage.removeItem(AD_META_PREFIX + page);
      return [];
    }
    return ads;
  } catch {
    return [];
  }
}

export function setCachedAds(page, ads) {
  try {
    localStorage.setItem(AD_META_PREFIX + page, JSON.stringify({ ads, ts: Date.now() }));
  } catch {}
}

// ── Ad images ──

/** Get a cached ad image data URL (or null) */
export function getCachedAdImage(adpath) {
  if (!adpath) return null;
  // L1
  if (adImageMem.has(adpath)) return adImageMem.get(adpath);
  // L2
  try {
    const raw = localStorage.getItem(AD_IMG_PREFIX + adpath);
    if (!raw) return null;
    const { d, t } = JSON.parse(raw);
    if (Date.now() - t > IMG_TTL) {
      localStorage.removeItem(AD_IMG_PREFIX + adpath);
      return null;
    }
    adImageMem.set(adpath, d);
    return d;
  } catch {
    return null;
  }
}

/** Fetch an ad image, convert to base64, store in both tiers */
async function fetchAndCacheAdImage(url, adpath) {
  if (!url || adImageMem.has(adpath)) return;
  try {
    const res = await fetchImage(url, { cache: "force-cache" });
    if (!res.ok) return;
    const blob = await res.blob();
    // Skip images > 500KB to protect localStorage
    if (blob.size > 500 * 1024) {
      const objUrl = URL.createObjectURL(blob);
      adImageMem.set(adpath, objUrl);
      return;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        adImageMem.set(adpath, dataUrl);
        safeLsSet(AD_IMG_PREFIX + adpath, JSON.stringify({ d: dataUrl, t: Date.now() }));
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(blob);
    });
  } catch {}
}

/**
 * Preload ad images — fetches and caches all ad images to localStorage.
 * @param {Array} ads - Array of ad objects with `adpath`
 * @param {Function} proxyFn - URL rewriter (proxyImageUrl)
 */
export function preloadAdImages(ads, proxyFn) {
  if (!ads || ads.length === 0) return;
  ads.forEach((ad) => {
    const proxied = proxyFn ? proxyFn(ad.adpath) : ad.adpath;
    if (!proxied) return;
    // Skip if already cached
    if (adImageMem.has(ad.adpath)) return;
    const stored = getCachedAdImage(ad.adpath);
    if (stored) return;
    fetchAndCacheAdImage(proxied, ad.adpath);
  });
}
