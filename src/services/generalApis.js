// General API services
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
  };
}

export async function UserLogin(username, password) {
  const url = `${getBaseUrl()}ServiceApis/custlogin`;
  const headers = getHeadersForm();

  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

export async function OTPauth(username, otprefid, otpcode) {
  const url = `${getBaseUrl()}ServiceApis/custLoginVerification`;
  const headers = getHeadersForm();

  const formData = new FormData();
  formData.append("username", username);
  formData.append("otprefid", otprefid);
  formData.append("otpcode", otpcode);

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

export async function resendOTP(username) {
  const url = `${getBaseUrl()}ServiceApis/custLoginResendOtp?username=` + username;
  const headers = getHeadersJson();
  const resp = await fetch(url, { method: "POST", headers });
  if (!resp.ok) throw new Error(`Failed to resend otp ${resp.status}`);
  const data = await resp.json();
  return data;
}

/**
 * Get wallet balance
 * @param {Object} payload - { loginuname: string, servicekey?: string }
 * @returns {Promise<Object>} Response containing wallet balance
 */
export async function getWalBal(payload) {
  const url = `${getBaseUrl()}ServiceApis/myWallet`;
  const headers = getHeadersJson();
  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(`Failed to get wallet balance ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getCustList(payload, status) {
  const url = `${getBaseUrl()}ServiceApis/customersList?status=${encodeURIComponent(status || '')}`;
  const headers = getHeadersJson();
  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(`Failed to get customer data ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getServiceList() {
  // Build query parameters
  const params = new URLSearchParams({
    servtype: 'all',
    iskirana: 'false'
  });

  const url = `${getBaseUrl()}ServiceApis/servServiceList?${params.toString()}`;

  // Use form headers (without Content-Type for FormData)
  const headers = {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
    appversion: import.meta.env.VITE_API_APP_VERSION,
  };

  // Still send as FormData in body as per client spec
  const formData = new FormData();
  formData.append("servtype", "all");
  formData.append("iskirana", "false");

  console.log('🔵 [getServiceList] Making API request to:', url);
  console.log('🔵 [getServiceList] Headers:', headers);
  console.log('🔵 [getServiceList] FormData - servtype:', formData.get('servtype'));
  console.log('🔵 [getServiceList] FormData - iskirana:', formData.get('iskirana'));

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  console.log('🔵 [getServiceList] Response status:', resp.status, resp.statusText);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  console.log('🔵 [getServiceList] Response data:', data);
  console.log('🔵 [getServiceList] Status object:', data.status);
  console.log('🔵 [getServiceList] Body:', data.body);
  return data;
}

/**
 * Get user assigned items for a specific service
 * @param {string} servkey - Service key (e.g., 'internet', 'iptv', 'voice', 'fofi')
 * @param {string} userid - User ID
 * @returns {Promise<Object>} Response containing assigned items
 */
export async function getUserAssignedItems(servkey, userid) {
  const url = `${getBaseUrl()}ServiceApis/getUserAssignedItems`;
  const headers = getHeadersJson();

  const payload = {
    servkey,
    userid
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Failed to get user assigned items: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

/**
 * Get cable customer details
 * @param {string} refid - Reference ID (customer username)
 * @returns {Promise<Object>} Response containing customer details
 */
export async function getCableCustomerDetails(refid) {
  const url = `${getBaseUrl()}GeneralApi/cblCustDet`;

  // This API uses different headers (Basic auth)
  const headers = {
    Authorization: "Basic 06e32ddefe8ad2b05024530451a1cc28",
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const formData = new URLSearchParams();
  formData.append("refid", refid);

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Failed to get cable customer details: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

/**
 * Get primary customer details
 * @param {string} userid - User ID
 * @returns {Promise<Object>} Response containing primary customer details
 */
export async function getPrimaryCustomerDetails(userid) {
  const url = `${getBaseUrl()}cabletvapis/primaryCustdet`;

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const formData = new URLSearchParams();
  formData.append("userid", userid);

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Failed to get primary customer details: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

/**
 * Get user's plan details for a specific service
 * @param {Object} params - Plan details parameters
 * @param {string} params.servicekey - Service key (e.g., 'internet', 'iptv', 'voice', 'fofi')
 * @param {string} params.userid - User ID
 * @param {string} params.fofiboxid - FoFi box ID (optional, empty string if not applicable)
 * @param {string} params.voipnumber - VoIP number (optional, empty string if not applicable)
 * @returns {Promise<Object>} Response containing plan details
 */
export async function getMyPlanDetails(params) {
  const url = `${getBaseUrl()}ServiceApis/getMyPlanDetails`;
  const headers = getHeadersJson();

  const payload = {
    fofiboxid: params.fofiboxid || "",
    servicekey: params.servicekey,
    userid: params.userid,
    voipnumber: params.voipnumber || ""
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Failed to get plan details: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

/* Ticket APIs */
export async function getTktDepartments() {
  const url = `${getBaseUrl()}apis/getDepartments`;
  const headers = getHeadersJson();
  const resp = await fetch(url, { method: "GET", headers });
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

  const resp = await fetch(url, { method: "GET", headers });
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
  // var inpParams = { apiopid : allParams.op_id };
  const query = new URLSearchParams({ ...allParams }).toString();

  const url = `${getBaseUrl()}apis/${ep}?${query}`;
  const headers = getHeadersJson();

  const resp = await fetch(url, { method: "POST", headers });
  if (!resp.ok) throw new Error(`Failed to pick ticket ${resp.status}`);

  const data = await resp.json();
  return data;
}

// export async function createTicket(payload) {
//   const url     = `${getBaseUrl()}ServiceApis/createTicket`;
//   const headers = getHeadersJson();
//   const resp    = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
//   if (!resp.ok) throw new Error(`Failed to create ticket ${resp.status}`);
//   const data = await resp.json();
//   return data;
// }

// export async function updateTicketStatus(payload) {
//   const url     = `${getBaseUrl()}ServiceApis/updateTicketStatus`;
//   const headers = getHeadersJson();
//   const resp    = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
//   if (!resp.ok) throw new Error(`Failed to update ticket status ${resp.status}`);
//   const data = await resp.json();
//   return data;
// }

/* Get Customer KYC Preview - Fetches existing uploaded documents */
export async function getCustKYCPreview({ cid, reqtype = 'update' }) {
  const url = `${getBaseUrl()}ServiceApis/custKYCpreview`;

  // Headers matching client documentation exactly
  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': 'employee',
    'Content-Type': 'application/json; charset=UTF-8'
  };

  const payload = { cid, reqtype };

  console.log('🔵 [custKYCpreview] Request:', { url, payload });

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  console.log('🔵 [custKYCpreview] Response status:', resp.status, resp.statusText);

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('❌ [custKYCpreview] Error response:', errorText);
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  console.log('🟢 [custKYCpreview] Response data:', JSON.stringify(data, null, 2));
  return data;
}

/* Upload Customer KYC Document - Uploads document with multipart/form-data */
export async function uploadCustKYC({ cid, prooftype, reqtype = 'update', file, loginuser = 'superadmin' }) {
  const url = `${getBaseUrl()}ServiceApis/uploadcustKYC`;

  // Validate file
  if (!file || !(file instanceof File)) {
    throw new Error('Invalid file object');
  }

  // Validate required parameters
  if (!cid) {
    throw new Error('Customer ID (cid) is required');
  }
  if (!prooftype) {
    throw new Error('Proof type is required');
  }

  // Create FormData for multipart/form-data upload
  // Based on client logs: FORMREQUEST:cid=iptvuser, prooftype=addProofs, reqtype=update, loginuser=superadmin
  // The file field must be named 'docimg' as per server specification
  const formData = new FormData();
  formData.append('cid', cid);
  formData.append('prooftype', prooftype);
  formData.append('reqtype', reqtype);
  formData.append('loginuser', loginuser);

  // Append file with field name 'docimg' as required by the server API
  formData.append('docimg', file, file.name);

  // For multipart/form-data, browser sets Content-Type with boundary automatically
  // Headers matching client documentation exactly
  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': 'employee',
    'appversion': import.meta.env.VITE_API_APP_VERSION || '1.49',
  };

  console.log('🔵 [uploadcustKYC] Request:', {
    url,
    formData: { cid, prooftype, reqtype, loginuser, docimg: file.name },
    fileSize: file.size,
    fileType: file.type
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });

  console.log('🔵 [uploadcustKYC] Response status:', resp.status, resp.statusText);

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('❌ [uploadcustKYC] Error response:', errorText);
    throw new Error(`HTTP ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  console.log('🟢 [uploadcustKYC] Response data:', JSON.stringify(data, null, 2));
  return data;
}

/**
 * Submit KYC - Final submission of KYC documents
 * API: ServiceApis/submitKYC
 * Request: { cid, loginuser, prooftype, reqtype }
 */
export async function submitKYC({ cid, loginuser = 'superadmin', prooftype, reqtype = 'update' }) {
  const url = `${getBaseUrl()}ServiceApis/submitKYC`;

  // Headers matching client documentation exactly
  const headers = {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': 'employee',
    'Content-Type': 'application/json; charset=UTF-8'
  };

  const payload = { cid, loginuser, prooftype, reqtype };

  console.log('🔵 [submitKYC] URL:', url);
  console.log('🔵 [submitKYC] Headers:', headers);
  console.log('🔵 [submitKYC] Payload:', JSON.stringify(payload));

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  console.log('🔵 [submitKYC] Response status:', resp.status, resp.statusText);

  // Always try to parse JSON response even if not ok
  const data = await resp.json().catch(() => null);
  console.log('🟢 [submitKYC] Response data:', JSON.stringify(data, null, 2));

  // Return the data regardless of status code - let caller handle the error
  return data;
}