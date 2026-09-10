/**
 * iOS safe-area insets — a source-level guard.
 *
 * Reported Aug 2026: "content cut off top/bottom on iPhone".
 *
 * index.html ships `viewport-fit=cover` together with
 * `apple-mobile-web-app-status-bar-style: black-translucent`. In an installed
 * iOS PWA that combination means the web view is laid out from y=0 — under the
 * status bar and notch — and runs to the very bottom, under the home
 * indicator. iOS reserves nothing. Android reports 0 for both insets, which is
 * exactly why this only ever reproduced on iPhone.
 *
 * Every screen therefore has to pay the insets itself. This is asserted at the
 * SOURCE level rather than by rendering, because the failure is a missing
 * class on a container — jsdom has no notion of env(safe-area-inset-*), so a
 * render test could not tell a fixed screen from a broken one.
 */

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SRC, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("the viewport contract these fixes depend on", () => {
  const html = read("index.html");

  test("viewport-fit=cover is set — without it env(safe-area-inset-*) is always 0", () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });

  test("the status bar is black-translucent, so the app owns the top inset", () => {
    // If this ever changes to `default`/`black`, iOS reserves the status bar
    // itself and the .pt-safe paddings become redundant (harmless, but the
    // reasoning below no longer applies — update the comments).
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/);
  });
});

describe("index.css defines the inset utilities", () => {
  const css = read("src/index.css");

  test("the safe-area custom properties exist", () => {
    for (const token of ["--safe-top", "--safe-bottom", "--safe-left", "--safe-right"]) {
      expect(css).toContain(`${token}: env(safe-area-inset-`);
    }
  });

  test(".pt-safe / .pb-safe keep a 1rem floor on top of the inset", () => {
    // They are emitted after `@tailwind utilities`, so they BEAT a p-4 on the
    // same element. A bare inset would therefore delete a screen's normal
    // padding on Android, where both insets are 0.
    expect(css).toMatch(/\.pt-safe\s*\{\s*padding-top:\s*calc\(1rem \+ var\(--safe-top\)\)/);
    expect(css).toMatch(/\.pb-safe\s*\{\s*padding-bottom:\s*calc\(1rem \+ var\(--safe-bottom\)\)/);
  });

  test("pb-bottomnav still clears the nav AND the home indicator", () => {
    expect(css).toMatch(/\.pb-bottomnav\s*\{\s*padding-bottom:\s*calc\(5rem \+ env\(safe-area-inset-bottom/);
  });
});

describe("the header-less screens pay the top inset", () => {
  // These render no app Header, so nothing else pays it for them. VerifyOTP is
  // the worst case: it is TOP-aligned, and its p-4 gave 16px where an iPhone
  // notch needs ~47-59px, so the heading was clipped.
  const cases = [
    ["src/pages/VerifyOTP.jsx", "OTP entry"],
    ["src/pages/Login.jsx", "login / install instructions"],
    ["src/components/BrowserGate.jsx", "install gate"],
    ["src/components/ErrorBoundary.jsx", "crash + recovery screens"],
    ["src/routes/Routes.jsx", "lazy-chunk PageLoader"],
  ];

  test.each(cases)("%s (%s) uses pt-safe", (file) => {
    const src = read(file);
    const roots = src.match(/className="[^"]*min-h-dvh[^"]*"/g) || [];
    expect(roots.length).toBeGreaterThan(0);
    for (const cls of roots) {
      expect(cls).toMatch(/\bpt-safe\b/);
    }
  });
});

describe("full-height page roots pay the bottom inset", () => {
  // Every screen that owns its own chrome instead of sitting inside <Layout>.
  const FILES = [
    "src/pages/Profile.jsx",
    "src/pages/Services.jsx",
    "src/pages/Tickets.jsx",
    "src/pages/PaymentHistory.jsx",
    "src/pages/OrderDetail.jsx",
    "src/pages/VoicePayment.jsx",
    "src/pages/UploadDocuments.jsx",
    "src/pages/services/VoiceService.jsx",
    "src/pages/services/InternetService.jsx",
    "src/pages/services/IPTVService.jsx",
    "src/pages/services/FoFiSmartBox.jsx",
    "src/pages/ont/FleetDashboard.jsx",
    "src/pages/ont/OntDevice.jsx",
    "src/components/iptv/DataUsage.jsx",
    "src/components/iptv/ResetMac.jsx",
    "src/components/iptv/ResetPassword.jsx",
    "src/components/iptv/ResetPPPoE.jsx",
  ];

  test.each(FILES)("%s", (file) => {
    const src = read(file);
    const roots = src.match(/className="[^"]*min-h-dvh[^"]*"/g) || [];
    expect(roots.length).toBeGreaterThan(0);
    for (const cls of roots) {
      expect(cls).toMatch(/\bpb-safe\b/);
    }
  });

  test("Layout's <main> pays it too when the bottom nav is hidden", () => {
    const src = read("src/layout/Layout.jsx");
    expect(src).toMatch(/hideBottomNav \? 'pb-bottomnav' : 'pb-safe'/);
  });

  test("screens INSIDE <Layout> do not double-pay the inset", () => {
    // Layout's <main> already pays it; an inner min-h-dvh with pb-safe as well
    // stacked ~100px of dead space at the bottom of the payment screens.
    for (const file of ["src/pages/Paynow.jsx", "src/pages/FofiPayment.jsx"]) {
      const src = read(file);
      expect(src).toMatch(/<Layout/);
      const roots = src.match(/className="[^"]*min-h-dvh[^"]*"/g) || [];
      for (const cls of roots) {
        expect(cls).not.toMatch(/\bpb-safe\b/);
      }
    }
  });
});

describe("the chrome that was already correct stays correct", () => {
  test("Header pays the top inset with a max() floor", () => {
    expect(read("src/components/Header.jsx")).toMatch(
      /paddingTop: 'max\(0\.75rem, env\(safe-area-inset-top/
    );
  });

  test("BottomNav pays the bottom inset with a max() floor", () => {
    const src = read("src/components/BottomNav.jsx");
    const matches = src.match(/paddingBottom: 'max\(0\.5rem, env\(safe-area-inset-bottom/g) || [];
    // One for the operator nav, one for the customer nav.
    expect(matches.length).toBe(2);
  });
});
