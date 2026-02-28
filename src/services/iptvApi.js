/**
 * IPTV API service — separate from main BBNL CRM APIs.
 * Uses the IPTV backend (Cabletvapis) for channel lists, streams, ads, and languages.
 */
import logger from "../utils/logger";
import { getEntry as _getEntry, setEntry as _setEntry } from "./channelStore";

const IPTV_API_BASE = import.meta.env.VITE_IPTV_API_BASE_URL || "/api/Cabletvapis";
const IPTV_AUTH_KEY = import.meta.env.VITE_IPTV_API_AUTH_KEY || "";
const IPTV_USERNAME = import.meta.env.VITE_IPTV_API_USERNAME || "";
const IPTV_PASSWORD = import.meta.env.VITE_IPTV_API_PASSWORD || "";
const IPTV_DEFAULT_MOBILE = import.meta.env.VITE_IPTV_DEFAULT_MOBILE || "";

const BASIC_AUTH = "Basic " + btoa(`${IPTV_USERNAME}:${IPTV_PASSWORD}`);

/** Get the mobile number to use for IPTV APIs (logged-in user first, fallback to default) */
export function getIptvMobile() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  return user.mobileno || user.mobile || user.phone || IPTV_DEFAULT_MOBILE || "";
}

const API_TIMEOUT = 12000; // 12 seconds (base — extended on slow connections)
const MAX_RETRIES = 1;    // 1 automatic retry on network failure (keeps worst-case < 30s)

/** Detect slow connection and extend timeout accordingly */
function getAdaptiveTimeout() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    // effectiveType: 'slow-2g', '2g', '3g', '4g'
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 25000;
    if (conn.effectiveType === '3g') return 20000;
  }
  return API_TIMEOUT;
}

// ── Request deduplication ──
// If two callers request the same endpoint+body simultaneously (e.g. prefetcher
// and LiveTvPage both call getChannelList), only one network request is made.
const _inflight = new Map();

async function iptvFetch(endpoint, options = {}) {
  const dedupeKey = endpoint + '|' + (options.body || '');
  const pending = _inflight.get(dedupeKey);
  if (pending) return pending;

  const promise = _iptvFetchInner(endpoint, options).finally(() => _inflight.delete(dedupeKey));
  _inflight.set(dedupeKey, promise);
  return promise;
}

async function _iptvFetchInner(endpoint, options = {}) {
  const url = `${IPTV_API_BASE}${endpoint}`;
  const timeout = getAdaptiveTimeout();
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const start = performance.now();
    logger.debug("IPTV", `Request → POST ${endpoint}${attempt > 0 ? ` (retry ${attempt})` : ""}`);

    // AbortController for timeout
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    let res;
    try {
      res = await fetch(url, {
        ...options,
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: BASIC_AUTH,
          "x-api-key": IPTV_AUTH_KEY,
          ...options.headers,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const duration = Math.round(performance.now() - start);
      const isTimeout = err.name === "AbortError";
      logger.error("IPTV", `${isTimeout ? "Timeout" : "Network error"} on ${endpoint}: ${err.message}`, { duration: `${duration}ms` });
      lastErr = new Error(isTimeout ? "Server took too long to respond. Please check your network and retry." : `Network error: ${err.message}`);
      // Retry on network/timeout errors (exponential backoff: 1s, 3s)
      if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }

    const duration = Math.round(performance.now() - start);
    logger.api("POST", endpoint, res.status, duration);

    if (res.status === 401 || res.status === 403) {
      logger.security("IPTV_AUTH_REJECTED", { endpoint, status: res.status });
    }

    if (!res.ok) {
      lastErr = new Error(`Server error: ${res.status} ${res.statusText}`);
      // Retry on 5xx server errors (exponential backoff)
      if (res.status >= 500 && attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      throw lastErr;
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_e) {
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

  throw lastErr || new Error("Request failed after retries.");
}

function requireMobile(mobile) {
  if (!mobile) {
    throw new Error("Mobile number not available. Please update your profile or re-login.");
  }
}

export function getLanguageList({ mobile }) {
  requireMobile(mobile);
  return iptvFetch("/ftauserlanglist", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}

export function getChannelList({ mobile, grid = "", bcid = "", langid = "subs", search = "" }) {
  requireMobile(mobile);
  return iptvFetch("/ftauserchnllist", {
    method: "POST",
    body: JSON.stringify({ mobile, grid, bcid, langid, search }),
  });
}

export async function getAdvertisements({ mobile, adclient = "fofi", srctype = "Image", displayarea = "homepage", displaytype = "multiple" }) {
  requireMobile(mobile);
  const cacheKey = `ads_${mobile}_${adclient}`;

  // Check channelStore (L1 in-memory → L2 IndexedDB) — no localStorage
  const cached = _getEntry(cacheKey);
  if (cached?.data && (Date.now() - cached.ts < 10 * 60 * 1000)) return cached.data;

  const data = await iptvFetch("/ftauserads", {
    method: "POST",
    body: JSON.stringify({ mobile, adclient, srctype, displayarea, displaytype }),
  });
  _setEntry(cacheKey, data);
  return data;
}

let _cachedIP = null;
let _ipFetchPromise = null;

export async function getPublicIP() {
  if (_cachedIP) return _cachedIP;
  if (_ipFetchPromise) return _ipFetchPromise;
  _ipFetchPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();
      _cachedIP = data.ip;
      logger.debug("IPTV", `Public IP resolved: ${data.ip}`);
      return data.ip;
    } catch (_e) {
      logger.warn("IPTV", "Failed to resolve public IP, using fallback 0.0.0.0");
      return "0.0.0.0";
    } finally {
      _ipFetchPromise = null;
    }
  })();
  return _ipFetchPromise;
}

/** Call early (e.g. on IPTV page mount) so the IP is ready before first channel play */
export function prefetchPublicIP() {
  if (!_cachedIP && !_ipFetchPromise) getPublicIP();
}

export function addFtaUser({ name, mobile }) {
  requireMobile(mobile);
  if (!name) throw new Error("Name is required for registration.");
  return iptvFetch("/addftauser", {
    method: "POST",
    body: JSON.stringify({ name, mobile }),
  });
}

export async function getPromoStream({ mobile, id }) {
  requireMobile(mobile);
  if (!id) throw new Error("Promo ID is required.");
  return iptvFetch("/promo_stream", {
    method: "POST",
    body: JSON.stringify({ mobile, id }),
  });
}

export async function getChannelStream({ mobile, chid = "", chno = "", ip_address }) {
  requireMobile(mobile);
  if (!ip_address) {
    ip_address = await getPublicIP();
  }
  logger.info("IPTV", `Stream request: chid=${chid}, chno=${chno}`);
  return iptvFetch("/ftauserstream", {
    method: "POST",
    body: JSON.stringify({ mobile, chid, chno, ip_address }),
  });
}
