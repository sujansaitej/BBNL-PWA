import { useState, useEffect } from "react";
import { getCachedLogo, subscribeLogo } from "../services/logoCache";

/**
 * Returns a cached data URL (base64 or blob) for the given image URL.
 * Returns null while the image is still downloading.
 * Uses the two-tier cache — instant from localStorage on return visits.
 */
export default function useCachedLogo(url) {
  const [dataUrl, setDataUrl] = useState(() => getCachedLogo(url));

  useEffect(() => {
    if (!url) { setDataUrl(null); return; }

    // Check cache synchronously (might have loaded between renders)
    const cached = getCachedLogo(url);
    if (cached) { setDataUrl(cached); return; }

    setDataUrl(null);
    return subscribeLogo(url, setDataUrl);
  }, [url]);

  return dataUrl;
}
