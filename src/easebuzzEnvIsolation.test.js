/**
 * The sandbox and the live Easebuzz account must never meet.
 *
 * Explicit instruction from the server team, 2026-08-31, when they supplied the
 * sandbox pair: "production credentials is different testing credentials is
 * different ... nothing should affect in production because of this."
 *
 * Two things could break that, and both are checked here from the SOURCE rather
 * than trusted:
 *
 *  1. Credential/route selection. EZ_ENV is derived from the build mode, so a
 *     production bundle must resolve to the live pair and the ezpay-prod seam,
 *     and a test bundle to the sandbox pair and ezpay-test. Verified in the
 *     built output too: vite constant-folds it, so the prod chunk literally
 *     reads `i="prod".toLowerCase()` and the `i==="test"` branch is dead code.
 *
 *  2. The .htaccess Easebuzz proxy. Production and preprod ALREADY proxy ezpay
 *     at the vhost level — probed 2026-08-31, bbnlnetmon and bbnlpwa both
 *     answered with a real Easebuzz body ("Invalid merchant key"), while
 *     netmontest served 10462 bytes of SPA shell. So the rule is emitted for
 *     the TEST build only; laying a second per-directory proxy over a working
 *     vhost one is pure risk on the money path.
 */

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const EZ = read("src/services/customer/easebuzz.js");
const CFG = read("vite.config.js");

describe("credentials are separated by build mode", () => {
  test("the two pairs are distinct in every field", async () => {
    const { EZ_FALLBACK } = await import("./services/customer/easebuzz.js");
    expect(EZ_FALLBACK.test.key).not.toBe(EZ_FALLBACK.prod.key);
    expect(EZ_FALLBACK.test.salt).not.toBe(EZ_FALLBACK.prod.salt);
    // The sandbox pair the server team supplied, pinned verbatim.
    expect(EZ_FALLBACK.test).toEqual({ key: "2PBP7IABZ2", salt: "DAH88E3UWQ" });
  });

  test("env is derived from the build mode, defaulting to the SANDBOX", () => {
    // Only an explicitly production build may reach live Easebuzz. Anything
    // else — dev, test, preprod, an unknown mode — must fall to the sandbox,
    // so a misconfigured build cannot fire a real charge.
    expect(EZ).toMatch(/MODE\s*===\s*"production"\s*\?\s*"prod"\s*:\s*"test"/);
  });

  test("resolveCreds reads the block matching the env, never the other one", () => {
    // test → easebuzztest, prod → fofieasebuzz. Crossing these would hand a
    // live key to a sandbox build or vice versa.
    expect(EZ).toMatch(/EZ_ENV\s*===\s*"test"\s*\?\s*block\?\.easebuzztest\s*:\s*block\?\.fofieasebuzz/);
  });

  test("the route seam is chosen by the same env, not hardcoded", () => {
    expect(EZ).toMatch(/ezpay-\$\{env\s*===\s*"test"\s*\?\s*"test"\s*:\s*"prod"\}/);
  });
});

describe("the .htaccess Easebuzz proxy ships to test only", () => {
  test("the block is gated on a flag, not emitted unconditionally", () => {
    expect(CFG).toMatch(/\$\{emitEzpay\s*\?/);
  });

  test("the flag is the test-mode flag", () => {
    // htaccessPlugin(basePath, acsUrl, qr, emitEzpay) — the 4th argument.
    expect(CFG).toMatch(/isTest\s*\)\s*,/);
    expect(CFG).toMatch(/function htaccessPlugin\(basePath, acsUrl, qr, emitEzpay\)/);
  });

  test("only the sandbox host is ever proxied from .htaccess", () => {
    // The live host must not appear in a rule we generate — production's
    // vhost owns that route and must stay the only thing serving it.
    const block = CFG.slice(CFG.indexOf("${emitEzpay ?"), CFG.indexOf("# If the requested file"));
    expect(block).toMatch(/testpay\.easebuzz\.in/);
    expect(block).not.toMatch(/RewriteRule \^ezpay-prod/);
    expect(block).not.toMatch(/\bhttps:\/\/pay\.easebuzz\.in/);
  });
});

// ── The failure that shipped ────────────────────────────────────────
//
// The bundle live on bbnlnetmon on 3 Aug 2026 carried every production value
// but was built under a NON-PRODUCTION MODE. easebuzz.js derives its gateway
// from `MODE === "production" ? "prod" : "test"`, so EZ_ENV folded to "test":
// the sandbox key, posting to the ezpay-test seam. Measured 2026-08-31,
// bbnlnetmon proxies only ezpay-prod:
//     ezpay-test → HTTP 403        ezpay-prod → HTTP 200
// so initiateLink threw "Could not start payment (HTTP 403)" on the first step
// of every production payment.
//
// The mode NAME is not the deployment target. Each .env now says outright
// which gateway its host uses, so a build called anything at all still gets the
// right one.
describe("the gateway is declared per deployment, not inferred", () => {
  const ENVS = {
    ".env.production": "prod",
    ".env.preprod": "test",
    ".env.test": "test",
    ".env.development": "test",
  };

  test.each(Object.entries(ENVS))("%s declares VITE_EASEBUZZ_ENV=%s", (file, expected) => {
    const m = read(file).match(/^VITE_EASEBUZZ_ENV=(.+)$/m);
    expect(m, `${file} does not set VITE_EASEBUZZ_ENV`).toBeTruthy();
    expect(m[1].trim()).toBe(expected);
  });

  test("only the production deployment may reach the live gateway", () => {
    const live = Object.entries(ENVS).filter(([, v]) => v === "prod").map(([f]) => f);
    expect(live).toEqual([".env.production"]);
  });

  test("the explicit value outranks the mode-name fallback", () => {
    // `VITE_EASEBUZZ_ENV || (MODE === "production" ? ... )` — the override has
    // to come FIRST, or declaring it would change nothing.
    expect(EZ).toMatch(/VITE_EASEBUZZ_ENV\s*\|\|\s*\(\s*import\.meta\.env\.MODE/);
  });

  test("the build refuses to guess", () => {
    // Unset, invalid, or a production build wired to the sandbox — all fatal.
    expect(CFG).toMatch(/VITE_EASEBUZZ_ENV is not set for mode/);
    expect(CFG).toMatch(/must be "prod" or "test"/);
    expect(CFG).toMatch(/mode === 'production' && ezEnv !== 'prod'/);
  });

  test("the pre-deploy audit reads the gateway back out of the built bundle", () => {
    // A source-level guard cannot catch a bundle built before it existed —
    // which is the situation on production right now. audit-dist compares the
    // constant-folded value in dist/ against the .env for the mode.
    const audit = read("tools/audit-dist.cjs");
    expect(audit).toMatch(/toLowerCase/);
    expect(audit).toMatch(/Easebuzz gateway/);
  });
});

// ── The customer portal's two payment paths ─────────────────────────
//
// The portal takes payment two ways and they source credentials differently:
//   InternetPaymentSummary → resolveCreds(undefined)              — makepayment ships no creds block
//   PaymentSummary         → resolveCreds(info.easebuzzpay_cred)  — the BACKEND supplies them
//
// The second is the one worth pinning. If the backend hands back both sets —
// which it may, since one response shape serves both environments — a test
// build must take the sandbox one and must never be able to reach the live
// one. resolveCreds does that structurally: the env picks WHICH SUB-KEY is
// read, so on a test build `fofieasebuzz` is never even looked at.
describe("the customer portal takes sandbox credentials on a test build", () => {
  const BACKEND_SENDS_BOTH = {
    easebuzztest: { key: "SANDBOXKEY", salt: "SANDBOXSALT" },
    fofieasebuzz: { key: "LIVEKEY", salt: "LIVESALT" },
  };

  test("a backend block carrying BOTH sets yields the sandbox one", async () => {
    const { resolveCreds, EZ_ENV } = await import("./services/customer/easebuzz.js");
    expect(EZ_ENV).toBe("test");           // vitest runs as MODE=test
    expect(resolveCreds(BACKEND_SENDS_BOTH)).toEqual({ key: "SANDBOXKEY", salt: "SANDBOXSALT" });
  });

  test("the live pair in that block is unreachable, not merely deprioritised", async () => {
    const { resolveCreds } = await import("./services/customer/easebuzz.js");
    const got = resolveCreds(BACKEND_SENDS_BOTH);
    expect(got.key).not.toBe("LIVEKEY");
    expect(got.salt).not.toBe("LIVESALT");
  });

  test("a block with ONLY the live pair falls back to the sandbox, never uses it", async () => {
    const { resolveCreds, EZ_FALLBACK } = await import("./services/customer/easebuzz.js");
    expect(resolveCreds({ fofieasebuzz: { key: "LIVEKEY", salt: "LIVESALT" } }))
      .toEqual(EZ_FALLBACK.test);
  });

  test("the path that ships no block at all still gets the sandbox pair", async () => {
    const { resolveCreds, EZ_FALLBACK } = await import("./services/customer/easebuzz.js");
    // InternetPaymentSummary.jsx calls exactly this.
    expect(resolveCreds(undefined)).toEqual(EZ_FALLBACK.test);
  });

  test("both call sites go through resolveCreds — neither hardcodes a key", () => {
    for (const f of ["src/pages/customer/PaymentSummary.jsx", "src/pages/customer/InternetPaymentSummary.jsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/resolveCreds\(/);
      expect(src, f).not.toMatch(/2PBP7IABZ2|P0O87KRJ4R|DAH88E3UWQ|PM1XH32XM4/);
    }
  });
});
