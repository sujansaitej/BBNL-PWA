/**
 * EVERY screen follows the theme — both portals, no exceptions by accident.
 *
 * QA, Aug 2026, with photos: Add User first, then the plan/create-user screen —
 * "when user switches to darkmode it should completely every screen should
 * adapt to that mode entirely, every screen in customer portal as well as the
 * franchise."
 *
 * Fixing screens one photo at a time does not converge: at the time of this
 * audit 40 files carried 166 light-only class attributes, and the ones QA had
 * photographed were only the first two they happened to open. This replaces
 * screenshot-driven fixes with a rule that holds repo-wide.
 *
 * THREE FAILURE SHAPES, all of which shipped:
 *
 *   1. An opaque light surface with no dark counterpart — `bg-white` on a card
 *      that then glares out of a dark page.
 *   2. Readable text with no dark counterpart — `text-gray-800` that stays
 *      near-black on a now-dark card.
 *   3. Text pinned DARKER in dark mode — `dark:text-gray-700`. This is the
 *      subtle one: it looks like dark-mode support and is the opposite. It was
 *      written to keep a heading legible on a card that never darkened, so it
 *      turns invisible the moment the card is fixed.
 *
 * TWO THINGS ARE DELIBERATELY EXEMPT and must stay exempt:
 *
 *   - `scheme-light` marks a surface that stays light ON PURPOSE (the signature
 *     pad, whose export is flattened onto white; TicketDialog). The class also
 *     pins the user agent's own chrome, so those two travel together.
 *   - `bg-white/NN` is a translucent overlay on a gradient, not a surface.
 *     OTTHub and the service headers use it correctly.
 *
 * And one legitimate pattern the naive rule gets wrong: `text-gray-300
 * dark:text-gray-600` is a decorative empty-state icon, faint against white AND
 * against near-black. Only a READABLE light shade (500+) makes a darker dark
 * variant a bug — so the light counterpart decides.
 */

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.dirname(fileURLToPath(import.meta.url));

function jsxFiles(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) jsxFiles(full, out);
    else if (/\.jsx$/.test(e.name) && !/\.test\.jsx$/.test(e.name)) out.push(full);
  }
  return out;
}

/** [{file, cls}] for every className literal in the app. */
const ALL = jsxFiles().flatMap((f) => {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(SRC, f).split(path.sep).join("/");
  return [...src.matchAll(/className=[{]?[`"]([^`"]*)[`"]/g)].map((m) => ({ file: rel, cls: m[1] }));
});

const show = (rows) => rows.map((r) => `${r.file}: ${r.cls.replace(/\s+/g, " ").slice(0, 72)}`);

test("the audit actually sees the app", () => {
  // A broken glob would make every assertion below vacuously pass.
  expect(ALL.length).toBeGreaterThan(1000);
  expect(new Set(ALL.map((r) => r.file)).size).toBeGreaterThan(40);
});

describe("no screen is left light-only", () => {
  test("every opaque light surface has a dark counterpart", () => {
    const bad = ALL.filter(({ cls }) =>
      /\b(bg-white|bg-gray-50|bg-gray-100)\b/.test(cls) &&
      !/dark:bg-/.test(cls) &&
      !/bg-white\//.test(cls) &&      // translucent overlay on a gradient
      !/scheme-light/.test(cls)       // deliberately light, see the header
    );
    expect(show(bad)).toEqual([]);
  });

  test("every readable dark text colour has a dark counterpart", () => {
    const bad = ALL.filter(({ cls }) =>
      /\b(text-gray-[7-9]00|text-black)\b/.test(cls) && !/dark:text-/.test(cls)
    );
    expect(show(bad)).toEqual([]);
  });

  test("no readable text is pinned DARKER in dark mode", () => {
    const bad = ALL.filter(({ cls }) => {
      if (!/dark:text-gray-[6-9]00/.test(cls)) return false;
      const light = cls.match(/(?<!dark:)\btext-gray-(\d)00\b/);
      return !light || Number(light[1]) >= 5;   // 300/400 = deliberately muted
    });
    expect(show(bad)).toEqual([]);
  });
});

// Backgrounds and text were the first sweep. These are what it MISSED, found
// only by asking "what else is colour?" — and each is plainly visible: a light
// border reads as a bright outline round a dark card, and a light hover fill
// flashes white under the finger. 40 more attributes across 21 files.
describe("the details that surround a surface follow it", () => {
  test("light borders have a dark counterpart", () => {
    const bad = ALL.filter(({ cls }) =>
      /\bborder-gray-(200|300)\b/.test(cls) && !/dark:border-/.test(cls) && !/scheme-light/.test(cls));
    expect(show(bad)).toEqual([]);
  });

  test("light hover fills have a dark counterpart", () => {
    const bad = ALL.filter(({ cls }) =>
      /\bhover:bg-gray-(50|100|200)\b/.test(cls) && !/dark:hover:bg-/.test(cls) && !/scheme-light/.test(cls));
    expect(show(bad)).toEqual([]);
  });

  test("placeholder colours have a dark counterpart", () => {
    const bad = ALL.filter(({ cls }) =>
      /\bplaceholder-gray-\d00\b/.test(cls) && !/dark:placeholder-/.test(cls) && !/scheme-light/.test(cls));
    expect(show(bad)).toEqual([]);
  });
});

describe("the deliberate exemptions stay deliberate", () => {
  // If this list grows, someone has opted a screen out of the theme rather
  // than styling it — which is how the whole problem started.
  test("only surfaces whose ARTEFACT is light opt out", () => {
    const optedOut = [...new Set(
      ALL.filter(({ cls }) => /scheme-light/.test(cls)).map((r) => r.file)
    )].sort();
    expect(optedOut).toEqual(["components/ui/TicketDialog.jsx", "pages/Register.jsx"]);
  });
});
