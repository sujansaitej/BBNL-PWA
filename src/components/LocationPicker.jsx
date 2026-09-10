import { useEffect } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";

/**
 * Centre-locked location picker: the map moves UNDER a fixed pointer.
 *
 * This is Android's behaviour, not an invention. NewConnectionFragment's
 * `onCameraChange` reads `googleMap.getCameraPosition().target` — the map
 * CENTRE — as the chosen coordinate, so the user "marks the spot by moving the
 * screen" rather than by tapping a pin. `moveend` here is the same idea; the
 * pointer is a static overlay, never a Leaflet marker, so it cannot drift out
 * of the centre.
 *
 * Extracted from pages/Register.jsx so the operator's Add User address picker
 * and the customer's New Connection screen cannot drift apart — they are the
 * same interaction and were about to become two copies.
 *
 * `zoom` defaults to 14, matching Android's
 * `moveCamera(newLatLngZoom(latLng, 14.0f))`.
 */
export function RecenterMap({ center, zoom }) {
  const map = useMap();
  // `zoom` is optional: a search result recentres AND zooms (Android's
  // delegateLatLng does moveCamera + zoomTo(15)); a plain recentre keeps the
  // zoom the user has set.
  useEffect(() => {
    map.setView(center, zoom ?? map.getZoom());
  }, [center[0], center[1], zoom]);
  return null;
}

/**
 * Leaflet measures its container once, at mount. If the container is still
 * 0-high or mid-layout at that moment — which is what a flex parent does — the
 * map keeps the stale size and paints nothing. `invalidateSize` re-measures.
 *
 * A ResizeObserver rather than a one-shot timeout, because the container also
 * changes height when the on-screen keyboard opens or the device rotates.
 */
export function MapAutoSize() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    // Guarded: an older engine (and jsdom) has no ResizeObserver, and a missing
    // one must degrade to "resize only", never take the map down with it.
    if (typeof ResizeObserver === "undefined") {
      const onResize = () => map.invalidateSize();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function MapCenterTracker({ onCenterPick }) {
  const map = useMapEvents({
    click(e) {
      map.setView(e.latlng, map.getZoom());
      onCenterPick(e.latlng);
    },
    moveend() {
      onCenterPick(map.getCenter());
    },
  });
  return null;
}

/**
 * When `height` is a percentage, the floor below it. A percentage resolves
 * against the parent — and if the parent's height is not DEFINITE (a flex
 * item inside a `min-height` column is the classic case) the browser
 * resolves it to auto, i.e. zero. QA hit exactly that twice: a dark void
 * with the centre pointer stranded over the header. Callers should size the
 * parent properly (see NewConnection's absolute-fill), but a floor means a
 * layout slip degrades to a short map, never to no map.
 */
const PERCENT_HEIGHT_FLOOR_PX = 280;

export default function LocationPicker({ center, onChange, zoom = 14, viewZoom, height = 400, children }) {
  const isPercent = typeof height === "string" && height.trim().endsWith("%");
  return (
    // The wrapper MUST carry the height: a caller passing height="100%" is
    // sizing against ITS parent, and a percentage on the MapContainer alone
    // resolves against this auto-height div — i.e. zero, a blank screen with
    // the centre pointer stranded at the top. Numbers still work (React adds
    // "px"), so height={400} is unchanged.
    // `isolate z-0`: Leaflet stacks its panes at z-index 400 and its controls
    // at 1000, and those numbers live in whatever stacking context the map
    // sits in. Without isolation they compete with the app's own layers — a
    // Modal at z-60 and the toasts at z-50 rendered BEHIND the map (QA, 5 Sep
    // 2026: "the pop-up hides behind the map"). Isolation makes this wrapper
    // its own stacking context, so 400/1000 are internal ranks and the
    // wrapper as a whole sits at 0 in the page.
    <div className="relative isolate z-0" style={{ height, minHeight: isPercent ? PERCENT_HEIGHT_FLOOR_PX : undefined }}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <RecenterMap center={center} zoom={viewZoom} />
        <MapCenterTracker onCenterPick={onChange} />
        <MapAutoSize />
        {children}
      </MapContainer>
      {/* z-[500] clears Leaflet's own panes; pointer-events-none so the map
          still receives the drag that does the actual picking. The -translate
          puts the pin TIP on the centre, not its middle. */}
      <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
        <img
          src={import.meta.env.VITE_API_APP_DIR_PATH + "icons/marker.png"}
          alt="Center pointer"
          className="h-11 w-11 -translate-y-5 drop-shadow-md"
        />
      </div>
    </div>
  );
}
