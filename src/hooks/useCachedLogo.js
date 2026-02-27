import { useState, useEffect, useRef } from "react";
import { getCachedLogo, subscribeLogo } from "../services/logoCache";

/**
 * Returns a cached data URL (base64 or objectURL) for the given image URL.
 * Returns null while the cache is loading — never returns the raw URL,
 * because IPTV images need auth headers that <img> tags can't send.
 * This prevents wasted 401 requests and broken-image flicker.
 */
export default function useCachedLogo(url) {
  const [dataUrl, setDataUrl] = useState(() => getCachedLogo(url) || null);
  const retryRef = useRef(null);
  const unsubRef = useRef(null);

  useEffect(() => {
    if (!url) { setDataUrl(null); return; }

    // Check cache synchronously (might have loaded between renders)
    const cached = getCachedLogo(url);
    if (cached) { setDataUrl(cached); return; }

    // Show placeholder (null) until cache delivers a valid data URL
    setDataUrl(null);

    // Subscribe for the cached version
    const unsub = subscribeLogo(url, (cachedVal) => {
      if (cachedVal) {
        setDataUrl(cachedVal);
      } else {
        // Fetch failed — retry with a fresh subscribe so the callback is
        // properly registered for the new fetch cycle.  The old subscribe
        // only called preloadLogos without re-registering, losing the result.
        retryRef.current = setTimeout(() => {
          const retryCheck = getCachedLogo(url);
          if (retryCheck) { setDataUrl(retryCheck); return; }
          // Unsubscribe old listener and re-subscribe for a fresh attempt
          if (unsubRef.current) unsubRef.current();
          unsubRef.current = subscribeLogo(url, (retryVal) => {
            if (retryVal) setDataUrl(retryVal);
          });
        }, 800);
      }
    });
    unsubRef.current = unsub;

    return () => {
      if (unsubRef.current) unsubRef.current();
      unsubRef.current = null;
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [url]);

  return dataUrl;
}
