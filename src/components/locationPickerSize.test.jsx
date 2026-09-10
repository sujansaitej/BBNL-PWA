/** @vitest-environment jsdom */
/**
 * LocationPicker sizing — the blank-map regression.
 *
 * QA screenshot, 1 Sep 2026: New Connection rendered as a full-screen dark void
 * with the centre pointer stranded over the header, while the Android app was
 * fine.
 *
 * CAUSE: `height="100%"` was applied to the MapContainer, but its wrapper was a
 * bare `<div className="relative">` with auto height. A percentage height
 * resolves against the PARENT, so the map computed to 0px — and the pointer
 * overlay, `absolute inset-0` on that same zero-height box, centred itself at
 * the very top of the screen. The wrapper must carry the height.
 *
 * react-leaflet is stubbed: jsdom has no layout engine, so this asserts the
 * style contract that Leaflet depends on rather than a rendered pixel height.
 */
import { describe, test, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, style }) => (
    <div data-testid="map" style={style}>{children}</div>
  ),
  TileLayer: () => null,
  useMap: () => ({
    setView: () => {}, getZoom: () => 14, getCenter: () => ({ lat: 0, lng: 0 }),
    getContainer: () => document.createElement("div"), invalidateSize: () => {},
  }),
  useMapEvents: () => ({ setView: () => {}, getZoom: () => 14, getCenter: () => ({ lat: 0, lng: 0 }) }),
}));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

import LocationPicker from "./LocationPicker";

const wrapper = (el) => el.querySelector("div.relative");

describe("the wrapper carries the height, not just the map", () => {
  test('height="100%" reaches the wrapper — otherwise the map collapses to 0', () => {
    const { container } = render(<LocationPicker center={[12.97, 77.59]} onChange={() => {}} height="100%" />);
    expect(wrapper(container).style.height).toBe("100%");
    // The map then fills that wrapper rather than resolving 100% of `auto`.
    expect(container.querySelector('[data-testid="map"]').style.height).toBe("100%");
  });

  test("the numeric default still works for Add User's 400px picker", () => {
    const { container } = render(<LocationPicker center={[12.97, 77.59]} onChange={() => {}} />);
    expect(wrapper(container).style.height).toBe("400px");
  });

  test("the centre pointer overlays the wrapper, so it can only be centred if the wrapper has height", () => {
    const { container } = render(<LocationPicker center={[12.97, 77.59]} onChange={() => {}} height="100%" />);
    const overlay = container.querySelector(".pointer-events-none.absolute.inset-0");
    expect(overlay).toBeTruthy();
    expect(overlay.parentElement).toBe(wrapper(container));
  });
});

/**
 * Second sighting, 5 Sep 2026: same dark void, same stranded pointer — on a
 * build that already had the wrapper fix above. The wrapper was fine; its
 * PARENT was the problem. `min-h-dvh` gives the column no definite height,
 * so the flex item's height is indefinite and the picker's `100%` still
 * resolved to 0. jsdom cannot lay this out, so these pin the source contract
 * that a real browser needs.
 */
describe("NewConnection gives the map a definite height", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "../pages/customer/NewConnection.jsx"), "utf8");

  test("the page root is h-dvh, not min-h-dvh", () => {
    expect(src).toMatch(/className="h-dvh flex flex-col/);
    expect(src).not.toMatch(/className="min-h-dvh flex flex-col/);
  });

  test("the picker absolutely fills a relative flex item", () => {
    expect(src).toMatch(/<div className="relative isolate z-0 flex-1 min-h-0">\s*<div className="absolute inset-0">\s*<LocationPicker/);
  });

  test("a percentage height carries a pixel floor so a slip is a short map, not no map", () => {
    const { container } = render(<LocationPicker center={[12.97, 77.59]} onChange={() => {}} height="100%" />);
    expect(wrapper(container).style.minHeight).toBe("280px");
    const fixed = render(<LocationPicker center={[12.97, 77.59]} onChange={() => {}} />);
    expect(wrapper(fixed.container).style.minHeight).toBe("");
  });
});

/**
 * 5 Sep 2026, once the map drew: "when user clicks Services / Get New
 * Connection the pop-up hides behind the map". Leaflet's panes are z-400 and
 * its controls z-1000; the app's Modal is z-60 and toasts z-50. Unless the
 * map is its own stacking context those numbers compete at page level and
 * the map wins. `isolate` on the picker wrapper and on the map box keeps
 * Leaflet's ranks internal.
 */
describe("the map is an isolated stacking context", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const here = path.dirname(fileURLToPath(import.meta.url));

  test("LocationPicker's wrapper isolates Leaflet's z-indexes", () => {
    const { container } = render(<LocationPicker center={[12.97, 77.59]} onChange={() => {}} />);
    const w = container.querySelector("div.relative");
    expect(w.className).toMatch(/\bisolate\b/);
    expect(w.className).toMatch(/\bz-0\b/);
  });

  test("NewConnection's map box (with its search form and location button) is isolated too", () => {
    const src = readFileSync(path.join(here, "../pages/customer/NewConnection.jsx"), "utf8");
    expect(src).toMatch(/<div className="relative isolate z-0 flex-1 min-h-0">/);
  });

  test("the Modal outranks an isolated map: z-60 vs the map box's z-0", () => {
    const modal = readFileSync(path.join(here, "ui/Modal.jsx"), "utf8");
    expect(modal).toMatch(/fixed inset-0[^"]*z-\[60\]/);
  });
});
