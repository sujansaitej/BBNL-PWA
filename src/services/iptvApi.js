/**
 * IPTV API service — separate from main BBNL CRM APIs.
 * Uses the IPTV backend (Cabletvapis) for channel lists, streams, ads, and languages.
 */
import logger from "../utils/logger";

const IPTV_API_BASE = import.meta.env.VITE_IPTV_API_BASE_URL || "/api/Cabletvapis";
const IPTV_AUTH_KEY = import.meta.env.VITE_IPTV_API_AUTH_KEY || "";
const IPTV_USERNAME = import.meta.env.VITE_IPTV_API_USERNAME || "";
const IPTV_PASSWORD = import.meta.env.VITE_IPTV_API_PASSWORD || "";
const IPTV_DEFAULT_MOBILE = import.meta.env.VITE_IPTV_DEFAULT_MOBILE || "";

const BASIC_AUTH = "Basic " + btoa(`${IPTV_USERNAME}:${IPTV_PASSWORD}`);

/** Get the mobile number to use for IPTV APIs (default or logged-in user's) */
export function getIptvMobile() {
  if (IPTV_DEFAULT_MOBILE) return IPTV_DEFAULT_MOBILE;
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  return user.mobileno || "";
}

async function iptvFetch(endpoint, options = {}) {
  const url = `${IPTV_API_BASE}${endpoint}`;
  const start = performance.now();

  logger.debug("IPTV", `Request → POST ${endpoint}`);

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: BASIC_AUTH,
        "x-api-key": IPTV_AUTH_KEY,
        ...options.headers,
      },
    });
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    logger.error("IPTV", `Network error on ${endpoint}: ${err.message}`, { duration: `${duration}ms` });
    throw err;
  }

  const duration = Math.round(performance.now() - start);
  logger.api("POST", endpoint, res.status, duration);

  if (res.status === 401 || res.status === 403) {
    logger.security("IPTV_AUTH_REJECTED", { endpoint, status: res.status });
  }

  if (!res.ok) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    logger.error("IPTV", `Invalid JSON response from ${endpoint}`);
    throw new Error("Server returned an invalid response. Please try again.");
  }

  const isSuccess = data?.status?.err_code === 0;
  if (!isSuccess) {
    logger.warn("IPTV", `API error on ${endpoint}: ${data?.status?.err_msg}`);
    throw new Error(data?.status?.err_msg || "Something went wrong!");
  }

  return data;
}

export function getLanguageList({ mobile }) {
  return iptvFetch("/ftauserlanglist", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}

export function getChannelList({ mobile, grid = "", bcid = "", langid = "subs", search = "" }) {
  return iptvFetch("/ftauserchnllist", {
    method: "POST",
    body: JSON.stringify({ mobile, grid, bcid, langid, search }),
  });
}

export function getAdvertisements({ mobile, adclient = "fofi", srctype = "Image", displayarea = "homepage", displaytype = "multiple" }) {
  return iptvFetch("/ftauserads", {
    method: "POST",
    body: JSON.stringify({ mobile, adclient, srctype, displayarea, displaytype }),
  });
}

export async function getPublicIP() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    logger.debug("IPTV", `Public IP resolved: ${data.ip}`);
    return data.ip;
  } catch {
    logger.warn("IPTV", "Failed to resolve public IP, using fallback 0.0.0.0");
    return "0.0.0.0";
  }
}

export async function getChannelStream({ mobile, chid = "", chno = "", ip_address }) {
  if (!ip_address) {
    ip_address = await getPublicIP();
  }
  logger.info("IPTV", `Stream request: chid=${chid}, chno=${chno}`);
  return iptvFetch("/ftauserstream", {
    method: "POST",
    body: JSON.stringify({ mobile, chid, chno, ip_address }),
  });
}
