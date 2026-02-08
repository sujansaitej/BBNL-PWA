const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const API_AUTH_KEY = import.meta.env.VITE_API_AUTH_KEY;
const API_USERNAME = import.meta.env.VITE_API_USERNAME;
const API_PASSWORD = import.meta.env.VITE_API_PASSWORD;

const BASIC_AUTH = "Basic " + btoa(`${API_USERNAME}:${API_PASSWORD}`);

async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const requestBody = options.body ? JSON.parse(options.body) : null;

  console.group(`%c🔵 [API] ${options.method || "GET"} ${endpoint}`, "color: #3b82f6; font-weight: bold; font-size: 12px;");
  console.log("%c📡 URL:", "color: #6366f1; font-weight: bold;", url);
  console.log("%c📋 Request Headers:", "color: #6366f1; font-weight: bold;", {
    "Content-Type": "application/json",
    Authorization: "Basic ***",
    "x-api-key": API_AUTH_KEY ? "***" + API_AUTH_KEY.slice(-6) : "N/A",
  });
  if (requestBody) {
    console.log("%c🔑 Request Keys:", "color: #8b5cf6; font-weight: bold;", Object.keys(requestBody));
    console.log("%c📦 Request Body:", "color: #8b5cf6; font-weight: bold;", requestBody);
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: BASIC_AUTH,
      "x-api-key": API_AUTH_KEY,
      ...options.headers,
    },
  });

  console.log("%c📶 Response Status:", "color: #6366f1; font-weight: bold;", res.status, res.statusText);

  if (!res.ok) {
    console.log("%c🔴 RESPONSE FAILED", "color: #ef4444; font-weight: bold; font-size: 13px;", res.status, res.statusText);
    console.groupEnd();
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log("%c🔴 NON-JSON RESPONSE", "color: #ef4444; font-weight: bold; font-size: 13px;", text.substring(0, 300));
    console.groupEnd();
    throw new Error("Server returned an invalid response. Please try again.");
  }

  const isSuccess = data?.status?.err_code === 0;
  const statusIcon = isSuccess ? "🟢" : "🔴";
  const statusColor = isSuccess ? "color: #22c55e; font-weight: bold;" : "color: #ef4444; font-weight: bold;";

  console.log(`%c${statusIcon} err_code:`, statusColor, data?.status?.err_code);
  console.log(`%c${statusIcon} err_msg:`, statusColor, data?.status?.err_msg);
  if (data?.body) {
    console.log("%c📦 Response Body:", "color: #0ea5e9; font-weight: bold;", data.body);
  }
  console.log(`%c${statusIcon} Full Response:`, statusColor, data);
  console.groupEnd();

  if (!isSuccess) {
    throw new Error(data?.status?.err_msg || "Something went wrong!");
  }

  return data;
}

export async function registerUser({ name, mobile }) {
  try {
    return await apiFetch("/addftauser", {
      method: "POST",
      body: JSON.stringify({ name, mobile }),
    });
  } catch (err) {
    // "User already exists" → call sign-in endpoint to actually send the OTP
    if (err.message?.toLowerCase().includes("already exists")) {
      console.log("%c🟡 [API] User already exists — calling /ftausersignin to send OTP", "color: #eab308; font-weight: bold; font-size: 12px;");
      return await signIn({ mobile });
    }
    throw err;
  }
}

export function verifyOtp({ mobile, otp }) {
  return apiFetch("/verifyftauserotp", {
    method: "POST",
    body: JSON.stringify({ mobile, otp }),
  });
}

export function signIn({ mobile }) {
  return apiFetch("/ftausersignin", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}

export function resendOtp({ mobile }) {
  return apiFetch("/ftauserresendotp", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}

export function getLanguageList({ mobile }) {
  return apiFetch("/ftauserlanglist", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}

export function getChannelList({ mobile, grid = "", bcid = "", langid = "subs", search = "" }) {
  return apiFetch("/ftauserchnllist", {
    method: "POST",
    body: JSON.stringify({ mobile, grid, bcid, langid, search }),
  });
}

export function getAdvertisements({ mobile, adclient = "fofi", srctype = "Image", displayarea = "homepage", displaytype = "multiple" }) {
  return apiFetch("/ftauserads", {
    method: "POST",
    body: JSON.stringify({ mobile, adclient, srctype, displayarea, displaytype }),
  });
}

export async function getPublicIP() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip;
  } catch {
    return "0.0.0.0";
  }
}

export async function getChannelStream({ mobile, chid = "", chno = "", ip_address }) {
  if (!ip_address) {
    ip_address = await getPublicIP();
  }
  return apiFetch("/ftauserstream", {
    method: "POST",
    body: JSON.stringify({ mobile, chid, chno, ip_address }),
  });
}

export function getAppVersion({ mobile, app_package = "com.fofi.fofiboxmob" }) {
  return apiFetch("/ftauserappversion", {
    method: "POST",
    body: JSON.stringify({ mobile, app_package }),
  });
}

export async function getAppLock({ mobile, appversion = "1.0" }) {
  const ip_address = await getPublicIP();
  return apiFetch("/ftauserapplock", {
    method: "POST",
    body: JSON.stringify({ mobile, ip_address, appversion }),
  });
}

export function submitFeedback({ mobile, rate_count, feedback, device_name = "" }) {
  if (!device_name) {
    device_name = navigator.userAgent.slice(0, 50);
  }
  return apiFetch("/ftauserfeedback", {
    method: "POST",
    body: JSON.stringify({ mobile, rate_count: String(rate_count), feedback, device_name }),
  });
}
