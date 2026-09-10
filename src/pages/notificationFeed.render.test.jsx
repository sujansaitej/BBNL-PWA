/** @vitest-environment jsdom */
/**
 * The Notification History screen asks for the right feed.
 *
 * `app_type` SELECTS THE NOTIFICATION SET server-side. One screen serves both
 * portals — the header menu offers it to operators and customers alike — and
 * it always asked for the operator feed, so a customer was looked up as an
 * `admin.user` and could only ever be told they had nothing.
 *
 * Verified live 2026-08-31, same cid, two app_types, two different sets:
 *   cid=superadmin app_type=crm          → "Transaction success!!" …
 *   cid=superadmin app_type=customer_app → "Welcome" …
 *
 * It hid for weeks because the endpoint 500'd on every request when this screen
 * was written. Once the backend was fixed the wrong feed became reachable, and
 * its symptom — an empty list — is indistinguishable from having no
 * notifications, which is exactly why it needs a test rather than a look.
 *
 * services/notifications.test.js already pins the request shape; the gap this
 * covers is the SCREEN never passing appType at all.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getNotificationHistory = vi.fn();
vi.mock("../services/notifications", async (orig) => ({
    ...(await orig()),
    getNotificationHistory: (...a) => getNotificationHistory(...a),
}));

vi.mock("../services/safeStorage", () => ({ getUser: () => ({ username: "superadmin" }) }));

vi.mock("react-router-dom", async (orig) => ({
    ...(await orig()),
    useNavigate: () => vi.fn(),
}));

import NotificationHistory from "./NotificationHistory";
import { APP_TYPE_CRM, APP_TYPE_CUSTOMER } from "../services/notifications";

const mount = () => render(<MemoryRouter><NotificationHistory /></MemoryRouter>);

beforeEach(() => {
    localStorage.clear();
    getNotificationHistory.mockReset().mockResolvedValue({ ok: true, items: [], message: "" });
});
afterEach(cleanup);

describe("the feed follows the signed-in portal", () => {
    test("a customer gets the customer feed", async () => {
        localStorage.setItem("loginType", "customer");
        mount();
        await waitFor(() => expect(getNotificationHistory).toHaveBeenCalled());
        // THE REGRESSION: this used to be "crm" for everyone.
        expect(getNotificationHistory).toHaveBeenCalledWith(
            expect.objectContaining({ appType: APP_TYPE_CUSTOMER })
        );
    });

    test.each([["franchisee"], [null]])("an operator gets the operator feed (loginType %s)", async (loginType) => {
        if (loginType) localStorage.setItem("loginType", loginType);
        mount();
        await waitFor(() => expect(getNotificationHistory).toHaveBeenCalled());
        expect(getNotificationHistory).toHaveBeenCalledWith(
            expect.objectContaining({ appType: APP_TYPE_CRM })
        );
    });

    test("the signed-in username is sent as cid either way", async () => {
        localStorage.setItem("loginType", "customer");
        mount();
        await waitFor(() => expect(getNotificationHistory).toHaveBeenCalled());
        expect(getNotificationHistory).toHaveBeenCalledWith(
            expect.objectContaining({ cid: "superadmin" })
        );
    });

    // The two feeds must stay distinguishable. If someone collapses these to
    // one constant the screen silently serves the wrong set again.
    test("the two feed identifiers are not the same value", () => {
        expect(APP_TYPE_CRM).not.toBe(APP_TYPE_CUSTOMER);
    });
});

describe("the screen still tells the truth about failures", () => {
    test("an empty feed reads as empty, not as an error", async () => {
        mount();
        expect(await screen.findByText(/no notifications yet/i)).toBeTruthy();
    });

    // Android's requestFailed() only logs, leaving a blank screen that looks
    // identical to an empty inbox. This screen must keep separating the two —
    // it is how a backend regression stays visible.
    test("a failure is reported and retryable", async () => {
        getNotificationHistory.mockResolvedValue({ ok: false, items: [], message: "Notifications are unavailable right now." });
        mount();
        expect(await screen.findByText(/unavailable right now/i)).toBeTruthy();
        expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    });
});
