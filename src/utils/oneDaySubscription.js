/**
 * oneDaySubscription.js — the "One day" IPTV subscription option, SINGLE
 * SOURCE OF TRUTH for when it may be offered and what it puts on the wire.
 *
 * Requested 3 Sep 2026 for the operator (crmapp) Cable TV checkout:
 *
 *     POST service/paymentinfo/cabletv      { …, "cblextenperiod": 1, "use_day_expiry": 1 }
 *     POST ServiceApis/cabletv/generateorder { …, "cblextenperiod": 1, "use_day_expiry": 1 }
 *
 * BOTH calls must carry the flag. `cabletv/generateorder` is routed straight
 * to ServiceApis::generateBill (routes.php:520), and generateBill is where
 * the flag actually does its work — the expiry (ServiceApis.php:3996-4035)
 * and the wallet debit formula (WalletTxnsDeductions.php:57-70,
 * OnlineTxnsDeductions.php:31-33). paymentinfo alone only prices.
 *
 * ── What the backend does with it (read from the source, verified live on
 *    netmontest 3 Sep 2026) ──────────────────────────────────────────────
 *
 *  • PRICE: purely pro-rated on cblextenperiod. The flag changes nothing
 *    about the amount — period 1 costs the same ₹2.63 with or without it
 *    (period 30: ₹79.06). So the flag is not "the discount"; the period is.
 *  • EXPIRY: with the flag, generateBill sets expiry = today + 1 day
 *    (`findExpiryDate($today, 1, 1, 1)`) — but ONLY when
 *
 *        $applyDayBased = use_day_expiry && !empty(channelid) && empty(packageid)
 *
 *    i.e. À-LA-CARTE CHANNELS WITH NO PACKAGES, and platform != 'stb'.
 *    With a package in the basket the flag is silently ignored for expiry,
 *    while the price is still pro-rated to ONE day — the operator would pay
 *    1/30th for a full period. That is a revenue leak, not a feature, so
 *    `oneDayAllowed()` below refuses the option whenever a package is
 *    selected, and the UI explains why.
 *  • WALLET: with the flag, the `bussinessshare_json.default` share is not
 *    added to the debit and a fixed `day_based_split` (BBNL/op) from general
 *    settings is carved out of the plan amount. Backend-side; nothing for
 *    the PWA to compute.
 *
 * ── Not affecting the existing flow ──────────────────────────────────────
 *
 * `dayExpiryFields()` returns an EMPTY object unless the option is on, so the
 * default checkout's wire payload is byte-for-byte what it was — no
 * `use_day_expiry: 0`, no `use_day_expiry: ""`. The backend treats anything
 * but '1'/'yes' as off anyway, but the point is that a diff of the default
 * request against last week's shows nothing.
 *
 * The customer (serviceapp / Easebuzz) checkout is deliberately NOT wired:
 * its order is regenerated server-side from the Easebuzz `udf5` blob, and
 * whether that path reads `use_day_expiry` is unverified. Adding it there
 * without that proof would price a customer for one day and possibly grant
 * a month.
 */

/** The period sent for a one-day subscription. */
export const ONE_DAY_PERIOD = "1";

/**
 * May "One day" be offered for this basket?
 *
 * Mirrors generateBill's `$applyDayBased` gate exactly: channels present,
 * packages absent. Anything else and the backend would price one day but
 * not expire in one day.
 *
 * @param {{chIds?: any[], pkgIds?: any[]}} parts
 * @returns {boolean}
 */
export function oneDayAllowed({ chIds = [], pkgIds = [] } = {}) {
  return Array.isArray(chIds) && chIds.length > 0 && (!Array.isArray(pkgIds) || pkgIds.length === 0);
}

/**
 * Why the option is unavailable, for the UI. Empty string when it is allowed.
 */
export function oneDayBlockedReason(parts) {
  if (oneDayAllowed(parts)) return "";
  const pkgs = parts?.pkgIds || [];
  if (pkgs.length > 0) return "One-day subscription is available for individual channels only, not packages.";
  return "Select at least one channel to use a one-day subscription.";
}

/**
 * Is the option actually in effect: chosen by the operator AND allowed for
 * the basket? An operator who toggled it on and then added a package gets
 * the normal period again — silently sending the flag with a package is the
 * leak described above.
 */
export function oneDayActive(oneDay, parts) {
  return Boolean(oneDay) && oneDayAllowed(parts);
}

/**
 * The cblextenperiod to send: "1" when one-day is active, otherwise the
 * caller's normal (backend-authoritative) period.
 */
export function periodFor(oneDay, parts, normalPeriod) {
  return oneDayActive(oneDay, parts) ? ONE_DAY_PERIOD : String(normalPeriod || "");
}

/**
 * The extra wire fields. Spread this into BOTH the paymentinfo and the
 * generateorder payloads. Empty when the option is off, so nothing changes
 * for the existing flow.
 *
 * @returns {{use_day_expiry: 1} | {}}
 */
export function dayExpiryFields(oneDay, parts) {
  return oneDayActive(oneDay, parts) ? { use_day_expiry: 1 } : {};
}
