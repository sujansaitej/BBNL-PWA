import { describe, it, expect } from "vitest";
import {
    calendarDaysUntil,
    getAuthoritativeDays,
    getPeriodsArray,
    getPeriodValue,
    normaliseToInclusiveDays,
    parsePositiveInteger,
    resolveSubscriptionDays,
} from "./subscriptionDays";

// Payloads below are VERBATIM ServiceApis/planExtensionPeriods responses
// captured from prod on 2026-08-13 (operator creds, servkey "cabletv").
const RAGTEST9 = {
    status: { err_code: 0, err_msg: "success" },
    body: {
        periods: [{ label: "29 Days", period: 29 }],
        days_range: { min: 1, max: 29 },
    },
};

// Multi-period box. days_range.max (88) is NOT periods[0] (28) — this is the
// case that proves "use days_range.max" and "use the first period" are
// different rules, and that native picks the former.
const RAGTEST3 = {
    status: { err_code: 0, err_msg: "success" },
    body: {
        periods: [
            { label: "28 Days", period: 28 },
            { label: "30 Days", period: 30 },
            { label: "60 Days", period: 60 },
            { label: "88 Days", period: 88 },
        ],
        days_range: { min: 1, max: 88 },
    },
};

const NOT_ACTIVATED = {
    status: { err_code: 1, err_msg: "OTT Service is not available please activate the service" },
    body: null,
};

describe("getAuthoritativeDays — native's days_range.max rule", () => {
    it("returns days_range.max for a single-period box", () => {
        expect(getAuthoritativeDays(RAGTEST9)).toBe(29);
    });

    it("returns days_range.max, NOT periods[0], when they differ", () => {
        // Native: subscriptionNoofDays = days_range.getMax() overwrites the
        // provisional periods.get(0) assignment. Picking periods[0] here would
        // charge 28 days for an 88-day entitlement.
        expect(getAuthoritativeDays(RAGTEST3)).toBe(88);
        expect(getPeriodValue(getPeriodsArray(RAGTEST3)[0])).toBe("28");
    });

    it("returns null on a backend error envelope so callers keep their fallback", () => {
        expect(getAuthoritativeDays(NOT_ACTIVATED)).toBeNull();
    });

    it("returns null for a missing / malformed response rather than throwing", () => {
        expect(getAuthoritativeDays(undefined)).toBeNull();
        expect(getAuthoritativeDays(null)).toBeNull();
        expect(getAuthoritativeDays({})).toBeNull();
        expect(getAuthoritativeDays({ status: { err_code: 0 }, body: null })).toBeNull();
    });

    it("falls back to periods[0] when days_range is absent (native would NPE)", () => {
        const noRange = {
            status: { err_code: 0 },
            body: { periods: [{ label: "30 Days", period: 30 }, { label: "60 Days", period: 60 }] },
        };
        expect(getAuthoritativeDays(noRange)).toBe(30);
    });

    it("treats 0 as a real answer (plan expiring today), not a gap", () => {
        // Measured live: customer `pwaram`, expiry 16-08-2026, read on
        // 16-08-2026 → DATEDIFF 0 and days_range.max 0. Discarding that as
        // "no answer" drops the checkout to its 30-day default and bills a
        // full month to extend a plan with one day left.
        const mk = (max) => ({ status: { err_code: 0 }, body: { days_range: { min: 1, max }, periods: [] } });
        expect(getAuthoritativeDays(mk(0))).toBe(0);
        expect(getAuthoritativeDays(mk(-5))).toBeNull();
        expect(getAuthoritativeDays(mk("abc"))).toBeNull();
    });

    it("accepts a stringified max, as the backend sometimes sends", () => {
        expect(getAuthoritativeDays({
            status: { err_code: 0 },
            body: { days_range: { min: "1", max: "30" }, periods: [] },
        })).toBe(30);
    });

    it("never returns a fractional day count", () => {
        expect(getAuthoritativeDays({
            status: { err_code: 0 },
            body: { days_range: { min: 1, max: 29.9 }, periods: [] },
        })).toBe(29);
    });
});

describe("regression: the local expiry-date estimate that caused 30-vs-29", () => {
    // The old rule. Reproduced here ONLY to demonstrate why it was replaced —
    // it is a client-side re-implementation of a backend rule and its result
    // moves with the device clock.
    const localEstimate = (expiryMs, nowMs) => Math.floor((expiryMs - nowMs) / 86400000);

    it("loses a full day when expirydate arrives without its end-of-day time", () => {
        const withTime = new Date(2026, 8, 11, 23, 59, 59).getTime(); // 11-09-2026 11:59:59 pm
        const midnight = new Date(2026, 8, 11, 0, 0, 0).getTime();    // 11-09-2026 (no time)
        const now = new Date(2026, 7, 13, 13, 40, 0).getTime();       // 13-08-2026 1:40 pm

        expect(localEstimate(withTime, now)).toBe(29);
        expect(localEstimate(midnight, now)).toBe(28); // ← silently one day short
        // The backend's answer does not move with any of this.
        expect(getAuthoritativeDays(RAGTEST9)).toBe(29);
    });

    it("moves with the device clock; the backend number does not", () => {
        const expiry = new Date(2026, 8, 11, 23, 59, 59).getTime();
        const correctClock = new Date(2026, 7, 13, 1, 40, 0).getTime();
        const clockSkewedForward = new Date(2026, 7, 14, 1, 40, 0).getTime(); // +1 day

        expect(localEstimate(expiry, correctClock)).toBe(29);
        expect(localEstimate(expiry, clockSkewedForward)).toBe(28);
        expect(getAuthoritativeDays(RAGTEST9)).toBe(29);
        expect(getAuthoritativeDays(RAGTEST9)).toBe(29);
    });
});

// Live cross-backend measurement, 2026-08-14, customer ragtest9, box
// BBNL-ANDBOX-02200910. IDENTICAL request/headers, IDENTICAL expirydate; the
// two deployments simply count the expiry day differently.
const EXPIRY = "11-09-2026 11:59:59 pm";
const AUG_14 = new Date(2026, 7, 14, 12, 0, 0).getTime(); // DATEDIFF = 28
const ANDROID_BACKEND_MAX = 29; // bbnlnetmon.bbnl.in/prod  → DATEDIFF + 1
const PWA_BACKEND_MAX = 28;     // bbnlpwa.bbnl.in/prod     → DATEDIFF

describe("calendarDaysUntil", () => {
    it("counts whole calendar days, independent of the time of day", () => {
        expect(calendarDaysUntil(EXPIRY, AUG_14)).toBe(28);
        // Same date, 1 minute past midnight and 1 minute to midnight.
        expect(calendarDaysUntil(EXPIRY, new Date(2026, 7, 14, 0, 1).getTime())).toBe(28);
        expect(calendarDaysUntil(EXPIRY, new Date(2026, 7, 14, 23, 59).getTime())).toBe(28);
    });

    it("handles an expirydate with no time component", () => {
        expect(calendarDaysUntil("11-09-2026", AUG_14)).toBe(28);
    });

    it("returns null for unparseable input", () => {
        expect(calendarDaysUntil("N/A", AUG_14)).toBeNull();
        expect(calendarDaysUntil("", AUG_14)).toBeNull();
        expect(calendarDaysUntil(null, AUG_14)).toBeNull();
    });
});

describe("normaliseToInclusiveDays — reconciling the two backends", () => {
    it("adds the expiry day when the backend counted EXCLUSIVELY (bbnlpwa)", () => {
        expect(normaliseToInclusiveDays(PWA_BACKEND_MAX, EXPIRY, AUG_14)).toBe(29);
    });

    it("leaves an already-INCLUSIVE backend alone (bbnlnetmon = Android's)", () => {
        // The critical no-double-count case: the PWA PRODUCTION build points at
        // the same host Android does (bbnlnetmon, since 2026-08-19 — it used to
        // be bbnlpwa), and must not show 30 where Android shows 29.
        // normaliseToInclusiveDays is what makes that host swap a non-event.
        expect(normaliseToInclusiveDays(ANDROID_BACKEND_MAX, EXPIRY, AUG_14)).toBe(29);
    });

    it("makes both backends agree — the whole point of the fix", () => {
        expect(normaliseToInclusiveDays(PWA_BACKEND_MAX, EXPIRY, AUG_14))
            .toBe(normaliseToInclusiveDays(ANDROID_BACKEND_MAX, EXPIRY, AUG_14));
    });

    it("leaves a plan-capped max untouched rather than charging an unoffered day", () => {
        // 118 days remain but the plan only offers 30. Neither 30 === 118 nor
        // 30 === 119, so the relationship is unrecognised and we must not add.
        expect(normaliseToInclusiveDays(30, "09-12-2026", AUG_14)).toBe(30);
    });

    // REGRESSION (reported from the test server): the page still read 28 where
    // it should read 29. `expiryDate` is the string 'N/A' until
    // getMyPlanDetails delivers a cabletv row, so on a checkout opened before
    // that lands the probe had nothing to compare against — and "inconclusive"
    // used to mean "leave alone", i.e. silently drop the day.
    it("still adds the day on an exclusive backend when there is NO expiry date", () => {
        expect(normaliseToInclusiveDays(28, "N/A", AUG_14)).toBe(29);
        expect(normaliseToInclusiveDays(28, undefined, AUG_14)).toBe(29);
        expect(normaliseToInclusiveDays(28, "", AUG_14)).toBe(29);
    });

    it("an already-inclusive backend is still protected whenever the date IS available", () => {
        // The probe, not a hard-coded host list, is what prevents double-counting.
        expect(normaliseToInclusiveDays(29, EXPIRY, AUG_14)).toBe(29);
    });

    it("returns null for a missing backend value", () => {
        expect(normaliseToInclusiveDays(null, EXPIRY, AUG_14)).toBeNull();
        expect(normaliseToInclusiveDays(undefined, EXPIRY, AUG_14)).toBeNull();
        expect(normaliseToInclusiveDays(-3, EXPIRY, AUG_14)).toBeNull();
    });

    it("a plan expiring TODAY reads 1 day, not 0 and not the 30-day default", () => {
        const today = "16-08-2026 11:59:59 pm";
        const aug16 = new Date(2026, 7, 16, 12, 0, 0).getTime();
        expect(calendarDaysUntil(today, aug16)).toBe(0);
        expect(normaliseToInclusiveDays(0, today, aug16)).toBe(1);
    });

    it("rejects a 0 that contradicts a plan with time left", () => {
        // 28 days remain but the backend said 0 — not a cap, just wrong.
        // Reporting no answer lets the caller fall back instead of showing
        // "0 Days" and charging nothing.
        expect(normaliseToInclusiveDays(0, EXPIRY, AUG_14)).toBeNull();
    });

    it("is idempotent — normalising twice never adds two days", () => {
        const once = normaliseToInclusiveDays(PWA_BACKEND_MAX, EXPIRY, AUG_14);
        expect(normaliseToInclusiveDays(once, EXPIRY, AUG_14)).toBe(once);
    });
});

// Captured live from netmontest (.env.test) on 2026-08-16, customer iptvsub4,
// box BBNL-ANDBOX-08190251, expirydate 11-09-2026 11:59:59 pm → DATEDIFF = 26.
// This is the QA case: the page read 26 where it had to read 27.
// QA, 2026-08-17, customer testrag4, box BBNL-ANDBOX-08190120.
// A second month was added FROM THE BACKEND ADMIN — an event the PWA never
// observes. The service page picked up the new expiry (plandets_* has a 5-min
// TTL) but the payment page kept the pre-renewal day count for an hour, and
// because that stale count no longer agreed with the new expiry date the
// inclusive normalisation could not recognise it either. So the page fell from
// "30 Days" to "29 Days" instead of rising to 60.
describe("QA case — testrag4, renewed in the backend admin", () => {
    const BOX = "BBNL-ANDBOX-08190120";
    const OLD_EXPIRY = "15-09-2026 11:59:59 pm";   // 1 month  → DATEDIFF 29
    const NEW_EXPIRY = "15-10-2026 11:59:59 pm";   // 2 months → DATEDIFF 59
    const AUG_17 = new Date(2026, 7, 17, 12, 0, 0).getTime();
    const opts = { nowMs: AUG_17 };

    // Live payload after the renewal.
    const AFTER_RENEWAL = {
        status: { err_code: 0, err_msg: "success" },
        body: {
            periods: [{ label: "29 Days", period: 29 }, { label: "30 Days", period: 30 }, { label: "59 Days", period: 59 }],
            days_range: { min: 1, max: 59 },
        },
    };

    it("reads days_range.max (59) and not periods[0] (29)", () => {
        expect(calendarDaysUntil(NEW_EXPIRY, AUG_17)).toBe(59);
        expect(getAuthoritativeDays(AFTER_RENEWAL)).toBe(59);
        expect(getPeriodValue(getPeriodsArray(AFTER_RENEWAL)[0])).toBe("29");
    });

    it("shows 60 days after the renewal", () => {
        const raw = getAuthoritativeDays(AFTER_RENEWAL);
        const shown = resolveSubscriptionDays(
            { boxId: BOX, expiry: NEW_EXPIRY, days: raw }, BOX, null, NEW_EXPIRY, opts
        );
        expect(shown).toBe(60);
    });

    it("REFUSES a day count resolved against the pre-renewal expiry", () => {
        // Same box, stale expiry. Matching on the box alone would apply the
        // old 29 to the new subscription and reproduce the bug exactly.
        const stale = { boxId: BOX, expiry: OLD_EXPIRY, days: 29 };
        const localEstimate = 60;
        expect(resolveSubscriptionDays(stale, BOX, localEstimate, NEW_EXPIRY, opts)).toBe(60);
        // With no fallback either, report nothing rather than a wrong number.
        expect(resolveSubscriptionDays(stale, BOX, null, NEW_EXPIRY, opts)).toBeNull();
    });

    it("the stale count is exactly the 29 that was reported", () => {
        // Demonstrates the failure the expiry match prevents: 29 against a
        // 59-day-remaining subscription matches neither DATEDIFF nor
        // DATEDIFF+1, so it is not even recognised as needing the +1.
        expect(normaliseToInclusiveDays(29, NEW_EXPIRY, AUG_17)).toBe(29);
        expect(normaliseToInclusiveDays(29, OLD_EXPIRY, AUG_17)).toBe(30);
    });
});

describe("QA case — iptvsub4 on the netmontest test backend", () => {
    const IPTVSUB4 = {
        status: { err_code: 0, err_msg: "success" },
        body: { periods: [{ label: "26 Days", period: 26 }], days_range: { min: 1, max: 26 } },
    };
    const EXPIRY_SUB4 = "11-09-2026 11:59:59 pm";
    const AUG_16 = new Date(2026, 7, 16, 12, 0, 0).getTime();
    const BOX = "BBNL-ANDBOX-08190251";

    it("netmontest counts exclusively, like production and unlike Android's backend", () => {
        expect(calendarDaysUntil(EXPIRY_SUB4, AUG_16)).toBe(26);
        expect(getAuthoritativeDays(IPTVSUB4)).toBe(26);
    });

    it("shows 27, with OR without the expiry date loaded", () => {
        const raw = getAuthoritativeDays(IPTVSUB4);
        const opts = { nowMs: AUG_16 };
        const withDate = resolveSubscriptionDays({ boxId: BOX, expiry: EXPIRY_SUB4, days: raw }, BOX, null, EXPIRY_SUB4, opts);
        // 'N/A' is what expiryDate holds until getMyPlanDetails returns the
        // cabletv row — the path that used to silently drop the day.
        const noDate = resolveSubscriptionDays({ boxId: BOX, expiry: "N/A", days: raw }, BOX, null, "N/A", opts);
        expect(withDate).toBe(27);
        expect(noDate).toBe(27);
        expect(withDate).toBe(noDate);
    });
});

describe("resolveSubscriptionDays — what gets shown and charged", () => {
    const BOX = "BBNL-ANDBOX-02200910";
    const backend = (days, boxId = BOX, expiry = EXPIRY) => ({ boxId, expiry, days });
    const resolve = (bd, box, est, expiry = EXPIRY) =>
        resolveSubscriptionDays(bd, box, est, expiry, { nowMs: AUG_14 });

    it("shows 29 on the PWA backend — matching Android, which is the bug report", () => {
        // Field report: Android "30 Days" vs PWA "29 Days". Same shape, one day
        // later in the cycle: Android 29 vs PWA 28. After the fix, both read 29.
        expect(resolve(backend(PWA_BACKEND_MAX), BOX, null)).toBe(29);
        expect(resolve(backend(ANDROID_BACKEND_MAX), BOX, null)).toBe(29);
    });

    it("prefers the backend number over the local estimate for an ACTIVE subscriber", () => {
        expect(resolve(backend(PWA_BACKEND_MAX), BOX, 12)).toBe(29);
    });

    it("falls back to the local estimate before the backend answers", () => {
        expect(resolve(null, BOX, 29)).toBe(29);
    });

    it("returns null when neither source has a usable number", () => {
        expect(resolve(null, BOX, null)).toBeNull();
    });

    it("ignores a backend number resolved for a DIFFERENT box", () => {
        // React Router keeps this component mounted across :customerId changes,
        // so an unscoped value would price customer B on customer A's days.
        expect(resolve(backend(88, "BBNL-ANDBOX-OTHER"), BOX, 29)).toBe(29);
        expect(resolve(backend(88, "BBNL-ANDBOX-OTHER"), BOX, null)).toBeNull();
    });

    it("ignores the backend value before a box is known", () => {
        expect(resolve(backend(88), "", 29)).toBe(29);
    });

    it("ignores a corrupt persisted value and keeps the estimate", () => {
        expect(resolve(backend(0), BOX, 29)).toBe(29);
        expect(resolve(backend(null), BOX, 29)).toBe(29);
        expect(resolve(backend(undefined), BOX, 29)).toBe(29);
    });

    it("end-to-end: a live payload decides the charged period", () => {
        // This is the value that becomes cblextenperiod on
        // service/paymentinfo/cabletv AND cabletv/generateorder.
        const days = getAuthoritativeDays(RAGTEST9);
        expect(String(resolve(backend(days), BOX, null))).toBe("29");
    });
});

describe("supporting parsers", () => {
    it("getPeriodsArray tolerates the legacy body shapes", () => {
        expect(getPeriodsArray(RAGTEST3)).toHaveLength(4);
        expect(getPeriodsArray({ body: { result: [{ period: 7 }] } })).toHaveLength(1);
        expect(getPeriodsArray({ body: [{ period: 7 }] })).toHaveLength(1);
        expect(getPeriodsArray({ body: { periods: "nope" } })).toEqual([]);
        expect(getPeriodsArray(null)).toEqual([]);
    });

    it("parsePositiveInteger strips label text", () => {
        expect(parsePositiveInteger("30 Days")).toBe(30);
        expect(parsePositiveInteger("")).toBeNull();
        expect(parsePositiveInteger(null)).toBeNull();
        expect(parsePositiveInteger(0)).toBeNull();
    });
});
