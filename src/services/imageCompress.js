/**
 * Client-side image downscale + re-encode, before upload.
 *
 * PARITY: Android runs every profile photo through
 * `ImageProcessing.compressImageFile()` → `new Compressor(ctx).compressToFile(file)`
 * (id.zelory:compressor:2.1.0, app/build.gradle:192). That library's defaults are
 * the constants below — 612×816 bounding box, JPEG, quality 80 — so a 4000×3000
 * camera original leaves the phone as roughly 40-80 KB.
 *
 * The PWA was sending the ORIGINAL file. That is the difference behind both
 * symptoms QA photographed:
 *
 *   - "Unable to complete previous operation due to low memory" — Chrome's own
 *     system toast, not ours. Android kills the renderer under memory pressure
 *     while the camera app is foregrounded; handing a multi-megabyte blob
 *     straight into a multipart body on return makes that far likelier on the
 *     low-tier phones this app targets.
 *   - The 5 MB ceiling. `custom_helper.php::fileUpload` sets
 *     `$config['max_size'] = '5120'`, and the PWA had a matching client-side
 *     reject. A modern phone camera clears 5 MB routinely, so the customer was
 *     simply told "choose an image under 5 MB" for an ordinary photo. After
 *     compression nothing gets near the limit and the ceiling stops mattering.
 *
 * MEMORY DISCIPLINE MATTERS HERE. This runs on phones that are already under
 * pressure. `createImageBitmap` with resize options decodes straight to the
 * target size without ever materialising the full-resolution bitmap, which is
 * the whole point on a 12 MP input; the <img> fallback cannot avoid that, so it
 * is only used where the fast path is unavailable. Every path frees the bitmap,
 * the object URL and the canvas backing store explicitly rather than waiting
 * for GC.
 */

import logger from "../utils/logger";

/** id.zelory:compressor 2.1.0 defaults — keep in step with Android. */
export const MAX_WIDTH = 612;
export const MAX_HEIGHT = 816;
export const QUALITY = 0.8;

/**
 * Refuse to even decode something absurd. This is not the upload limit — after
 * compression the result is tens of KB regardless — it is a guard against
 * spending a low-memory device's remaining headroom decoding a file that was
 * never a photo.
 */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Ceiling on the <img> decode fallback — see the note in decode(). */
export const DECODE_TIMEOUT_MS = 15000;

/**
 * Scale (w,h) to fit inside (maxW,maxH), preserving aspect ratio.
 * NEVER upscales — a 200×200 avatar stays 200×200 rather than being blown up
 * to 612 and re-encoded into something blurrier and larger than the original.
 */
export function fitWithin(w, h, maxW = MAX_WIDTH, maxH = MAX_HEIGHT) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Swap any extension for .jpg — the output is always JPEG, whatever went in. */
export function toJpegName(name) {
  const base = String(name || "photo").replace(/\.[^./\\]+$/, "").trim();
  return `${base || "photo"}.jpg`;
}

/** Decode to a bitmap at (or near) the target size, cheaply where possible. */
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      // Probe the intrinsic size first so the resize can preserve aspect ratio.
      const probe = await createImageBitmap(file);
      const { width, height } = fitWithin(probe.width, probe.height);
      if (width === probe.width && height === probe.height) return probe;
      try {
        const sized = await createImageBitmap(file, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "high",
        });
        return sized;
      } finally {
        probe.close?.();
      }
    } catch (_e) {
      // Safari < 15 and some Android builds reject the options bag, and no
      // browser can decode HEIC here. Fall through.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      // BOUNDED. An <img> is not guaranteed to fire either handler — a revoked
      // object URL, a decoder that gives up quietly, or a detached document all
      // leave it silent. Without this the promise never settles, and the caller
      // (Profile.jsx) is left with its upload spinner running and no way out.
      const timer = setTimeout(() => {
        el.onload = el.onerror = null;
        el.src = "";
        reject(new Error("decode timed out"));
      }, DECODE_TIMEOUT_MS);
      el.onload = () => { clearTimeout(timer); resolve(el); };
      el.onerror = () => { clearTimeout(timer); reject(new Error("decode failed")); };
      el.src = url;
    });
    if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) {
      throw new Error("decode produced no pixels");
    }
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale and re-encode an image file as JPEG.
 *
 * @param {File|Blob} file
 * @returns {Promise<File>} a JPEG File, or the ORIGINAL file when it is already
 *   small enough that re-encoding would only lose quality.
 * @throws {Error} with a customer-readable message when the image cannot be
 *   decoded at all (HEIC on Chrome, a corrupt file, a non-image).
 */
export async function compressImage(file) {
  if (!file) throw new Error("No image selected.");
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("That image is too large to process. Please choose a smaller one.");
  }

  let source;
  try {
    source = await decode(file);
  } catch (_e) {
    logger.warn("imageCompress", "could not decode picked image", {
      type: file.type, size: file.size,
    });
    throw new Error("That image format isn't supported. Please choose a JPG or PNG photo.");
  }

  const sw = source.width;
  const sh = source.height;
  const { width, height } = fitWithin(sw, sh);

  // Already inside the box AND already a modest JPEG — re-encoding would only
  // throw away quality for no size win.
  if (width === sw && height === sh && file.type === "image/jpeg" && file.size <= 300 * 1024) {
    source.close?.();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  // JPEG has no alpha; without this a transparent PNG composites onto black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  source.close?.();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY)
  );

  // Release the backing store now rather than at the next GC — on a phone
  // already short of memory that gap is the whole problem.
  canvas.width = 0;
  canvas.height = 0;

  if (!blob) throw new Error("Could not process that image. Please try another photo.");

  const out = new File([blob], toJpegName(file.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
  logger.debug("imageCompress", `${sw}x${sh} ${file.size}B → ${width}x${height} ${out.size}B`);
  return out;
}
