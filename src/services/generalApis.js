// General API services
import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";
import { lsGet, lsSet } from "./lsCache";
import {
  getBaseUrl,
  getHeadersJson,
  getHeadersForm,
  dedupe,
  apiFetch,
  UPLOAD_TIMEOUT,
} from "./apiCore";

export async function UserLogin(username, password) {
  const url = `${getBaseUrl()}ServiceApis/custlogin`;
  const headers = getHeadersForm();

  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);

  logger.info("Auth", `Login attempt for user: ${username}`);

  // credentials pinned to browser default: the login handshake is the one flow
  // that may rely on server-side session state, and it is not covered by tests.
  const resp = await apiFetch(url, { method: "POST", headers, body: formData, credentials: "same-origin" }, "UserLogin");

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

  const resp = await apiFetch(url, { method: "POST", headers, body: formData, credentials: "same-origin" }, "OTPauth");

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
  const resp = await apiFetch(url, { method: "POST", headers, credentials: "same-origin" }, "resendOTP");
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
  return dedupe(cacheKey, async () => {
    const url = `${getBaseUrl()}ServiceApis/myWallet`;
    const headers = getHeadersJson();
    const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getWalBal");
    if (!resp.ok) throw new Error(`Failed to get wallet balance ${resp.status}`);
    const data = await resp.json();
    lsSet(cacheKey, data);
    return data;
  });
}

export async function getCustList(payload, status) {
  const cacheKey = `custlist_${status || 'all'}`;
  const cached = lsGet(cacheKey, 10 * 60 * 1000); // 10 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getCustList", cacheKey); return cached; }
  return dedupe(cacheKey, async () => {
    const url = `${getBaseUrl()}ServiceApis/customersList?status=${encodeURIComponent(status || '')}`;
    const headers = getHeadersJson();
    const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getCustList");
    if (!resp.ok) throw new Error(`Failed to get customer data ${resp.status}`);
    const data = await resp.json();
    lsSet(cacheKey, data);
    return data;
  });
}

export async function getServiceList() {
  const cacheKey = 'svclist_all';
  const cached = lsGet(cacheKey, 10 * 60 * 1000); // 10 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getServiceList", cacheKey); return cached; }

  // servtype/iskirana go in the QUERY STRING only. Confirmed against backend
  // source: ServicesModules/ServicesList.php::_getservicesList reads both via
  // input->get() — the previous multipart body was never read and is dropped.
  const params = new URLSearchParams({ servtype: 'all', iskirana: 'false' });
  const url = `${getBaseUrl()}ServiceApis/servServiceList?${params.toString()}`;

  const headers = getHeadersForm();

  const resp = await apiFetch(url, { method: "POST", headers }, "getServiceList");

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

// REMOVED (2026-07-17): getCableCustomerDetails (GeneralApi/cblCustDet) and
// getPrimaryCustomerDetails (cabletvapis/primaryCustdet).
//
// Both hit backend endpoints that return full customer PII — name, mobile,
// email, address, GST — for ANY userid with NO authentication (verified in
// the backend source: Cabletvapis has no auth gate; the cblCustDet Basic key
// is unprovisioned in prod). The Android app never calls either; it carries
// the operator-selected customer forward from the authenticated customersList
// search and reads plan data from authenticated endpoints.
//
// All six consuming screens were migrated to that model: customer basics come
// from `customerData` (customersList selection), op_id falls back to the
// logged-in user, and the "has cable" signal derives from customerData.usertype.
// See memory bbnl-audit-corrections / bbnl-backend-source-truths.

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

/* ─── Ticket APIs — BYTE-IDENTICAL to the native franchise app ─────────
 * Native's //Ticket block (ApiInterface.java) hits `prod/Apis/<method>` as
 * @POST @FormUrlEncoded with NO auth headers (no Authorization/username/
 * password/appkeytype/appversion). Verified live: getDepartments / getEmployee
 * / jobDoneList / pendingTickets all return data with zero auth headers.
 * Success envelope: { status:{err_code,err_msg}, body:[...] }; the OPEN list
 * uniquely uses `ticketstatus` instead of `status`.
 *
 * Departments come from getDepartments; the first/default entry is the literal
 * string "Departments" (means "all"), sent back as `newcon` on the list calls.
 */
const TICKET_FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

export async function getTktDepartments() {
  const cacheKey = 'tktdepts';
  const cached = lsGet(cacheKey, 30 * 60 * 1000); // 30 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getTktDepartments", cacheKey); return cached; }
  const url = `${getBaseUrl()}Apis/getDepartments`;
  const resp = await apiFetch(url, { method: "GET", headers: {} }, "getTktDepartments");
  if (!resp.ok) throw new Error(`Failed to get departments ${resp.status}`);
  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

export async function getTickets(tabKey, allParams = {}) {
  const cacheKey = `tkts_${tabKey}_${allParams.user || ''}_${allParams.dept || ''}`;
  const cached = lsGet(cacheKey, 3 * 60 * 1000); // 3 min TTL
  if (cached) { perfMonitor.recordCacheHit("General", "getTickets", cacheKey); return cached; }

  const opid = allParams.op_id || '';
  const newcon = allParams.dept || 'Departments'; // native default (means "all")
  let ep = '', form = {};
  switch (tabKey) {
    case 'OPEN':
      ep = 'getAvailableTicket'; form = { apiopid: opid, newcon }; break;
    case 'PENDING':
      ep = 'pendingTickets'; form = { apiopid: opid, newcon, loginid: allParams.user || '' }; break;
    case 'NEW CONNECTIONS':
      // Native sends the operator's op_id (the old PWA hardcoded "raghav").
      ep = 'getNewConnectionTicket'; form = { apiopid: opid }; break;
    case 'DISCONNECTIONS':
      ep = 'disConnection'; form = { apiopid: opid }; break;
    case 'JOB DONE':
      ep = 'jobDoneList'; form = { apiopid: opid, userid: allParams.user || '' }; break;
    default:
      ep = '';
  }
  const url = `${getBaseUrl()}Apis/${ep}`;
  const body = new URLSearchParams(form).toString();
  const resp = await apiFetch(url, { method: "POST", headers: TICKET_FORM_HEADERS, body }, `getTickets(${tabKey})`);
  if (!resp.ok) throw new Error(`Failed to get tickets ${resp.status}`);
  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

// pick / close / transfer. Native form field sets (per action):
//   pick     : { ticketid, apiopid, empname, empcontact }
//   close    : { ticketid, apiopid, empname, reason, opid }   → crmCloseTicket
//   transfer : { ticketid, toEmpname, toEmpLoginId, fromemp, toEmpMob, opid }
// Callers build the exact field set; this only picks the endpoint + posts form.
export async function pickTicket(allParams = {}, action = '') {
  let ep = 'pickTicket';
  if (action === 'close') ep = 'crmCloseTicket';
  else if (action === 'transfer') ep = 'transferTicket';
  const url = `${getBaseUrl()}Apis/${ep}`;
  const body = new URLSearchParams({ ...allParams }).toString();
  const resp = await apiFetch(url, { method: "POST", headers: TICKET_FORM_HEADERS, body }, `pickTicket(${action || 'pick'})`);
  if (!resp.ok) throw new Error(`Failed to ${action || 'pick'} ticket ${resp.status}`);
  return resp.json();
}

// Real transferable-employee list (native getEmployee, form { opid, group }).
// Replaces the PWA's fake hardcoded 3-person array. group defaults to
// "accounts" (native hardcodes this in TransferTicketFragment).
// Response body: [{ loginid, empname, empmobile, id }, …].
export async function getTicketEmployees(opid, group = 'accounts') {
  const url = `${getBaseUrl()}Apis/getEmployee`;
  const body = new URLSearchParams({ opid: opid || '', group }).toString();
  const resp = await apiFetch(url, { method: "POST", headers: TICKET_FORM_HEADERS, body }, "getTicketEmployees");
  if (!resp.ok) throw new Error(`Failed to get transfer employees ${resp.status}`);
  return resp.json();
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

  const resp = await apiFetch(url, { method: 'POST', headers, body: formData }, "uploadCustKYC", { timeout: UPLOAD_TIMEOUT });

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

  if (!resp.ok) {
    const errorText = await resp.text();
    logger.error("API", "submitKYC error", { status: resp.status, cid, prooftype });
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

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
    const asArray = (v, fields = []) => {
      if (!Array.isArray(v)) return [];
      return v.flatMap((item) => {
        if (item && typeof item === "object") {
          return fields.map((field) => item[field]);
        }
        return [item];
      }).filter((item) => item !== undefined && item !== null && item !== "").map(String);
    };
    const mergedChannelIds = Array.from(new Set([
      ...asArray(defBody.channelid),
      ...asArray(actBody.channelid),
    ]));
    const mergedPackageIds = Array.from(new Set([
      ...asArray(defBody.packageid, ["pkgid", "packageid", "id"]),
      ...asArray(actBody.packageid, ["pkgid", "packageid", "id"]),
      ...asArray(defBody.packageids),
      ...asArray(actBody.packageids),
      ...asArray(defBody.pkgid),
      ...asArray(actBody.pkgid),
      ...asArray(defBody.pkgids),
      ...asArray(actBody.pkgids),
      ...asArray(defBody.packages, ["pkgid", "packageid", "id"]),
      ...asArray(actBody.packages, ["pkgid", "packageid", "id"]),
      ...asArray(defBody.subscribed_packages, ["pkgid", "packageid", "id"]),
      ...asArray(actBody.subscribed_packages, ["pkgid", "packageid", "id"]),
    ]));
    const mergedPackageCodes = Array.from(new Set([
      ...asArray(defBody.pkgcode),
      ...asArray(actBody.pkgcode),
      ...asArray(defBody.pkgcodes),
      ...asArray(actBody.pkgcodes),
      ...asArray(defBody.packagecode),
      ...asArray(actBody.packagecode),
      ...asArray(defBody.packagecodes),
      ...asArray(actBody.packagecodes),
      ...asArray(defBody.packages, ["pkgcode", "packagecode", "pkg_code", "package_code"]),
      ...asArray(actBody.packages, ["pkgcode", "packagecode", "pkg_code", "package_code"]),
      ...asArray(defBody.subscribed_packages, ["pkgcode", "packagecode", "pkg_code", "package_code"]),
      ...asArray(actBody.subscribed_packages, ["pkgcode", "packagecode", "pkg_code", "package_code"]),
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
        pkgcode: mergedPackageCodes,
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

// ═══════════════════════════════════════════════════════════════════════
//  Cable-TV endpoints ported from the Android employee flavor (2026-07-17).
//  Contracts verified against CABLE_TV_API_REPORT.md + backend PHP source.
//  Each mirrors the mobile app's exact wire bytes (report section 6) so the
//  PWA cable flow behaves identically to the APK. Envelope is the standard
//  {status:{err_code,err_msg}, body}; these return the raw parsed object like
//  their siblings (getChannelsList etc.) so callers gate on err_code === 0.
// ═══════════════════════════════════════════════════════════════════════

/**
 * custSearchOptions - provider/platform picker options for a service.
 * Report 6.2. POST JSON { username: <employee>, servid: <int> }.
 * NOTE servid is an INT on the wire (SearchOptionsRequest.java), not a string.
 */
export async function getCustSearchOptions({ username = "superadmin", servid = 1 }) {
  const url = `${getBaseUrl()}ServiceApis/custSearchOptions`;
  const headers = getHeadersJson();
  const payload = { username, servid: Number(servid) || 0 };
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getCustSearchOptions");
  if (!resp.ok) throw new Error(`Failed to get search options: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * subscribedChannels - the customer's currently-subscribed cable selection.
 * Report 6.8. POST JSON { userid: <customer>, username: <employee>, servid }.
 * Response body: { channelid[], packageid[], lcochid[], pkgcode[],
 *                  issubscribed:"yes"|"no", total_amount:<number> }.
 */
export async function getSubscribedChannels({ userid, username = "superadmin", servid }) {
  const url = `${getBaseUrl()}ServiceApis/subscribedChannels`;
  const headers = getHeadersJson();
  const payload = { userid, username, servid: String(servid ?? "1") };
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getSubscribedChannels");
  if (!resp.ok) throw new Error(`Failed to get subscribed channels: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * filterOptions - genre/language/broadcaster/stream/price/sort option lists
 * for the channel-filter dialog. Report 6.20. GET query.
 * apptype is the literal "android" in the APK; sent verbatim to match the app.
 */
export async function getFilterOptions({ username = "superadmin", userid, apptype = "android" }, skipCache = false) {
  const cacheKey = `filteropts_${userid}`;
  if (!skipCache) {
    const cached = lsGet(cacheKey, 30 * 60 * 1000); // 30 min - options rarely change
    if (cached) { perfMonitor.recordCacheHit("General", "getFilterOptions", cacheKey); return cached; }
  }
  const params = new URLSearchParams({ username, userid: userid ?? "", apptype });
  const url = `${getBaseUrl()}ServiceApis/filterOptions?${params.toString()}`;
  const headers = getHeadersForm(); // GET - no Content-Type needed
  const resp = await apiFetch(url, { method: "GET", headers }, "getFilterOptions");
  if (!resp.ok) throw new Error(`Failed to get filter options: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.status?.err_code === 0) lsSet(cacheKey, data);
  return data;
}

/**
 * denominations - currency-note breakdown for the cash-collection screen.
 * Report 6.21. POST, NO body, NO params. Result feeds generateorder's
 * `denominations` array on the cash rail.
 */
export async function getDenominations() {
  const url = `${getBaseUrl()}ServiceApis/denominations`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "POST", headers }, "getDenominations");
  if (!resp.ok) throw new Error(`Failed to get denominations: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * getServRegCastNos - CAS numbers linked to a customer/service.
 * Report 6.16. GET query ?servid=&username=. body is a BARE ARRAY of
 * linked-account rows; each row's `castregid` is the regid for delServRegCasNos.
 */
export async function getServRegCastNos({ servid, username = "superadmin" }) {
  const params = new URLSearchParams({ servid: String(servid ?? "1"), username });
  const url = `${getBaseUrl()}ServiceApis/getServRegCastNos?${params.toString()}`;
  const headers = getHeadersForm();
  const resp = await apiFetch(url, { method: "GET", headers }, "getServRegCastNos");
  if (!resp.ok) throw new Error(`Failed to get linked CAS numbers: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * delServRegCasNos - unlink a CAS account. Report 6.16.
 * The ONLY form-encoded cable endpoint: single field `regid` (= a row's
 * castregid). NOT JSON.
 */
export async function delServRegCasNos({ regid }) {
  const url = `${getBaseUrl()}ServiceApis/delServRegCasNos`;
  const headers = getHeadersForm();
  const body = new URLSearchParams();
  body.append("regid", regid ?? "");
  const resp = await apiFetch(url, { method: "POST", headers, body }, "delServRegCasNos");
  if (!resp.ok) throw new Error(`Failed to delete linked CAS: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * registrationTermsAndConditions - T&C text for the registration wizard.
 * Report 6.22. POST, no params.
 */
export async function getRegistrationTermsAndConditions() {
  const url = `${getBaseUrl()}ServiceApis/registrationTermsAndConditions`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "POST", headers }, "getRegistrationTermsAndConditions");
  if (!resp.ok) throw new Error(`Failed to get terms and conditions: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * crmGeneralDetails - generic CRM config/details. Report 6.22.
 * POST JSON (ad-hoc body). Pass whatever the call site needs; forwarded verbatim.
 */
export async function getCrmGeneralDetails(params = {}) {
  const url = `${getBaseUrl()}ServiceApis/crmGeneralDetails`;
  const headers = getHeadersJson();
  // Backend requires `username` (verified live: an empty body returns
  // err_code 1 "Please enter username."). Default to the employee login;
  // callers may override via params.
  const payload = { username: "superadmin", ...params };
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getCrmGeneralDetails");
  if (!resp.ok) throw new Error(`Failed to get CRM general details: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * servicesOrders - generic operator order list (getCommonOrderList).
 * Report 6.22. POST JSON ServiceOrderRequest; all fields optional filters.
 */
export async function getServicesOrders(params = {}) {
  const url = `${getBaseUrl()}ServiceApis/servicesOrders`;
  const headers = getHeadersJson();
  const payload = {
    opid: "", limit: "", offset: "", todate: "", fromdate: "", planname: "",
    txnstatus: "", datesearch: "", servuserid: "", ordernumber: "", servicename: "",
    paymentmode: "", gatewaytxnid: "", customised_data: "",
    ...params,
  };
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getServicesOrders");
  if (!resp.ok) throw new Error(`Failed to get services orders: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * ordersList - the customer's cable/service order history. Report 6.15.
 * POST JSON { userid, username, servid, + 6 always-empty date/filter fields }.
 * Response body: { total_orders:<int>, result:[ {ordernumber, orderdate,
 *   txndate, totalamount, paidamount, balanceamount, taxamount,
 *   discountamount, othercharges, paymentmode, txnstatus}, ... ] }.
 * This is the REAL order-history endpoint - ServiceApis/cabletv/orderhistory
 * (which orderApis previously called) does not exist and 404s.
 */
export async function getOrdersList({ userid, username = "superadmin", servid }) {
  const url = `${getBaseUrl()}ServiceApis/ordersList`;
  const headers = getHeadersJson();
  const payload = {
    userid: userid ?? "",
    username,
    servid: String(servid ?? "1"),
    ordernumber: "",
    txndatefrom: "",
    txndatetill: "",
    orderdatefrom: "",
    orderdatetill: "",
    paymentmode: "",
  };
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getOrdersList");
  if (!resp.ok) throw new Error(`Failed to get orders list: HTTP ${resp.status}`);
  return resp.json();
}
