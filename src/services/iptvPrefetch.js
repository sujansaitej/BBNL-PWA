/**
 * iptvPrefetch — Background prefetcher for IPTV data.
 *
 * Imported early in main.jsx.  On app startup it silently fetches channels
 * and languages so that when the user taps "Live TV" data renders instantly.
 * Only language logos (~10-12) are preloaded; channel logos load on-demand
 * via IntersectionObserver to avoid overwhelming the HTTP/1.1 server.
 *
 * Timing:
 *   1. Wait for channelStore L1 hydration from IndexedDB (~5 ms)
 *   2. Check if channel/language data is already fresh
 *   3. If not, fetch both in parallel + preload language logos
 *
 * The request deduplication in iptvFetch guarantees that if LiveTvPage
 * mounts while a prefetch is in flight, no duplicate network request is made.
 */

import { waitForHydration, getEntry, setEntry, getAdaptiveTTL } from "./channelStore";
import { getChannelList, getLanguageList, getIptvMobile, prefetchPublicIP } from "./iptvApi";
import { preloadLogos } from "./logoCache";
import { proxyImageUrl } from "./iptvImage";

function isFresh(entry) {
  return entry && (Date.now() - entry.ts < getAdaptiveTTL());
}

/** Detect slow connection — used to skip logo prefetch on 2G */
function _getEffective() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return c?.effectiveType || '4g';
}

/** Run IPTV prefetch — called on startup and again after login. */
export async function runIptvPrefetch() {
  try {
    await waitForHydration();

    const mobile = getIptvMobile();
    if (!mobile) return; // No user — nothing to prefetch

    // Start public IP resolution early (needed for stream playback later)
    prefetchPublicIP();

    const chKey = `channels_${mobile}_subs`;
    const langKey = `languages_${mobile}`;

    const chEntry = getEntry(chKey);
    const langEntry = getEntry(langKey);

    const chFresh = isFresh(chEntry);
    const langFresh = isFresh(langEntry);

    const eff = _getEffective();
    const isSlow = eff === 'slow-2g' || eff === '2g';

    // Already fresh — preload language logos from cached data
    if (chFresh && langFresh) {
      _preloadFromCached(langEntry);
      return;
    }

    // Fetch stale/missing data — language logos start preloading as soon as
    // the language API responds, WITHOUT waiting for the channel API.

    // ── Language logos: start immediately when data arrives ──
    const langPromise = !langFresh
      ? getLanguageList({ mobile })
          .then((data) => {
            const langs = data?.body?.[0]?.languages || [];
            if (langs.length > 0) setEntry(langKey, langs);
            return langs;
          })
          .catch(() => langEntry?.data || [])
      : Promise.resolve(langEntry?.data || []);

    // Start language logo preload as soon as language data arrives (don't wait for channels)
    langPromise.then((languages) => {
      const langUrls = (languages || [])
        .map((l) => proxyImageUrl(l.langlogomob))
        .filter((u) => u && !u.includes("chnlnoimage"));
      if (langUrls.length > 0) preloadLogos(langUrls, true);
    });

    if (isSlow) return; // 2G: language logos only, skip channel data prefetch

    // ── Channel data: prefetch for instant page render (logos load on-demand via IntersectionObserver) ──
    if (!chFresh) {
      getChannelList({ mobile, langid: "subs" })
        .then((data) => {
          const chnls = data?.body?.[0]?.channels || [];
          if (chnls.length > 0) setEntry(chKey, chnls);
        })
        .catch(() => {});
    }
  } catch (_) {
    // Prefetch is best-effort — never block or crash the app
  }
}

// Run on startup (works if user is already logged in from previous session)
runIptvPrefetch();

function _preloadFromCached(langEntry) {
  // Only preload language logos (~10-12) — channel logos load on-demand
  // via IntersectionObserver when the user opens Live TV
  const langUrls = (langEntry?.data || [])
    .map((l) => proxyImageUrl(l.langlogomob))
    .filter((u) => u && !u.includes("chnlnoimage"));
  if (langUrls.length > 0) preloadLogos(langUrls, true);
}
