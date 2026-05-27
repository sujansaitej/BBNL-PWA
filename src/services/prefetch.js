/**
 * prefetch.js — Warm caches before navigation so pages load instantly.
 *
 * Call prefetchCustomerData(userid) when a customer is selected in the list.
 * By the time the user reaches InternetService/FoFiSmartBox, cached data is ready.
 *
 * Uses background mode so these requests are NOT aborted when the user navigates
 * to a service page — that's the whole point of prefetching.
 */
import { getUserAssignedItems, getCableCustomerDetails, getPrimaryCustomerDetails, getMyPlanDetails, getIptvLastSubscribedInfo } from "./generalApis";
import { getSpecialInternetPlans } from "./fofiApis";
import { lsGet } from "./lsCache";
import { enterBackgroundMode, exitBackgroundMode } from "./navigationController";

const OVERVIEW_TTL = 2 * 60 * 1000; // 2 min
const PLANS_TTL = 10 * 60 * 1000; // 10 min
const BOX_TTL = 365 * 24 * 60 * 60 * 1000; // 1 year — box ID rarely changes

// Track in-flight prefetches to avoid duplicates
const _inflight = new Set();

/**
 * Prefetch all overview APIs for a customer. Fire-and-forget.
 * Safe to call multiple times — deduplicates by userid.
 */
export function prefetchCustomerData(userid, logUname) {
  if (!userid || _inflight.has(userid)) return;
  _inflight.add(userid);

  // Background mode: these calls won't be aborted by navigation controller
  enterBackgroundMode();

  // Only fetch what's NOT already cached
  const tasks = [];

  if (!lsGet(`uai_internet_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getUserAssignedItems("internet", userid).catch(() => null));
  }
  if (!lsGet(`uai_fofi_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getUserAssignedItems("fofi", userid).catch(() => null));
  }
  // IPTV box-id discovery has a secondary fallback servkey — some
  // user-state classifications surface the FoFi box only under "multi".
  // Warming it here means IPTVService doesn't have to re-fetch on first
  // visit when the box hasn't been resolved yet.
  if (!lsGet(`uai_multi_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getUserAssignedItems("multi", userid).catch(() => null));
  }
  if (!lsGet(`uai_voip_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getUserAssignedItems("voip", userid).catch(() => null));
  }
  if (!lsGet(`cblcust_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getCableCustomerDetails(userid).catch(() => null));
  }
  if (!lsGet(`pricust_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getPrimaryCustomerDetails(userid).catch(() => null));
  }
  if (!lsGet(`plandets_internet_${userid}_`, OVERVIEW_TTL)) {
    tasks.push(getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }).catch(() => null));
  }
  // IPTV plan + last-subscribed need a cabletv box ID. Reuse the long-
  // lived cache populated by IPTVService on prior visits — once we've
  // seen a customer's box, we have it forever (the box ID rarely
  // changes for the lifetime of the account). On the operator's FIRST
  // visit to this customer we won't have it yet, but on every visit
  // after that the IPTV page lands warm with zero spinner time.
  const cabletvBoxId = lsGet(`cabletv_boxid_${userid}`, BOX_TTL);
  if (cabletvBoxId) {
    if (!lsGet(`plandets_cabletv_${userid}_${cabletvBoxId}`, OVERVIEW_TTL)) {
      tasks.push(getMyPlanDetails({ servicekey: "cabletv", userid, fofiboxid: cabletvBoxId, voipnumber: "" }).catch(() => null));
    }
    if (!lsGet(`iptvLastSub_${userid}_${cabletvBoxId}`, OVERVIEW_TTL)) {
      tasks.push(getIptvLastSubscribedInfo({ userid, itemid: cabletvBoxId }).catch(() => null));
    }
  }
  if (logUname && !lsGet(`siplans_${logUname}`, PLANS_TTL)) {
    tasks.push(getSpecialInternetPlans({ logUname, isKiranastore: "no" }).catch(() => null));
  }

  // Exit background mode AFTER all API calls have been initiated (synchronously).
  // Each apiFetch checks isBackgroundMode() before its first await, so the flag
  // is captured correctly even though we reset it here.
  exitBackgroundMode();

  if (tasks.length > 0) {
    Promise.all(tasks).finally(() => _inflight.delete(userid));
  } else {
    _inflight.delete(userid);
  }
}
