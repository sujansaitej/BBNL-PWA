/**
 * Add User follows the app theme.
 *
 * QA, Aug 2026, with a photo: "Phone theme and App theme both changed to Dark
 * Mode. When Redirect to Add User page showing like this." — the whole app was
 * dark and the Add User form was a stack of glaring white cards.
 *
 * It was not an oversight, which is why this file exists. The page was
 * deliberately light-only, and three separate mechanisms were holding it that
 * way, each of which had to be undone together:
 *
 *   1. Cards were `bg-white` with no dark variant.
 *   2. Every heading carried `dark:text-gray-700` — text pinned DARKER in dark
 *      mode, which only makes sense on a card that stays white. That is the
 *      tell: nine of the file's twelve `dark:` classes were compensating for
 *      the missing dark styling rather than providing it.
 *   3. Fields carried `scheme-light`, forcing light user agent chrome (caret,
 *      date picker, autofill) so they would not look dark inside a white card.
 *
 * Undo any one and the page looks worse, not better — dark text on a dark
 * card, or a dark date picker hanging off a white field. So the assertions
 * below cover all three, and the ONE surface that is still light on purpose.
 */

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "Register.jsx"), "utf8");

/** Every className="..." / className={`...`} literal on the page. */
function classNames(src = SRC) {
  return [...src.matchAll(/className=[{]?[`"]([^`"]*)[`"]/g)].map((m) => m[1]);
}

describe("the form darkens with the app", () => {
  test("no card is left white-only", () => {
    const offenders = classNames().filter(
      (c) => /\bbg-white\b/.test(c) && !/dark:bg-/.test(c) && !/scheme-light/.test(c)
    );
    expect(offenders).toEqual([]);
  });

  // The compensation hack. `dark:text-gray-700` is DARK text in DARK mode.
  test("no text is pinned dark for a white card that no longer exists", () => {
    expect(SRC).not.toMatch(/dark:text-gray-[6-9]00/);
  });

  test("headings invert instead", () => {
    expect(SRC).toMatch(/dark:text-gray-100/);
  });

  // A label that floats up punches a hole in the input's top border, so its
  // background has to track the field fill or the border runs through the text.
  test("the floating label's background follows the field", () => {
    const label = classNames().find((c) => /peer-placeholder-shown:top-/.test(c));
    expect(label, "floating label not found").toBeTruthy();
    expect(label).toMatch(/bg-white dark:bg-gray-800/);
  });

  test("the field itself darkens and is not pinned to light UA chrome", () => {
    const field = classNames().find((c) => /\bpeer w-full rounded-xl border\b/.test(c));
    expect(field, "input not found").toBeTruthy();
    expect(field).toMatch(/dark:bg-gray-800/);
    expect(field).toMatch(/dark:text-gray-100/);
    expect(field).not.toMatch(/scheme-light/);
  });

  // gray-700 on a gray-800 card is very nearly invisible — the failure this
  // page would have shipped if only the backgrounds had been fixed.
  test("no label text is left at a shade that vanishes on a dark card", () => {
    const offenders = classNames().filter(
      (c) => /\btext-gray-[5-9]00\b/.test(c) && !/dark:text-/.test(c)
    );
    expect(offenders).toEqual([]);
  });
});

// The former light islands (Subscribe, Support, OTTHub, and the shared
// ui/Input + ui/FloatingInput) were checked here individually. That list is now
// obsolete: src/darkModeCoverage.test.js enforces the same three rules across
// EVERY .jsx in the app, so a per-file list would only go stale. What stays
// here is what is specific to Add User — the compensation hack it carried, and
// the one surface on it that is light on purpose.

describe("the signature pad stays light, on purpose", () => {
  // The exported PNG is composited onto white by flattenSignatureToWhite,
  // because a transparent one renders as black-on-black in several document
  // viewers. Signing on a dark pad and flattening onto white would hand the
  // customer a signature they cannot see.
  test("the full-screen pad is white and opts out of the dark UA chrome", () => {
    const pad = classNames().find((c) => /fixed inset-0 z-\[70\]/.test(c));
    expect(pad, "full-screen pad not found").toBeTruthy();
    expect(pad).toMatch(/\bbg-white\b/);
    expect(pad).toMatch(/scheme-light/);
    expect(pad).not.toMatch(/dark:bg-/);
  });

  test("flattening onto white is still what makes that necessary", () => {
    expect(SRC).toMatch(/flattenSignatureToWhite/);
  });
});
