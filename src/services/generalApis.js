// General API services
import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";
import { lsGet, lsSet } from "./lsCache";
import { getServiceSignal, isBackgroundMode } from "./navigationController";

// ── Request deduplication ───────────────────────────────────────────
// Multiple components (overview mount, prefetch, click handlers) can
// race for the same endpoint+payload. Without dedup each fires its own
// network request — wasting connection slots (browsers cap at 6 per
// origin over HTTP/1.1) and bandwidth. The native Android app dedupes
// at the HTTP client level; we mirror that here.
//
// The map is keyed by cache key (helpers already build a stable cache
// key for every cached endpoint, so we reuse it). The first call
// registers a Promise; concurrent callers attach to it; on settle the
// entry is cleared so the next call starts fresh.
const _inflight = new Map();

function dedupe(key, fn) {
  if (_inflight.has(key)) return _inflight.get(key);
  const p = (async () => fn())().finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

function getBaseUrl() {
  if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL;
  return '/api/';
}

function getHeadersJson() {
  return {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
    "Content-Type": "application/json",
  };
}

function getHeadersForm() {
  return {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
  };
}

// Field devices on 3G / patchy 4G see 10-15 s baseline latency (DNS + TLS +
// server RTT + packet retransmits). A 15 s cap caused frequent "Request
// timed out" errors on low-tier franchisee phones while working fine on
// flagships on LTE. 30 s matches the real-world tail latency measured on
// the slowest test SIMs without being so long that the UI feels frozen.
const API_TIMEOUT = 30000; // 30 seconds default
const UPLOAD_TIMEOUT = 60000; // 60 seconds for file uploads

/** Wrapper that adds timing, security logging, perf monitoring, and timeout to every API call.
 *  Also links to the navigation controller — requests are auto-aborted when user navigates away. */
async function apiFetch(url, options, label, timeout = API_TIMEOUT) {
  const method = options.method || "GET";
  const endPerf = perfMonitor.start(method, url, "General", label);
  logger.debug("API", `${label} → ${method} ${url}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  // Link to navigation controller — abort this request if user navigated to another page.
  // Skip for background/prefetch requests so cache-warming isn't killed on navigation.
  const _bg = isBackgroundMode();
  let navSignal, onNavAbort;
  if (!_bg) {
    navSignal = getServiceSignal();
    onNavAbort = () => ctrl.abort();
    if (navSignal.aborted) {
      clearTimeout(timer);
      endPerf({ status: 0, error: "navigation cancelled" });
      throw new Error("Request cancelled — navigated away.");
    }
    navSignal.addEventListener('abort', onNavAbort, { once: true });
  }

  let resp;
  try {
    resp = await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    if (navSignal) navSignal.removeEventListener('abort', onNavAbort);
    const isTimeout = err.name === "AbortError";
    // Distinguish navigation abort from timeout
    if (isTimeout && navSignal?.aborted) {
      endPerf({ status: 0, error: "navigation cancelled" });
      throw new Error("Request cancelled — navigated away.");
    }
    const errMsg = isTimeout ? "timeout" : `network error: ${err.message}`;
    endPerf({ status: 0, error: errMsg });
    logger.error("API", `${label} ${errMsg}`, { method, url });
    throw new Error(isTimeout ? "Request timed out. Please check your network and try again." : `Network error: ${err.message}`);
  } finally {
    clearTimeout(timer);
    if (navSignal) navSignal.removeEventListener('abort', onNavAbort);
  }

  const entry = endPerf({ status: resp.status });
  logger.api(method, url, resp.status, entry.duration);

  if (resp.status === 401 || resp.status === 403) {
    logger.security("API_AUTH_REJECTED", { endpoint: url, status: resp.status, label });
  }

  return resp;
}

export async function UserLogin(username, password) {
  const url = `${getBaseUrl()}ServiceApis/custlogin`;
  const headers = getHeadersForm();

  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);

  logger.info("Auth", `Login attempt for user: ${username}`);

  const resp = await apiFetch(url, { method: "POST", headers, body: formData }, "UserLogin");

  if (!resp.ok) {
    logger.security("LOGIN_API_FAILED", { username, status: resp.status });
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();

  if (data?.status?.err_code === 1) {
    logger.security("LOGIN_REJECTED", { username, reason: data?.status?.err_msg });
  } else {
    logger.info("Auth", `Login API success for user: ${username}`);
  }

  return data;
}

export async function OTPauth(username, otprefid, otpcode) {
  const url = `${getBaseUrl()}ServiceApis/custLoginVerification`;
  const headers = getHeadersForm();

  const formData = new FormData();
  formData.append("username", username);
  formData.append("otprefid", otprefid);
  formData.append("otpcode", otpcode);

  logger.info("Auth", `OTP verification attempt for user: ${username}`);

  const resp = await apiFetch(url, { method: "POST", headers, body: formData }, "OTPauth");

  if (!resp.ok) {
    logger.security("OTP_VERIFY_FAILED", { username, status: resp.status });
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();

  if (data?.status?.err_code === 0) {
    logger.security("OTP_VERIFY_SUCCESS", { username });
  } else {
    logger.security("OTP_VERIFY_REJECTED", { username, reason: data?.status?.err_msg });
  }

  return data;
}

export async function resendOTP(username) {
  const url = `${getBaseUrl()}ServiceApis/custLoginResendOtp?username=` + username;
  const headers = getHeadersJson();
  logger.info("Auth", `OTP resend requested for user: ${username}`);
  const resp = await apiFetch(url, { method: "POST", headers }, "resendOTP");
  if (!resp.ok) throw new Error(`Failed to resend otp ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getWalBal(payload, skipCache = false) {
  const cacheKey = `walbal_${payload.loginuname}_${payload.servicekey || 'internet'}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 5 * 60 * 1000); // 5 min TTL
    if (cached) { perfMonitor.recordCacheHit("General", "getWalBal", cacheKey); return cached; }
  }
  const url = `${getBaseUrl()}ServiceApis/myWallet`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getWalBal");
  if (!resp.ok) throw new Error(`Failed to get wallet balance ${resp.status}`);
  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

export async function getCustList(payload, status) {
  const cacheKey = `custlist_${status || 'all'}`;
  const cached = lsGet(cacheKey, 10 * 60 * 1000); // 10 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getCustList", cacheKey); return cached; }
  const url = `${getBaseUrl()}ServiceApis/customersList?status=${encodeURIComponent(status || '')}`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getCustList");
  if (!resp.ok) throw new Error(`Failed to get customer data ${resp.status}`);
  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

export async function getServiceList() {
  const cacheKey = 'svclist_all';
  const cached = lsGet(cacheKey, 10 * 60 * 1000); // 10 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getServiceList", cacheKey); return cached; }

  const params = new URLSearchParams({ servtype: 'all', iskirana: 'false' });
  const url = `${getBaseUrl()}ServiceApis/servServiceList?${params.toString()}`;

  const headers = {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
  };

  const formData = new FormData();
  formData.append("servtype", "all");
  formData.append("iskirana", "false");

  const resp = await apiFetch(url, { method: "POST", headers, body: formData }, "getServiceList");

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  logger.debug("API", "getServiceList response", { errCode: data.status?.err_code, bodyCount: data.body?.length });
  lsSet(cacheKey, data);
  return data;
}

export async function getUserAssignedItems(servkey, userid, skipCache = false) {
  const cacheKey = `uai_${servkey}_${userid}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 5 * 60 * 1000); // 5 min TTL
    if (cached) { perfMonitor.recordCacheHit("General", "getUserAssignedItems", cacheKey); return cached; }
  }
  return dedupe(cacheKey, async () => {
    const url = `${getBaseUrl()}ServiceApis/getUserAssignedItems`;
    const headers = getHeadersJson();
    const payload = { servkey, userid };

    const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getUserAssignedItems");

    if (!resp.ok) {
      throw new Error(`Failed to get user assigned items: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    lsSet(cacheKey, data);
    return data;
  });
}

export async function getCableCustomerDetails(refid, skipCache = false) {
  const cacheKey = `cblcust_${refid}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 10 * 60 * 1000); // 10 min TTL
    if (cached) { perfMonitor.recordCacheHit("General", "getCableCustomerDetails", cacheKey); return cached; }
  }
  return dedupe(cacheKey, async () => {
    const url = `${getBaseUrl()}GeneralApi/cblCustDet`;

    const headers = {
      Authorization: "Basic 06e32ddefe8ad2b05024530451a1cc28",
      username: import.meta.env.VITE_API_USERNAME,
      password: import.meta.env.VITE_API_PASSWORD,
      "X-App-Package": "com.bbnl.smartphone",
      "Content-Type": "application/x-www-form-urlencoded",
    };

    const formData = new URLSearchParams();
    formData.append("refid", refid);

    const resp = await apiFetch(url, { method: "POST", headers, body: formData }, "getCableCustomerDetails");

    if (!resp.ok) {
      throw new Error(`Failed to get cable customer details: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    lsSet(cacheKey, data);
    return data;
  });
}

export async function getPrimaryCustomerDetails(userid, skipCache = false) {
  const cacheKey = `pricust_${userid}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 10 * 60 * 1000); // 10 min TTL
    if (cached) { perfMonitor.recordCacheHit("General", "getPrimaryCustomerDetails", cacheKey); return cached; }
  }
  return dedupe(cacheKey, async () => {
    const url = `${getBaseUrl()}cabletvapis/primaryCustdet`;

    const headers = {
      "X-App-Package": "com.bbnl.smartphone",
      "Content-Type": "application/x-www-form-urlencoded",
    };

    const formData = new URLSearchParams();
    formData.append("userid", userid);

    const resp = await apiFetch(url, { method: "POST", headers, body: formData }, "getPrimaryCustomerDetails");

    if (!resp.ok) {
      throw new Error(`Failed to get primary customer details: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    lsSet(cacheKey, data);
    return data;
  });
}

export async function getMyPlanDetails(params, skipCache = false) {
  const cacheKey = `plandets_${params.servicekey}_${params.userid}_${params.fofiboxid || ''}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 5 * 60 * 1000); // 5 min TTL
    if (cached) { perfMonitor.recordCacheHit("General", "getMyPlanDetails", cacheKey); return cached; }
  }
  return dedupe(cacheKey, async () => {
    const ts = Date.now();
    const url = `${getBaseUrl()}ServiceApis/getMyPlanDetails?_t=${ts}`;
    const headers = {
      ...getHeadersJson(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    };

    const payload = {
      fofiboxid: params.fofiboxid || "",
      servicekey: params.servicekey,
      userid: params.userid,
      voipnumber: params.voipnumber || ""
    };

    logger.debug("API", "getMyPlanDetails request", { servicekey: params.servicekey, userid: params.userid });

    const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getMyPlanDetails");

    if (!resp.ok) {
      throw new Error(`Failed to get plan details: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    logger.debug("API", "getMyPlanDetails response", { errCode: data.status?.err_code });
    lsSet(cacheKey, data);
    return data;
  });
}

/* Ticket APIs */
export async function getTktDepartments() {
  const cacheKey = 'tktdepts';
  const cached = lsGet(cacheKey, 30 * 60 * 1000); // 30 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getTktDepartments", cacheKey); return cached; }
  const url = `${getBaseUrl()}apis/getDepartments`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "GET", headers }, "getTktDepartments");
  if (!resp.ok) throw new Error(`Failed to get ticket stats ${resp.status}`);
  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

export async function getTickets(tabKey, allParams = {}) {
  const cacheKey = `tkts_${tabKey}_${allParams.user || ''}_${allParams.dept || ''}`;
  const cached = lsGet(cacheKey, 3 * 60 * 1000); // 3 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getTickets", cacheKey); return cached; }
  var ep = '';
  var inpParams = { apiopid: tabKey !== 'NEW CONNECTIONS' ? allParams.op_id : 'raghav' };
  switch (tabKey) {
    case 'OPEN':
      ep = 'getavailableticket';
      inpParams = { ...inpParams, newcon: allParams.dept };
      break;
    case 'PENDING':
      ep = 'pendingtickets';
      inpParams = { ...inpParams, loginid: allParams.user, newcon: allParams.dept };
      break;
    case 'NEW CONNECTIONS':
      ep = 'getNewConnectionTicket';
      break;
    case 'DISCONNECTIONS':
      ep = 'disconnection';
      break;
    case 'JOB DONE':
      ep = 'jobDoneList';
      inpParams = { ...inpParams, userid: allParams.user };
      break;
    default:
      ep = '';
  }
  const query = new URLSearchParams({ ...inpParams }).toString();

  const url = `${getBaseUrl()}apis/${ep}?${query}`;
  const headers = getHeadersJson();

  const resp = await apiFetch(url, { method: "GET", headers }, `getTickets(${tabKey})`);
  if (!resp.ok) throw new Error(`Failed to get tickets data ${resp.status}`);

  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

export async function pickTicket(allParams = {}, action = '') {
  var ep = '';
  if (action === 'close')
    ep = 'crmCloseTicket';
  else if (action === 'transfer')
    ep = 'transferTicket';
  else
    ep = 'pickTicket';
  const query = new URLSearchParams({ ...allParams }).toString();

  const url = `${getBaseUrl()}apis/${ep}?${query}`;
  const headers = getHeadersJson();

  const resp = await apiFetch(url, { method: "POST", headers }, `pickTicket(${action})`);
  if (!resp.ok) throw new Error(`Failed to pick ticket ${resp.status}`);

  const data = await resp.json();
  return data;
}

/* Get Customer KYC Preview */
export async function getCustKYCPreview({ cid, reqtype = 'update' }) {
  const url = `${getBaseUrl()}ServiceApis/custKYCpreview`;

  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    'X-App-Package': 'com.bbnl.smartphone',
    'Content-Type': 'application/json; charset=UTF-8'
  };

  const payload = { cid, reqtype };
  logger.debug("API", "custKYCpreview request", { cid, reqtype });

  const resp = await apiFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) }, "getCustKYCPreview");

  if (!resp.ok) {
    const errorText = await resp.text();
    logger.error("API", "custKYCpreview error", { status: resp.status, error: errorText });
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  logger.debug("API", "custKYCpreview response", { errCode: data.status?.err_code });
  return data;
}

/* Upload Customer KYC Document */
export async function uploadCustKYC({ cid, prooftype, reqtype = 'update', file, loginuser = 'superadmin' }) {
  const url = `${getBaseUrl()}ServiceApis/uploadcustKYC`;

  if (!file || !(file instanceof File)) {
    throw new Error('Invalid file object');
  }
  if (!cid) {
    throw new Error('Customer ID (cid) is required');
  }
  if (!prooftype) {
    throw new Error('Proof type is required');
  }

  const formData = new FormData();
  formData.append('cid', cid);
  formData.append('prooftype', prooftype);
  formData.append('reqtype', reqtype);
  formData.append('loginuser', loginuser);
  formData.append('docimg', file, file.name || "upload.jpg");

  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    'appversion': import.meta.env.VITE_API_APP_VERSION || '1.49',
    'X-App-Package': 'com.bbnl.smartphone',
  };

  logger.info("API", `KYC upload: cid=${cid}, type=${prooftype}, file=${file.name} (${file.size} bytes)`);

  const resp = await apiFetch(url, { method: 'POST', headers, body: formData }, "uploadCustKYC", UPLOAD_TIMEOUT);

  if (!resp.ok) {
    const errorText = await resp.text();
    logger.error("API", "uploadcustKYC error", { status: resp.status, cid, prooftype });
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  logger.info("API", `KYC upload success: cid=${cid}, type=${prooftype}`);
  return data;
}

/* Submit KYC */
export async function submitKYC({ cid, loginuser = 'superadmin', prooftype, reqtype = 'update' }) {
  const url = `${getBaseUrl()}ServiceApis/submitKYC`;

  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    'X-App-Package': 'com.bbnl.smartphone',
    'Content-Type': 'application/json; charset=UTF-8'
  };

  const payload = { cid, loginuser, prooftype, reqtype };
  logger.info("API", `KYC submit: cid=${cid}, type=${prooftype}`);

  const resp = await apiFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) }, "submitKYC");

  const data = await resp.json().catch(() => null);
  if (data) {
    logger.debug("API", "submitKYC response", { errCode: data.status?.err_code });
  }

  return data;
}

/* Cable TV / IPTV APIs */

export async function getCustomerRegistrationStatus(userid) {
  const url = `${getBaseUrl()}ServiceApis/customerRegistrationStatus`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify({ userid }) }, "getCustomerRegistrationStatus");
  if (!resp.ok) throw new Error(`Failed to get registration status: HTTP ${resp.status}`);
  return resp.json();
}

// Verified live against the staging backend across multiple users:
//   user           Without validity_status   With validity_status:"active"
//   ----           -----------------------   -----------------------------
//   cgreen2        []  + 56 ch               ['11','1457','1461'] + 172 ch
//   adarsh01test   ['11','1331',…] + 113 ch  []  + 0 ch    ← !! breaks
//   samsungiptv    [] + 90 ch                []  + 0 ch    ← !! breaks
//   testatvu1      ['11'] + 113 ch           ['11'] + 113 ch
//
// The endpoint's behaviour with vs without `validity_status` is not
// consistent across user-state classifications on the server. Sending
// only one variant universally would silently lose subscription
// state for half the user base — that's the actual cause of the
// "Subscribed flag missing" issue people kept hitting. The robust
// answer is to fire BOTH requests in parallel and union the
// channelid / packageid arrays. Network cost is one extra parallel
// request (typically ~200-400 ms on top of the original); benefit is
// every subscribed channel and every subscribed package surfaces
// regardless of which user / box state we're looking at.
export async function getIptvLastSubscribedInfo({ userid, itemid }, skipCache = false) {
  const cacheKey = `iptvLastSub_${userid}_${itemid}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 5 * 60 * 1000); // 5 min TTL
    if (cached) { perfMonitor.recordCacheHit("General", "getIptvLastSubscribedInfo", cacheKey); return cached; }
  }
  return dedupe(cacheKey, async () => {
    const url = `${getBaseUrl()}ServiceApis/iptvLastSubscribedinfo`;
    const headers = getHeadersJson();

    const fireOne = async (extra) => {
      const body = JSON.stringify({ userid, itemid, ...extra });
      const r = await apiFetch(url, { method: "POST", headers, body }, "getIptvLastSubscribedInfo");
      if (!r.ok) return null;
      try { return await r.json(); } catch (_) { return null; }
    };

    const [defaultResp, activeResp] = await Promise.allSettled([
      fireOne({}),
      fireOne({ validity_status: "active" }),
    ]);

    const defData = defaultResp.status === "fulfilled" ? defaultResp.value : null;
    const actData = activeResp.status === "fulfilled" ? activeResp.value : null;

    // Hard failure when both calls failed — preserve the original
    // throw shape so callers' catch blocks behave the same.
    if (!defData && !actData) {
      throw new Error(`Failed to get last subscribed info`);
    }

    const defBody = defData?.body || {};
    const actBody = actData?.body || {};
    // Defensive Array.isArray — some error responses return body.channelid
    // as null (verified live: "Please choose fofiboxid" path returns
    // body:{channelid:null}). Without the guard the spread crashes the
    // overview load on bad input.
    const asArray = (v) => Array.isArray(v) ? v.map(String) : [];
    const mergedChannelIds = Array.from(new Set([
      ...asArray(defBody.channelid),
      ...asArray(actBody.channelid),
    ]));
    const mergedPackageIds = Array.from(new Set([
      ...asArray(defBody.packageid),
      ...asArray(actBody.packageid),
    ]));

    // Prefer the success status — if either call returned err_code:0,
    // we have data and treat the merged result as a success.
    const status = (actData?.status?.err_code === 0 ? actData.status :
      (defData?.status?.err_code === 0 ? defData.status :
        (actData?.status || defData?.status || { err_code: 1, err_msg: 'No response' })));

    const merged = {
      status,
      body: {
        // Pick whichever body has more keys as the merge base, then
        // overlay the unioned arrays so callers reading body.directpay
        // / body.* aren't surprised by missing fields.
        ...defBody,
        ...actBody,
        channelid: mergedChannelIds,
        packageid: mergedPackageIds,
      },
    };
    lsSet(cacheKey, merged);
    return merged;
  });
}

export async function getPkgCategories({ username = "superadmin", userid }, skipCache = false) {
  // pkgCategories reads username/userid from the QUERY STRING, not
  // the form body (verified by direct curl probe — body-only POST
  // returns "Please enter username", query-string-only succeeds).
  // The native app's Android okhttp trace's [FORMREQUEST:…] label
  // is misleading; the actual on-the-wire payload sits in the URL.
  //
  // Cached for 30 min — categories are per-operator config and
  // rarely change. The first visit pays the network cost; every
  // subsequent visit (including via popstate or re-entry) renders
  // the tab strip instantly.
  const cacheKey = `pkgcats_${username}_${userid}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 30 * 60 * 1000);
    if (cached) { perfMonitor.recordCacheHit("General", "getPkgCategories", cacheKey); return cached; }
  }
  const params = new URLSearchParams({ username, userid });
  const url = `${getBaseUrl()}ServiceApis/pkgCategories?${params.toString()}`;
  const headers = getHeadersForm();

  const resp = await apiFetch(url, { method: "POST", headers }, "getPkgCategories");
  if (!resp.ok) throw new Error(`Failed to get package categories: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.status?.err_code === 0 || (data && Array.isArray(data?.body))) {
    lsSet(cacheKey, data);
  }
  return data;
}

export async function getChannelsList({ channelid, userid, username = "superadmin", price = "", sort = "", stream = "", packageid, alacarte }, skipCache = false) {
  // channelid must be an array on the wire — the mobile app sends
  // ["151","37",...]. Coerce here so callers can pass [] for
  // alacarte / global queries without thinking about it.
  const chArr = Array.isArray(channelid) ? channelid : (channelid ? [channelid] : []);
  const pkgArr = (packageid !== undefined && packageid !== null && packageid !== "")
    ? (Array.isArray(packageid) ? packageid : [String(packageid)])
    : null;

  // Cache the alacarte/global channel grid for 10 minutes — the
  // production response is 218KB / 490 channels, takes 5–10s to
  // download + parse on a 4G phone. Without a cache, every visit
  // to "Create Own Package" → channels view re-downloads the
  // whole catalog. The cache is keyed by the input axes that
  // change the response (subscribed-channel set, package filter,
  // alacarte flag), and 10 min is a safe TTL for a catalog that
  // changes only when the operator runs a back-office update.
  const subKey = chArr.length > 0 ? chArr.map(String).sort().join(",") : "";
  const pkgKey = pkgArr ? pkgArr.map(String).sort().join(",") : "";
  const cacheKey = `chlist_${userid}_${alacarte || "no"}_${subKey}_${pkgKey}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 10 * 60 * 1000);
    if (cached) { perfMonitor.recordCacheHit("General", "getChannelsList", cacheKey); return cached; }
  }

  const url = `${getBaseUrl()}ServiceApis/channelsList`;
  const headers = getHeadersJson();
  const payload = { channelid: chArr, price, sort, stream, userid, username };
  if (pkgArr) payload.packageid = pkgArr;
  // alacarte:"yes" tells the backend to return EVERY available
  // channel with each entry's issubscribed flag set per the
  // current customer. Without this flag (or a non-empty
  // channelid array) the endpoint returns 0 rows. Used by the
  // "Create Own Package" channels grid so subscribed and
  // unsubscribed channels both render with status ribbons.
  if (alacarte) payload.alacarte = alacarte;

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getChannelsList");
  if (!resp.ok) throw new Error(`Failed to get channels list: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.status?.err_code === 0) {
    lsSet(cacheKey, data);
  }
  return data;
}

export async function getPaymentInfo({ channelid = [], lcochid = [], packageid = [], pkgcode = [], servapptype = "crmapp", servid = "1", userid, username = "superadmin" }) {
  const url = `${getBaseUrl()}ServiceApis/getPaymentInfo`;
  const headers = getHeadersJson();
  const payload = { channelid, lcochid, packageid, pkgcode, servapptype, servid, userid, username };

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getPaymentInfo");
  if (!resp.ok) throw new Error(`Failed to get payment info: HTTP ${resp.status}`);
  return resp.json();
}

export async function getPlanExtensionPeriods({ userid, servkey = "cabletv", itemid }, skipCache = false) {
  // Cached 60 min — extension periods are per-box plan-validity
  // options that change very rarely (only when the operator
  // reconfigures the plan tier). Live timing showed this endpoint
  // taking 2.4 s on average, the slowest in the checkout chain.
  // Cache turns the second visit into 0 ms.
  const cacheKey = `extper_${userid}_${servkey}_${itemid || ''}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 60 * 60 * 1000);
    if (cached) { perfMonitor.recordCacheHit("General", "getPlanExtensionPeriods", cacheKey); return cached; }
  }
  const url = `${getBaseUrl()}ServiceApis/planExtensionPeriods`;
  const headers = getHeadersJson();
  const payload = { userid, servkey, itemid };

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getPlanExtensionPeriods");
  if (!resp.ok) throw new Error(`Failed to get plan extension periods: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.status?.err_code === 0) {
    lsSet(cacheKey, data);
  }
  return data;
}

export async function getCableTvPaymentDetails(params) {
  const url = `${getBaseUrl()}service/paymentinfo/cabletv`;
  const headers = getHeadersJson();

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(params) }, "getCableTvPaymentDetails");
  if (!resp.ok) throw new Error(`Failed to get cable TV payment details: HTTP ${resp.status}`);
  return resp.json();
}

export async function generateCableTvOrder(params) {
  const url = `${getBaseUrl()}ServiceApis/cabletv/generateorder`;
  const headers = getHeadersJson();

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(params) }, "generateCableTvOrder");
  if (!resp.ok) throw new Error(`Failed to generate order: HTTP ${resp.status}`);
  return resp.json();
}

export async function getPackagesList({ category, packageid, userid, username = "superadmin" }, skipCache = false) {
  // Cached 5 min, keyed by (category, userid, sorted subscribed-id
  // hash). The hash captures the subscribed-package set we pass in,
  // because the API's `issubscribed` flag in the response depends on
  // that set — caching without it would serve a response with the
  // wrong flags after a subscription change. 5-minute TTL is short
  // enough that a real package change becomes visible quickly without
  // requiring a manual refresh.
  const subIds = Array.isArray(packageid) ? packageid : [];
  const subHash = subIds.length > 0 ? subIds.map(String).sort().join(",") : "";
  const cacheKey = `pkglist_${userid}_${String(category)}_${subHash}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 5 * 60 * 1000);
    if (cached) { perfMonitor.recordCacheHit("General", "getPackagesList", cacheKey); return cached; }
  }
  const url = `${getBaseUrl()}ServiceApis/packagesList`;
  const headers = getHeadersJson();
  const payload = { category: String(category), packageid, userid, username };

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getPackagesList");
  if (!resp.ok) throw new Error(`Failed to get packages list: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.status?.err_code === 0) {
    lsSet(cacheKey, data);
  }
  return data;
}

// Returns the exact set of channels allocated to a single package.
// channelsList ignores its packageid filter and returns the global
// channel catalog, which is why the Package Details modal had been
// showing every channel instead of the package's actual lineup. This
// endpoint requires BOTH packageid AND pkgcode (string, not array) —
// passing only one returns "Please enter package id."
//
// Response shape:
//   body.result   → channel rows: { chid, chtitle, chlogo, chmrp, ptype, chtype }
//   body.totals   → { pkgprice, totchnlprice, totalchnls, totpaidchnls, totftachnls }
//
// language / broadcaster / genres are NOT included — enrich via
// channelsList with the returned chids if those fields are needed.
export async function getPkgChannelsList({ packageid, pkgcode, userid, username = "superadmin" }) {
  const url = `${getBaseUrl()}ServiceApis/pkgChannelsList`;
  const headers = getHeadersJson();
  const payload = {
    packageid: String(packageid),
    pkgcode: String(pkgcode || packageid),
    userid,
    username,
  };

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getPkgChannelsList");
  if (!resp.ok) throw new Error(`Failed to get package channels list: HTTP ${resp.status}`);
  return resp.json();
}
