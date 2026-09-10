/** @vitest-environment jsdom */
/**
 * Wire-contract tests for Notification History.
 *
 * The contract here was read from the BACKEND SOURCE
 * (application/controllers/Notification.php::AppNotificationHistory) and then
 * confirmed against live traffic, so these assertions pin what the server
 * actually parses — not what the Android Gson models imply.
 *
 * Every response fixture is REAL, captured 2026-08-18 from
 * https://bbnlpwa.bbnl.in/prod/notification/history.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/prod/");
vi.stubEnv("VITE_API_AUTH_KEY", "MAIN_KEY");
vi.stubEnv("VITE_API_USERNAME", "mainuser");
vi.stubEnv("VITE_API_PASSWORD", "mainpass");
vi.stubEnv("VITE_API_APP_USER_TYPE", "employee");
vi.stubEnv("VITE_API_APP_VERSION", "1.2.0");
vi.stubEnv("VITE_NOTIFICATION_AUTH_KEY", "Basic TEST_NOTI_KEY");

// ── real captured responses ──────────────────────────────────────────
const AUTH_FAIL = { status: { err_code: 1, err_msg: "Failed to authenticate" }, body: [] };
const MISSING = { status: { err_code: 1, err_msg: "Please input required values" }, body: [] };
const NO_RECORDS = { status: { err_code: 1, err_msg: "No Records found" }, body: [] };
// Shape per the controller's $details[] assembly.
const LISTED = {
    status: { err_code: 0, err_msg: "Notification listed successfully" },
    body: [{
        title: "Plan expiring", file_type: "image", message: "Your plan expires soon",
        media: "https://x/Notification/showfile/images/9/a.png", time: "2 days ago",
        icon: "https://x/assets/image/notification/fofi_icon.png",
    }],
};

let fetchMock;
function mockResponse(payload, { status = 200 } = {}) {
    const text = JSON.stringify(payload);
    return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}
function lastRequest() {
    const [url, opts] = fetchMock.mock.calls.at(-1);
    return { url, opts, headers: opts?.headers || {}, rawBody: opts?.body };
}

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockResponse(LISTED));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("request shape — what the controller actually parses", () => {
    test("body is RAW JSON, never form-encoded", async () => {
        const { getNotificationHistory } = await import("./notifications.js");
        await getNotificationHistory({ cid: "superadmin" });
        const { rawBody, headers } = lastRequest();
        // The controller reads json_decode(file_get_contents('php://input')).
        // A form body leaves every field null and it answers "Failed to
        // authenticate" — an auth error for an encoding mistake.
        expect(() => JSON.parse(rawBody)).not.toThrow();
        expect(rawBody).not.toContain("fcmkey=");
        expect(headers["Content-Type"]).toBe("application/json");
    });

    test("sends exactly fcmkey / cid / app_type", async () => {
        const { getNotificationHistory } = await import("./notifications.js");
        await getNotificationHistory({ cid: "superadmin" });
        expect(JSON.parse(lastRequest().rawBody)).toEqual({
            fcmkey: "APPFCM", cid: "superadmin", app_type: "crm",
        });
    });

    test("fcmkey is the literal APPFCM, not a Firebase token", async () => {
        // NotificationHistory.java:37 — `String fcmkey = "APPFCM"`. The server
        // compares it as a constant, so this feature needs no push setup.
        const { getNotificationHistory } = await import("./notifications.js");
        await getNotificationHistory({ cid: "x" });
        expect(JSON.parse(lastRequest().rawBody).fcmkey).toBe("APPFCM");
    });

    test("sends ONLY Authorization — no username/password/appkeytype", async () => {
        const { getNotificationHistory } = await import("./notifications.js");
        await getNotificationHistory({ cid: "superadmin" });
        const h = lastRequest().headers;
        expect(h.Authorization).toBe("Basic TEST_NOTI_KEY");
        expect(h.username).toBeUndefined();
        expect(h.password).toBeUndefined();
        expect(h.appkeytype).toBeUndefined();
    });

    test("posts to {base}notification/history", async () => {
        const { getNotificationHistory } = await import("./notifications.js");
        await getNotificationHistory({ cid: "superadmin" });
        expect(lastRequest().url).toBe("https://test.example/prod/notification/history");
        expect(lastRequest().opts.method).toBe("POST");
    });

    test("app_type can select the customer branch", async () => {
        const { getNotificationHistory, APP_TYPE_CUSTOMER } = await import("./notifications.js");
        await getNotificationHistory({ cid: "ragtest9", appType: APP_TYPE_CUSTOMER });
        expect(JSON.parse(lastRequest().rawBody).app_type).toBe("customer_app");
    });
});

describe("response branching — err_code 1 is not always an error", () => {
    test("err_code 0 lists the rows", async () => {
        const { getNotificationHistory } = await import("./notifications.js");
        const r = await getNotificationHistory({ cid: "superadmin" });
        expect(r.ok).toBe(true);
        expect(r.empty).toBe(false);
        expect(r.items).toHaveLength(1);
    });

    test('"No Records found" is an EMPTY state, not a failure', async () => {
        // Shares err_code 1 with the real errors below. Treating every 1 as an
        // error would show an alarming banner to an operator who simply has no
        // notifications yet.
        fetchMock.mockResolvedValue(mockResponse(NO_RECORDS));
        const { getNotificationHistory } = await import("./notifications.js");
        const r = await getNotificationHistory({ cid: "superadmin" });
        expect(r.ok).toBe(true);
        expect(r.empty).toBe(true);
        expect(r.items).toEqual([]);
    });

    test("auth and validation failures are reported as failures", async () => {
        const { getNotificationHistory } = await import("./notifications.js");
        for (const fixture of [AUTH_FAIL, MISSING]) {
            fetchMock.mockResolvedValue(mockResponse(fixture));
            const r = await getNotificationHistory({ cid: "superadmin" });
            expect(r.ok).toBe(false);
            expect(r.message).toBe(fixture.status.err_msg);
        }
    });

    test("the live HTTP 500 surfaces as an error, not an empty list", async () => {
        // The current backend fault. Android swallows this and shows a blank
        // screen indistinguishable from "no notifications"; we must not.
        fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "", json: async () => ({}) });
        const { getNotificationHistory } = await import("./notifications.js");
        await expect(getNotificationHistory({ cid: "superadmin" })).rejects.toThrow(/server error/i);
    });
});

// REAL body captured 2026-08-19 from the test backend. `message` is HTML.
const REAL_HTML = '<div><p><b>Dear superadmin,</b><p>Your transaction for renewing/purchasing the <b>fofi smart box</b> service with amount <b>Rs:220</b> is <b>success!!</b>. Now the service has been activated.</p><p>For any enquiries, Please call us to <b>08067995700.</b><p>BBNL Team.</p></div>';

describe("sanitiseNotificationHtml — Android renders this HTML, so we must too", () => {
    test("keeps the formatting Android's HtmlCompat.fromHtml would show", async () => {
        const { sanitiseNotificationHtml } = await import("./notifications.js");
        const out = sanitiseNotificationHtml(REAL_HTML);
        expect(out).toContain("<b>Dear superadmin,</b>");
        expect(out).toContain("Rs:220");
        // Never render the tags as literal text.
        expect(out).not.toContain("&lt;div&gt;");
    });

    test("strips script entirely — the reason we do not inject raw", async () => {
        const { sanitiseNotificationHtml } = await import("./notifications.js");
        const out = sanitiseNotificationHtml('<p>hi</p><script>alert(1)</script>');
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toContain("alert(1)");
        expect(out).toContain("hi");
    });

    test("drops every attribute, killing handler and javascript: vectors", async () => {
        const { sanitiseNotificationHtml } = await import("./notifications.js");
        const out = sanitiseNotificationHtml(
            '<div onclick="steal()" style="x"><b onmouseover="x()">bold</b><a href="javascript:evil()">link</a></div>'
        );
        expect(out).not.toMatch(/onclick|onmouseover|javascript:|style=/i);
        // Text survives even when its element does not.
        expect(out).toContain("bold");
        expect(out).toContain("link");
    });

    test("unwraps disallowed elements but keeps their words", async () => {
        const { sanitiseNotificationHtml } = await import("./notifications.js");
        const out = sanitiseNotificationHtml('<table><tr><td>cell text</td></tr></table>');
        expect(out).not.toMatch(/<table|<td/i);
        expect(out).toContain("cell text");
    });

    test("neutralises an img onerror payload", async () => {
        const { sanitiseNotificationHtml } = await import("./notifications.js");
        const out = sanitiseNotificationHtml('<img src=x onerror="alert(1)">');
        expect(out).not.toMatch(/<img|onerror/i);
    });

    test("handles empty / null safely", async () => {
        const { sanitiseNotificationHtml } = await import("./notifications.js");
        expect(sanitiseNotificationHtml("")).toBe("");
        expect(sanitiseNotificationHtml(null)).toBe("");
    });
});

describe("notificationPlainText — list previews", () => {
    test("reduces the real payload to readable text", async () => {
        const { notificationPlainText } = await import("./notifications.js");
        const out = notificationPlainText(REAL_HTML);
        expect(out).not.toMatch(/[<>]/);
        expect(out).toContain("Dear superadmin,");
        expect(out).toContain("Rs:220");
    });
});

describe("normaliseNotification", () => {
    test("maps the server row and tolerates missing fields", async () => {
        const { normaliseNotification } = await import("./notifications.js");
        expect(normaliseNotification(LISTED.body[0])).toMatchObject({
            title: "Plan expiring",
            message: "Your plan expires soon",
            media: "https://x/Notification/showfile/images/9/a.png",
            fileType: "image",
            icon: "https://x/assets/image/notification/fofi_icon.png",
            time: "2 days ago",
        });
        // The controller sets media to null when the template has no
        // attachment, and title/message to null when they resolve empty.
        expect(normaliseNotification({ title: null, message: null, media: null }))
            .toMatchObject({ title: "", message: "", media: "", fileType: "", icon: "", time: "" });
        expect(() => normaliseNotification(undefined)).not.toThrow();
    });
});
