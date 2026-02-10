/**
 * IPTV API service — separate from main BBNL CRM APIs.
 * Uses the IPTV backend (Cabletvapis) for channel lists, streams, ads, and languages.
 */

const IPTV_API_BASE = import.meta.env.VITE_IPTV_API_BASE_URL || "/api/Cabletvapis";
const IPTV_AUTH_KEY = import.meta.env.VITE_IPTV_API_AUTH_KEY || "";
const IPTV_USERNAME = import.meta.env.VITE_IPTV_API_USERNAME || "";
const IPTV_PASSWORD = import.meta.env.VITE_IPTV_API_PASSWORD || "";

const BASIC_AUTH = "Basic " + btoa(`${IPTV_USERNAME}:${IPTV_PASSWORD}`);

async function iptvFetch(endpoint, options = {}) {
  const url = `${IPTV_API_BASE}${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: BASIC_AUTH,
      "x-api-key": IPTV_AUTH_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Server returned an invalid response. Please try again.");
  }

  const isSuccess = data?.status?.err_code === 0;
  if (!isSuccess) {
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
    return data.ip;
  } catch {
    return "0.0.0.0";
  }
}

export async function getChannelStream({ mobile, chid = "", chno = "", ip_address }) {
  if (!ip_address) {
    ip_address = await getPublicIP();
  }
  return iptvFetch("/ftauserstream", {
    method: "POST",
    body: JSON.stringify({ mobile, chid, chno, ip_address }),
  });
}
