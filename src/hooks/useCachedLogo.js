import { useState, useEffect, useRef } from "react";
import { getCachedLogo, subscribeLogo, preloadLogos } from "../services/logoCache";

/**
 * Returns a cached data URL (base64 or objectURL) for the given image URL.
 * Returns null while the cache is loading — never returns the raw URL,
 * because IPTV images need auth headers that <img> tags can't send.
 * This prevents wasted 401 requests and broken-image flicker.
 */
export default function useCachedLogo(url) {
  const [dataUrl, setDataUrl] = useState(() => getCachedLogo(url) || null);
  const retryRef = useRef(null);

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
        // Fetch failed — retry once after a shorter delay.
        // Was 4000ms — on Android Chrome with 275 channels, even 5-10
        // failures meant 40+ seconds of wait. 1500ms is enough to avoid
        // hammering a flaky connection while keeping perceived load fast.
        retryRef.current = setTimeout(() => {
          const retryCheck = getCachedLogo(url);
          if (retryCheck) { setDataUrl(retryCheck); return; }
          preloadLogos([url], true); // priority retry
        }, 1500);
      }
    });

    return () => {
      unsub();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [url]);

  return dataUrl;
}
