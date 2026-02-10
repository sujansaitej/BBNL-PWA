import { useState, useEffect } from "react";
import { getCachedLogo, subscribeLogo } from "../services/logoCache";

/**
 * Returns a blob URL for the given image URL once it's fully loaded.
 * Returns null while the image is still downloading.
 * Uses the global logo cache — load once, instant everywhere.
 */
export default function useCachedLogo(url) {
  const [blobUrl, setBlobUrl] = useState(() => getCachedLogo(url));

  useEffect(() => {
    if (!url) { setBlobUrl(null); return; }

    // Check cache synchronously (might have loaded between renders)
    const cached = getCachedLogo(url);
    if (cached) { setBlobUrl(cached); return; }

    setBlobUrl(null);
    return subscribeLogo(url, setBlobUrl);
  }, [url]);

  return blobUrl;
}
