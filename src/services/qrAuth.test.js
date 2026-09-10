/**
 * Wire-contract tests for the QR web-login / Netmon SSO pair.
 *
 * Response fixtures below are REAL, captured live on 2026-08-17 against both
 * https://bbnlnetmon.bbnl.in/ and https://bbnlpwa.bbnl.in/ — not invented from
 * the Android source. The two endpoints disagree about what err_code means,
 * and only live traffic shows that.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/prod/");
vi.stubEnv("VITE_API_AUTH_KEY", "MAIN_KEY");
vi.stubEnv("VITE_API_USERNAME", "mainuser");
vi.stubEnv("VITE_API_PASSWORD", "mainpass");
vi.stubEnv("VITE_API_APP_USER_TYPE", "employee");
vi.stubEnv("VITE_API_APP_VERSION", "1.2.0");
vi.stubEnv("VITE_WEBLOGIN_AUTH_KEY", "WEB_KEY");
vi.stubEnv("VITE_WEBLOGIN_USERNAME", "WEB_USER");
vi.stubEnv("VITE_WEBLOGIN_PASSWORD", "WEB_PASS");
vi.stubEnv("VITE_NETMON_CONSOLE_URL", "");
vi.stubEnv("VITE_API_APP_DIR_PATH", "/pwa/crm/");

// Captured live 2026-08-17.
const NETMON_OK = {
    status: { err_code: 1, err_msg: "" },
    body: { link: "https://bbnlpwa.bbnl.in/prod/login?q=$2y$10$LtNGPoi1nCYdNgZ6npHat" },
};
const NETMON_BAD_USER = { status: { err_code: 0, err_msg: "Invalid username" }, body: [] };
const NETMON_BAD_REQ = { status: { err_code: 0, err_msg: "Invalid request" }, body: null };
// REAL, captured with a deliberately bogus token. Note err_code is 0 — the
// SAME value the Android app treats as success.
const QR_BAD_TOKEN = { status: { err_code: 0, err_msg: "Invalid Token" }, body: null };
// REAL success, captured 2026-08-19 by minting a QR from
// QrcodeAuthentication/getqrcode and posting its token. NOTE err_code 1 —
// the same inversion as apploginlink, and the OPPOSITE of what Android checks.
const QR_OK = {
    status: { err_code: 1, err_msg: "" },
    body: { token: "$2y$10$iRHo2cEHzTVkrcc4d.39SulZqyuZhtaLAU0sf04pdmizqih12O0y6", verified: 1 },
};
// REAL: wrong operator for a valid token.
const QR_BAD_USER = { status: { err_code: 0, err_msg: "Invalid username" }, body: null };

let fetchMock;
function mockResponse(payload, { status = 200 } = {}) {
    const text = JSON.stringify(payload);
    return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}
function lastRequest() {
    const [url, opts] = fetchMock.mock.calls.at(-1);
    return { url, opts, headers: opts?.headers || {}, body: JSON.parse(opts?.body || "{}") };
}

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockResponse(NETMON_OK));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

// The QrcodeAuthentication service matches credential headers CASE-SENSITIVELY
// (only `Authorization`/`username`/`password`). Browsers always lowercase
// header names — the Fetch API normalises them and JS cannot override it — so
// no value sent from the client can satisfy it. Requests therefore go through
// a same-origin Apache proxy that re-attaches them with the right casing.
describe("requests go through the same-origin qr-api proxy", () => {
    test("apploginlink posts to the proxy path, not the service directly", async () => {
        const { getNetmonLoginLink } = await import("./qrAuth.js");
        await getNetmonLoginLink("superadmin");
        expect(lastRequest().url).toBe("/pwa/crm/qr-api/apploginlink");
    });

    test("verifyqrcode too", async () => {
        fetchMock.mockResolvedValue(mockResponse(QR_OK));
        const { verifyQrLogin } = await import("./qrAuth.js");
        await verifyQrLogin({ reference: "superadmin", token: "tok" });
        expect(lastRequest().url).toBe("/pwa/crm/qr-api/verifyqrcode");
    });

    test("NO credentials are sent from the browser", async () => {
        // Two reasons: the browser cannot send the casing the service needs,
        // and shipping them in the bundle exposed them to anyone with devtools.
        // Apache attaches them on the way through instead.
        const { getNetmonLoginLink } = await import("./qrAuth.js");
        await getNetmonLoginLink("superadmin");
        const h = lastRequest().headers;
        expect(h.Authorization).toBeUndefined();
        expect(h.username).toBeUndefined();
        expect(h.password).toBeUndefined();
        expect(h["Content-Type"]).toBe("application/json");
    });

    test("a missing proxy is reported as such, not as a credential problem", async () => {
        const { getNetmonLoginLink } = await import("./qrAuth.js");
        for (const [status, re] of [[502, /proxy is not enabled/i], [404, /proxy rule is missing/i]]) {
            fetchMock.mockResolvedValue({ ok: false, status, text: async () => "", json: async () => ({}) });
            await expect(getNetmonLoginLink("superadmin")).rejects.toThrow(re);
        }
    });

    // THE FAILURE BOTH PRODUCTION HOSTS WERE ACTUALLY SHOWING on 2026-08-24.
    // The two cases above only cover a proxy rule that exists and misbehaves.
    // When the deployed .htaccess predates the qr-api rules entirely, the path
    // is simply unmatched — neither a file nor a directory — so the SPA
    // fallback rewrites it to index.html and Apache answers HTTP 200 with an
    // 8936-byte HTML body. No status check catches that, and JSON.parse turned
    // it into `Netmon returned an unexpected response: "<!doctype html> …"`,
    // which points the reader at the backend instead of at the deployment.
    //
    // Measured the same day:
    //   netmontest.bbnl.in/pwa/crm/qr-api/apploginlink        -> 154 bytes JSON
    //   bbnlnetmon.bbnl.in/smartphone/crm/qr-api/apploginlink -> 8936 bytes HTML
    //   bbnlpwa.bbnl.in/smartphone/crm/qr-api/apploginlink    -> 8936 bytes HTML
    test("the SPA shell coming back is reported as a missing proxy rule", async () => {
        const { getNetmonLoginLink, verifyQrLogin } = await import("./qrAuth.js");
        const shell = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />';
        // HTTP 200 — resp.ok is true, so nothing above this can notice.
        fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => shell, json: async () => ({}) });
        await expect(getNetmonLoginLink("superadmin")).rejects.toThrow(/missing the qr-api proxy rule/i);
        await expect(verifyQrLogin({ reference: "superadmin", token: "t" }))
            .rejects.toThrow(/missing the qr-api proxy rule/i);
        // And it must NOT be mistaken for the credential-casing failure.
        await expect(getNetmonLoginLink("superadmin")).rejects.not.toThrow(/attach credentials/i);
    });
});

describe("reference_type differs per endpoint", () => {
    test("netmon SSO uses netmon_login", async () => {
        const { getNetmonLoginLink } = await import("./qrAuth.js");
        await getNetmonLoginLink("superadmin");
        // Sending "employer" here returns {"err_msg":"Invalid request"} — verified live.
        expect(lastRequest().body).toEqual({ reference_type: "netmon_login", reference: "superadmin" });
    });

    test("QR approval uses employer", async () => {
        fetchMock.mockResolvedValue(mockResponse(QR_OK));
        const { verifyQrLogin } = await import("./qrAuth.js");
        await verifyQrLogin({ reference: "superadmin", token: "TOK" });
        // Sending "netmon_login" here returns "Invalid request" — verified live.
        expect(lastRequest().body).toEqual({ reference_type: "employer", reference: "superadmin", token: "TOK" });
    });
});

describe("err_code is INVERTED on apploginlink", () => {
    test("err_code 1 is SUCCESS and carries the link", async () => {
        const { getNetmonLoginLink } = await import("./qrAuth.js");
        const r = await getNetmonLoginLink("superadmin");
        expect(r.ok).toBe(true);
        expect(r.link).toBe(NETMON_OK.body.link);
    });

    test("err_code 0 is FAILURE and yields no link", async () => {
        const { getNetmonLoginLink } = await import("./qrAuth.js");
        for (const fixture of [NETMON_BAD_USER, NETMON_BAD_REQ]) {
            fetchMock.mockResolvedValue(mockResponse(fixture));
            const r = await getNetmonLoginLink("nobody");
            expect(r.ok).toBe(false);
            expect(r.link).toBe("");
            expect(r.message).toBe(fixture.status.err_msg);
        }
    });

    test("verifyqrcode is INVERTED TOO — 1 is success, 0 is failure", async () => {
        const { verifyQrLogin } = await import("./qrAuth.js");

        fetchMock.mockResolvedValue(mockResponse(QR_OK));
        expect((await verifyQrLogin({ reference: "a", token: "b" })).ok).toBe(true);

        // Android checks `err_code == 0` (DashboardLatest.java:618), which is
        // the FAILURE value here — so it announces "Web Login Success" for a
        // rejected scan and says nothing when one is actually approved.
        for (const fixture of [QR_BAD_TOKEN, QR_BAD_USER]) {
            fetchMock.mockResolvedValue(mockResponse(fixture));
            const bad = await verifyQrLogin({ reference: "a", token: "x" });
            expect(bad.ok).toBe(false);
            expect(bad.message).toBe(fixture.status.err_msg);
        }
    });

    test("verifyqrcode: an empty-array body is not approval", async () => {
        const { verifyQrLogin } = await import("./qrAuth.js");
        fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1, err_msg: "" }, body: [] }));
        expect((await verifyQrLogin({ reference: "a", token: "b" })).ok).toBe(false);
    });

    test("verifyqrcode: verified:0 is a refusal, not an approval", async () => {
        const { verifyQrLogin } = await import("./qrAuth.js");
        fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1 }, body: { token: "t", verified: 0 } }));
        expect((await verifyQrLogin({ reference: "a", token: "b" })).ok).toBe(false);
    });
});

// QA (2026-08-18): "Login To Netmon" did nothing useful on the TEST server.
// The request was fine — the backend hardcodes /prod/ in the link it returns,
// and the test install lives at /netmon/. Measured: the /prod/ link 404s, the
// same token at /netmon/login answers HTTP 307 and establishes the session.
// QA 2026-08-18/19: "Login To Netmon" opened a 404 on the TEST server. The QR
// service mints the token but builds the link from a hardcoded /prod/ path plus
// the request host. Measured with the SAME token on two hosts:
//   http://124.40.244.211/…/apploginlink  → http://124.40.244.211/netmon/login?q=…  correct
//   https://netmontest.bbnl.in/…          → https://netmontest.bbnl.in/prod/login?q=… 404
// So the token comes from the response and the destination from config.
describe("alignNetmonLink — token from the backend, destination from config", () => {
    const withConsole = async (url) => {
        vi.stubEnv("VITE_NETMON_CONSOLE_URL", url);
        vi.resetModules();
        return (await import("./qrAuth.js")).alignNetmonLink;
    };

    test("sends the token to THIS environment's console (test = the IP host)", async () => {
        const align = await withConsole("http://124.40.244.211/netmon/login");
        expect(align("https://netmontest.bbnl.in/prod/login?q=$2y$10$abc"))
            .toBe("http://124.40.244.211/netmon/login?q=$2y$10$abc");
    });

    test("production console is left as production", async () => {
        const align = await withConsole("https://bbnlnetmon.bbnl.in/prod/login");
        expect(align("https://bbnlnetmon.bbnl.in/prod/login?q=TOK"))
            .toBe("https://bbnlnetmon.bbnl.in/prod/login?q=TOK");
    });

    test("preserves the token byte-for-byte — it IS the credential", async () => {
        const align = await withConsole("http://124.40.244.211/netmon/login");
        const q = "?q=$2y$10$LtNGPoi1nCYdNgZ6npHateezw9XFOOB/TwmBejZD75Gecd0LVDx.u";
        expect(align(`https://netmontest.bbnl.in/prod/login${q}`)).toContain(q);
    });

    test("an http console from an https app is allowed (navigation, not fetch)", async () => {
        const align = await withConsole("http://124.40.244.211/netmon/login");
        expect(align("https://netmontest.bbnl.in/prod/login?q=T")).toMatch(/^http:\/\//);
    });

    test("with NO console configured, falls back to correcting the path", async () => {
        vi.stubEnv("VITE_NETMON_CONSOLE_URL", "");
vi.stubEnv("VITE_API_APP_DIR_PATH", "/pwa/crm/");
        vi.stubEnv("VITE_API_BASE_URL", "https://netmontest.bbnl.in/netmon/");
        vi.resetModules();
        const { alignNetmonLink } = await import("./qrAuth.js");
        expect(alignNetmonLink("https://netmontest.bbnl.in/prod/login?q=T"))
            .toBe("https://netmontest.bbnl.in/netmon/login?q=T");
        vi.stubEnv("VITE_API_BASE_URL", "https://test.example/prod/");
        vi.resetModules();
    });

    test("passes through junk rather than mangling it", async () => {
        const align = await withConsole("http://124.40.244.211/netmon/login");
        expect(align("")).toBe("");
        expect(align(null)).toBe("");
        expect(align("not a url")).toBe("not a url");
    });

    test("getNetmonLoginLink returns the console-aligned link", async () => {
        vi.stubEnv("VITE_NETMON_CONSOLE_URL", "http://124.40.244.211/netmon/login");
        vi.resetModules();
        fetchMock.mockResolvedValue(mockResponse({
            status: { err_code: 1, err_msg: "" },
            body: { link: "https://netmontest.bbnl.in/prod/login?q=TOK" },
        }));
        const { getNetmonLoginLink } = await import("./qrAuth.js");
        const r = await getNetmonLoginLink("superadmin");
        expect(r.ok).toBe(true);
        expect(r.link).toBe("http://124.40.244.211/netmon/login?q=TOK");
        vi.stubEnv("VITE_NETMON_CONSOLE_URL", "");
vi.stubEnv("VITE_API_APP_DIR_PATH", "/pwa/crm/");
        vi.resetModules();
    });
});

describe("decodeQrLoginToken", () => {
    // THE REAL PAYLOAD, read off a QR minted by QrcodeAuthentication/getqrcode
    // (410x410, 1-bit PNG) and decoded with jsQR. Standard base64, padded,
    // length % 4 === 0, no URL-safe characters — so atob handles it directly.
    // The JSON carries ONLY `token`; the bcrypt hash inside contains "/",
    // which the server escapes as "\/".
    test("decodes the REAL netmon QR payload", async () => {
        const { decodeQrLoginToken } = await import("./qrAuth.js");
        const real = "eyJ0b2tlbiI6IiQyeSQxMCRyeVdyaU5tRE9yUmJxc0RwR0Z1UEYuLldsQVFsdHk0Rzl5WURkenJrXC9kVEF1VVhUMHIydWUifQ==";
        expect(decodeQrLoginToken(real))
            .toBe("$2y$10$ryWriNmDOrRbqsDpGFuPF..WlAQlty4G9yYDdzrk/dTAuUXT0r2ue");
    });

    test("extracts the token from base64 JSON, as Android does", async () => {
        const { decodeQrLoginToken } = await import("./qrAuth.js");
        const payload = { reference_type: "employer", reference: "superadmin", token: "$2y$10$abcDEF" };
        const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
        expect(decodeQrLoginToken(b64)).toBe("$2y$10$abcDEF");
    });

    test("takes ONLY the token — reference cannot be hijacked by the QR", () => {
        // The app supplies reference itself, so a doctored QR naming another
        // operator cannot redirect the approval.
        return import("./qrAuth.js").then(({ decodeQrLoginToken }) => {
            const evil = { reference_type: "employer", reference: "someone-else", token: "T" };
            const b64 = Buffer.from(JSON.stringify(evil), "utf8").toString("base64");
            expect(decodeQrLoginToken(b64)).toBe("T");
        });
    });

    test("accepts a bare token when the scanner returns it unwrapped", async () => {
        const { decodeQrLoginToken } = await import("./qrAuth.js");
        expect(decodeQrLoginToken("$2y$10$LtNGPoi1nCYdNgZ6npHateezw9XF")).toBe("$2y$10$LtNGPoi1nCYdNgZ6npHateezw9XF");
    });

    test("rejects junk rather than sending it to the backend", async () => {
        const { decodeQrLoginToken } = await import("./qrAuth.js");
        expect(decodeQrLoginToken("")).toBe("");
        expect(decodeQrLoginToken(null)).toBe("");
        expect(decodeQrLoginToken("hello")).toBe("");
        expect(decodeQrLoginToken("https://example.com/some/page")).toBe("");
        // base64 of JSON with no token field
        expect(decodeQrLoginToken(Buffer.from('{"a":1}', "utf8").toString("base64"))).toBe("");
    });
});
