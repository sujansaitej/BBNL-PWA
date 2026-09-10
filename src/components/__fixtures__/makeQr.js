/**
 * makeQr — a minimal QR encoder, for TESTS ONLY.
 *
 * The app only ever DECODES (jsqr), so there is no encoder in the tree and the
 * scanner had no test that put a real QR code through the real pipeline — every
 * test mocked getUserMedia and stopped at "a stream arrived". That left the
 * thing we most needed to prove unproven: that the frame the scan loop builds
 * is still decodable after the Android-parity resolution change.
 *
 * Scope is deliberately the minimum that answers that: QR Version 2 (25x25),
 * error-correction level L, byte mode — 32 bytes of payload, enough for the
 * tokens this app scans. It is self-validating: if the encoder were wrong, jsQR
 * would not decode its output and the tests using it would fail loudly rather
 * than pass vacuously.
 *
 * Refs: ISO/IEC 18004. Version 2-L = 44 total codewords, 34 data + 10 EC,
 * single block; alignment pattern centred at (18,18); mask 0 = (row+col)%2===0.
 */

// ── GF(256) arithmetic for Reed-Solomon (primitive polynomial 0x11d) ──
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Reed-Solomon EC codewords for `data`. */
function ecCodewords(data, ecLen) {
  // Generator polynomial: product of (x - a^i) for i in [0, ecLen).
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

const SIZE = 25;          // Version 2
const DATA_CODEWORDS = 34;
const EC_CODEWORDS = 10;

/**
 * @param {string} text payload, <= 32 bytes
 * @returns {number[][]} SIZE x SIZE matrix of 0/1 (1 = dark)
 */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > 32) throw new Error(`payload too long for V2-L: ${bytes.length} > 32`);

  // ── bitstream: mode(4) + length(8) + data + terminator, byte-aligned ──
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);          // byte mode
  push(bytes.length, 8);    // char count (V1-9 byte mode = 8 bits)
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, DATA_CODEWORDS * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Pad alternately with the spec's two pad codewords.
  for (let i = 0; data.length < DATA_CODEWORDS; i++) data.push(i % 2 === 0 ? 0xec : 0x11);

  const all = [...data, ...ecCodewords(data, EC_CODEWORDS)];

  // ── module grid ──
  const m = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  const set = (r, c, v) => { if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) m[r][c] = v; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(r0 + r, c0 + c, inRing ? 1 : 0);
      }
    }
  };
  finder(0, 0); finder(0, SIZE - 7); finder(SIZE - 7, 0);

  // Timing patterns
  for (let i = 8; i < SIZE - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    set(6, i, v);
    set(i, 6, v);
  }

  // Alignment pattern (V2: single, centred at 18,18)
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      set(18 + r, 18 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1 ? 1 : 0);
    }
  }

  set(SIZE - 8, 8, 1); // dark module

  // Reserve format-info cells so data placement skips them.
  const reserved = [];
  for (let i = 0; i < 9; i++) { reserved.push([8, i], [i, 8]); }
  for (let i = 0; i < 8; i++) { reserved.push([8, SIZE - 1 - i], [SIZE - 1 - i, 8]); }
  for (const [r, c] of reserved) if (m[r][c] === null) m[r][c] = 0;

  // ── data placement: 2-wide columns, right to left, alternating direction ──
  let bitIdx = 0;
  const allBits = [];
  for (const cw of all) for (let i = 7; i >= 0; i--) allBits.push((cw >> i) & 1);

  let upward = true;
  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let i = 0; i < SIZE; i++) {
      const row = upward ? SIZE - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (m[row][c] !== null) continue;
        let bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        if ((row + c) % 2 === 0) bit ^= 1;   // mask 0
        m[row][c] = bit;
      }
    }
    upward = !upward;
  }

  // ── format info: EC level L + mask 0, per the spec's fixed table ──
  const FORMAT_L_MASK0 = "111011111000100".split("").map(Number);
  for (let i = 0; i <= 5; i++) m[8][i] = FORMAT_L_MASK0[i];
  m[8][7] = FORMAT_L_MASK0[6];
  m[8][8] = FORMAT_L_MASK0[7];
  m[7][8] = FORMAT_L_MASK0[8];
  for (let i = 9; i <= 14; i++) m[14 - i][8] = FORMAT_L_MASK0[i];
  for (let i = 0; i <= 7; i++) m[SIZE - 1 - i][8] = FORMAT_L_MASK0[i];
  for (let i = 8; i <= 14; i++) m[8][SIZE - 15 + i] = FORMAT_L_MASK0[i];
  m[SIZE - 8][8] = 1; // dark module wins

  return m;
}

/**
 * Render a matrix into RGBA pixels at `size` px square, with a quiet zone.
 * @returns {{data: Uint8ClampedArray, width: number, height: number}}
 */
export function qrImageData(text, size = 400, quietModules = 4) {
  const m = qrMatrix(text);
  const total = SIZE + quietModules * 2;
  const scale = Math.floor(size / total);
  const dim = scale * total;
  const px = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mr = Math.floor(y / scale) - quietModules;
      const mc = Math.floor(x / scale) - quietModules;
      const dark = mr >= 0 && mr < SIZE && mc >= 0 && mc < SIZE && m[mr][mc] === 1;
      const i = (y * dim + x) * 4;
      const v = dark ? 0 : 255;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return { data: px, width: dim, height: dim };
}
