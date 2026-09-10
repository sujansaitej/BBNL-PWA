/** @vitest-environment jsdom */
/**
 * The logo must be legible against whatever is actually behind it.
 *
 * QA report: "in dark theme logo is not visible in the login". The lockup is a
 * NAVY wordmark and both VITE_API_APP_LOGO_* vars pointed at that same file,
 * so "use the white one in dark mode" was a no-op — the navy art landed on a
 * near-black card. The first fix was a white PLATE behind the wordmark.
 *
 * Aug 2026 QA then asked for that plate to go from the header ("remove the
 * background colour of the BBNL logo"), so a real reversed lockup was made:
 * /img/logo-white.png, wordmark knocked out to white with the brand-red mark
 * kept. BrandLogo now SWAPS THE ART on a dark surface and draws no plate.
 *
 * The rule these tests protect is unchanged and is the point of the component:
 * a dark surface must never receive the navy art. Only the remedy moved, from
 * a plate to a second file. src/theme.test.js checks the pixels of that file;
 * these render the real component in both themes.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import BrandLogo from "./BrandLogo";
import { ThemeProvider } from "../ThemeContext.jsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
});

function renderIn(theme, ui) {
  localStorage.setItem("theme", theme);
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

/** The white chip BrandLogo falls back to when there is no reversed art. */
function plateOf(img) {
  const parent = img.parentElement;
  return parent && /\bbg-white\b/.test(parent.className) ? parent : null;
}

/** Which of the two lockups was served. */
const isReversed = (img) => /logo-white\.png$/.test(img.getAttribute("src") || "");

describe("BrandLogo on a theme-driven surface", () => {
  test("light theme: the navy wordmark, bare, on a white card", () => {
    renderIn("light", <BrandLogo alt="App Logo" />);
    const img = screen.getByAltText("App Logo");
    expect(isReversed(img)).toBe(false);
    expect(plateOf(img)).toBeNull();
  });

  test("dark theme: the reversed lockup is served, and bare — no chip behind it", () => {
    renderIn("dark", <BrandLogo alt="App Logo" />);
    const img = screen.getByAltText("App Logo");
    expect(isReversed(img)).toBe(true);
    expect(plateOf(img)).toBeNull();
  });
});

describe("BrandLogo on a surface that does not follow the theme", () => {
  test("a fixed gradient gets the reversed lockup in LIGHT theme too", () => {
    // The auth background and the header bar are an indigo gradient in both
    // themes. Reading the theme here is what would put a navy wordmark on
    // indigo the moment the operator switched to light mode.
    renderIn("light", <BrandLogo onDark alt="Gradient Logo" />);
    const img = screen.getByAltText("Gradient Logo");
    expect(isReversed(img)).toBe(true);
    expect(plateOf(img)).toBeNull();
  });

  test("an explicitly light surface keeps the navy art, even in dark theme", () => {
    renderIn("dark", <BrandLogo onDark={false} alt="Light Surface Logo" />);
    const img = screen.getByAltText("Light Surface Logo");
    expect(isReversed(img)).toBe(false);
    expect(plateOf(img)).toBeNull();
  });
});

describe("the theme drives the document, not just React", () => {
  test("dark theme pins the UA colour-scheme so it cannot paint light widgets", () => {
    renderIn("dark", <BrandLogo />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  test("light theme pins it the other way", () => {
    renderIn("light", <BrandLogo />);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
