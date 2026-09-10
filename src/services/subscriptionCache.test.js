import { describe, it, expect, beforeEach } from "vitest";
import { invalidateSubscriptionCaches } from "./subscriptionCache";
import { lsSet, lsGet } from "./lsCache";

const FRESH = 60 * 60 * 1000;
const USER = "iptvsub4";
const BOX = "BBNL-ANDBOX-08190251";
const OTHER = "someoneelse";

// A plan-details payload as getMyPlanDetails caches it.
const plan = (expiry) => ({
    status: { err_code: 0 },
    body: { subscribed_services: [{ servicekey: "cabletv", planname: "FTA + FOFI", expirydate: expiry }] },
});

describe("invalidateSubscriptionCaches", () => {
    beforeEach(() => localStorage.clear());

    // THE BUG: renewing a FoFi Smart Box left the Cable TV page on the old
    // expiry date. `fofi` and `cabletv` are the same subscription under two
    // service keys — verified live, identical planname and expirydate — but
    // they cache under separate keys, and the FoFi screens only cleared their
    // own. Up to 5 minutes of a stale expiry date on the Cable TV page.
    it("clears the CABLETV plan view, not just the fofi one", () => {
        lsSet(`plandets_fofi_${USER}_${BOX}`, plan("15-09-2026 11:59:59 pm"));
        lsSet(`plandets_cabletv_${USER}_${BOX}`, plan("15-09-2026 11:59:59 pm"));

        invalidateSubscriptionCaches({ userid: USER });

        expect(lsGet(`plandets_fofi_${USER}_${BOX}`, FRESH)).toBeNull();
        expect(lsGet(`plandets_cabletv_${USER}_${BOX}`, FRESH)).toBeNull();
    });

    // FoFiSmartBox invalidates at the top of its fetch, BEFORE box discovery
    // has run, so it cannot pass a boxId. Exact-key clearing would miss the
    // box-suffixed entry — the only one that matters.
    it("clears box-suffixed entries even when the box id is unknown to the caller", () => {
        lsSet(`plandets_cabletv_${USER}_${BOX}`, plan("15-09-2026"));
        lsSet(`plandets_cabletv_${USER}_`, plan("15-09-2026"));
        lsSet(`iptvLastSub_${USER}_${BOX}`, { status: { err_code: 0 }, body: {} });
        lsSet(`extper_${USER}_cabletv_${BOX}`, { status: { err_code: 0 }, body: {} });

        invalidateSubscriptionCaches({ userid: USER });

        expect(lsGet(`plandets_cabletv_${USER}_${BOX}`, FRESH)).toBeNull();
        expect(lsGet(`plandets_cabletv_${USER}_`, FRESH)).toBeNull();
        expect(lsGet(`iptvLastSub_${USER}_${BOX}`, FRESH)).toBeNull();
        expect(lsGet(`extper_${USER}_cabletv_${BOX}`, FRESH)).toBeNull();
    });

    it("clears every box when a customer has more than one", () => {
        const box2 = "BBNL-ANDBOX-99999999";
        lsSet(`plandets_cabletv_${USER}_${BOX}`, plan("a"));
        lsSet(`plandets_cabletv_${USER}_${box2}`, plan("b"));

        invalidateSubscriptionCaches({ userid: USER });

        expect(lsGet(`plandets_cabletv_${USER}_${BOX}`, FRESH)).toBeNull();
        expect(lsGet(`plandets_cabletv_${USER}_${box2}`, FRESH)).toBeNull();
    });

    it("clears assigned-item and order-history views", () => {
        for (const k of ["fofi", "cabletv", "multi", "voip", "internet"]) {
            lsSet(`uai_${k}_${USER}`, { status: { err_code: 0 }, body: {} });
        }
        lsSet(`orderhist_${USER}_fofi`, { body: [] });
        lsSet(`orderhist_${USER}_all`, { body: [] });

        invalidateSubscriptionCaches({ userid: USER });

        for (const k of ["fofi", "cabletv", "multi", "voip", "internet"]) {
            expect(lsGet(`uai_${k}_${USER}`, FRESH)).toBeNull();
        }
        expect(lsGet(`orderhist_${USER}_fofi`, FRESH)).toBeNull();
        expect(lsGet(`orderhist_${USER}_all`, FRESH)).toBeNull();
    });

    it("does NOT touch another customer's cached plan", () => {
        // Prefix clearing is scoped per userid; an operator paying for one
        // customer must not cause a refetch storm for every other customer.
        lsSet(`plandets_cabletv_${OTHER}_${BOX}`, plan("15-09-2026"));
        lsSet(`uai_fofi_${OTHER}`, { status: { err_code: 0 }, body: {} });

        invalidateSubscriptionCaches({ userid: USER });

        expect(lsGet(`plandets_cabletv_${OTHER}_${BOX}`, FRESH)).not.toBeNull();
        expect(lsGet(`uai_fofi_${OTHER}`, FRESH)).not.toBeNull();
    });

    it("leaves the wallet cache alone", () => {
        // Callers that debit a wallet re-read it with skipCache; blanking it
        // here would only produce a "Loading…" flash on the next screen.
        lsSet(`walbal_superadmin_fofi`, { status: { err_code: 0 }, body: { wallet_balance: 100 } });
        invalidateSubscriptionCaches({ userid: USER });
        expect(lsGet(`walbal_superadmin_fofi`, FRESH)).not.toBeNull();
    });

    it("is a no-op without a userid, and never throws", () => {
        lsSet(`plandets_cabletv_${USER}_${BOX}`, plan("15-09-2026"));
        expect(() => invalidateSubscriptionCaches({ userid: "" })).not.toThrow();
        expect(lsGet(`plandets_cabletv_${USER}_${BOX}`, FRESH)).not.toBeNull();
    });
});
