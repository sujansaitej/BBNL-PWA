/**
 * prefetch.js - Warm customer caches without blocking selected service loads.
 *
 * Customer overview starts only light/common warmup. When an operator selects a
 * service, prioritizeCustomerService() warms that selected service first, then
 * resumes the broader customer prefetch after a short delay.
 */
import { getUserAssignedItems, getMyPlanDetails, getIptvLastSubscribedInfo } from "./generalApis";
import { getSpecialInternetPlans, getFofiUpgradePlans, validateBeforeFofiBoxReg } from "./fofiApis";
import { lsGet, lsSet, lsRemoveByPrefix } from "./lsCache";
import { enterBackgroundMode, exitBackgroundMode } from "./navigationController";
import { resolveBoxIdFromResponses } from "../utils/boxId";

const OVERVIEW_TTL = 2 * 60 * 1000; // 2 min
const PLANS_TTL = 10 * 60 * 1000; // 10 min
const BOX_TTL = 365 * 24 * 60 * 60 * 1000; // 1 year
const DEFERRED_PREFETCH_DELAY = 5000;
const POST_SELECTION_PREFETCH_DELAY = 3000;

const _inflight = new Set();
const _restStarted = new Set();
const _deferredTimers = new Map();
const _priorityPrefetches = new Set();

const IPTV_SERVICE_STATUS_CACHE_PREFIXES = [
  "cabletv_boxid_",
  "cblcust_",
  "pricust_",
  "uai_fofi_",
  "uai_multi_",
  "uai_voip_",
  "uai_internet_",
  "plandets_cabletv_",
  "plandets_fofi_",
  "iptvLastSub_",
];

export function invalidateIptvServiceStatusCache() {
  lsRemoveByPrefix(IPTV_SERVICE_STATUS_CACHE_PREFIXES);
}

function startBackgroundCalls(createTasks) {
  enterBackgroundMode();
  try {
    return createTasks() || [];
  } finally {
    exitBackgroundMode();
  }
}

function maybeWarmCustomerOverview(_userid) {
  // No-op. This used to warm cblcust_/pricust_ caches by calling the
  // unauthenticated primaryCustdet/cblCustDet endpoints (customer PII with no
  // auth). Those calls were removed for the Android-parity/security rework;
  // customer basics now come from the selected-customer navigation state
  // (authenticated customersList) and internetsrvid from getMyPlanDetails.
  // Kept as a no-op so the existing task-assembly call sites stay unchanged.
  return [];
}

function createAssignedItemWarmup(userid) {
  return {
    aiInternet: getUserAssignedItems("internet", userid).catch(() => null),
    aiFofi: getUserAssignedItems("fofi", userid).catch(() => null),
    aiMulti: getUserAssignedItems("multi", userid).catch(() => null),
    aiVoip: getUserAssignedItems("voip", userid).catch(() => null),
  };
}

function pushAssignedItemTasks(tasks, assignedItemPromises) {
  tasks.push(
    assignedItemPromises.aiInternet,
    assignedItemPromises.aiFofi,
    assignedItemPromises.aiMulti,
    assignedItemPromises.aiVoip
  );
}

function resolveBoxId(userid, assignedItemPromises) {
  const cachedBoxId = lsGet(`cabletv_boxid_${userid}`, BOX_TTL);
  if (cachedBoxId) return Promise.resolve(cachedBoxId);

  return Promise.all([
    assignedItemPromises.aiFofi,
    assignedItemPromises.aiMulti,
    assignedItemPromises.aiVoip,
    assignedItemPromises.aiInternet,
  ]).then((responses) => {
    const boxId = resolveBoxIdFromResponses(responses, userid);
    if (boxId) {
      try { lsSet(`cabletv_boxid_${userid}`, boxId); } catch (_) { /* storage full / private mode */ }
    }
    return boxId;
  });
}

function warmIptvAndFofiPlans(userid, assignedItemPromises, { includeCableTv = true, includeFofi = true, includeLastSubscribed = true } = {}) {
  return resolveBoxId(userid, assignedItemPromises).then((boxId) => {
    if (!boxId) return null;

    startBackgroundCalls(() => {
      const tasks = [];
      if (includeCableTv && !lsGet(`plandets_cabletv_${userid}_${boxId}`, OVERVIEW_TTL)) {
        tasks.push(getMyPlanDetails({ servicekey: "cabletv", userid, fofiboxid: boxId, voipnumber: "" }).catch(() => null));
      }
      if (includeFofi && !lsGet(`plandets_fofi_${userid}_${boxId}`, OVERVIEW_TTL)) {
        tasks.push(getMyPlanDetails({ servicekey: "fofi", userid, fofiboxid: boxId, voipnumber: "" }).catch(() => null));
      }
      if (includeLastSubscribed && !lsGet(`iptvLastSub_${userid}_${boxId}`, OVERVIEW_TTL)) {
        tasks.push(getIptvLastSubscribedInfo({ userid, itemid: boxId }).catch(() => null));
      }
      return tasks;
    });

    return boxId;
  }).catch(() => null);
}

function startRestPrefetch(userid, logUname) {
  if (!userid || _restStarted.has(userid)) return;
  _restStarted.add(userid);

  const tasks = startBackgroundCalls(() => {
    const backgroundTasks = [];
    const assignedItemPromises = createAssignedItemWarmup(userid);

    pushAssignedItemTasks(backgroundTasks, assignedItemPromises);
    backgroundTasks.push(...maybeWarmCustomerOverview(userid));

    if (!lsGet(`plandets_internet_${userid}_`, OVERVIEW_TTL)) {
      backgroundTasks.push(getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }).catch(() => null));
    }

    backgroundTasks.push(warmIptvAndFofiPlans(userid, assignedItemPromises));

    if (logUname && !lsGet(`siplans_${logUname}`, PLANS_TTL)) {
      backgroundTasks.push(getSpecialInternetPlans({ logUname, isKiranastore: "no" }).catch(() => null));
    }

    return backgroundTasks;
  });

  if (!tasks.length) {
    _inflight.delete(userid);
    _restStarted.delete(userid);
    return;
  }

  Promise.allSettled(tasks).finally(() => {
    _inflight.delete(userid);
    _restStarted.delete(userid);
  });
}

function scheduleRestPrefetch(userid, logUname, delay) {
  const existingTimer = _deferredTimers.get(userid);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    _deferredTimers.delete(userid);
    startRestPrefetch(userid, logUname);
  }, delay);
  _deferredTimers.set(userid, timer);
}

function startSelectedServicePrefetch(userid, logUname, serviceKey) {
  const normalizedService = (serviceKey || "").toLowerCase();

  return startBackgroundCalls(() => {
    const tasks = maybeWarmCustomerOverview(userid);

    if (normalizedService === "internet") {
      // Fetch the plan details FIRST — it gates the Internet overview's
      // Current Plan section. Initiating it before the non-critical
      // assigned-items (Internet ID line) and specialInternetPlans (only
      // needed if the operator later taps "Link FoFi Box") means it wins
      // the connection race instead of queuing behind them.
      if (!lsGet(`plandets_internet_${userid}_`, OVERVIEW_TTL)) {
        tasks.push(getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }).catch(() => null));
      }
      tasks.push(getUserAssignedItems("internet", userid).catch(() => null));
      if (logUname && !lsGet(`siplans_${logUname}`, PLANS_TTL)) {
        tasks.push(getSpecialInternetPlans({ logUname, isKiranastore: "no" }).catch(() => null));
      }
      return tasks;
    }

    if (normalizedService === "iptv" || normalizedService === "cabletv" || normalizedService === "fofi-smart-box" || normalizedService === "fofi") {
      const isFofi = normalizedService === "fofi-smart-box" || normalizedService === "fofi";

      // ADD/UPGRADE FO-FI BOX gating calls FIRST. These are exactly the two
      // calls handleUpgradeClick waits on when the operator taps ADD FO-FI
      // BOX (validateBeforeFofiBoxReg + registrationNecessities plan list),
      // and they read these same valbfr_ / fofupl_ caches. Initiating them
      // before the 4-bucket assigned-items burst below (which only feeds the
      // box-ID/plan display) lets them win the connection race, so they're
      // warm by the time the operator taps — the button then opens instantly
      // instead of fetching cold behind the assigned-items calls.
      if (isFofi && !lsGet(`fofupl_${logUname || userid}_upgradation`, PLANS_TTL)) {
        tasks.push(getFofiUpgradePlans({ logUname, moduletype: "upgradation", userid }).catch(() => null));
      }
      if (isFofi && logUname && !lsGet(`valbfr_${userid}`, 5 * 60 * 1000)) {
        tasks.push(validateBeforeFofiBoxReg({ username: userid, loginuname: logUname }).catch(() => null));
      }

      const assignedItemPromises = createAssignedItemWarmup(userid);
      pushAssignedItemTasks(tasks, assignedItemPromises);
      tasks.push(warmIptvAndFofiPlans(userid, assignedItemPromises, {
        includeCableTv: normalizedService === "iptv" || normalizedService === "cabletv",
        includeFofi: isFofi,
        includeLastSubscribed: normalizedService === "iptv" || normalizedService === "cabletv",
      }));
      return tasks;
    }

    return tasks;
  });
}

export function prefetchCustomerData(userid, logUname) {
  if (!userid || _inflight.has(userid)) return;
  _inflight.add(userid);

  // Warm the customer overview details AND eagerly resolve the box ID
  // immediately — do NOT wait for the deferred rest-prefetch.
  //
  // The Cable TV / FoFi service pages block on cabletv_boxid_<userid>:
  // when it's already cached they fetch plan details in ONE round-trip;
  // when it's missing they need TWO sequential round-trips (resolve the
  // box ID from the assigned-items calls, THEN fetch the plan). Operators
  // open a customer and pick a service well within DEFERRED_PREFETCH_DELAY,
  // so deferring box-ID resolution by 5s meant the fast single-RTT path was
  // almost never taken — every selection ate the cold two-RTT load.
  //
  // Resolving the box ID here closes that gap. resolveBoxId() short-circuits
  // on the cached value and the assigned-items calls dedupe at the API layer,
  // so the later startRestPrefetch run does no duplicate work.
  const eagerTasks = startBackgroundCalls(() => {
    const tasks = maybeWarmCustomerOverview(userid);

    // Head-start the Internet plan details — the single call that gates the
    // Internet overview's Current Plan section, and Internet is the most-
    // opened service. It's cheap (~0.4-1s), so warming it on customer-open
    // (before any heavy burst) means the page usually paints its plan
    // instantly the moment the operator selects Internet.
    if (!lsGet(`plandets_internet_${userid}_`, OVERVIEW_TTL)) {
      tasks.push(getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }).catch(() => null));
    }

    // Assigned-items across all 4 buckets exist only to resolve the FoFi/
    // cable box ID. That ID is cached for a YEAR, so for a returning
    // customer (the common case) firing all four buckets here is pure
    // connection-pool contention that delays the plan/detail calls above —
    // and the box ID is already known. Only pay for the 4-bucket burst when
    // the box ID is genuinely missing; otherwise let the selected service
    // page fetch just its own bucket. (prioritizeCustomerService re-warms
    // the right bucket the moment a service is picked.)
    if (!lsGet(`cabletv_boxid_${userid}`, BOX_TTL)) {
      const assignedItemPromises = createAssignedItemWarmup(userid);
      pushAssignedItemTasks(tasks, assignedItemPromises);
      tasks.push(resolveBoxId(userid, assignedItemPromises));
    }
    return tasks;
  });
  Promise.allSettled(eagerTasks).catch(() => null);

  scheduleRestPrefetch(userid, logUname, DEFERRED_PREFETCH_DELAY);
}

export function prioritizeCustomerService(userid, logUname, serviceKey) {
  if (!userid || !serviceKey) return;

  const existingTimer = _deferredTimers.get(userid);
  if (existingTimer) {
    clearTimeout(existingTimer);
    _deferredTimers.delete(userid);
  }

  const priorityKey = `${userid}:${serviceKey}`;
  if (_priorityPrefetches.has(priorityKey)) return;
  _priorityPrefetches.add(priorityKey);
  _inflight.add(userid);

  const tasks = startSelectedServicePrefetch(userid, logUname, serviceKey);
  Promise.allSettled(tasks).finally(() => {
    _priorityPrefetches.delete(priorityKey);
    scheduleRestPrefetch(userid, logUname, POST_SELECTION_PREFETCH_DELAY);
  });
}
