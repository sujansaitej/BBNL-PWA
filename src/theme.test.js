/**
 * Light/dark must have exactly ONE source of truth.
 *
 * The shipped bug this file exists to prevent: the login screen chose its logo
 * from `prefers-color-scheme` while the card behind it was styled from the
 * persisted app theme. On a dark-mode phone whose saved theme was light, the
 * two disagreed and the wordmark vanished into the white card. The same split
 * left `color-scheme: light dark` on :root, so the browser painted its own
 * charcoal input boxes inside that white card.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const jsxFiles = (() => {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.jsx$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
  })(path.join(ROOT, "src"));
  return out;
})();

describe("color-scheme is pinned to the rendered theme", () => {
  test("index.css never tells the UA to follow the OS", () => {
    const css = read("src/index.css");
    expect(css).not.toMatch(/color-scheme:\s*light\s+dark/);
    expect(css).toMatch(/:root\.dark\s*\{\s*color-scheme:\s*dark/);
  });

  test("the theme is resolved before the first paint", () => {
    const html = read("index.html");
    expect(html).toMatch(/root\.style\.colorScheme\s*=\s*theme/);
    // A media-scoped theme-color follows the phone and would contradict an
    // explicit in-app choice.
    expect(html).not.toMatch(/theme-color[^>]*media=/);
  });
});

describe("nothing reads the OS preference behind the theme's back", () => {
  test("prefers-color-scheme is confined to the theme layer", () => {
    const allowed = new Set([
      path.join(ROOT, "src", "ThemeContext.jsx"),
    ]);
    const offenders = jsxFiles.filter(
      (f) => !allowed.has(f) && /prefers-color-scheme/.test(fs.readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  test("useDarkMode delegates to the theme context", () => {
    const src = read("src/hooks/useDarkMode.js");
    expect(src).toMatch(/useTheme\(\)\.isDark/);
    expect(src).not.toMatch(/matchMedia/);
  });
});

describe("a gradient is a background IMAGE — dark:bg-<colour> cannot cover it", () => {
  test("every themed gradient also clears itself with dark:bg-none", () => {
    const offenders = [];
    for (const f of jsxFiles) {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (!/bg-gradient-to-[a-z]+/.test(ln)) return;
        if (!/dark:bg-[a-z]/.test(ln)) return; // no dark override at all
        if (/dark:bg-none/.test(ln) || /dark:from-/.test(ln)) return;
        offenders.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("the logo never has to guess what is behind it", () => {
  test("no component picks the lockup from the raw theme flag itself", () => {
    const offenders = jsxFiles.filter((f) => {
      const s = fs.readFileSync(f, "utf8");
      return /VITE_API_APP_LOGO_/.test(s) && !/BrandLogo/.test(s);
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  // Until 2026-08-26 this asserted the OPPOSITE — the two env vars pointed at
  // byte-identical copies of the navy wordmark, so BrandLogo had to draw a
  // white plate behind it on every dark surface. QA asked for that plate to go
  // from the header; the only way to drop it and keep the logo legible on the
  // indigo→blue gradient is a genuine reversed lockup, so one was made.
  test("the dark-surface lockup is a DIFFERENT asset from the light one", () => {
    // If this fails, someone pointed both vars back at the same file. Flip
    // HAS_DARK_ART in BrandLogo.jsx back to false at the same time, or the app
    // paints a navy wordmark straight onto the gradient with nothing behind it.
    const env = read(".env.production");
    const black = env.match(/VITE_API_APP_LOGO_BLACK=(.+)/)[1].trim();
    const white = env.match(/VITE_API_APP_LOGO_WHITE=(.+)/)[1].trim();
    const bytes = (p) => fs.readFileSync(path.join(ROOT, "public", p.replace(/^\//, "")));
    expect(bytes(black).equals(bytes(white))).toBe(false);
  });

  test("every env file agrees on the reversed lockup", () => {
    for (const f of [".env.production", ".env.test", ".env.development", ".env.preprod"]) {
      const m = read(f).match(/VITE_API_APP_LOGO_WHITE=(.+)/);
      expect(m?.[1].trim(), f).toBe("/img/logo-white.png");
    }
  });

  // The bug this whole describe() exists for was a logo that LOOKED switched
  // but wasn't. A path check cannot catch that a second time — only the pixels
  // can. The reversed lockup must actually be light where the original is
  // navy, or the plate has been removed from the header for nothing.
  test("the reversed lockup is genuinely light where the original is navy", async () => {
    const { decode } = await import("fast-png");
    const load = (p) => decode(fs.readFileSync(path.join(ROOT, "public", p)));
    const light = load("img/logo.png");
    const dark = load("img/logo-white.png");
    expect([dark.width, dark.height]).toEqual([light.width, light.height]);

    // Sample only the wordmark half — the brand-red mark is deliberately kept
    // in both, so averaging the whole image would hide a failure.
    const luma = (img) => {
      let sum = 0, n = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = Math.floor(img.width / 2); x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.data[i + 3] < 250) continue;
          sum += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
          n++;
        }
      }
      return n ? sum / n : 0;
    };
    expect(luma(light)).toBeLessThan(64);   // navy wordmark
    expect(luma(dark)).toBeGreaterThan(224); // knocked out to white
  });
});

describe("theme resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  const withMatchMedia = (dark) => {
    globalThis.window = globalThis.window || {};
    window.matchMedia = (q) => ({
      matches: dark && /dark/.test(q),
      addEventListener() {},
      removeEventListener() {},
    });
  };

  test("an unset preference follows the OS instead of freezing on first launch", async () => {
    withMatchMedia(true);
    const { readStoredMode, resolveTheme } = await import("./ThemeContext.jsx");
    expect(readStoredMode()).toBe("system");
    expect(resolveTheme("system")).toBe("dark");
    // Reading the preference must not write one back.
    expect(localStorage.getItem("theme")).toBe(null);
  });

  test("an explicit choice outranks the OS", async () => {
    withMatchMedia(true);
    localStorage.setItem("theme", "light");
    const { readStoredMode, resolveTheme } = await import("./ThemeContext.jsx");
    expect(resolveTheme(readStoredMode())).toBe("light");
  });

  test("a junk stored value falls back to system rather than throwing", async () => {
    withMatchMedia(false);
    localStorage.setItem("theme", "chartreuse");
    const { readStoredMode, resolveTheme } = await import("./ThemeContext.jsx");
    expect(readStoredMode()).toBe("system");
    expect(resolveTheme("system")).toBe("light");
  });
});
