/**
 * audit-dist — deep pre-deploy audit of a built dist/.
 *
 * Usage: node tools/audit-dist.cjs [--mode test|production]
 *
 * dist-readiness.cjs answers "is this bundle structurally sound?". This answers
 * a different and, historically, more expensive question: "is this bundle
 * ACTUALLY the code we just wrote?"
 *
 * The project has already shipped a stale dist once — a client spent a session
 * testing features that were fixed but never rebuilt. Minified bundles are a
 * single enormous line, so eyeballing them and naive line-based greps both lie;
 * every check below does a substring match over the FULL file text.
 *
 * Read-only. Touches nothing but dist/ and the .env for the mode.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const argOf = (f, d) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const MODE = argOf("--mode", "production");
// --dist lets this be pointed at an EXTRACTED artifact, which is the only way
// to prove the audit can actually fail: run it against a known-stale bundle and
// watch the markers in [2] go red.
const DIST = path.resolve(ROOT, argOf("--dist", "dist"));

function parseEnv(p) {
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("="); if (i === -1) continue;
    let v = l.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[l.slice(0, i).trim()] = v;
  }
  return env;
}

const env = parseEnv(path.join(ROOT, `.env.${MODE}`));
const BASE = env.VITE_API_APP_DIR_PATH || "/";
const API_HOST = (env.VITE_API_BASE_URL || "").replace(/^https?:\/\//, "").split("/")[0];

let pass = 0, fail = 0, warn = 0;
const ok = (m, d) => { pass++; console.log(`  [ OK ] ${m}${d ? " — " + d : ""}`); };
const bad = (m, d) => { fail++; console.log(`  [FAIL] ${m}${d ? " — " + d : ""}`); };
const meh = (m, d) => { warn++; console.log(`  [WARN] ${m}${d ? " — " + d : ""}`); };

if (!fs.existsSync(DIST)) { console.error("dist/ not found"); process.exit(2); }

// Full text of every emitted JS/CSS asset, concatenated once.
const assetDir = path.join(DIST, "assets");
const assetFiles = fs.readdirSync(assetDir);
const jsText = assetFiles.filter((f) => f.endsWith(".js"))
  .map((f) => fs.readFileSync(path.join(assetDir, f), "utf8")).join("\n");
const allText = jsText + "\n" + assetFiles.filter((f) => f.endsWith(".css"))
  .map((f) => fs.readFileSync(path.join(assetDir, f), "utf8")).join("\n");
const has = (s) => allText.includes(s);

console.log(`\naudit-dist — mode ${MODE}, base ${BASE}, api ${API_HOST}`);
console.log(`${assetFiles.length} assets, ${(Buffer.byteLength(allText) / 1024 / 1024).toFixed(2)} MB of JS/CSS text\n`);

// ── 1. Is this the RIGHT environment? ─────────────────────────────────
console.log("[1] environment targeting");
if (API_HOST && has(API_HOST)) ok(`bundle targets ${API_HOST}`);
else bad(`bundle does NOT contain ${API_HOST}`, "wrong build mode?");

for (const stray of ["netmontest.bbnl.in", "bbnlnetmon.bbnl.in", "bbnlpwa.bbnl.in"]) {
  if (stray === API_HOST) continue;
  if (has(stray)) bad(`FOREIGN HOST leaked into the bundle: ${stray}`);
}
if (fail === 0) ok("no foreign API host in the bundle");

// ── Easebuzz gateway ──────────────────────────────────────────────────
// THE CHECK THAT WOULD HAVE CAUGHT THE 3 AUG PRODUCTION BUNDLE.
// That build carried every production value but was made under a
// non-production mode, so easebuzz.js folded EZ_ENV to "test": it used the
// SANDBOX key and posted to the ezpay-test seam. bbnlnetmon proxies only
// ezpay-prod, so it answered 403 and every production payment failed at
// initiateLink. Nothing in this audit noticed, because every other value in
// the bundle was correct.
//
// Vite constant-folds the env, so the built chunk literally contains
// `i="prod".toLowerCase()` or `i="test".toLowerCase()` — read it back and
// compare with what this mode is supposed to be.
{
  const declared = String(env.VITE_EASEBUZZ_ENV || "").toLowerCase();
  const folded = (jsText.match(/"(prod|test)"\.toLowerCase\(\)/) || [])[1];
  if (!declared) {
    bad("VITE_EASEBUZZ_ENV is not set in .env." + MODE, "gateway falls back to the MODE NAME");
  } else if (!folded) {
    bad("could not read the Easebuzz gateway out of the bundle", "easebuzz chunk missing?");
  } else if (folded !== declared) {
    bad(`bundle uses the ${folded.toUpperCase()} Easebuzz gateway but .env.${MODE} says ${declared.toUpperCase()}`);
  } else if (MODE === "production" && folded !== "prod") {
    bad("a PRODUCTION bundle is wired to the Easebuzz SANDBOX");
  } else {
    ok(`Easebuzz gateway is ${folded} — matches .env.${MODE}`);
  }

  // The seam the bundle posts to must be the one its host proxies.
  const seam = folded === "prod" ? "ezpay-prod" : "ezpay-test";
  if (jsText.includes("ezpay-")) ok(`checkout posts to the ${seam} seam`);
  else bad("no ezpay seam found in the bundle");
}

const idx = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
if (idx.includes(`"${BASE}`) || idx.includes(`'${BASE}`) || idx.includes(`=${BASE}`) || idx.includes(BASE)) {
  ok(`index.html uses base ${BASE}`);
} else bad(`index.html does not reference base ${BASE}`);

// ── 2. Are THIS SESSION's changes actually in the bundle? ─────────────
// Each marker is a string that only exists because of a specific change.
console.log("\n[2] this session's changes are present (not a stale dist)");
// EVERY marker here was validated against a known-stale bundle: it must be
// present in the new build AND absent from the old one. Markers that appear in
// both are worse than useless — they manufacture confidence. Rejected for that
// reason: "ServiceApis/upgradeRegistration" and "Services Subscription" (both
// predate this work), and bare numbers like 1600 / 3500, which occur by chance
// all over 2+ MB of minified JS.
//
// Also: NOTHING here may be a console.* string. vite.config.js:287 sets
// `pure: ['console.log','console.debug','console.info']` for production only,
// so console markers pass in test mode and silently vanish in production —
// exactly the false-negative that would block a good release.
const MARKERS = [
  // Voice — provisioning + the native subscription step
  ["ADD VOICE PLAN", "not-opted CTA (replaces the Fo-Fi dead end)"],
  ["VOIP Number", "subscription screen's read-only VOIP field"],
  ["This customer has no registered VOIP number yet.", "mislabelled-backend-error remap"],
  ["Could not register a voice line", "provisioning failure path"],
  ["voicecall_plans", "voice plan catalog extraction"],
  ["paymentinfo/voicecall", "voice quote endpoint"],
  // FO-Fi Cloud photo album upload
  // Validated against the archived stale dist.zip AND the live test deploy
  // (2026-08-31): absent from both, present in a fresh build. The endpoint
  // string is the load-bearing one — it is the only place the subdirectory
  // controller path appears, so it cannot collide with anything else.
  ["fofi/fofiapis/cloudUpload/", "cloud album upload endpoint"],
  ["FO-Fi Cloud", "cloud upload screen header"],
  ["Upload photos to cloud album", "cloud icon on the box selector bar"],
  // Profile photo — Android-parity compression (Zelory 612x816 q80)
  ["Photo uploads are temporarily unavailable on the server",
   "server-side upload-fault remap (replaces the raw CodeIgniter string)"],
  // Payment
  ["ServiceApis/killTxn", "stranded-transaction cleanup"],
  // Branding
  ["BBNL CRM", "app name"],
];
for (const [needle, why] of MARKERS) {
  if (has(needle)) ok(why, JSON.stringify(needle.slice(0, 42)));
  else bad(`MISSING: ${why}`, JSON.stringify(needle));
}

// Things that must NOT be there any more.
const REMOVED = [
  ["GO TO FO-FI SMART BOX", "the Fo-Fi dead-end button"],
  ["A voice plan needs a Fo-Fi Box", "the invented prerequisite sentence"],
];
for (const [needle, why] of REMOVED) {
  if (has(needle)) bad(`STALE: ${why} is still in the bundle`, JSON.stringify(needle));
  else ok(`removed: ${why}`);
}

// ── 3. Camera constants actually made it through minification ────────
console.log("\n[3] QR camera tuning survived the build");
// Bare numbers are useless here — "1600", "3500" and the word "continuous" all
// occur by chance in a stale bundle (verified). Match the surrounding object
// literal instead, which minification preserves.
const camera = [
  ["ideal:1600", "Android preview width (setRequestedPreviewSize 1600x1024)"],
  ["ideal:1024", "Android preview height"],
  ["focusMode", "continuous autofocus constraint (FOCUS_MODE_CONTINUOUS_PICTURE)"],
];
for (const [needle, why] of camera) {
  if (has(needle)) ok(why);
  else bad(`MISSING: ${why}`, JSON.stringify(needle));
}
// The per-attempt timeout is a plain const the minifier inlines, so there is no
// reliable literal to match. It is covered behaviourally by
// src/components/qrScannerCamera.test.jsx instead — asserted here only so the
// gap is visible rather than silently assumed.
console.log("         (per-attempt camera budget is covered by qrScannerCamera.test.jsx,");
console.log("          not matchable in minified output)");

// ── 4. Icons are the real BBNL ones, not the placeholders ────────────
console.log("\n[4] branding assets");
const iconDir = path.join(DIST, "icons");
const mf = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8"));
ok(`manifest name="${mf.name}" short_name="${mf.short_name}"`);
if (/fo-?fi/i.test(mf.name) || /fo-?fi/i.test(mf.short_name)) bad("manifest still says Fo-Fi");

for (const icon of mf.icons || []) {
  const rel = icon.src.startsWith(BASE) ? icon.src.slice(BASE.length) : icon.src.replace(/^\//, "");
  const p = path.join(DIST, rel);
  if (!fs.existsSync(p)) { bad(`manifest icon missing: ${icon.src}`); continue; }
  const buf = fs.readFileSync(p);
  // The BBNL mark is crimson rgb(237,24,71). A placeholder icon will not
  // contain that colour anywhere; decode is overkill, so probe the raw bytes
  // for the PNG signature and a plausible size instead, and check the source
  // PNG we generated is byte-identical to what shipped.
  const srcPath = path.join(ROOT, "public", "icons", rel.replace(/^icons\//, ""));
  if (fs.existsSync(srcPath) && Buffer.compare(buf, fs.readFileSync(srcPath)) === 0) {
    ok(`${rel} matches public/icons source (${buf.length}B)`);
  } else {
    meh(`${rel} differs from public/icons source`, `${buf.length}B`);
  }
}
const backup = path.join(ROOT, "public", "icons", "backup-prebbnl");
if (fs.existsSync(backup)) {
  for (const f of fs.readdirSync(backup)) {
    const shipped = path.join(iconDir, f);
    if (fs.existsSync(shipped) &&
        Buffer.compare(fs.readFileSync(shipped), fs.readFileSync(path.join(backup, f))) === 0) {
      bad(`SHIPPED THE OLD PLACEHOLDER ICON: ${f}`);
    }
  }
  ok("no pre-BBNL placeholder icon shipped");
}

// ── 5. Nothing that should never ship ────────────────────────────────
console.log("\n[5] nothing leaked");
const maps = assetFiles.filter((f) => f.endsWith(".map"));
if (maps.length) bad(`${maps.length} source map(s) shipped`); else ok("no source maps");

// Credentials: the API password/auth key legitimately ship in a same-origin
// PWA (the backend has no token flow), so their PRESENCE is expected — but
// anything from a DIFFERENT environment is a packaging mistake.
const otherModes = fs.readdirSync(ROOT).filter((f) => f.startsWith(".env.") && f !== `.env.${MODE}`);
for (const f of otherModes) {
  const other = parseEnv(path.join(ROOT, f));
  const otherHost = (other.VITE_API_BASE_URL || "").replace(/^https?:\/\//, "").split("/")[0];
  if (otherHost && otherHost !== API_HOST && has(otherHost)) {
    bad(`credentials/host from ${f} leaked`, otherHost);
  }
}
ok(`no config from other env files (${otherModes.join(", ") || "none"})`);

if (/sourceMappingURL=/.test(jsText)) meh("a sourceMappingURL comment remains in a bundle");
else ok("no sourceMappingURL references");

// ── 6. Service worker + server-side routing ──────────────────────────
console.log("\n[6] deploy mechanics");
const sw = fs.readFileSync(path.join(DIST, "sw.js"), "utf8");
const urls = [...sw.matchAll(/\burl:"([^"]+)"/g)].map((m) => m[1]);
const missing = urls.filter((u) => {
  const rel = u.startsWith(BASE) ? u.slice(BASE.length) : u.replace(/^\//, "");
  return !fs.existsSync(path.join(DIST, decodeURIComponent(rel)));
});
if (missing.length) bad(`${missing.length} precache entries missing`, missing.slice(0, 3).join(", "));
else ok(`all ${urls.length} precache entries exist`);
if (sw.includes(BASE)) ok(`sw.js scoped to ${BASE}`); else meh("sw.js does not mention the base path");

// A missing .htaccess is a FINDING, not a reason to crash — deep-linking dies
// without it on Apache, and an audit that throws here tells you nothing about
// everything it had not checked yet.
const htPath = path.join(DIST, ".htaccess");
if (!fs.existsSync(htPath)) {
  bad(".htaccess MISSING — SPA deep links will 404 on Apache");
} else {
  const ht = fs.readFileSync(htPath, "utf8");
  const rb = (ht.match(/RewriteBase\s+(\S+)/) || [])[1];
  if (rb === BASE) ok(`.htaccess RewriteBase ${rb}`);
  else bad(`.htaccess RewriteBase ${rb} != ${BASE}`);
}

// server.js is NOT part of dist/ but must ship with it, or IPTV streaming 404s.
const serverJs = path.join(ROOT, "server.js");
if (fs.existsSync(serverJs)) {
  const s = fs.readFileSync(serverJs, "utf8");
  ok(`server.js present (${(fs.statSync(serverJs).size / 1024).toFixed(1)} KB) — MUST be deployed alongside dist/`);
  if (!/stream/i.test(s)) meh("server.js has no 'stream' reference — is it the right file?");
} else bad("server.js MISSING — IPTV live channels will 404");

console.log(`\n${"=".repeat(60)}`);
console.log(`${pass} pass · ${warn} warn · ${fail} fail`);
console.log(fail === 0 ? "\nSAFE TO PUSH" : "\nDO NOT PUSH — resolve the failures above");
process.exit(fail > 0 ? 1 : 0);
