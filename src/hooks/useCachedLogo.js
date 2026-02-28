import { useState, useEffect, useRef, useCallback } from "react";
import { getCachedLogo, subscribeLogo } from "../services/logoCache";

/**
 * Returns [cachedSrc, refCallback] for the given image URL.
 *
 * cachedSrc: object URL string (or null while loading).
 * refCallback: attach to the element's ref — logo loading is gated on
 *   IntersectionObserver visibility (rootMargin: 800px ≈ 12 rows ahead).
 *   Already-cached logos return instantly without waiting for visibility.
 *
 * This prevents 274 simultaneous image requests on the Live TV page.
 * Only visible (or nearly visible) logos trigger network fetches.
 */
export default function useCachedLogo(url) {
  const [dataUrl, setDataUrl] = useState(() => getCachedLogo(url) || null);
  const retryRef = useRef(null);
  const unsubRef = useRef(null);
  const observerRef = useRef(null);
  const elementRef = useRef(null);
  const subscribedRef = useRef(false);

  // Subscribe to logo cache and handle retries
  const startSubscription = useCallback((targetUrl) => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    const unsub = subscribeLogo(targetUrl, (cachedVal) => {
      if (cachedVal) {
        setDataUrl(cachedVal);
      } else {
        // Fetch failed — retry with a fresh subscribe
        retryRef.current = setTimeout(() => {
          const retryCheck = getCachedLogo(targetUrl);
          if (retryCheck) { setDataUrl(retryCheck); return; }
          if (unsubRef.current) unsubRef.current();
          subscribedRef.current = false;
          unsubRef.current = subscribeLogo(targetUrl, (retryVal) => {
            if (retryVal) setDataUrl(retryVal);
          });
          subscribedRef.current = true;
        }, 1000);
      }
    });
    unsubRef.current = unsub;
  }, []);

  useEffect(() => {
    if (!url) { setDataUrl(null); return; }

    // Check cache synchronously — if already cached, skip observer entirely
    const cached = getCachedLogo(url);
    if (cached) { setDataUrl(cached); return; }

    // Reset state for new URL
    setDataUrl(null);
    subscribedRef.current = false;

    // If element is already assigned and visible, subscribe immediately
    // Otherwise the refCallback / observer will trigger subscription
    if (elementRef.current) {
      setupObserver(url);
    }

    return () => {
      if (unsubRef.current) unsubRef.current();
      unsubRef.current = null;
      subscribedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [url]);

  function setupObserver(targetUrl) {
    if (observerRef.current) observerRef.current.disconnect();

    const el = elementRef.current;
    if (!el) return;

    // Already cached — no need to observe
    const cached = getCachedLogo(targetUrl);
    if (cached) { setDataUrl(cached); return; }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          observerRef.current = null;
          startSubscription(targetUrl);
        }
      },
      { rootMargin: "800px" } // preload ~12 rows ahead for smooth scrolling
    );
    observerRef.current = observer;
    observer.observe(el);
  }

  // Ref callback — called when element mounts/unmounts
  const refCallback = useCallback((node) => {
    elementRef.current = node;
    if (node && url) {
      // Already cached — set immediately
      const cached = getCachedLogo(url);
      if (cached) { setDataUrl(cached); return; }

      // Not yet subscribed — set up observer
      if (!subscribedRef.current) {
        setupObserver(url);
      }
    }
  }, [url]);

  return [dataUrl, refCallback];
}
