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
  const url     = `${getBaseUrl()}ServiceApis/custLoginResendOtp?username=`+username;
  const headers = getHeadersJson();
  const resp    = await fetch(url, { method: "POST", headers });
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
  const url     = `${getBaseUrl()}ServiceApis/myWallet`;
  const headers = getHeadersJson();
  const resp    = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(`Failed to get wallet balance ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getCustList(payload, status) {
  const url     = `${getBaseUrl()}ServiceApis/customersList?status=${encodeURIComponent(status || '')}`;
  const headers = getHeadersJson();
  const resp    = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(`Failed to get customer data ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getServiceList() {
  const url = `${getBaseUrl()}ServiceApis/servServiceList`;
  
  // Use headers WITHOUT Content-Type (let browser set it for FormData)
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
  const url     = `${getBaseUrl()}apis/getDepartments`;
  const headers = getHeadersJson();
  const resp    = await fetch(url, { method: "GET", headers });
  if (!resp.ok) throw new Error(`Failed to get ticket stats ${resp.status}`);
  const data = await resp.json();
  return data;
}

export async function getTickets(tabKey, allParams = {}) {
  var ep = '';
  var inpParams = { apiopid : tabKey !== 'NEW CONNECTIONS' ? allParams.op_id : 'raghav'};
  switch(tabKey) {
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

export async function pickTicket(allParams = {}, action='') {
  var ep = '';
  if(action === 'close')
    ep = 'crmCloseTicket';
  else if(action === 'transfer')
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