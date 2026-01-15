import { useCallback } from "react";

export function useOpenMap() {
  const openMap = useCallback((options = {}) => {
    const {
      latitude,
      longitude,
      placeName,
      zoomLevel = 15,
      from, // { lat, lng, name }
      to,   // { lat, lng, name }
      waypoints = [], // Array of { lat, lng, name }
      travelMode = "driving", // driving | walking | bicycling | transit
    } = options;

    const userAgent = navigator.userAgent || navigator.vendor || window.opera;

    // --- Helper: format any location into a usable query ---
    const encodeLoc = (loc) => {
      if (!loc) return "";
      if (loc.name) return encodeURIComponent(loc.name);
      if (loc.lat && loc.lng) return `${loc.lat},${loc.lng}`;
      return "";
    };

    const isDirection = !!(from && to);

    // --- Build URLs ---
    let webUrl, androidAppUrl, iosAppUrl, appleMapsUrl;

    if (isDirection) {
      // 🧭 Directions Mode
      const fromQuery = encodeLoc(from);
      const toQuery = encodeLoc(to);
      const waypointQueries = waypoints.map(encodeLoc).filter(Boolean);

      const waypointsParam =
        waypointQueries.length > 0
          ? `&waypoints=${waypointQueries.join("|")}`
          : "";

      // Web version
      webUrl = `https://www.google.com/maps/dir/?api=1&origin=${fromQuery}&destination=${toQuery}${waypointsParam}&travelmode=${travelMode}`;

      // Android Google Maps app intent
      androidAppUrl = `google.navigation:q=${toQuery}&mode=${travelMode[0] || "d"}`;

      // iOS Google Maps deep link
      iosAppUrl = `comgooglemaps://?saddr=${fromQuery}&daddr=${toQuery}${waypointsParam}&directionsmode=${travelMode}`;

      // iOS Apple Maps fallback
      appleMapsUrl = `https://maps.apple.com/?saddr=${fromQuery}&daddr=${toQuery}&dirflg=${travelMode[0] || "d"}`;
    } else {
      // 📍 Location / Search Mode
      const query = placeName
        ? encodeURIComponent(placeName)
        : `${latitude},${longitude}`;

      webUrl = `https://www.google.com/maps/search/?api=1&query=${query}&zoom=${zoomLevel}`;
      androidAppUrl = placeName
        ? `geo:0,0?q=${query}`
        : `geo:${latitude},${longitude}?q=${latitude},${longitude}`;
      iosAppUrl = `comgooglemaps://?q=${query}&zoom=${zoomLevel}`;
      appleMapsUrl = placeName
        ? `https://maps.apple.com/?q=${query}&z=${zoomLevel}`
        : `https://maps.apple.com/?ll=${latitude},${longitude}&z=${zoomLevel}`;
    }

    // --- Android Flow ---
    if (/android/i.test(userAgent)) {
      try {
        const now = Date.now();
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = androidAppUrl;
        document.body.appendChild(iframe);

        setTimeout(() => {
          const elapsed = Date.now() - now;
          if (elapsed < 1500) {
            window.open(webUrl, "_blank");
          }
          document.body.removeChild(iframe);
        }, 1200);
      } catch {
        window.open(webUrl, "_blank");
      }

    // --- iOS Flow ---
    } else if (/iPad|iPhone|iPod/i.test(userAgent)) {
      const now = Date.now();
      window.location.href = iosAppUrl;

      setTimeout(() => {
        const elapsed = Date.now() - now;
        if (elapsed < 1500) {
          window.location.href = appleMapsUrl;
        }
      }, 1200);

    // --- Desktop / PWA / Others ---
    } else {
      window.open(webUrl, "_blank");
    }
  }, []);

  return { openMap };
}
