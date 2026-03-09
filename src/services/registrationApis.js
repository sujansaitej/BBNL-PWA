// Centralized API helpers for registration and validation
import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";
import { lsGet, lsSet } from "./lsCache";

function getBaseUrl() {
    // return import.meta.env.VITE_API_BASE_URL;
    if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL; // Use this in production
    return '/api/'; // Use proxy in development
}

function getHeadersJson() {
  return {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
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
    appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
  };
}
const API_TIMEOUT = 15000; // 15 seconds
const UPLOAD_TIMEOUT = 60000; // 60 seconds for file uploads

/** Fetch with AbortController timeout, perf monitoring, and structured logging */
async function apiFetchWithTimeout(url, options, timeout = API_TIMEOUT, label = "Registration") {
    const method = options.method || "POST";
    const endPerf = perfMonitor.start(method, url, "Registration", label);
    logger.debug("Registration", `${label} → ${method} ${url}`);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const resp = await fetch(url, { ...options, signal: ctrl.signal });
        const entry = endPerf({ status: resp.status });
        logger.api(method, url, resp.status, entry.duration);
        return resp;
    } catch (err) {
        const isTimeout = err.name === "AbortError";
        const errMsg = isTimeout ? "timeout" : `network error: ${err.message}`;
        endPerf({ status: 0, error: errMsg });
        logger.error("Registration", `${label} ${errMsg}`, { method, url });
        if (isTimeout) throw new Error("Request timed out. Please check your network and try again.");
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// device id helper: persist a uuid in localStorage
import { v4 as uuidv4 } from "uuid";
export function getDeviceId() {
  const key = import.meta.env.VITE_DEVICE_ID_KEY || "deviceid";
  let id = localStorage.getItem(key);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(key, id);
  }
  return id;
}

// Generic POST JSON to ServiceApis/generalValidation
async function postGeneralValidation(payload) {
  const url = `${getBaseUrl()}ServiceApis/generalValidation`;
  const headers = getHeadersJson();
  const resp = await apiFetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }, API_TIMEOUT, "generalValidation");
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data;
}

/**
 * Check username availability by calling generalValidation with { userid, deviceid }
 * Returns { available: boolean, raw: data, message: string }
 */
export async function checkUsernameAvailability(userid) {
  try {
    const deviceid = getDeviceId();
    const payload = { userid, deviceid };
    const data = await postGeneralValidation(payload);

    const ok = data?.status?.err_code === 0 ? true : false;
    return {
      available: ok,
      raw: data,
      message: ok ? "Username available, proceed further" : data?.status?.err_msg || "Username not available",
    };
  } catch (err) {
    logger.error("Registration", "checkUsernameAvailability error", { error: err.message });
    return { available: false, raw: null, message: "Error checking username" };
  }
}

/**
 * Check email - use same endpoint but change payload property to 'email'
 */
export async function checkEmailAvailability(email) {
  try {
    const payload = { email };
    const data = await postGeneralValidation(payload);

    const ok = data?.status?.err_code === 0 ? true : false;
    return {
      available: ok,
      raw: data,
      message: ok ? "Email ID valid" : data?.status?.err_msg || "Email ID already exists",
    };
  } catch (err) {
    logger.error("Registration", "checkEmailAvailability error", { error: err.message });
    return { available: false, raw: null, message: "Error checking email" };
  }
}

/**
 * Check mobile - payload { mobile }
 */
export async function checkMobileAvailability(mobile) {
  try {
    const payload = { mobile };
    const data = await postGeneralValidation(payload);

    const ok = data?.status?.err_code === 0 ? true : false;
    return {
      available: ok,
      raw: data,
      message: ok ? "Mobile number valid" : data?.status?.err_msg || "Mobile number already exists",
    };
  } catch (err) {
    logger.error("Registration", "checkMobileAvailability error", { error: err.message });
    return { available: false, raw: null, message: "Error checking mobile number" };
  }
}

/**
 * Upload a single file to ServiceApis/custKYC
 * - username: user id string (form requires username param)
 * - fieldName: name to send for file (photo1, addrproof1, idcard1, signature, ...)
 * - file: File object
 *
 * Returns parsed JSON from server.
 */
export async function uploadKycFile(username, file, fieldName) {
  const url = `${getBaseUrl()}ServiceApis/custKYC`;
  const headers = {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
  };

  const formData = new FormData();
  formData.append("username", username);
  formData.append(fieldName, file, file.name);

  const resp = await apiFetchWithTimeout(url, {
    method: "POST",
    headers,
    body: formData,
  }, UPLOAD_TIMEOUT, "uploadKycFile");
  if (!resp.ok) throw new Error(`Upload failed ${resp.status}`);
  const data = await resp.json();
  return data;
}

/**
 * Final registration call
 * request JSON: {"logUname":"superadmin"} where superadmin dynamic
 */
export async function submitRegistrationNecessities(logUname) {
  const cacheKey = `regnec_${logUname}`;
  const cached = lsGet(cacheKey, 30 * 60 * 1000); // 30 min TTL
  if (cached) { perfMonitor.recordCacheHit("Registration", "submitRegistrationNecessities", cacheKey); return cached; }
  const url = `${getBaseUrl()}ServiceApis/registrationNecessities`;
  const headers = getHeadersJson();
  const body = JSON.stringify({ logUname });
  const resp = await apiFetchWithTimeout(url, { method: "POST", headers, body }, API_TIMEOUT, "registrationNecessities");
  if (!resp.ok) throw new Error(`registrationNecessities failed ${resp.status}`);
  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

export async function getOnuHwDets(op_id, onumacid) {
  const url     = `${getBaseUrl()}ServiceApis/getonuhardwaredetails`;
  const headers = getHeadersJson();
  const body    = JSON.stringify({ client_id: op_id, macid: onumacid });
  const resp    = await apiFetchWithTimeout(url, { method: "POST", headers, body }, API_TIMEOUT, "getOnuHwDets");
  if (!resp.ok) throw new Error(`Failed ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function registerCustomer(payload) {
  const url     = `${getBaseUrl()}ServiceApis/custservregistration`;
  const headers = getHeadersJson();
  const resp    = await apiFetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(payload) }, API_TIMEOUT, "registerCustomer");
  if (!resp.ok) throw new Error(`Customer registration failed ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getPayDets(params) {
  const url = `${getBaseUrl()}apis/makepayment`;
  const headers = {
    ...getHeadersForm(),
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // convert object to URL-encoded string
  const body = new URLSearchParams({
    apiopid: params.apiopid,
    apiuserid: params.apiuserid,
    apptype: params.apptype,
    othamt: params.othamt,
    othreason: params.othreason,
  }).toString();

  const resp = await apiFetchWithTimeout(url, {
    method: "POST",
    headers,
    body, // already stringified
  }, API_TIMEOUT, "getPayDets");

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  return await resp.json();
}

export async function payNow(params) {
  const url = `${getBaseUrl()}apis/savepaymentapi`;
  const headers = {
    ...getHeadersForm(),
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // convert object to URL-encoded string
  const body = new URLSearchParams({
    apiopid: params.apiopid,
    apiuserid: params.apiuserid,
    applicationname: params.applicationname,
    paymode: params.paymode,
    noofmonth: params.noofmonth,
    cashpaid: params.cashpaid,
    transstatus: params.transstatus,
    renewstatus: params.renewstatus,
    usagecompleted: params.usagecompleted,
    services_app: params.services_app,
    paydoneby: params.paydoneby,
    payreceivedby: params.payreceivedby,
    receivedremark: params.receivedremark
  }).toString();

  const resp = await apiFetchWithTimeout(url, {
    method: "POST",
    headers,
    body, // already stringified
  }, API_TIMEOUT, "payNow");

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  return await resp.json();
}
