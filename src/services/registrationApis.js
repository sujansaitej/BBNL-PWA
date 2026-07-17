// Centralized API helpers for registration and validation
import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";
import { lsGet, lsSet } from "./lsCache";
import { getUser } from "./safeStorage";
import {
  getBaseUrl,
  getHeaders,
  getHeadersJson,
  getHeadersForm,
  apiFetch,
  PROFILE,
  UPLOAD_TIMEOUT,
  PAYMENT_TIMEOUT,
} from "./apiCore";

function getInternetPaymentBaseUrl() {
  return import.meta.env.VITE_INTERNET_PAYMENT_BASE_URL || getBaseUrl();
}

// ponytail: every apiFetch here is Registration-grouped; one const beats
// repeating the object at 8 call sites.
const REG = { group: "Registration" };

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
  const resp = await apiFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }, "generalValidation", REG);
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
 * - username: sent as a query param for Android parity. THE SERVER IGNORES IT.
 * - fieldName: the file part name — photo1 | idcard1 | idcard2 | addrproof1..3
 *              | pan1 | pan2 | signature. THIS is what the server reads.
 * - file: File object
 *
 * HOW THIS ENDPOINT ACTUALLY WORKS (read from the backend source, not inferred)
 * ---------------------------------------------------------------------------
 * ServiceApis::custKYC -> CustomerRegistration::_custKYC()
 * (BBNL-PWA-Backend/application/controllers/ServicesModules/CustomerRegistration.php:341)
 *
 * `_custKYC` never reads `username` — not from $_GET, not from $_POST, nowhere.
 * It is a STATELESS TEMP-FILE UPLOAD:
 *   1. switches on which $_FILES[<fieldName>] key is present, to derive
 *      filetype (profile | idproof | address | pan | sign),
 *   2. inserts a row into `cust_kyc_temp_files`,
 *   3. writes the file to REG_FILE_DIR,
 *   4. returns {status, body:{result:{id, filepath, filetype}}}.
 *
 * The file is bound to a customer LATER: the caller keeps `body.result.id` and
 * passes it as `filerefid[]` on the registration POST, where the backend does
 * getTempFiles($uname, $filerefid) (CustomerRegistration.php:51,151).
 *
 * So the ONLY thing that matters on this call is the file part NAME. Android's
 * @Query("username") is equally ignored by the server; we send it purely so the
 * two clients put identical bytes on the wire.
 */
export async function uploadKycFile(username, file, fieldName) {
  const url = `${getBaseUrl()}ServiceApis/custKYC?username=${encodeURIComponent(username)}`;
  // No Content-Type — the browser must set the multipart boundary itself.
  const headers = getHeadersForm();

  // File part only, matching Android's single @Part. username is NOT a body
  // field; see above.
  const formData = new FormData();
  formData.append(fieldName, file, file.name || "upload.jpg");

  const resp = await apiFetch(url, {
    method: "POST",
    headers,
    body: formData,
    // linkNavigation:false — a half-delivered document upload leaves the
    // record ambiguous. Uploads are re-runnable, but this file had no
    // nav-abort pre-migration; don't add one to a write path silently.
  }, "uploadKycFile", { ...REG, timeout: UPLOAD_TIMEOUT, linkNavigation: false });
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
  const resp = await apiFetch(url, { method: "POST", headers, body }, "registrationNecessities", REG);
  if (!resp.ok) throw new Error(`registrationNecessities failed ${resp.status}`);
  const data = await resp.json();
  lsSet(cacheKey, data);
  return data;
}

export async function getOnuHwDets(op_id, onumacid) {
  const url     = `${getBaseUrl()}ServiceApis/getonuhardwaredetails`;
  const headers = getHeadersJson();
  const body    = JSON.stringify({ client_id: op_id, macid: onumacid });
  const resp    = await apiFetch(url, { method: "POST", headers, body }, "getOnuHwDets", REG);
  if (!resp.ok) throw new Error(`Failed ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function registerCustomer(payload) {
  const url     = `${getBaseUrl()}ServiceApis/custservregistration`;
  const headers = getHeadersJson();
  // linkNavigation:false — creates a customer record. An aborted-but-delivered
  // request leaves us unable to tell whether the customer exists, and the
  // retry creates a duplicate. Preserves this file's pre-apiCore behavior.
  const resp    = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "registerCustomer", { ...REG, linkNavigation: false });
  if (!resp.ok) throw new Error(`Customer registration failed ${resp.status}`);
  const data = await resp.json();
  return data;
}

// Internet payment — get payment details.
// Endpoint: apis/makepayment
// Form fields: apiopid, apptype, apiuserid (per backend contract).
// Previous version sent extra `othamt` / `othreason` fields which
// the backend now ignores — pruned to keep the payload identical to
// what netmon's other clients send.
export async function getPayDets(params) {
  const url = `${getBaseUrl()}apis/makepayment`;
  // Use employee payment headers (same as paymentinfo + savePaymentApi)
  // so the backend sees appkeytype=employee and returns the correct
  // share-split / balance / total calculation for operator context.
  const headers = getHeaders({
    profile: PROFILE.EMPLOYEE_PAYMENT,
    contentType: "application/x-www-form-urlencoded",
  });

  const body = new URLSearchParams({
    apiopid: params.apiopid,
    apptype: params.apptype,
    apiuserid: params.apiuserid,
  }).toString();

  const resp = await apiFetch(url, {
    method: "POST",
    headers,
    body,
    // linkNavigation:false — apis/makepayment registers a payment attempt
    // server-side despite the read-ish name (Android calls this
    // INTERNETPAYMENTINFO). Treat it as a mutation, not a fetch.
  }, "getPayDets", { ...REG, linkNavigation: false });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

// Internet — paymentinfo (JSON). First leg of the Proceed-to-Pay
// flow. Server validates the payment and returns the computed
// breakdown (taxes, transaction id, share splits) used for billing
// records. Must be called BEFORE savePaymentApi so the server has
// the transaction context for the save step.
// Endpoint: internet/paymentinfo (JSON)
export async function getInternetPaymentInfo(params) {
  const url = `${getInternetPaymentBaseUrl()}internet/paymentinfo`;
  const headers = getHeadersJson(PROFILE.EMPLOYEE_PAYMENT);

  // CRITICAL FIX (May 2026): Every internet renewal/registration must be
  // exactly 1 month. We hardcode it as a Number to ensure the backend 
  // JSON parser doesn't default to a multi-month period.
  const forcedNoofMonth = 1;

  const normalizeOptionalAmount = (value) => {
    if (value === "" || value === null || typeof value === "undefined") {
      return "";
    }
    return Number(value || 0).toFixed(2);
  };

  // Body matches the netmon contract. 
  // IMPORTANT: Match user's provided trace exactly.
  // Fields are sent as STRINGS to ensure legacy backend parsing works.
  // paidamount uses .toFixed(2) to include the .00 suffix.
  // loginuname is sent as an empty string per the trace.
  const body = JSON.stringify({
    userid: params.userid || "",
    loginopid: params.loginopid || "",
    noofmonth: String(forcedNoofMonth), 
    usagecompleted: String(params.usagecompleted || 0),
    disctype: params.disctype || "",
    discamt: normalizeOptionalAmount(params.discamt),
    othamt: normalizeOptionalAmount(params.othamt),
    discreason: params.discreason || "",
    othreason: params.othreason || "",
    // Ensure paidamount is a String with two decimals for the JSON payload
    paidamount: Number(params.paidamount || 0).toFixed(2),
    apptype: params.apptype || "crmapp",
    paymode: params.paymode || "cash",
    paydoneby: params.paydoneby || "",
    payreceivedby: params.payreceivedby || "",
    receivedremark: params.receivedremark || "cash",
    transstatus: params.transstatus || "success",
    renewstatus: params.renewstatus || "success",
    addprefix: params.addprefix || "no",
    formtype: params.formtype || "payment",
    bank_name: params.bank_name || "",
    chqdate: params.chqdate || "",
    chqno: params.chqno || "",
    gtwy_logid: params.gtwy_logid || "",
    gatewaytransid: params.gatewaytransid || "",
    gatewaycharges: params.gatewaycharges || "",
    banktransid: params.banktransid || "",
    onl_pymt_typ: params.onl_pymt_typ || "",
    gtwy_postvals: params.gtwy_postvals || null,
    pymtdate: params.pymtdate || null,
    updateexpiry: params.updateexpiry || "",
    atomtxngnrt: params.atomtxngnrt || "",
    // User trace shows loginuname is empty in the JSON body
    loginuname: "",
  });



  const resp = await apiFetch(url, {
    method: "POST",
    headers,
    body,
    // linkNavigation:false — money in flight. Aborting the request does NOT
    // roll back the server; it only means we never learn whether the payment
    // landed, leaving the operator to retry and risk a double charge. This
    // file had no nav-abort before the apiCore migration (apiCore defaults it
    // on), so opting out here preserves the original, safer behavior.
  }, "getInternetPaymentInfo", { ...REG, timeout: PAYMENT_TIMEOUT, linkNavigation: false });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  logger.debug("Registration", "Internet paymentinfo completed", {
    endpoint: "internet/paymentinfo",
    authMode: headers.appkeytype,
    userid: params.userid || "",
    loginopid: params.loginopid || "",
    status: data?.status?.err_code,
    error: data?.error,
    message: data?.status?.err_msg || data?.result || "",
  });
  return data;
}

// Internet — savePaymentApi (note camelCase 'P' — distinct from the
// older lowercase savepaymentapi endpoint). Second leg of Proceed-
// to-Pay: persists the payment record after paymentinfo validated
// and computed the breakdown.
// Endpoint: apis/savePaymentApi (form-urlencoded)
// Fields per backend contract:
//   apiopid, cashpaid, paidamount, transstatus, services_app, noofmonth,
//   paydoneby, apiuserid, usagecompleted, applicationname,
//   payreceivedby, paymode, renewstatus, receivedremark
export async function payNow(params) {
  const url = `${getInternetPaymentBaseUrl()}apis/savePaymentApi`;
  const headers = getHeaders({
    profile: PROFILE.EMPLOYEE_PAYMENT,
    contentType: "application/x-www-form-urlencoded",
  });

  // CRITICAL FIX (May 2026): Force exactly 1 month for all internet renewals.
  const forcedNoofMonth = 1;

  const user = getUser();
  const bodyParams = new URLSearchParams();
  bodyParams.set("apiopid", params.apiopid || user.op_id || "");
  bodyParams.set(
    "cashpaid",
    (typeof params.cashpaid !== 'undefined' && params.cashpaid !== null)
      ? Number(params.cashpaid).toFixed(2)
      : "0.00"
  );
  // Native Internet flow does not always send paidamount in savePaymentApi.
  // When omitted, renewal logic relies on paymentinfo while savePaymentApi
  // closes the receipt using cashpaid only.
  if (!params.omitPaidAmount) {
    bodyParams.set(
      "paidamount",
      (typeof params.paidamount !== 'undefined' && params.paidamount !== null)
        ? Number(params.paidamount).toFixed(2)
        : (typeof params.cashpaid !== 'undefined' && params.cashpaid !== null)
          ? Number(params.cashpaid).toFixed(2)
          : "0.00"
    );
  }
  bodyParams.set("transstatus", params.transstatus || "success");
  bodyParams.set("services_app", String(params.services_app || 1));
  bodyParams.set("noofmonth", String(forcedNoofMonth));
  bodyParams.set("paydoneby", params.paydoneby || "");
  bodyParams.set("apiuserid", params.apiuserid || "");
  bodyParams.set("usagecompleted", String(params.usagecompleted || 0));
  bodyParams.set("applicationname", params.applicationname || "crmapp");
  bodyParams.set("payreceivedby", params.payreceivedby || "");
  bodyParams.set("paymode", params.paymode || "cash");
  bodyParams.set("renewstatus", params.renewstatus || "success");
  bodyParams.set("receivedremark", params.receivedremark || "cash");
  const body = bodyParams.toString();



  const resp = await apiFetch(url, {
    method: "POST",
    headers,
    body,
    // linkNavigation:false — see getInternetPaymentInfo. This is the actual
    // debit call; a cancelled-but-delivered request is the double-charge path.
  }, "payNow", { ...REG, timeout: PAYMENT_TIMEOUT, linkNavigation: false });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  logger.debug("Registration", "Internet savePaymentApi completed", {
    endpoint: "apis/savePaymentApi",
    authMode: headers.appkeytype,
    apiuserid: params.apiuserid || "",
    apiopid: params.apiopid || "",
    status: data?.status?.err_code,
    error: data?.error,
    message: data?.status?.err_msg || data?.result || "",
  });
  return data;
}
