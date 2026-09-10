/**
 * Operator-supplied artwork is never covered, and never sits on a dark plate.
 *
 * Two QA reports, Aug 2026, one underlying mistake: treating an image the
 * operator uploaded as if it were a decorative backdrop we may draw on.
 *
 *   1. "Caption/Title showing over the text in banner image or covering the
 *      content mentioned on the banner image."
 *   2. "In each Service home page, top left place showing image (where the
 *      name and user id showing) not clearly visible due to its background
 *      colour."
 *
 * The dashboard banners are finished 16:9 designs — BBNL logo, headline, body
 * copy, and the support phone numbers along the bottom edge (verified by
 * pulling apis/webads and opening the real files). The slide laid a
 * `from-black/80` gradient over the lower half and printed `ad.description` on
 * top of it, landing "Best Support" across the two numbers customers are meant
 * to call. `description` is a label; the operator dashboard has always used it
 * as alt text only.
 *
 * The service-home tile had the mirror problem: a dark navy plan logo on
 * `bg-white/20` over an indigo gradient, i.e. a dark logo on a dark surface.
 *
 * Source-level checks: both are CSS-and-markup rules with no behaviour to
 * drive, and jsdom has no layout or paint to inspect.
 */

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/**
 * The <SwiperSlide> body — everything drawn for one banner, comments removed.
 *
 * Stripping comments is not cosmetic: the code now carries a note explaining
 * which classes used to cover the artwork, and it names them. Without this the
 * explanation of the fix would itself fail the test.
 */
function adSlide() {
  const src = read("pages/customer/Dashboard.jsx")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")   // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, "");      // block comments
  const start = src.indexOf("<SwiperSlide");
  const end = src.indexOf("</SwiperSlide>");
  expect(start, "ad slide not found").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("the dashboard banner shows the artwork, not our caption", () => {
  test("description is alt text, never rendered as visible text", () => {
    const slide = adSlide();
    expect(slide).toMatch(/alt=\{ad\.description/);
    // THE REGRESSION: `{ad.description}` as a JSX child paints it on the image.
    expect(slide).not.toMatch(/>\s*\{ad\.description\}\s*</);
    expect(slide).not.toMatch(/\{ad\.description\s*&&/);
  });

  test("no full-bleed scrim is laid over the image", () => {
    const slide = adSlide();
    // `absolute inset-0` + a gradient is the shape that covered the artwork.
    const scrim = /absolute inset-0[^"]*bg-gradient/.test(slide);
    expect(scrim).toBe(false);
    expect(slide).not.toMatch(/from-black\/[5-9]\d/);
  });

  // The tappable affordance is allowed, but only as a corner chip — it must
  // stay pinned to an edge rather than spanning the design.
  test("the Watch Now chip stays in a corner and does not span the banner", () => {
    const slide = adSlide();
    if (!/Watch Now/.test(slide)) return;
    expect(slide).toMatch(/absolute (?:top|bottom)-\d+ (?:left|right)-\d+/);
    expect(slide).not.toMatch(/absolute bottom-0 inset-x-0/);
  });
});

describe("the service-home plan tile plates its logo", () => {
  test("the artwork sits on a solid white plate, not a tint", () => {
    const src = read("pages/customer/ServiceHome.jsx");
    const img = src.match(/<img[\s\S]{0,400}?planRow\.imgurl[\s\S]{0,400}?\/>/)
      || src.match(/planRow\?\.imgurl \?[\s\S]{0,500}?\/>/);
    expect(img, "plan logo <img> not found").toBeTruthy();
    const cls = img[0];
    // A tint over the indigo gradient is still a dark surface.
    expect(cls).not.toMatch(/bg-white\/\d+/);
    expect(cls).toMatch(/\bbg-white\b/);
    // Plating only helps if the logo is fitted inside it rather than cropped.
    expect(cls).toMatch(/object-contain/);
  });
});
