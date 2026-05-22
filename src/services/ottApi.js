/**
 * OTT API service — calls BBNL backend which proxies to tied-up OTT partner APIs.
 *
 * Architecture (mirrors IPTV):
 *   Frontend → BBNL backend (OttApis/) → OTT partner API (e.g. Watcho)
 *
 * The BBNL backend handles partner authentication, token exchange, and
 * user entitlement checks. This service only talks to the BBNL proxy.
 *
 * To configure, set in .env:
 *   VITE_OTT_API_BASE_URL=/api/OttApis        (dev — Vite proxy)
 *   VITE_OTT_API_BASE_URL=https://bbnlnetmon.bbnl.in/prod/OttApis  (prod)
 */
import logger from "../utils/logger";
import perfMonitor from "../utils/apiPerfMonitor";

const OTT_API_BASE = import.meta.env.VITE_OTT_API_BASE_URL || `${import.meta.env.VITE_API_BASE_URL || '/api/'}OttApis`;

function getHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
  };
}

/** Get mobile number for OTT APIs (same as IPTV pattern) */
export function getOttMobile() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  return user.mobileno || user.mobile || user.phone || "";
}

const API_TIMEOUT = 15000;
const MAX_RETRIES = 1;

// Request deduplication (same pattern as iptvApi.js)
const _inflight = new Map();

async function ottFetch(endpoint, options = {}) {
  const dedupeKey = endpoint + "|" + (options.body || "");
  const pending = _inflight.get(dedupeKey);
  if (pending) return pending;

  const promise = _ottFetchInner(endpoint, options).finally(() =>
    _inflight.delete(dedupeKey)
  );
  _inflight.set(dedupeKey, promise);
  return promise;
}

async function _ottFetchInner(endpoint, options = {}) {
  const url = `${OTT_API_BASE}${endpoint}`;
  const endPerf = perfMonitor.start("POST", url, "OTT", endpoint);
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    logger.debug("OTT", `Request → POST ${endpoint}${attempt > 0 ? ` (retry ${attempt})` : ""}`);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT);
    let res;

    try {
      res = await fetch(url, {
        ...options,
        signal: ctrl.signal,
        headers: { ...getHeaders(), ...options.headers },
      });
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err.name === "AbortError";
      lastErr = new Error(
        isTimeout
          ? "Server took too long to respond. Please check your network and retry."
          : `Network error: ${err.message}`
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      endPerf({ status: 0, error: lastErr.message });
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      lastErr = new Error(`Server error: ${res.status} ${res.statusText}`);
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      endPerf({ status: res.status, error: lastErr.message });
      throw lastErr;
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_e) {
      endPerf({ status: res.status, error: "invalid JSON" });
      throw new Error("Server returned an invalid response. Please try again.");
    }

    const entry = endPerf({ status: res.status, size: text.length });
    logger.api("POST", endpoint, res.status, entry.duration);
    return data;
  }

  endPerf({ status: 0, error: "max retries exhausted" });
  throw lastErr || new Error("Request failed after retries.");
}

/**
 * Get OTT content catalog from the partner API.
 * The BBNL backend fetches content from the tied-up OTT partner and returns it.
 *
 * @param {Object} params
 * @param {string} params.mobile - User's mobile number
 * @param {string} [params.category] - Content category filter (movies, series, live)
 * @param {string} [params.search] - Search query
 * @param {string} [params.partner] - OTT partner ID (e.g. "watcho")
 * @param {number} [params.page] - Pagination page number
 * @returns {Promise<Object>} Content catalog
 */
export function getOTTContentList({ mobile, category = "", search = "", partner = "watcho", page = 1 }) {
  if (!mobile) throw new Error("Mobile number not available. Please re-login.");
  return ottFetch("/contentlist", {
    method: "POST",
    body: JSON.stringify({ mobile, category, search, partner, page }),
  });
}

/**
 * Get categories/genres available from the OTT partner.
 *
 * @param {Object} params
 * @param {string} params.mobile - User's mobile number
 * @param {string} [params.partner] - OTT partner ID
 * @returns {Promise<Object>} Categories list
 */
export function getOTTCategories({ mobile, partner = "watcho" }) {
  if (!mobile) throw new Error("Mobile number not available. Please re-login.");
  return ottFetch("/categories", {
    method: "POST",
    body: JSON.stringify({ mobile, partner }),
  });
}

/**
 * Get stream URL for specific OTT content.
 * Backend handles DRM token exchange with the OTT partner.
 *
 * @param {Object} params
 * @param {string} params.mobile - User's mobile number
 * @param {string} params.contentId - Content ID from the catalog
 * @param {string} [params.partner] - OTT partner ID
 * @returns {Promise<Object>} Stream URL and playback info
 */
export function getOTTStream({ mobile, contentId, partner = "watcho" }) {
  if (!mobile) throw new Error("Mobile number not available. Please re-login.");
  if (!contentId) throw new Error("Content ID is required.");
  return ottFetch("/stream", {
    method: "POST",
    body: JSON.stringify({ mobile, contentid: contentId, partner }),
  });
}

/**
 * Check user's OTT subscription/entitlement status.
 * Returns what content the user is allowed to access.
 *
 * @param {Object} params
 * @param {string} params.mobile - User's mobile number
 * @param {string} [params.partner] - OTT partner ID
 * @returns {Promise<Object>} Entitlement details
 */
export function getOTTEntitlement({ mobile, partner = "watcho" }) {
  if (!mobile) throw new Error("Mobile number not available. Please re-login.");
  return ottFetch("/entitlement", {
    method: "POST",
    body: JSON.stringify({ mobile, partner }),
  });
}

/**
 * Get OTT partner configuration (banner images, partner info, etc.)
 *
 * @param {Object} params
 * @param {string} params.mobile - User's mobile number
 * @returns {Promise<Object>} Partner configs
 */
export function getOTTPartners({ mobile }) {
  if (!mobile) throw new Error("Mobile number not available. Please re-login.");
  return ottFetch("/partners", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}
