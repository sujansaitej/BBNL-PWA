/**
 * A signature pad must be sized by its BOX, never by itself.
 *
 * QA, Aug 2026: "Signature Box height/size increased but full screen mode not
 * appropriate."
 *
 * The full-screen pad put `absolute inset-2` directly on the <canvas>. That
 * looks like every other "fill the parent" class in this codebase, and it is
 * wrong for this one element:
 *
 *   - <canvas> is a REPLACED element. With `width`/`height` still `auto`, CSS
 *     resolves them from the element's INTRINSIC size (its width/height
 *     content attributes, 300x150 by default) — and an absolutely positioned
 *     replaced element that is over-constrained simply drops `right`/`bottom`
 *     (CSS 2.2 s10.3.8). So `inset-2` positioned it and never stretched it.
 *   - Tailwind's preflight gives canvas only `display:block`. The
 *     `max-width:100%` rule next to it lists img and video only, so nothing
 *     capped it either.
 *   - react-signature-canvas sets the bitmap to `offsetWidth * devicePixelRatio`.
 *     With no CSS width the bitmap IS the intrinsic width, so every re-fit
 *     multiplied the canvas by the pixel ratio (300 -> 900 -> 2700 on a dpr-3
 *     phone), and each growth retriggered the ResizeObserver in
 *     useSignaturePadAutoFit.
 *
 * Result: full screen opened a small pad pinned to the top-left that then ran
 * off the screen, with the ink landing away from the finger. The inline pad
 * was fine the whole time because it used `h-full w-full`.
 *
 * This is a source-level check on purpose: jsdom has no layout engine, so a
 * render test cannot tell a stretched canvas from a 300x150 one.
 */

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function jsxFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsxFiles(full, out);
    else if (/\.jsx$/.test(entry.name) && !/\.test\.jsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every `canvasProps={{ className: "..." }}` string in the app. */
function canvasClassNames() {
  const found = [];
  for (const file of jsxFiles()) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/canvasProps=\{\{[^}]*className:\s*"([^"]*)"/g)) {
      found.push({ file: path.relative(ROOT, file), className: m[1] });
    }
  }
  return found;
}

describe("signature pads are stretched by CSS, not by their intrinsic size", () => {
  test("there is at least one pad to check", () => {
    expect(canvasClassNames().length).toBeGreaterThan(0);
  });

  test("every pad canvas declares an explicit width and height", () => {
    const offenders = canvasClassNames().filter(
      ({ className }) => !/\bw-full\b/.test(className) || !/\bh-full\b/.test(className)
    );
    expect(offenders).toEqual([]);
  });

  // The specific shape that broke: positioning classes on the canvas itself.
  // Put them on a wrapping <div> — an ordinary element honours `inset-*`.
  test("no pad canvas is positioned by inset-* instead of sized", () => {
    const offenders = canvasClassNames().filter(({ className }) =>
      /\b(absolute|fixed)\b/.test(className) && /\binset-/.test(className)
    );
    expect(offenders).toEqual([]);
  });

  // Both pads must keep this off, or the Android keyboard/URL-bar resize wipes
  // a finished signature. useSignaturePadAutoFit re-fits without erasing.
  test("neither pad lets the library clear it on resize", () => {
    // Line comments first — the hook's own doc block mentions <SignaturePad>
    // and would otherwise be counted as a third pad.
    const src = read("pages/Register.jsx").replace(/^\s*\/\/.*$/gm, "");
    const pads = src.match(/<SignaturePad\b/g) || [];
    const guarded = src.match(/clearOnResize=\{false\}/g) || [];
    expect(pads.length).toBeGreaterThanOrEqual(2);
    expect(guarded.length).toBe(pads.length);
  });

  // The full-screen pad's canvas lives inside a positioned wrapper, and the
  // flex column it sits in must be allowed to shrink or the pad overflows.
  test("the full-screen pad wraps the canvas in a positioned box that can shrink", () => {
    const src = read("pages/Register.jsx");
    expect(src).toMatch(/relative flex-1 min-h-0[\s\S]{0,120}absolute inset-2/);
  });
});
