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

    // Already fresh — start logo preloading from cached data and skip network
    if (chFresh && langFresh) {
      if (!isSlow) _preloadFromCached(chEntry, langEntry);
      return;
    }

    // Fetch stale/missing data in parallel
    const promises = [];

    if (!chFresh) {
      promises.push(
        getChannelList({ mobile, langid: "subs" })
          .then((data) => {
            const chnls = data?.body?.[0]?.channels || [];
            if (chnls.length > 0) setEntry(chKey, chnls);
            return chnls;
          })
          .catch(() => chEntry?.data || [])
      );
    } else {
      promises.push(Promise.resolve(chEntry?.data || []));
    }

    if (!langFresh) {
      promises.push(
        getLanguageList({ mobile })
          .then((data) => {
            const langs = data?.body?.[0]?.languages || [];
            if (langs.length > 0) setEntry(langKey, langs);
            return langs;
          })
          .catch(() => langEntry?.data || [])
      );
    } else {
      promises.push(Promise.resolve(langEntry?.data || []));
    }

    const [channels, languages] = await Promise.all(promises);

    // On 2G/slow-2G: skip logo prefetch entirely — save bandwidth for the
    // actual LiveTV page load.  Logos will load on-demand when user navigates.
    // On 3G: only prefetch language logos (~8 small images).
    // On 4G+: full prefetch (languages + first 15 channel logos).
    if (isSlow) return;

    const langUrls = (languages || [])
      .map((l) => proxyImageUrl(l.langlogomob))
      .filter((u) => u && !u.includes("chnlnoimage"));
    if (langUrls.length > 0) preloadLogos(langUrls, true);

    if (eff === '3g') return; // 3G: language logos only, skip channel logos

    const chUrls = (channels || [])
      .map((ch) => proxyImageUrl(ch.chlogo))
      .filter((u) => u && !u.includes("chnlnoimage"));
    if (chUrls.length > 0) {
      preloadLogos(chUrls.slice(0, 15));
      if (chUrls.length > 15) setTimeout(() => preloadLogos(chUrls.slice(15)), 500);
    }
  } catch (_) {
    // Prefetch is best-effort — never block or crash the app
  }
})();

function _preloadFromCached(chEntry, langEntry) {
  const langUrls = (langEntry?.data || [])
    .map((l) => proxyImageUrl(l.langlogomob))
    .filter((u) => u && !u.includes("chnlnoimage"));
  if (langUrls.length > 0) preloadLogos(langUrls, true);

  const chUrls = (chEntry?.data || [])
    .map((ch) => proxyImageUrl(ch.chlogo))
    .filter((u) => u && !u.includes("chnlnoimage"));
  if (chUrls.length > 0) {
    preloadLogos(chUrls.slice(0, 15));
    if (chUrls.length > 15) setTimeout(() => preloadLogos(chUrls.slice(15)), 500);
  }
}
