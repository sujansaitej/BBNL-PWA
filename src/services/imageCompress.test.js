/** @vitest-environment jsdom */
/**
 * Profile-photo compression — parity with Android's Zelory Compressor.
 *
 * QA, Aug 2026, with photos: profile upload showed Chrome's "Unable to complete
 * previous operation due to low memory" and the backend's 5 MB rejection, while
 * the Android app updated the photo fine. Android compresses first
 * (id.zelory:compressor 2.1.0 — 612x816, JPEG q80); the PWA sent the original.
 * These pin the geometry so that never silently drifts back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fitWithin,
  toJpegName,
  compressImage,
  MAX_WIDTH,
  MAX_HEIGHT,
  QUALITY,
  MAX_INPUT_BYTES,
  DECODE_TIMEOUT_MS,
} from "./imageCompress.js";

describe("Android parity constants", () => {
  it("matches id.zelory:compressor 2.1.0 defaults", () => {
    expect(MAX_WIDTH).toBe(612);
    expect(MAX_HEIGHT).toBe(816);
    expect(QUALITY).toBe(0.8);
  });
});

describe("fitWithin", () => {
  it("scales a portrait camera original into the box", () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 612, height: 816 });
  });

  it("scales a landscape original by the binding edge, keeping aspect", () => {
    // 4000x3000 → width binds (612/4000 < 816/3000)
    expect(fitWithin(4000, 3000)).toEqual({ width: 612, height: 459 });
  });

  it("NEVER upscales — a small avatar is left alone", () => {
    expect(fitWithin(200, 200)).toEqual({ width: 200, height: 200 });
    expect(fitWithin(100, 50)).toEqual({ width: 100, height: 50 });
  });

  it("never rounds an edge down to zero", () => {
    const { width, height } = fitWithin(10000, 3);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("is degenerate-input safe", () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, NaN)).toEqual({ width: 0, height: 0 });
  });
});

describe("toJpegName", () => {
  it("rewrites the extension, because the backend derives the stored one from it", () => {
    // CustomerProfilePhoto.php: pathinfo($fn)['extension'] → profile-<user>.<ext>
    expect(toJpegName("IMG_20260828_173700.png")).toBe("IMG_20260828_173700.jpg");
    expect(toJpegName("photo.jpeg")).toBe("photo.jpg");
    expect(toJpegName("holiday.snap.HEIC")).toBe("holiday.snap.jpg");
  });
  it("copes with no extension and no name", () => {
    expect(toJpegName("scan")).toBe("scan.jpg");
    expect(toJpegName("")).toBe("photo.jpg");
    expect(toJpegName(undefined)).toBe("photo.jpg");
  });
});

describe("compressImage guards", () => {
  it("rejects nothing-selected", async () => {
    await expect(compressImage(null)).rejects.toThrow(/No image/i);
  });

  it("refuses to decode an absurd input rather than spend the memory", async () => {
    const huge = new File([new Uint8Array(8)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: MAX_INPUT_BYTES + 1 });
    await expect(compressImage(huge)).rejects.toThrow(/too large to process/i);
  });

  it("reports an undecodable file (HEIC on Chrome) as a format problem", async () => {
    // jsdom implements neither createImageBitmap nor real <img> decoding, and
    // it fires NEITHER onload nor onerror — the exact silent-decoder case the
    // DECODE_TIMEOUT_MS guard exists for. Without it this hangs forever and the
    // upload spinner never stops.
    vi.useFakeTimers();
    try {
      const heic = new File([new Uint8Array(4)], "IMG_0001.HEIC", { type: "image/heic" });
      const p = compressImage(heic);
      const assertion = expect(p).rejects.toThrow(/isn't supported|JPG or PNG/i);
      await vi.advanceTimersByTimeAsync(DECODE_TIMEOUT_MS + 10);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("compressImage happy path", () => {
  let created;
  beforeEach(() => {
    created = [];
    // Stand in for the browser's decoder: report a 12 MP portrait original.
    vi.stubGlobal("createImageBitmap", vi.fn(async (_blob, opts) => {
      const bmp = {
        width: opts?.resizeWidth ?? 3000,
        height: opts?.resizeHeight ?? 4000,
        close: vi.fn(),
      };
      created.push(bmp);
      return bmp;
    }));
    // jsdom's canvas has no 2d context or toBlob.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(),
    });
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob([new Uint8Array(50 * 1024)], { type: "image/jpeg" }));
    };
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const original = () => {
    const f = new File([new Uint8Array(16)], "IMG_20260828.jpg", { type: "image/jpeg" });
    Object.defineProperty(f, "size", { value: 6 * 1024 * 1024 }); // over the 5 MB backend cap
    return f;
  };

  it("asks the decoder to resize to the Android box (no full-res bitmap)", async () => {
    await compressImage(original());
    const opts = createImageBitmap.mock.calls.find((c) => c[1])?.[1];
    expect(opts).toMatchObject({ resizeWidth: 612, resizeHeight: 816, resizeQuality: "high" });
  });

  it("returns a JPEG well under the backend's 5 MB max_size", async () => {
    const out = await compressImage(original());
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("IMG_20260828.jpg");
    expect(out.size).toBeLessThan(5 * 1024 * 1024);
  });

  it("frees every bitmap it decodes", async () => {
    await compressImage(original());
    expect(created.length).toBeGreaterThan(0);
    for (const b of created) expect(b.close).toHaveBeenCalled();
  });

  it("passes a small JPEG through untouched instead of re-encoding it", async () => {
    createImageBitmap.mockImplementation(async () => ({ width: 300, height: 300, close: vi.fn() }));
    const small = new File([new Uint8Array(1024)], "avatar.jpg", { type: "image/jpeg" });
    const out = await compressImage(small);
    expect(out).toBe(small);
  });
});
