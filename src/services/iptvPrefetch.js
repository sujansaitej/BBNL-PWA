/**
 * iptvPrefetch — Background prefetcher for IPTV data.
 *
 * Imported early in main.jsx.  On app startup it silently fetches channels,
 * languages, and starts preloading logos so that when the user taps "Live TV"
 * everything renders instantly — even on the very first visit.
 *
 * Timing:
 *   1. Wait for channelStore L1 hydration from IndexedDB (~5 ms)
 *   2. Check if channel/language data is already fresh
 *   3. If not, fetch both in parallel + prefetch logos
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

(async () => {
  try {
    // Wait for IndexedDB → L1 hydration so getEntry() returns persisted data
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

    // Already fresh — start logo preloading from cached data
    if (chFresh && langFresh) {
      _preloadFromCached(chEntry, langEntry);
      return;
    }

    // Fetch stale/missing data — language logos start preloading as soon as
    // the language API responds, WITHOUT waiting for the channel API.
    // Old code used Promise.all which blocked language logos behind slow
    // channel API calls (2-8s on Indian mobile).

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

    if (isSlow) return; // 2G: language logos only, skip channel logos

    // ── Channel logos: start when channel data arrives ──
    const chPromise = !chFresh
      ? getChannelList({ mobile, langid: "subs" })
          .then((data) => {
            const chnls = data?.body?.[0]?.channels || [];
            if (chnls.length > 0) setEntry(chKey, chnls);
            return chnls;
          })
          .catch(() => chEntry?.data || [])
      : Promise.resolve(chEntry?.data || []);

    const channels = await chPromise;
    const chUrls = (channels || [])
      .map((ch) => proxyImageUrl(ch.chlogo))
      .filter((u) => u && !u.includes("chnlnoimage"));

    if (eff === '3g') {
      if (chUrls.length > 0) preloadLogos(chUrls.slice(0, 30));
      return;
    }

    // 4G+: queue all logos at once — concurrency limiter handles batching
    if (chUrls.length > 0) preloadLogos(chUrls);
  } catch (_) {
    // Prefetch is best-effort — never block or crash the app
  }
})();

function _preloadFromCached(chEntry, langEntry) {
  const eff = _getEffective();

  const langUrls = (langEntry?.data || [])
    .map((l) => proxyImageUrl(l.langlogomob))
    .filter((u) => u && !u.includes("chnlnoimage"));
  if (langUrls.length > 0) preloadLogos(langUrls, true);

  const chUrls = (chEntry?.data || [])
    .map((ch) => proxyImageUrl(ch.chlogo))
    .filter((u) => u && !u.includes("chnlnoimage"));
  if (chUrls.length === 0) return;

  if (eff === '3g') {
    preloadLogos(chUrls.slice(0, 30));
    return;
  }

  // 4G+: queue all logos at once — concurrency limiter handles batching
  preloadLogos(chUrls);
}
