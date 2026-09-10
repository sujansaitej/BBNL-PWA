/**
 * subscriptionDays.js — the "No of Subscription Days" rule, SINGLE SOURCE OF
 * TRUTH, extracted so it can be unit-tested against real captured
 * ServiceApis/planExtensionPeriods payloads.
 *
 * The rule belongs to the BACKEND. The number shown to the operator and the
 * `cblextenperiod` the order is priced and charged on must be the same value,
 * and that value must come from planExtensionPeriods — never from arithmetic
 * on the client.
 *
 * Native reference — CablePaymentInfoFragment.java:545-551 (employee flavour):
 *
 *     subscriptionNoofDays = periods.get(0).getPeriod();           // provisional
 *     sub_selected_days_tv.setText(days_range.getMax() + " Days"); // displayed
 *     subscriptionNoofDays = "" + days_range.getMax();             // ← wins
 *     IPTVPaymentInfo(subscriptionNoofDays);                       // prices with it
 *
 * The period spinner sitting next to that label is
 * `android:visibility="gone"` (fragement_payment_screen.xml:136-141, with the
 * comment "TODO : ABDUL SAID TO STOP THE PERIOD LIST AND SET THE MAX COUNT"),
 * so the operator never selects a period: displayed days == charged days ==
 * days_range.max, always.
 *
 * ── The off-by-one, and why it is NOT an app bug ──────────────────────────
 *
 * The Android CRM app and this PWA talk to DIFFERENT backend deployments, and
 * those deployments disagree on whether the expiry day itself is counted:
 *
 *   Android  → https://bbnlnetmon.bbnl.in/prod/   (Constants.CONGIF_URL_VALUE)
 *   PWA prod → https://bbnlpwa.bbnl.in/prod/      (.env.production)
 *
 * Measured live 2026-08-14 — same customer, same box, byte-identical request
 * and headers, and the SAME expirydate of "11-09-2026 11:59:59 pm":
 *
 *   bbnlnetmon → days_range.max = 29   ← DATEDIFF(expiry, today) + 1  (INCLUSIVE)
 *   bbnlpwa    → days_range.max = 28   ← DATEDIFF(expiry, today)      (EXCLUSIVE)
 *
 * Confirmed on 4/4 customers against bbnlnetmon (max − DATEDIFF = 1 every
 * time) and 2/2 against bbnlpwa (max − DATEDIFF = 0). So the operator sees
 * "30 Days" on Android and "29 Days" in the PWA for the same subscription:
 * the apps are both faithfully showing what their own server said.
 *
 * The INCLUSIVE count is the intended one. normaliseToInclusiveDays() below
 * therefore adds the missing day when — and only when — the backend answered
 * with the exclusive count. It detects that by comparing the backend's own
 * answer against the backend's own expirydate, so it is self-correcting:
 *   • on bbnlpwa it adds 1                 → matches Android today
 *   • on bbnlnetmon it adds nothing        → no double-count
 *   • if bbnlpwa is later patched to count inclusively, it stops adding, with
 *     no code change and no risk of silently charging an extra day
 *
 * Verified the extra day is safe to charge: service/paymentinfo/cabletv does
 * NOT clamp at days_range.max — it pro-rates linearly on whatever period is
 * sent (channel at ₹4.00 MRP priced 27→₹3.60, 28→₹3.73, 29→₹3.87, 30→₹4.00),
 * so the displayed day count and the amount charged stay in agreement.
 */

import { parseBackendDate } from "./dateParse";

/**
 * Extension periods offered by the backend.
 * Live shape (verified against prod 2026-08-13):
 *   body.periods    = [{ label: "29 Days", period: 29 }, …]
 *   body.days_range = { min: 1, max: 29 }
 * Older code looked for body.result / body-as-array, so those are tolerated.
 * @param {*} response planExtensionPeriods envelope
 * @returns {Array}
 */
export function getPeriodsArray(response) {
    const body = response?.body;
    const periods = body?.periods || body?.result || (Array.isArray(body) ? body : []);
    return Array.isArray(periods) ? periods : [];
}

/** Day count of a single period row, across the field names seen in the wild. */
export function getPeriodValue(period) {
    return String(period?.period ?? period?.id ?? period?.periodid ?? period?.value ?? period ?? "");
}

/** Lenient positive-integer coercion ("30 Days" → 30). null when not usable. */
export function parsePositiveInteger(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(String(value).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
}

/**
 * As above but 0 is a VALID answer, not "absent".
 *
 * The backend returns days_range.max = 0 for a plan expiring today — measured
 * live (customer `pwaram`, expiry 16-08-2026, on 16-08-2026: DATEDIFF 0,
 * max 0). Read through parsePositiveInteger that becomes null, i.e. "the
 * backend never answered", and the checkout falls through to its "30" default —
 * charging a full month to renew a plan with one day left on it.
 */
export function parseNonNegativeInteger(value) {
    if (value === undefined || value === null || value === "") return null;
    const stripped = String(value).replace(/[^\d.-]/g, "");
    // Must contain an actual digit. Without this, "abc" strips to "" and
    // Number("") is 0 — silently turning junk into a valid "0 days" answer.
    // parsePositiveInteger only avoided that because its n <= 0 check
    // rejected the 0 as a side effect.
    if (!/\d/.test(stripped)) return null;
    const n = Number(stripped);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
}

/**
 * THE number of subscription days, per the native rule above.
 *
 * `null` means "the backend has not answered (yet)" — callers must fall back
 * to their previous estimate rather than dead-ending or sending an empty
 * cblextenperiod (which the backend rejects with "Please choose some days").
 *
 * @param {*} response planExtensionPeriods envelope
 * @returns {number|null}
 */
export function getAuthoritativeDays(response) {
    if (response?.status?.err_code !== 0) return null;
    // Non-negative: 0 means "expires today", which is an answer, not a gap.
    const max = parseNonNegativeInteger(response?.body?.days_range?.max);
    if (max !== null) return max;
    // days_range absent — fall back to native's provisional first assignment
    // (line 545). Native would NPE here; any answer is strictly better.
    const first = getPeriodsArray(response)[0];
    return first ? parseNonNegativeInteger(getPeriodValue(first)) : null;
}

/**
 * Whole calendar days from today until `expiryRaw`, both normalised to local
 * midnight. Midnight-anchoring (rather than differencing raw timestamps) makes
 * this independent of the time of day and safe across DST, so the result only
 * changes when the date changes.
 *
 * @returns {number|null} null when the date cannot be parsed
 */
export function calendarDaysUntil(expiryRaw, nowMs = Date.now()) {
    const expiryMs = parseBackendDate(expiryRaw);
    if (expiryMs == null) return null;
    const expiry = new Date(expiryMs);
    expiry.setHours(0, 0, 0, 0);
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    return Math.round((expiry.getTime() - today.getTime()) / 86400000);
}

/**
 * Convert a backend day count to the INCLUSIVE convention the operator expects
 * (and that Android shows).
 *
 * Preferred signal is a per-request probe — compare the backend's own answer
 * against the backend's own expirydate:
 *
 *   DATEDIFF === max      → backend counted EXCLUSIVELY → add the expiry day
 *   DATEDIFF === max - 1  → already inclusive           → leave alone
 *   any other relationship→ the plan CAPS the extension below the days
 *                           remaining (e.g. a 30-day cap on 118 days left) →
 *                           leave alone, or we would charge a day the plan
 *                           does not sell
 *
 * When there is NO usable expirydate the probe cannot run at all. That is not
 * rare: `expiryDate` is 'N/A' until getMyPlanDetails delivers a cabletv row, so
 * a checkout opened before that lands — or a customer whose cable row is filed
 * under another service key — has no date to probe. Treating that as "leave
 * alone" is what made the page read 28 where it had to read 29, so it now adds
 * the day: every BBNL deployment measured counts exclusively.
 *
 * That default is deliberately NOT keyed on which host the build talks to. An
 * earlier version hard-coded "bbnlnetmon counts inclusively" from a live
 * measurement — and bbnlnetmon was changed two days later to count exclusively
 * like the others, at which point the constant was silently suppressing the
 * day it was supposed to protect. The per-request probe is the durable
 * mechanism; the default is just the common case.
 *
 * @param {number|string|null} backendMax days_range.max as the backend sent it
 * @param {string} expiryRaw subscribed_services[].expirydate from the SAME backend
 * @param {number} [nowMs]
 * @returns {number|null}
 */
export function normaliseToInclusiveDays(backendMax, expiryRaw, nowMs = Date.now()) {
    const max = parseNonNegativeInteger(backendMax);
    if (max === null) return null;
    const remaining = calendarDaysUntil(expiryRaw, nowMs);
    // No date to probe → assume exclusive (every measured deployment is).
    if (remaining === null) return max + 1;
    if (max === remaining) return max + 1;      // exclusive → add the expiry day
    if (max === remaining + 1) return max;      // already inclusive → leave alone
    // Unrecognised relationship. Normally the plan capping the extension below
    // the days remaining (30-day cap on 118 days left) — adding there would
    // charge a day the plan does not sell, so leave it.
    //
    // A 0 is the exception: the backend saying "0 days" while the plan still
    // has time left is contradictory, not a cap. Report no answer so the
    // caller falls back rather than rendering "0 Days" and charging nothing.
    return max === 0 ? null : max;
}

/**
 * Precedence for the day count actually shown and charged.
 *
 * 1. The backend's answer — normalised to the inclusive convention — but ONLY
 *    if it was resolved for the box now on screen.
 *    /customer/:customerId/service/iptv keeps the same component mounted as the
 *    route param changes (React Router swaps the param, it does not remount),
 *    so an unscoped number would leak into the next customer's checkout and
 *    price their order on the previous customer's entitlement.
 * 2. Otherwise the caller's local estimate — used only for the window before
 *    planExtensionPeriods answers, and if it never does.
 * 3. `null` when there is nothing to show; the caller then keeps its own
 *    default so `cblextenperiod` is never sent empty.
 *
 * The stored answer is matched on BOTH the box and the expiry date it was
 * resolved for. Matching on the box alone is not enough: `days_range.max` is
 * the days left on the subscription, so a renewal (including one done in the
 * backend admin, which this app never observes) changes the correct answer
 * without changing the box. A retained or session-restored count from before
 * such a renewal would then be applied to a subscription it does not describe.
 *
 * @param {{boxId: string, expiry: string, days: number}|null} backendDays
 *   raw answer plus the box AND expiry it belongs to
 * @param {string} currentBoxId box currently on screen
 * @param {number|null} localEstimate expiry-date fallback (already inclusive)
 * @param {string} expiryRaw expirydate used to detect the backend's convention
 * @param {{nowMs?: number}} [opts]
 * @returns {number|null}
 */
export function resolveSubscriptionDays(backendDays, currentBoxId, localEstimate, expiryRaw, opts = {}) {
    const { nowMs = Date.now() } = opts;
    const scoped = backendDays
        && currentBoxId
        && backendDays.boxId === String(currentBoxId)
        && String(backendDays.expiry ?? "") === String(expiryRaw ?? "");
    if (scoped) {
        const inclusive = normaliseToInclusiveDays(backendDays.days, expiryRaw, nowMs);
        if (inclusive !== null) return inclusive;
    }
    return parsePositiveInteger(localEstimate);
}
