/**
 * prefetch.js — Warm caches before navigation so pages load instantly.
 *
 * Call prefetchCustomerData(userid) when a customer is selected in the list.
 * By the time the user reaches InternetService/FoFiSmartBox, cached data is ready.
 */
import { getUserAssignedItems, getCableCustomerDetails, getPrimaryCustomerDetails, getMyPlanDetails } from "./generalApis";
import { getSpecialInternetPlans } from "./fofiApis";
import { lsGet } from "./lsCache";

const OVERVIEW_TTL = 2 * 60 * 1000; // 2 min
const PLANS_TTL = 10 * 60 * 1000; // 10 min

// Track in-flight prefetches to avoid duplicates
const _inflight = new Set();

/**
 * Prefetch all overview APIs for a customer. Fire-and-forget.
 * Safe to call multiple times — deduplicates by userid.
 */
export function prefetchCustomerData(userid, logUname) {
  if (!userid || _inflight.has(userid)) return;
  _inflight.add(userid);

  // Only fetch what's NOT already cached
  const tasks = [];

  if (!lsGet(`uai_internet_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getUserAssignedItems("internet", userid).catch(() => null));
  }
  if (!lsGet(`uai_fofi_${userid}`, OVERVIEW_TTL)) {
    tasks.push(getUserAssignedItems("fofi", userid).catch(() => null));
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
  if (logUname && !lsGet(`siplans_${logUname}`, PLANS_TTL)) {
    tasks.push(getSpecialInternetPlans({ logUname, isKiranastore: "no" }).catch(() => null));
  }

  if (tasks.length > 0) {
    Promise.all(tasks).finally(() => _inflight.delete(userid));
  } else {
    _inflight.delete(userid);
  }
}
