import { useState, useEffect, useRef } from "react";
import { getCachedLogo, subscribeLogo } from "../services/logoCache";

/**
 * Returns [src, ref] for the given image URL.
 *
 * src: immediately usable — either an objectURL from L1 cache (instant) or
 *      the original CDN URL for browser-native loading (no CORS needed).
 *      Never returns null for a valid URL, so <img> starts loading immediately
 *      instead of showing a placeholder while the fetch pipeline processes.
 *
 * ref: stable no-op — kept for backward compatibility with existing JSX.
 *
 * The page-level preloadLogos() warms the Workbox cache in the background.
 * When it completes, this hook upgrades from CDN URL to objectURL (cached
 * by Workbox for offline + instant on re-render via L1 mem Map).
 * If the fetch pipeline fails (e.g., CORS not configured on CDN), the
 * CDN URL is already displaying the image via browser-native <img> loading.
 */

const NOOP_REF = () => {};

export default function useCachedLogo(url) {
  // Instant: L1 objectURL if available, else CDN URL for native <img> loading
  const [dataUrl, setDataUrl] = useState(() => getCachedLogo(url) || url || null);
  const unsubRef = useRef(null);

  useEffect(() => {
    if (!url) { setDataUrl(null); return; }

    // L1 cache hit → objectURL (no network needed, instant)
    const cached = getCachedLogo(url);
    if (cached) { setDataUrl(cached); return; }

    // Return CDN URL directly → <img src={cdnUrl}> loads immediately.
    // Browser handles HTTP/2 multiplexing, connection pooling, and decoding
    // natively — no JS overhead, no CORS dependency.
    setDataUrl(url);

    // Subscribe for objectURL upgrade when preloadLogos() completes.
    // This upgrades the src from CDN URL → objectURL (Workbox-cached for
    // offline support and instant on next render via L1 mem Map).
    // If fetch fails (CORS/network), the CDN URL is already showing the image.
    if (unsubRef.current) unsubRef.current();
    unsubRef.current = subscribeLogo(url, (val) => {
      if (val) setDataUrl(val);
      // null = fetch failed → keep CDN URL, image already displayed
    });

    return () => {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    };
  }, [url]);

  return [dataUrl, NOOP_REF];
}
