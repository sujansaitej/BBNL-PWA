// General API services
import logger from "../utils/logger";

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
  };
}

/** Wrapper that adds timing + security logging to every API call */
async function apiFetch(url, options, label) {
  const method = options.method || "GET";
  const start = performance.now();
  logger.debug("API", `${label} → ${method} ${url}`);

  let resp;
  try {
    resp = await fetch(url, options);
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    logger.error("API", `${label} network error: ${err.message}`, { method, url, duration: `${duration}ms` });
    throw err;
  }

  const duration = Math.round(performance.now() - start);
  logger.api(method, url, resp.status, duration);

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

export async function getWalBal(payload) {
  const url = `${getBaseUrl()}ServiceApis/myWallet`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getWalBal");
  if (!resp.ok) throw new Error(`Failed to get wallet balance ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getCustList(payload, status) {
  const url = `${getBaseUrl()}ServiceApis/customersList?status=${encodeURIComponent(status || '')}`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getCustList");
  if (!resp.ok) throw new Error(`Failed to get customer data ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getServiceList() {
  const params = new URLSearchParams({ servtype: 'all', iskirana: 'false' });
  const url = `${getBaseUrl()}ServiceApis/servServiceList?${params.toString()}`;

  const headers = {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
    appversion: import.meta.env.VITE_API_APP_VERSION,
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
  return data;
}

export async function getUserAssignedItems(servkey, userid) {
  const url = `${getBaseUrl()}ServiceApis/getUserAssignedItems`;
  const headers = getHeadersJson();
  const payload = { servkey, userid };

  const resp = await apiFetch(url, { method: "POST", headers, body: JSON.stringify(payload) }, "getUserAssignedItems");

  if (!resp.ok) {
    throw new Error(`Failed to get user assigned items: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

export async function getCableCustomerDetails(refid) {
  const url = `${getBaseUrl()}GeneralApi/cblCustDet`;

  const headers = {
    Authorization: "Basic 06e32ddefe8ad2b05024530451a1cc28",
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const formData = new URLSearchParams();
  formData.append("refid", refid);

  const resp = await apiFetch(url, { method: "POST", headers, body: formData }, "getCableCustomerDetails");

  if (!resp.ok) {
    throw new Error(`Failed to get cable customer details: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

export async function getPrimaryCustomerDetails(userid) {
  const url = `${getBaseUrl()}cabletvapis/primaryCustdet`;

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const formData = new URLSearchParams();
  formData.append("userid", userid);

  const resp = await apiFetch(url, { method: "POST", headers, body: formData }, "getPrimaryCustomerDetails");

  if (!resp.ok) {
    throw new Error(`Failed to get primary customer details: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

export async function getMyPlanDetails(params) {
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
  return data;
}

/* Ticket APIs */
export async function getTktDepartments() {
  const url = `${getBaseUrl()}apis/getDepartments`;
  const headers = getHeadersJson();
  const resp = await apiFetch(url, { method: "GET", headers }, "getTktDepartments");
  if (!resp.ok) throw new Error(`Failed to get ticket stats ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getTickets(tabKey, allParams = {}) {
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
    'appkeytype': 'employee',
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
  formData.append('docimg', file, file.name);

  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': 'employee',
    'appversion': import.meta.env.VITE_API_APP_VERSION || '1.49',
  };

  logger.info("API", `KYC upload: cid=${cid}, type=${prooftype}, file=${file.name} (${file.size} bytes)`);

  const resp = await apiFetch(url, { method: 'POST', headers, body: formData }, "uploadCustKYC");

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
    'appkeytype': 'employee',
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
