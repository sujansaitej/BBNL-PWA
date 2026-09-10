/**
 * App identity — BBNL, not Fo-Fi.
 *
 * Requested Aug 2026: "Change the app icon/name from FOFI to BBNL."
 *
 * The distinction this file protects: the APPLICATION is BBNL, but "Fo-Fi
 * Smart Box" / "FOFI Box ID" are PRODUCT names for a piece of hardware and
 * must stay. A blanket find-and-replace would have renamed the hardware too.
 */

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("the installed app identifies as BBNL", () => {
  test("index.html title and iOS home-screen label", () => {
    const html = read("index.html");
    expect(html).toMatch(/<title>BBNL CRM<\/title>/);
    expect(html).toMatch(/apple-mobile-web-app-title"\s+content="BBNL CRM"/);
    expect(html).not.toMatch(/Fo-Fi/);
  });

  test("the static manifest names BBNL", () => {
    const m = JSON.parse(read("manifest.webmanifest"));
    expect(m.name).toBe("BBNL CRM");
    expect(m.short_name).toBe("BBNL");
  });

  test("the build-time manifest names BBNL", () => {
    const cfg = read("vite.config.js");
    expect(cfg).toMatch(/name: 'BBNL CRM'/);
    expect(cfg).toMatch(/short_name: 'BBNL'/);
  });

  test("short_name stays one word — launchers ellipsise longer labels", () => {
    const m = JSON.parse(read("manifest.webmanifest"));
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.short_name).not.toMatch(/\s/);
  });

  test("manifest id/scope stay aligned so a rename updates in place", () => {
    // A changed `id` would install a SECOND app next to the existing one
    // instead of renaming it.
    const m = JSON.parse(read("manifest.webmanifest"));
    expect(m.scope).toBe(m.start_url);
  });
});

describe("the install / thank-you screens say BBNL", () => {
  test.each([
    ["src/components/BrowserGate.jsx"],
    ["src/pages/Login.jsx"],
  ])("%s", (file) => {
    const src = read(file);
    expect(src).toMatch(/Install BBNL CRM/);
    expect(src).toMatch(/Thank You for Installing BBNL CRM/);
    expect(src).not.toMatch(/Fo-Fi CRM/);
  });
});

describe("product names are NOT renamed", () => {
  test("the Fo-Fi Smart Box service keeps its name", () => {
    // Renaming this would misname a physical product the operator holds.
    expect(read("src/pages/Services.jsx")).toMatch(/Fo-Fi Smart Box/);
    expect(read("src/components/ui/ServiceSelectionModal.jsx")).toMatch(/Fo-Fi Smart Box/);
  });

  test("the FOFI box id/MAC field labels are untouched", () => {
    const src = read("src/pages/services/FoFiSmartBox.jsx");
    expect(src).toMatch(/FOFI Box Id\*/);
    expect(src).toMatch(/FOFI MAC ID\*/);
  });

  test("the `fofi` wire service key is untouched", () => {
    // Renaming this would break every plandets_/uai_ cache key and payload.
    expect(read("src/constants/services.js")).toMatch(/'voice', 'voice_call', 'voicecall', 'voip'/);
  });
});

describe("icon assets are present at the paths the manifest points to", () => {
  test.each([
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "public/icons/apple-icon-180.png",
    "public/icons/favicon.png",
    "public/icons/logo.png",
    "public/img/logo.png",
  ])("%s exists and is a real PNG", (rel) => {
    const p = path.join(ROOT, rel);
    expect(fs.existsSync(p)).toBe(true);
    const buf = fs.readFileSync(p);
    expect(buf.length).toBeGreaterThan(500);
    // PNG magic number — catches a truncated or half-written file.
    expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("the Fo-Fi originals are kept, so the rename is reversible", () => {
    // These are PLACEHOLDER BBNL icons. When real artwork lands, the old
    // branding should still be recoverable rather than lost to the rename.
    for (const rel of ["public/icons/icon-512-fofi.png", "public/img/logo-fofi.png"]) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });
});
