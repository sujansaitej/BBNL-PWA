/**
 * subscriptionCache.js — invalidate every cached view of ONE box's
 * subscription after a payment, from whichever screen took the money.
 *
 * WHY THIS EXISTS
 * ---------------
 * QA (Aug 2026): renewing a FoFi Smart Box left the Cable TV page showing the
 * OLD expiry date.
 *
 * `fofi` and `cabletv` are not two subscriptions — they are two service-key
 * views of the SAME one. Verified live (netmontest, box BBNL-ANDBOX-08190251):
 *
 *   getMyPlanDetails(servicekey:"fofi")    → "FTA + FOFI KANNADA BOKEH",
 *                                             expiry 15-09-2026 11:59:59 pm
 *   getMyPlanDetails(servicekey:"cabletv") → "FTA + FOFI KANNADA BOKEH",
 *                                             expiry 15-09-2026 11:59:59 pm
 *
 * …but the PWA caches them under SEPARATE lsCache keys
 * (`plandets_<servicekey>_<userid>_<boxid>`, 5-minute TTL). The FoFi screens
 * only ever cleared `plandets_fofi_*`, so after a FoFi renewal the Cable TV
 * page kept serving the pre-payment expiry until the TTL lapsed. IPTVService
 * cleared both and so never showed the bug — the inconsistency was the bug.
 *
 * The Android app has NO response cache at all (ApiClient builds a plain
 * Retrofit/OkHttp client with no Cache), so every screen there re-reads
 * getMyPlanDetails live and the question never arises. The PWA caches for
 * speed, which means invalidation is ours to get right — and getting it right
 * per-screen is exactly what failed. Hence one function, called by every
 * screen that can move a subscription's expiry date.
 *
 * NOTE: wallet balance (`walbal_*`) is deliberately NOT cleared here. Callers
 * that debit a wallet re-read it with skipCache so the cache is left warm and
 * correct; blanking it just produces a "Loading…" flash on the next screen.
 */

import { lsRemove, lsRemoveByPrefix } from "./lsCache";

/** Assigned-item buckets that can carry the box (see utils/boxId.js). */
// "voicecall" is the servkey the Voice screens query getUserAssignedItems with
// (native's CustomerCompleteOverviewFragment passes the SERVICE key, not the
// "voip" bucket name that appears inside the response body) — so its cache
// entry is `uai_voicecall_*` and clearing only `uai_voip_*` would miss it.
const ASSIGNED_SERVICE_KEYS = ["fofi", "cabletv", "multi", "voip", "voicecall", "internet"];

/**
 * Drop every cached read that a completed payment has just invalidated.
 *
 * Clearing is by PREFIX, scoped to this customer, rather than by exact key.
 * The plan/subscription keys are suffixed with a box id
 * (`plandets_cabletv_<userid>_<boxid>`), and the callers do not all know the
 * box at the moment they need to invalidate — FoFiSmartBox invalidates at the
 * top of its fetch, before box discovery has run. Exact-key clearing there
 * would silently miss the one entry that matters, which is the bug this
 * module exists to prevent. Prefix clearing also covers customers with more
 * than one box.
 *
 * @param {object}  params
 * @param {string}  params.userid        customer id the plan belongs to
 * @param {boolean}[params.orderHistory] also drop order-history lists
 */
export function invalidateSubscriptionCaches({ userid, orderHistory = true }) {
    if (!userid) return;

    try {
        lsRemoveByPrefix([
            // Plan details for BOTH service keys — the same subscription seen
            // two ways, so one payment moves both.
            `plandets_cabletv_${userid}_`,
            `plandets_fofi_${userid}_`,
            // Voice renewals move their own expiry date, and a voice plan
            // bundled with a box (reg_serv_keys carrying both) moves the box's
            // too — so the voice view is cleared alongside the other two.
            `plandets_voicecall_${userid}_`,
            // Subscribed channel/package sets after a cable purchase.
            `iptvLastSub_${userid}_`,
            // The remaining-days answer moves with the expiry date, and it is
            // what the checkout charges on — a stale entry would price the
            // next order on the pre-payment entitlement.
            `extper_${userid}_`,
        ]);

        // Which items are assigned to the customer can change on activation.
        for (const key of ASSIGNED_SERVICE_KEYS) {
            lsRemove(`uai_${key}_${userid}`);
        }

        if (orderHistory) {
            lsRemoveByPrefix(`orderhist_${userid}_`);
        }
    } catch (_) {
        // Cache clearing is best-effort: localStorage can throw in private
        // mode / when full, and a failure here must never block a completed
        // payment's success path.
    }
}
