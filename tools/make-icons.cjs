/**
 * make-icons — regenerate the PWA icon set from the BBNL master logo.
 *
 * Usage: node tools/make-icons.cjs [--src public/icons/image.png] [--dry]
 *
 * PROVENANCE: the client's official logo is bbnlnetmon.bbnl.in/prod/assets/
 * site_images/logo.jpg, kept verbatim at public/icons/brand-logo-official.jpg.
 * That file is only 240x60 (its mark is 55x50px), far too small to source a
 * 512px icon from, so public/icons/image.png keeps the lossless 2134x478
 * geometry and carries the official colourway: navy #0F1E3E wordmark, red
 * #ED1847 mark. Re-derive from the JPEG only if a higher-res original arrives.
 *
 * WHY THIS IS HAND-ROLLED: the repo has no image library (no sharp/jimp/canvas)
 * and adding one for a once-per-rebrand task is not worth the install. PNG is
 * just zlib plus a per-scanline filter byte, and Node ships zlib, so decode and
 * encode are ~120 lines with no dependency at all.
 *
 * WHAT IT PRODUCES, AND WHY NOT JUST "THE LOGO" EVERYWHERE
 * -------------------------------------------------------
 * The master is a 2134x478 lockup: a red swoosh mark, then "BBNL" in NAVY
 * (#0F1E3E), on transparency. Two facts drive every decision below.
 *   1. It is 4.5:1. Fitted whole into a 192x192 tile it occupies ~22% of the
 *      height and is illegible at home-screen size.
 *   2. Even with a legible navy wordmark, a 4.5:1 lockup in a square tile is a
 *      thin sliver in a sea of empty padding at 48px. App icons are marks.
 * So:
 *   icon-192 / icon-512 / apple-icon-180 / favicon
 *        -> the MARK alone, centred on white. It is the part of the lockup that
 *           survives at 48px, and red-on-white has the contrast the wordmark
 *           cannot. Padded to keep the mark inside the maskable safe zone
 *           (Android crops these to a circle/squircle).
 *   logo.png
 *        -> the FULL lockup, trimmed, transparency preserved. The wordmark is
 *           NAVY, so every surface it renders on must be light: Login and
 *           BrowserGate put it on a white chip (they sit on a blue/indigo
 *           gradient). Do not render this bare on a dark background.
 *
 * Existing files are backed up to public/icons/backup-prebbnl/ on first run.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const ICONS = path.join(ROOT, "public", "icons");
const argv = process.argv.slice(2);
const argOf = (f, d) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const SRC = path.resolve(ROOT, argOf("--src", "public/icons/image.png"));
const DRY = argv.includes("--dry");

// ── PNG decode (colour type 6/2, bit depth 8, non-interlaced) ─────────
function decodePng(buf) {
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
    throw new Error("not a PNG");
  }
  let pos = 8, width = 0, height = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`colour type ${colorType} not supported`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    // Reverse the per-scanline filter (PNG spec 9.2).
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;  // left
      const b = prev[i];                                  // up
      const c = i >= channels ? prev[i - channels] : 0;   // upper-left
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

// ── PNG encode (RGBA, filter 0) ───────────────────────────────────────
function encodePng({ width, height, data }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: None
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// ── helpers ───────────────────────────────────────────────────────────
const px = (img, x, y) => (y * img.width + x) * 4;

/** Tightest box containing pixels with alpha above `minA`. */
function opaqueBounds(img, minA = 8, x0 = 0, x1 = img.width) {
  let top = img.height, left = img.width, right = -1, bottom = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = x0; x < x1; x++) {
      if (img.data[px(img, x, y) + 3] > minA) {
        if (x < left) left = x; if (x > right) right = x;
        if (y < top) top = y; if (y > bottom) bottom = y;
      }
    }
  }
  return { left, top, right, bottom, w: right - left + 1, h: bottom - top + 1 };
}

function crop(img, { left, top, w, h }) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    img.data.copy(out, y * w * 4, px(img, left, top + y), px(img, left, top + y) + w * 4);
  }
  return { width: w, height: h, data: out };
}

/** Area-average downscale — the source is ~10x the target, so a box filter
 *  is both correct and cheap; nearest-neighbour would alias the swoosh badly. */
function resize(img, tw, th) {
  const out = Buffer.alloc(tw * th * 4);
  const sx = img.width / tw, sy = img.height / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      // Accumulate colour PREMULTIPLIED by alpha, or fully transparent pixels
      // (whose RGB is arbitrary, often black) drag the average toward black
      // and leave a dark fringe around the mark's antialiased edge.
      let r = 0, g = 0, b = 0, alphaSum = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = px(img, xx, yy), al = img.data[i + 3] / 255;
          r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al;
          alphaSum += al; n++;
        }
      }
      // Un-premultiply by the alpha WEIGHT (not the pixel count) to recover a
      // straight-alpha colour; the average alpha is the coverage.
      const d = (y * tw + x) * 4;
      const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
      if (alphaSum > 0) {
        out[d] = clamp(r / alphaSum);
        out[d + 1] = clamp(g / alphaSum);
        out[d + 2] = clamp(b / alphaSum);
      } // else leave RGB at 0 — alpha is 0, so the colour is never sampled
      out[d + 3] = clamp((alphaSum / n) * 255);
    }
  }
  return { width: tw, height: th, data: out };
}

/** Composite `img` centred on a solid square canvas, scaled to `inset` of it. */
function square(img, size, bg, inset) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = bg[0]; canvas[i * 4 + 1] = bg[1];
    canvas[i * 4 + 2] = bg[2]; canvas[i * 4 + 3] = bg[3];
  }
  const box = Math.round(size * inset);
  const scale = Math.min(box / img.width, box / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const small = resize(img, w, h);
  const ox = Math.round((size - w) / 2), oy = Math.round((size - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = ((oy + y) * size + (ox + x)) * 4;
      const a = small.data[s + 3] / 255;
      canvas[d] = Math.round(small.data[s] * a + canvas[d] * (1 - a));
      canvas[d + 1] = Math.round(small.data[s + 1] * a + canvas[d + 1] * (1 - a));
      canvas[d + 2] = Math.round(small.data[s + 2] * a + canvas[d + 2] * (1 - a));
      canvas[d + 3] = Math.round(255 * a + canvas[d + 3] * (1 - a));
    }
  }
  return { width: size, height: size, data: canvas };
}

// ── run ───────────────────────────────────────────────────────────────
const master = decodePng(fs.readFileSync(SRC));
console.log(`source ${path.relative(ROOT, SRC)} — ${master.width}x${master.height}`);

const full = opaqueBounds(master);
console.log(`lockup bounds: x ${full.left}..${full.right}, y ${full.top}..${full.bottom}`);

// Split mark from wordmark by finding the first fully-empty column gutter
// after the mark. Scanning columns beats hardcoding a pixel offset, which
// would silently mis-crop if the master is ever re-exported at a new size.
const colHas = [];
for (let x = 0; x < master.width; x++) {
  let hit = false;
  for (let y = 0; y < master.height && !hit; y++) if (master.data[px(master, x, y) + 3] > 8) hit = true;
  colHas.push(hit);
}
let gutter = -1;
for (let x = full.left + 10; x < full.right; x++) {
  if (!colHas[x]) {
    let run = 0;
    while (x + run < master.width && !colHas[x + run]) run++;
    if (run >= Math.round(master.width * 0.01)) { gutter = x; break; }
    x += run;
  }
}
if (gutter === -1) throw new Error("could not separate the mark from the wordmark");
console.log(`mark/wordmark gutter at x=${gutter}`);

const markBox = opaqueBounds(master, 8, full.left, gutter);
const mark = crop(master, markBox);
console.log(`mark: ${mark.width}x${mark.height}`);

// Sanity: the mark must actually be the red swoosh, not a stray artefact.
let rs = 0, gs = 0, bs = 0, n = 0;
for (let i = 0; i < mark.width * mark.height; i++) {
  if (mark.data[i * 4 + 3] > 128) { rs += mark.data[i * 4]; gs += mark.data[i * 4 + 1]; bs += mark.data[i * 4 + 2]; n++; }
}
const avg = [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)];
console.log(`mark average colour rgb(${avg.join(",")})`);
if (!(avg[0] > 120 && avg[0] > avg[1] + 40 && avg[0] > avg[2] + 40)) {
  throw new Error(`expected a red mark, got rgb(${avg.join(",")}) — check --src`);
}

const lockup = crop(master, full);
const WHITE = [255, 255, 255, 255];
// The TEST build ships its own icons so the two installed PWAs are
// distinguishable on a home screen (vite.config.js:114-116 picks the `-test`
// variants when mode==='test'). That convention predates this rebrand and is
// worth keeping — but they were a placeholder wifi glyph, not the brand mark.
// Same BBNL mark, dark tile: obviously BBNL, still obviously not production.
const NAVY = [11, 18, 32, 255];

const targets = [
  // 0.72 inset keeps the mark inside the maskable safe zone: Android crops
  // maskable icons to a circle/squircle that can eat the outer ~10% per side.
  ["icon-192.png", () => square(mark, 192, WHITE, 0.72)],
  ["icon-512.png", () => square(mark, 512, WHITE, 0.72)],
  ["apple-icon-180.png", () => square(mark, 180, WHITE, 0.72)],
  ["favicon.png", () => square(mark, 192, WHITE, 0.78)],
  // Full lockup, transparent — the navy wordmark needs a light surface, so
  // Login/BrowserGate render it on a white chip rather than bare on gradient.
  ["logo.png", () => resize(lockup, 512, Math.max(1, Math.round(512 * lockup.height / lockup.width)))],
  // Test-build variants.
  ["icon-192-test.png", () => square(mark, 192, NAVY, 0.72)],
  ["icon-512-test.png", () => square(mark, 512, NAVY, 0.72)],
  ["apple-icon-180-test.png", () => square(mark, 180, NAVY, 0.72)],
];

const backupDir = path.join(ICONS, "backup-prebbnl");
if (!DRY && !fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

for (const [name, build] of targets) {
  const outPath = path.join(ICONS, name);
  const img = build();
  const buf = encodePng(img);
  if (DRY) { console.log(`  [dry] ${name} ${img.width}x${img.height} ${buf.length}B`); continue; }
  if (fs.existsSync(outPath) && !fs.existsSync(path.join(backupDir, name))) {
    fs.copyFileSync(outPath, path.join(backupDir, name));
  }
  fs.writeFileSync(outPath, buf);
  console.log(`  wrote ${name} ${img.width}x${img.height} ${buf.length}B`);
}
console.log(DRY ? "\ndry run — nothing written" : `\noriginals backed up to ${path.relative(ROOT, backupDir)}/`);
