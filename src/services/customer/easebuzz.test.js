import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha512Hex, buildPaymentHash } from "./easebuzz.js";

describe("easebuzz hashing", () => {
  it("sha512Hex matches the canonical SHA-512 of 'abc'", async () => {
    // FIPS 180-4 test vector — proves our Web Crypto path is byte-correct.
    expect(await sha512Hex("abc")).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
      "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
    );
  });

  it("buildPaymentHash uses the official key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt sequence", async () => {
    const f = {
      key: "P0O87KRJ4R", txnid: "SERV-2002-1-0000007", amount: "400.02",
      productinfo: "fofi", firstname: "Pwa Testing", email: "a@b.c",
      udf1: "1", udf2: "pwaapptest2", udf3: "serviceapp", udf4: "OP49", udf5: "eyJhIjoxfQ==",
      salt: "PM1XH32XM4",
    };
    // Independent reference: udf6..udf10 empty, trailing salt, NO trailing key.
    const seq = [
      f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email,
      f.udf1, f.udf2, f.udf3, f.udf4, f.udf5, "", "", "", "", "", f.salt,
    ].join("|");
    const expected = createHash("sha512").update(seq, "utf8").digest("hex");
    expect(await buildPaymentHash(f)).toBe(expected);
    // Sanity: exactly 16 separators → 17 fields.
    expect(seq.split("|").length).toBe(17);
  });
});

// ── Test-environment wiring ─────────────────────────────────────────
//
// Server team supplied the sandbox pair on 2026-08-31 (key 2PBP7IABZ2 / salt
// DAH88E3UWQ). Both were already in EZ_FALLBACK, and the pair was verified
// live against the sandbox the same day: POST testpay.easebuzz.in
// payment/initiateLink with a hash built by buildPaymentHash returned
// {"status": 1, "data": "<access_key>"} — so the credentials authenticate AND
// the hash sequence above is the one Easebuzz expects.
//
// These pin the wiring around that: the right pair for the right env, and a
// test build never able to reach the live host.
describe("sandbox credentials and env routing", () => {
  it("carries the server team's sandbox pair", async () => {
    const { EZ_FALLBACK } = await import("./easebuzz.js");
    expect(EZ_FALLBACK.test).toEqual({ key: "2PBP7IABZ2", salt: "DAH88E3UWQ" });
  });

  // Confirmed by the server team 2026-08-31, and the KEY was independently
  // verified against the LIVE gateway the same day: posting it to
  // pay.easebuzz.in/payment/initiateLink fails on missing parameters but NOT
  // with "Invalid merchant key", whereas the sandbox key and a made-up key both
  // are rejected that way. Pinned so a rotation has to be deliberate.
  it("carries the server team's LIVE pair", async () => {
    const { EZ_FALLBACK } = await import("./easebuzz.js");
    expect(EZ_FALLBACK.prod).toEqual({ key: "P0O87KRJ4R", salt: "PM1XH32XM4" });
  });

  it("never confuses the sandbox pair with the live one", async () => {
    const { EZ_FALLBACK } = await import("./easebuzz.js");
    expect(EZ_FALLBACK.test.key).not.toBe(EZ_FALLBACK.prod.key);
    expect(EZ_FALLBACK.test.salt).not.toBe(EZ_FALLBACK.prod.salt);
  });

  it("a paymentinfo creds block wins over the fallback, per env", async () => {
    const { resolveCreds, EZ_ENV, EZ_FALLBACK } = await import("./easebuzz.js");
    // Vitest runs as MODE=test, so EZ_ENV resolves to the sandbox.
    expect(EZ_ENV).toBe("test");
    expect(resolveCreds({ easebuzztest: { key: "K", salt: "S" } })).toEqual({ key: "K", salt: "S" });
    // Absent block → the sandbox fallback, never the live pair.
    expect(resolveCreds(undefined)).toEqual(EZ_FALLBACK.test);
    expect(resolveCreds({})).toEqual(EZ_FALLBACK.test);
  });

  it("routes the sandbox to the ezpay-test seam, not the live one", async () => {
    const { getInitiateUrl } = await import("./easebuzz.js");
    expect(getInitiateUrl("test")).toMatch(/ezpay-test\/payment\/initiateLink$/);
    expect(getInitiateUrl("test")).not.toMatch(/ezpay-prod/);
    // Anything that is not exactly "test" is treated as live — fail closed on
    // the ROUTE, never silently send live traffic down the sandbox seam.
    expect(getInitiateUrl("prod")).toMatch(/ezpay-prod\/payment\/initiateLink$/);
  });
});

// ── The deployment trap ─────────────────────────────────────────────
//
// The browser cannot call Easebuzz directly (initiateLink sends no CORS
// headers), so it goes through a same-origin seam. That seam existed in the
// vite dev proxy and in server.js but NOT in the generated .htaccess, so an
// Apache-hosted build answered the POST with the SPA shell at HTTP 200 —
// measured 2026-08-31 on netmontest: 10462 bytes of text/html.
// resp.ok does not catch that, and JSON.parse turned it into
// "Unexpected token '<'", which blames Easebuzz for our own missing rule.
describe("initiateLink diagnoses a missing proxy instead of blaming Easebuzz", () => {
  const shell = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8" />';
  const withFetch = async (resp, fn) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => resp;
    try { return await fn(); } finally { globalThis.fetch = original; }
  };

  it("names the missing rule when the SPA shell comes back at HTTP 200", async () => {
    const { initiateLink } = await import("./easebuzz.js");
    await withFetch(
      { ok: true, status: 200, text: async () => shell },
      async () => {
        await expect(initiateLink({ env: "test", params: {} }))
          .rejects.toThrow(/missing the ezpay proxy rule/i);
      }
    );
  });

  it("names mod_proxy when the .htaccess 502 fires", async () => {
    const { initiateLink } = await import("./easebuzz.js");
    await withFetch(
      { ok: false, status: 502, text: async () => "" },
      async () => {
        await expect(initiateLink({ env: "test", params: {} }))
          .rejects.toThrow(/proxy is not enabled/i);
      }
    );
  });

  // netmontest has no working https proxy today — usage-api, which also targets
  // an https backend, returns the SPA shell there too (measured 2026-08-31).
  // So this is the likely first response after deploying the .htaccess rule if
  // SSLProxyEngine is not turned on, and it must name that rather than read as
  // an Easebuzz outage.
  it("names SSLProxyEngine when Apache matched the route but could not proxy", async () => {
    const { initiateLink } = await import("./easebuzz.js");
    await withFetch(
      { ok: false, status: 500, text: async () => "" },
      async () => {
        await expect(initiateLink({ env: "test", params: {} }))
          .rejects.toThrow(/SSLProxyEngine/i);
      }
    );
  });

  it("still surfaces a genuine Easebuzz refusal verbatim", async () => {
    const { initiateLink } = await import("./easebuzz.js");
    await withFetch(
      { ok: true, status: 200, text: async () => JSON.stringify({ status: 0, data: "Invalid hash" }) },
      async () => {
        await expect(initiateLink({ env: "test", params: {} })).rejects.toThrow("Invalid hash");
      }
    );
  });

  it("returns the access_key on success", async () => {
    const { initiateLink } = await import("./easebuzz.js");
    await withFetch(
      { ok: true, status: 200, text: async () => JSON.stringify({ status: 1, data: "ACCESS123" }) },
      async () => {
        expect(await initiateLink({ env: "test", params: {} })).toBe("ACCESS123");
      }
    );
  });
});
