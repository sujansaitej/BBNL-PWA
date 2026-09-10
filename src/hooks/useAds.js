import { useCallback, useEffect, useRef, useState } from "react";
import { ads } from "../services/customer/apis";
import { lsGetStale, lsSet, lsRemove } from "../services/lsCache";

/**
 * Shared advertisement feed for the customer app.
 *
 * The banner list is operator-managed: images get added, removed or reordered
 * from the admin side at any time, so the carousel has to pick that up on its
 * own.  Strategy is stale-while-revalidate:
 *
 *   1. Seed synchronously from localStorage — even an expired entry — so the
 *      carousel paints on the first frame instead of flashing a skeleton.
 *   2. Revalidate over the network whenever that seed is older than TTL
 *      (or missing), on mount, when the app is brought back to the
 *      foreground, and when connectivity returns.
 *   3. Swap the list in ONLY when its signature changed, so a revalidation
 *      that returns the same ads never resets the running carousel.
 */

const TTL = 5 * 60 * 1000; // how long a cached list is trusted without a re-check

/**
 * Identity of a list: ids + image URLs, in order.  An added, removed,
 * reordered or re-uploaded banner changes it; an identical re-fetch does not.
 */
function signature(list) {
  return list.map((a) => `${a.id ?? ""}|${a.content ?? ""}`).join("~");
}

export function useAds(type = "custapp") {
  const cacheKey = `webads_${type}`;

  const [state, setState] = useState(() => {
    const seed = lsGetStale(cacheKey, TTL);
    return {
      list: seed?.data || [],
      // Only show a skeleton when there is nothing at all to render.
      loading: !seed,
      // A stale seed still needs a network round trip.
      fresh: !!seed?.fresh,
    };
  });

  const sigRef = useRef(signature(state.list));
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);

  const revalidate = useCallback(
    async (force = false) => {
      if (inFlightRef.current) return;
      // Cheap guard: a still-fresh cache does not need the network.
      if (!force && lsGetStale(cacheKey, TTL)?.fresh) return;

      inFlightRef.current = true;
      try {
        const data = await ads(type);
        // webads has NO envelope — imglist is top-level.
        const next = (data?.imglist || []).filter((a) => a.content);
        const sig = signature(next);

        if (next.length > 0) lsSet(cacheKey, next);
        else lsRemove(cacheKey); // every banner was pulled — don't serve ghosts

        if (!aliveRef.current) return;
        if (sig !== sigRef.current) {
          sigRef.current = sig;
          setState({ list: next, loading: false, fresh: true });
        } else {
          setState((s) =>
            s.loading || !s.fresh ? { ...s, loading: false, fresh: true } : s
          );
        }
      } catch {
        // Ads are decorative — never block the page, keep showing the cache.
        if (aliveRef.current) {
          setState((s) => (s.loading ? { ...s, loading: false } : s));
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [type, cacheKey]
  );

  useEffect(() => {
    aliveRef.current = true;
    revalidate();

    // Coming back to the app (or back online) is the moment a newly added
    // banner should appear without the user reloading anything.
    const onVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    const onOnline = () => revalidate(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      aliveRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [revalidate]);

  return { adList: state.list, adCount: state.list.length, adLoading: state.loading, refreshAds: () => revalidate(true) };
}

export default useAds;
