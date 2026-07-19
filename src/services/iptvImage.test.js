/**
 * iptvImage.fetchImage — header selection per destination host.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * fetchImage had no test coverage, and it is the single choke point for every
 * channel logo, language logo and ad image. The rule it encodes is easy to
 * break by "tidying" the header object:
 *
 *   external CDN (cdn1.bbnl.in) → NO custom headers, ever
 *   netmon / everything else    → X-App-Package (+ auth in prod)
 *
 * The CDN case matters because ANY custom header makes the cross-origin
 * request non-simple, which forces a CORS preflight. cdn1.bbnl.in is plain
 * nginx: it answers OPTIONS with 405 and sends no Access-Control-Allow-Origin,
 * so a preflighted request can never succeed.
 *
 * The netmon case matters more: those images genuinely REQUIRE auth. If a
 * refactor ever widens the "external" branch to cover netmon URLs, logos on
 * the production server would start 401ing. That is the regression this file
 * is really guarding.
 *
 * Note fetchImage only builds headers — it never rewrites the URL. URL
 * construction lives in proxyImageUrl and is deliberately not touched here.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

const CDN = "https://cdn1.bbnl.in/cable";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_IPTV_IMAGE_CDN", CDN);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/prod/");
vi.stubEnv("VITE_IPTV_API_BASE_URL", "https://test.example/prod/Cabletvapis");
vi.stubEnv("VITE_IPTV_API_USERNAME", "iptvuser");
vi.stubEnv("VITE_IPTV_API_PASSWORD", "iptvpass");
vi.stubEnv("VITE_IPTV_API_AUTH_KEY", "IPTV_KEY");

let fetchMock;

function lastHeaders() {
  const [, opts] = fetchMock.mock.calls.at(-1);
  return opts?.headers || {};
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchImage — external CDN", () => {
  test("sends NO custom headers, so the request stays CORS-simple", async () => {
    const { fetchImage } = await import("./iptvImage.js");
    await fetchImage(`${CDN}/star-plus.png`);

    const h = lastHeaders();
    // Any one of these would trigger a preflight the CDN answers with 405.
    expect(h["X-App-Package"]).toBeUndefined();
    expect(h.Authorization).toBeUndefined();
    expect(h["x-api-key"]).toBeUndefined();
    expect(Object.keys(h)).toHaveLength(0);
  });

  test("still forwards caller-supplied options (signal is wired up)", async () => {
    const { fetchImage } = await import("./iptvImage.js");
    await fetchImage(`${CDN}/logo.png`);
    const [url, opts] = fetchMock.mock.calls.at(-1);
    expect(url).toBe(`${CDN}/logo.png`);
    expect(opts.signal).toBeDefined();   // timeout AbortController
  });
});

describe("fetchImage — production server (NOT the CDN)", () => {
  test("still sends X-App-Package AND auth — these images require it", async () => {
    const { fetchImage } = await import("./iptvImage.js");
    await fetchImage("https://test.example/prod/Cabletvapis/showimage/logo.png");

    const h = lastHeaders();
    expect(h["X-App-Package"]).toBe("com.bbnl.smartphone");
    expect(h.Authorization).toBe("Basic " + btoa("iptvuser:iptvpass"));
    expect(h["x-api-key"]).toBe("IPTV_KEY");
  });

  test("a URL that merely CONTAINS the CDN string is not treated as the CDN", async () => {
    const { fetchImage } = await import("./iptvImage.js");
    // startsWith, not includes — a netmon URL carrying the CDN as a query
    // param must keep its auth headers.
    await fetchImage(`https://test.example/prod/proxy?src=${CDN}/logo.png`);
    expect(lastHeaders()["X-App-Package"]).toBe("com.bbnl.smartphone");
  });
});

describe("fetchImage — when no CDN is configured (dev/test)", () => {
  test("every request keeps X-App-Package, so dev behaviour is unchanged", async () => {
    // VITE_IPTV_IMAGE_CDN is set ONLY in .env.production, so this is the
    // shape dev and test builds actually run with.
    vi.stubEnv("VITE_IPTV_IMAGE_CDN", "");
    vi.resetModules();

    const { fetchImage } = await import("./iptvImage.js");
    await fetchImage("https://cdn1.bbnl.in/cable/logo.png");

    // isExternalCdn is falsy without a configured CDN → headers unchanged.
    expect(lastHeaders()["X-App-Package"]).toBe("com.bbnl.smartphone");

    vi.stubEnv("VITE_IPTV_IMAGE_CDN", CDN);
  });
});
