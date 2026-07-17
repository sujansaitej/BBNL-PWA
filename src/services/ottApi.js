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
import { apiFetch, getHeadersJson, readEnvelope, dedupe } from "./apiCore";

// NOTE: VITE_OTT_API_BASE_URL is set in .env.development but ABSENT from
// .env.production, so prod falls back to `${VITE_API_BASE_URL}OttApis`.
// Preserved as-is — see report; needs an env/backend answer, not a code fix.
const OTT_API_BASE = import.meta.env.VITE_OTT_API_BASE_URL || `${import.meta.env.VITE_API_BASE_URL || '/api/'}OttApis`;

/** Get mobile number for OTT APIs (same as IPTV pattern) */
export function getOttMobile() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  return user.mobileno || user.mobile || user.phone || "";
}

const MAX_RETRIES = 1;

async function ottFetch(endpoint, options = {}) {
  // ponytail: apiCore.dedupe replaces the local _inflight map. Key is
  // prefixed so it cannot collide with generalApis' cache-key namespace.
  return dedupe("ott:" + endpoint + "|" + (options.body || ""), () =>
    _ottFetchInner(endpoint, options)
  );
}

async function _ottFetchInner(endpoint, options = {}) {
  const url = `${OTT_API_BASE}${endpoint}`;
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;

    try {
      res = await apiFetch(
        url,
        { ...options, headers: { ...getHeadersJson(), ...options.headers } },
        endpoint,
        { group: "OTT" }
      );
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw lastErr;
    }

    // Retry 5xx only; readEnvelope turns everything else (4xx, bad JSON,
    // non-zero err_code) into a thrown Error.
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      lastErr = new Error(`Server error: ${res.status} ${res.statusText}`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }

    return readEnvelope(res, "OTT");
  }

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
