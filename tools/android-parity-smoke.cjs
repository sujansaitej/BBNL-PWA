#!/usr/bin/env node
/**
 * Android-parity smoke test.
 *
 * Replays the Android customer app's EXACT request shape against a live
 * backend, alongside the PWA's, so "Android works but the PWA doesn't" can be
 * settled with evidence instead of inference.
 *
 *   node tools/android-parity-smoke.cjs --mode test --user testrag8
 *
 * The two clients differ on the wire in ways that look cosmetic and are not.
 * Retrofit sets a Content-Type on EVERY @Part including the plain text ones,
 * it sends `multipart/form-data` as the FILE part's own type rather than the
 * image type, and its @Headers block carries only four headers — no appversion,
 * no X-App-Package. Each pair of probes below sends one of those shapes.
 *
 * NON-DESTRUCTIVE BY DEFAULT. Every probe is chosen so the backend cannot store
 * anything:
 *   profile → posts a .txt, which `allowed_types = jpg|png|jpeg` always
 *             rejects. CodeIgniter validates the upload PATH before the
 *             filetype, so an unwritable directory still shows up.
 *   cloud   → posts an unknown cid, which fails checkuser() before any file is
 *             touched.
 * Pass --write to additionally attempt one REAL 1x1 JPEG for --user. That
 * overwrites that user's profile photo — throwaway accounts only.
 *
 * Exits non-zero if any probe reports a SERVER-SIDE fault, so it can gate a
 * deploy.
 */

const fs = require("fs");
const path = require("path");

const CRLF = "\r\n";

// ── args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const MODE = arg("--mode", "test");
const USER = arg("--user", "");
const CID = arg("--cid", "ZZ_NO_SUCH_USER_ZZ");
const SERIAL = arg("--serial", "ZZ_NO_SUCH_SERIAL_ZZ");
const DO_WRITE = argv.includes("--write");

// ── env ─────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, "..", `.env.${MODE}`);
if (!fs.existsSync(envPath)) {
  console.error(`No .env.${MODE} — expected ${envPath}`);
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const BASE = env.VITE_API_BASE_URL;
if (!BASE) { console.error(`.env.${MODE} has no VITE_API_BASE_URL`); process.exit(2); }

// ── credential sets ─────────────────────────────────────────────────
/** Android's @Headers block for ServiceApis/* — exactly four, nothing else. */
const ANDROID_HEADERS = {
  Authorization: env.VITE_API_AUTH_KEY,
  username: env.VITE_API_USERNAME,
  password: env.VITE_API_PASSWORD,
  appkeytype: env.VITE_API_APP_USER_TYPE_CUST,
};
/** What apiCore.mainHeaders() actually sends. */
const PWA_HEADERS = {
  ...ANDROID_HEADERS,
  appversion: env.VITE_API_APP_VERSION,
  "X-App-Package": "com.bbnl.smartphone",
};
/** Fofiapis::$authkey — the cloud album's lone Basic key. */
const CLOUD_AUTH = "Basic Zm9maWxhYkBnbWFpbC5jb206MTIzNDUtNTQzMjE=";

/** Smallest JPEG getimagesize() accepts (1x1). */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

// ── multipart encoder ───────────────────────────────────────────────
//
// FormData CANNOT express Retrofit's text parts, so this is hand-rolled.
// `fd.append(name, blob)` always emits `filename="blob"`, and PHP routes any
// part WITH a filename into $_FILES rather than $_POST — so cid/username arrive
// empty and the server answers "Please input ...". Retrofit's
// `@Part("username") RequestBody` sets a Content-Type but NO filename, which
// PHP does place in $_POST.
//
// That is not a theory. The first run of this tool reported exactly that
// failure, and the harness was at fault, not the app. Keep the encoder.
//
// Each part: {name, data, filename?, contentType?}. Omit contentType to
// reproduce a browser's plain string part, which carries no Content-Type.
function multipart(parts) {
  const boundary = "----bbnlSmoke" + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const p of parts) {
    let head = `--${boundary}${CRLF}Content-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += CRLF;
    if (p.contentType) head += `Content-Type: ${p.contentType}${CRLF}`;
    head += CRLF;
    chunks.push(Buffer.from(head, "utf8"));
    chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(String(p.data), "utf8"));
    chunks.push(Buffer.from(CRLF, "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, "utf8"));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Retrofit @Part("name") RequestBody(MediaType.parse("multipart/form-data")). */
const androidText = (name, v) => ({ name, data: v, contentType: "multipart/form-data" });
/** Browser FormData.append(name, "string") — no filename, no Content-Type. */
const pwaText = (name, v) => ({ name, data: v });

// ── reporting ───────────────────────────────────────────────────────
let faults = 0;
const results = [];
const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };

/**
 * Separate faults that live on the SERVER (no client change can help) from
 * rejections the request itself caused.
 */
const SERVER_FAULTS = [
  [/not\s+appear\s+to\s+be\s+writable/i, "upload directory is not writable ON THE SERVER"],
  [/no\s+tmp\s+directory/i, "PHP has no writable tmp dir ON THE SERVER"],
  [/unable\s+to\s+write\s+file/i, "PHP could not write the file ON THE SERVER"],
];
function classify(status, text) {
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  if (!json) {
    return status === 404
      ? { level: "fault", note: "HTTP 404 — endpoint not deployed on this base" }
      : { level: "fault", note: `HTTP ${status}, non-JSON body` };
  }
  const msg = String(json?.status?.err_msg ?? "");
  const code = Number(json?.status?.err_code);
  for (const [re, note] of SERVER_FAULTS) if (re.test(msg)) return { level: "fault", note, msg };
  if (code === 0) return { level: "ok", note: "success", msg };
  return { level: "expected", note: "rejected by validation (as designed)", msg };
}

async function probe(group, label, url, headers, parts) {
  const t = Date.now();
  const { body, contentType } = multipart(parts);
  let status = 0, text = "";
  try {
    const r = await fetch(url, {
      method: "POST",
      // Must carry OUR boundary — the encoder built the body.
      headers: { ...headers, "Content-Type": contentType },
      body,
    });
    status = r.status;
    text = await r.text();
  } catch (e) {
    console.log(`  ${C.r}[FAULT]${C.x} ${label}\n         transport: ${e.message}`);
    faults++;
    results.push({ group, label, msg: `transport: ${e.message}` });
    return;
  }
  const { level, note, msg } = classify(status, text);
  const tag = level === "ok" ? `${C.g}[ OK  ]${C.x}`
            : level === "fault" ? `${C.r}[FAULT]${C.x}`
            : `${C.y}[ exp ]${C.x}`;
  if (level === "fault") faults++;
  results.push({ group, label, msg: msg || note });
  console.log(`  ${tag} ${label}  ${C.d}(HTTP ${status}, ${Date.now() - t}ms)${C.x}`);
  console.log(`         ${note}${msg ? `  ${C.d}-> "${msg.trim()}"${C.x}` : ""}`);
}

/** The headline question: do the two shapes get the SAME answer? */
function compareShapes(group) {
  const rows = results.filter((r) => r.group === group);
  const a = rows.find((r) => r.label.startsWith("ANDROID"));
  const p = rows.find((r) => r.label.startsWith("PWA"));
  if (!a || !p) return;
  const same = a.msg.trim() === p.msg.trim();
  console.log(
    same
      ? `  ${C.d}=> identical for both shapes — the request shape is NOT the difference${C.x}`
      : `  ${C.r}=> DIVERGENT: android "${a.msg.trim()}" vs pwa "${p.msg.trim()}"${C.x}`
  );
  if (!same) faults++;
}

(async () => {
  console.log(`\n${"=".repeat(66)}`);
  console.log(`Android-parity smoke — mode=${MODE}`);
  console.log(`base: ${BASE}`);
  console.log("=".repeat(66));

  // ── [1] ServiceApis/uploadCustProfile ─────────────────────────────
  console.log("\n[1] profile photo — ServiceApis/uploadCustProfile/");
  if (!USER) {
    console.log(`  ${C.d}skipped: pass --user <customer username>${C.x}`);
  } else {
    const url = `${BASE}ServiceApis/uploadCustProfile/`;
    await probe("profile", "ANDROID shape (4 headers, typed text parts)", url, ANDROID_HEADERS, [
      androidText("username", USER),
      { name: "photo", filename: "probe.txt", contentType: "multipart/form-data", data: "probe" },
    ]);
    await probe("profile", "PWA shape (6 headers, bare text parts)", url, PWA_HEADERS, [
      pwaText("username", USER),
      { name: "photo", filename: "probe.txt", contentType: "text/plain", data: "probe" },
    ]);
    compareShapes("profile");

    if (DO_WRITE) {
      console.log(`  ${C.y}--write: attempting a REAL 1x1 JPEG for "${USER}"${C.x}`);
      await probe("write", "ANDROID shape, real JPEG (Zelory output ~= this)", url, ANDROID_HEADERS, [
        androidText("username", USER),
        { name: "photo", filename: "IMG_smoke.jpg", contentType: "multipart/form-data", data: TINY_JPEG },
      ]);
      await probe("write", "PWA shape, real JPEG (compressImage output ~= this)", url, PWA_HEADERS, [
        pwaText("username", USER),
        { name: "photo", filename: "IMG_smoke.jpg", contentType: "image/jpeg", data: TINY_JPEG },
      ]);
      compareShapes("write");
    }
  }

  // ── [2] fofi/fofiapis/cloudUpload ─────────────────────────────────
  console.log("\n[2] cloud photo album — fofi/fofiapis/cloudUpload/");
  {
    const url = `${BASE}fofi/fofiapis/cloudUpload/`;
    await probe("cloud", "ANDROID shape (files[], part type image/jpg)", url, { Authorization: CLOUD_AUTH }, [
      androidText("cid", CID),
      androidText("mac_address", SERIAL),
      { name: "files[]", filename: "a.jpg", contentType: "image/jpg", data: TINY_JPEG },
    ]);
    await probe("cloud", "PWA shape (files[], real per-file MIME)", url, { Authorization: CLOUD_AUTH }, [
      pwaText("cid", CID),
      pwaText("mac_address", SERIAL),
      { name: "files[]", filename: "a.png", contentType: "image/png", data: TINY_PNG },
    ]);
    compareShapes("cloud");

    // Regressions that would silently break the PWA port.
    await probe("guard", "auth guard — a wrong key must be refused", url, { Authorization: "Basic wrong" }, [
      pwaText("cid", CID), pwaText("mac_address", SERIAL),
      { name: "files[]", filename: "a.jpg", contentType: "image/jpeg", data: TINY_JPEG },
    ]);
    // `files` without brackets: PHP builds scalars, not arrays. Proves why the
    // PWA must send files[] — see services/customer/cloudUpload.js.
    await probe("guard", "bracketless `files` is not a usable field name", url, { Authorization: CLOUD_AUTH }, [
      pwaText("cid", CID), pwaText("mac_address", SERIAL),
      { name: "files", filename: "a.jpg", contentType: "image/jpeg", data: TINY_JPEG },
    ]);
  }

  console.log(`\n${"=".repeat(66)}`);
  if (faults) {
    console.log(`${C.r}${faults} fault(s). A "not writable"/404 fault needs a BACKEND fix, not an app change.${C.x}`);
    process.exit(1);
  }
  console.log(`${C.g}No faults. Android and PWA request shapes behave identically.${C.x}`);
})();
