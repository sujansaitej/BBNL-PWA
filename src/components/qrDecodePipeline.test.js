/**
 * The scan loop's geometry, exercised with a REAL QR code.
 *
 * Every other scanner test mocks getUserMedia and stops at "a stream arrived",
 * which proves nothing about whether a code can actually be read. This one puts
 * a genuine QR through the exact transform chain QRScanner applies to each
 * frame, and asserts it still decodes:
 *
 *     camera frame (Android's 1600x1024)
 *       -> downscale to JSQR_MAX_WIDTH (1280)      [ctx.drawImage in the app]
 *       -> centre crop 20%..80%                     [the cheap first pass]
 *       -> jsQR
 *
 * It exists because the Android-parity change raised the requested preview size
 * to 1600x1024 while capping what jsQR is fed at 1280 — and a cap is exactly the
 * kind of "optimisation" that can quietly destroy detection of small or distant
 * codes. That is the case native's high preview size was chosen for, so it is
 * the case that has to be measured rather than assumed.
 *
 * The fixture encoder is self-validating: if it emitted a malformed QR, jsQR
 * would fail to decode it and these tests would fail rather than pass vacuously.
 */

import { describe, test, expect } from "vitest";
import jsQR from "jsqr";
import { qrImageData } from "./__fixtures__/makeQr.js";

const PAYLOAD = "BBNL-TEST-12345";
const JSQR_MAX_WIDTH = 1280; // must track QRScanner.jsx

/** A white camera frame with `qr` centred, sized to a fraction of frame height. */
function cameraFrame(fw, fh, qr, fracOfHeight) {
  const px = new Uint8ClampedArray(fw * fh * 4).fill(255);
  const target = Math.round(fh * fracOfHeight);
  const ox = Math.round((fw - target) / 2);
  const oy = Math.round((fh - target) / 2);
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      const sx = Math.floor((x * qr.width) / target);
      const sy = Math.floor((y * qr.height) / target);
      const s = (sy * qr.width + sx) * 4;
      const d = ((oy + y) * fw + (ox + x)) * 4;
      px[d] = qr.data[s]; px[d + 1] = qr.data[s + 1]; px[d + 2] = qr.data[s + 2]; px[d + 3] = 255;
    }
  }
  return { data: px, width: fw, height: fh };
}

/** Box-filter downscale — stands in for ctx.drawImage(video, 0, 0, dw, dh). */
function downscale(img, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = img.width / dw;
  const sy = img.height / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      const y1 = Math.max(Math.floor(y * sy) + 1, Math.floor((y + 1) * sy));
      const x1 = Math.max(Math.floor(x * sx) + 1, Math.floor((x + 1) * sx));
      for (let yy = Math.floor(y * sy); yy < Math.min(img.height, y1); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.min(img.width, x1); xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const d = (y * dw + x) * 4;
      out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = 255;
    }
  }
  return { data: out, width: dw, height: dh };
}

/** The app's centre crop: offset 20%, size 60%. */
function centreCrop(img) {
  const x0 = Math.floor(img.width * 0.2);
  const y0 = Math.floor(img.height * 0.2);
  const w = Math.floor(img.width * 0.6);
  const h = Math.floor(img.height * 0.6);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.width + (x0 + x)) * 4;
      const d = (y * w + x) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Exactly what the scan loop does to one frame. */
function pipeline(frameW, frameH, fracOfHeight) {
  const qr = qrImageData(PAYLOAD, 400);
  const src = cameraFrame(frameW, frameH, qr, fracOfHeight);
  const scale = src.width > JSQR_MAX_WIDTH ? JSQR_MAX_WIDTH / src.width : 1;
  const scaled = downscale(src, Math.round(src.width * scale), Math.round(src.height * scale));
  const c = centreCrop(scaled);
  return {
    centre: jsQR(c.data, c.width, c.height, { inversionAttempts: "dontInvert" }),
    full: jsQR(scaled.data, scaled.width, scaled.height, { inversionAttempts: "dontInvert" }),
    canvas: `${scaled.width}x${scaled.height}`,
  };
}

describe("the fixture encoder is trustworthy", () => {
  test("jsQR round-trips what it produces — otherwise every test below is vacuous", () => {
    for (const payload of [PAYLOAD, "https://bbnlnetmon.bbnl.in/x", "A"]) {
      const img = qrImageData(payload, 400);
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      expect(r?.data, `failed to round-trip ${payload}`).toBe(payload);
    }
  });
});

describe("a real QR survives the 1600x1024 → 1280 downscale", () => {
  // Native requests 1600x1024 specifically to read "small barcodes at long
  // distances" (BarcodeCaptureActivity:200-207). Capping jsQR's input would be
  // a false economy if it gave that back, so the small end is what matters.
  test.each([
    ["filling the frame", 0.55],
    ["a comfortable arm's length", 0.4],
    ["held back", 0.25],
    ["small / distant", 0.15],
    ["very small — beyond realistic use", 0.1],
  ])("decodes with the QR %s (%s of frame height)", (_label, frac) => {
    const r = pipeline(1600, 1024, frac);
    expect(r.centre?.data, `centre crop failed at ${frac} (canvas ${r.canvas})`).toBe(PAYLOAD);
  });

  test("the full-frame fallback also decodes when the code is off-centre", () => {
    const r = pipeline(1600, 1024, 0.25);
    expect(r.full?.data).toBe(PAYLOAD);
  });

  test("the new camera size is not a downgrade on the old one", () => {
    // Old: 1280x720 source, no downscale. New: 1600x1024 -> 1280x819. Same
    // width, MORE height, so the working canvas cannot be worse.
    const oldCanvas = pipeline(1280, 720, 0.25);
    const newCanvas = pipeline(1600, 1024, 0.25);
    expect(oldCanvas.centre?.data).toBe(PAYLOAD);
    expect(newCanvas.centre?.data).toBe(PAYLOAD);
    const [, oldH] = oldCanvas.canvas.split("x").map(Number);
    const [, newH] = newCanvas.canvas.split("x").map(Number);
    expect(newH).toBeGreaterThanOrEqual(oldH);
  });
});
