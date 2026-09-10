/**
 * dist-readiness — offline sanity check on a built dist/ before deploying.
 *
 * Usage:  node tools/dist-readiness.cjs [--mode test|production]
 *         (default production; must match the mode dist/ was built with)
 *
 * Catches the deploy-time breakages that a green `vite build` does not:
 *   - an asset referenced by index.html that is not actually in dist/
 *   - a base-path mismatch between .env, the manifest and the emitted URLs
 *   - the service worker precaching a path the server will not serve
 *   - icons referenced by the manifest that are missing or truncated
 *   - a stale .htaccess RewriteBase (SPA deep links 404 without it)
 *
 * Everything here is local file inspection. Nothing is fetched, nothing is
 * uploaded, nothing is deployed.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

let fail = 0;
const ok = (m) => console.log(`  [ OK ] ${m}`);
const bad = (m) => { fail++; console.log(`  [FAIL] ${m}`); };
const info = (m) => console.log(`         ${m}`);

function parseEnv(p) {
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i === -1) continue;
    let v = l.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[l.slice(0, i).trim()] = v;
  }
  return env;
}

if (!fs.existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` (production) or `npm run build:test` first.");
  process.exit(2);
}

// Which build is in dist/? The base path is per-mode, so checking a test build
// against .env.production reports ~19 failures that are all the tool's own
// wrong assumption:
//   .env.production → /smartphone/crm/   (npm run build)
//   .env.test       → /pwa/crm/          (npm run build:test)
// This defaulted to production and had no override, so `npm run build:test`
// could never pass, and a production-base build passed only because it
// happened to share production's base, not because anything was verified.
//
//   node tools/dist-readiness.cjs [--mode test|production]
const MODE = (() => {
  const i = process.argv.indexOf("--mode");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "production";
})();
const envFile = path.join(ROOT, `.env.${MODE}`);
if (!fs.existsSync(envFile)) {
  console.error(`no .env.${MODE} — pass --mode with one of: ` +
    fs.readdirSync(ROOT).filter((f) => f.startsWith(".env.")).map((f) => f.slice(5)).join(", "));
  process.exit(2);
}

const env = parseEnv(envFile);
const BASE = env.VITE_API_APP_DIR_PATH || "/";
console.log(`\ndist readiness — mode ${MODE}, base ${BASE}\n`);

// ── 1. index.html references resolve to real files ────────────────────
const htmlRaw = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
// Strip HTML comments first. index.html keeps commented-out splash-screen
// <link>s as templates; Vite does not rewrite the base inside a comment, so
// scanning them reports a "wrong base" that no browser will ever request.
const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, "");
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|mailto:|#)/.test(u));

let missing = 0;
for (const ref of refs) {
  if (!ref.startsWith(BASE)) {
    bad(`ref outside base: ${ref}  (expected to start with ${BASE})`);
    continue;
  }
  const rel = ref.slice(BASE.length).split("?")[0];
  if (!fs.existsSync(path.join(DIST, rel))) {
    bad(`index.html references a file not in dist: ${ref}`);
    missing++;
  }
}
if (missing === 0) ok(`all ${refs.length} index.html asset refs resolve inside dist/`);

// ── 2. base path is consistent everywhere ─────────────────────────────
const manifestName = (html.match(/href="([^"]*\.webmanifest)"/) || [])[1];
if (!manifestName) bad("index.html has no <link rel=manifest>");
else ok(`manifest linked: ${manifestName}`);

const mf = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8"));
for (const [k, v] of [["start_url", mf.start_url], ["scope", mf.scope], ["id", mf.id]]) {
  if (v === BASE) ok(`manifest ${k} = ${v}`);
  else bad(`manifest ${k} = ${v} — expected ${BASE}`);
}
ok(`manifest name="${mf.name}" short_name="${mf.short_name}"`);

// ── 3. manifest icons exist and are real PNGs ─────────────────────────
for (const icon of mf.icons || []) {
  const rel = icon.src.startsWith(BASE) ? icon.src.slice(BASE.length) : icon.src.replace(/^\//, "");
  const p = path.join(DIST, rel);
  if (!fs.existsSync(p)) { bad(`manifest icon missing from dist: ${icon.src}`); continue; }
  const buf = fs.readFileSync(p);
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) bad(`manifest icon is not a PNG: ${icon.src}`);
  else if (buf.length < 500) bad(`manifest icon looks truncated (${buf.length}B): ${icon.src}`);
  else ok(`icon ${icon.sizes} ${icon.purpose || ""} ${rel} (${buf.length}B)`);
}

// ── 4. service worker precache entries are all present ────────────────
const swPath = path.join(DIST, "sw.js");
if (!fs.existsSync(swPath)) {
  bad("sw.js missing — PWA will not install");
} else {
  const sw = fs.readFileSync(swPath, "utf8");
  // Workbox emits object literals with UNQUOTED keys: {url:"…",revision:"…"}.
  // Matching on "url":"…" silently found zero entries and reported success.
  const urls = [...sw.matchAll(/\burl:"([^"]+)"/g)].map((m) => m[1]);
  if (urls.length === 0) bad("could not parse any precache entries from sw.js — check the format");
  const gone = urls.filter((u) => {
    const rel = u.startsWith(BASE) ? u.slice(BASE.length) : u.replace(/^\//, "");
    return !fs.existsSync(path.join(DIST, decodeURIComponent(rel)));
  });
  if (gone.length) {
    bad(`${gone.length} precache entr(ies) point at files not in dist:`);
    gone.slice(0, 8).forEach((g) => info(g));
  } else ok(`all ${urls.length} service-worker precache entries exist`);

  // The importScripts the workbox config injects must also ship.
  for (const s of ["sw-nav-preload.js", "sw-api-cache.js"]) {
    if (fs.existsSync(path.join(DIST, s))) ok(`importScripts asset present: ${s}`);
    else bad(`importScripts asset MISSING: ${s} — the SW will fail to install`);
  }
}

// ── 5. .htaccess SPA fallback matches this base ───────────────────────
const htPath = path.join(DIST, ".htaccess");
if (!fs.existsSync(htPath)) {
  bad(".htaccess missing — SPA deep links will 404 on Apache");
} else {
  const ht = fs.readFileSync(htPath, "utf8");
  const rb = (ht.match(/RewriteBase\s+(\S+)/) || [])[1];
  if (rb === BASE) ok(`.htaccess RewriteBase ${rb}`);
  else bad(`.htaccess RewriteBase ${rb} — expected ${BASE}`);
  if (/RewriteRule \. index\.html/.test(ht)) ok(".htaccess SPA fallback present");
  else bad(".htaccess has no SPA fallback rule");
}

// ── 6. no source maps, no stray dev artefacts ─────────────────────────
const maps = fs.readdirSync(path.join(DIST, "assets")).filter((f) => f.endsWith(".map"));
if (maps.length) bad(`${maps.length} source map(s) shipped: ${maps.slice(0, 3).join(", ")}`);
else ok("no source maps in dist/");

// ── 7. the fixes from this round are actually in the bundle ───────────
const assetDir = path.join(DIST, "assets");
const bundles = fs.readdirSync(assetDir).filter((f) => f.endsWith(".js"))
  .map((f) => fs.readFileSync(path.join(assetDir, f), "utf8"));
const cssText = fs.readdirSync(assetDir).filter((f) => f.endsWith(".css"))
  .map((f) => fs.readFileSync(path.join(assetDir, f), "utf8")).join("\n");

const MARKERS = [
  ["Login To Netmon", "item 1 — Netmon SSO"],
  ["Scan To Login", "item 2 — QR scan-to-login"],
  ["Drag the bottom edge", "item 3 — resizable signature pad"],
  // The full-screen pad now mirrors Android's CaptureSignature Activity, so
  // the marker is its prompt text ("Customer Signature" was the old header).
  ["Please Sign below", "item 3 — full-screen signature pad (Android parity)"],
  // Proves the pad uses the real Fullscreen API, not just a fixed overlay.
  // "requestFullscreen" alone is no good — OTTPlayer contains it too, so a
  // stale Register chunk would still pass.
  ["navigationUI", "item 3 — native Fullscreen API"],
  ["too common", "item 4 — relaxed password policy"],
  ["VOIP number allocated", "item 5 — voipno capture"],
  ["allocated automatically on registration", "item 5 — voice plan flag"],
  ["Install BBNL CRM", "item 7 — BBNL branding"],
];
for (const [needle, label] of MARKERS) {
  if (bundles.some((b) => b.includes(needle))) ok(`${label}`);
  else bad(`${label} — marker "${needle}" not found in any bundle`);
}
for (const [needle, label] of [
  ["--safe-top", "item 8 — safe-area tokens"],
  [".pt-safe", "item 8 — top inset utility"],
  [".pb-safe", "item 8 — bottom inset utility"],
]) {
  if (cssText.includes(needle)) ok(label);
  else bad(`${label} — "${needle}" not in the CSS bundle`);
}

// The inset utilities must be emitted AFTER Tailwind's padding utilities or
// they lose the cascade and silently do nothing.
const iP4 = cssText.indexOf(".p-4{");
const iPt = cssText.indexOf(".pt-safe{");
if (iP4 >= 0 && iPt > iP4) ok("inset utilities win the cascade over Tailwind padding");
else bad(`cascade order wrong: .p-4 at ${iP4}, .pt-safe at ${iPt}`);

console.log(`\n${fail === 0 ? "READY" : fail + " PROBLEM(S)"}\n`);
process.exit(fail === 0 ? 0 : 1);
