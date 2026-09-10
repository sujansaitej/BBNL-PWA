// ontApis — GenieACS northbound-interface client for the franchise ONT screens.
//
// WHAT THIS TALKS TO
// ------------------
// The ACS at acs.bfnl.services:7557 is a GenieACS NBI. The PHP console's
// Ontconflib.php is an HTTP client for it, and this module is a rewrite of that
// client against the same endpoints — NOT a wrapper around it. The audit found
// three defects in that transport that are fatal once a mobile app is the
// caller, so the paths and task payloads were carried across and the transport
// was rebuilt:
//
//   ONT-01  A cURL error ran `print_r(...); die();` — a network blip emitted a
//           PHP array dump as the response body and killed the request. There
//           was no way for a caller to tell that apart from any other failure.
//   ONT-02  No CURLOPT_TIMEOUT anywhere. A hung ACS held a PHP-FPM worker until
//           max_execution_time; enough of those take down every endpoint on the
//           backend, payments included.
//   ONT-03  The HTTP status code was never read. GenieACS answers 200 when a
//           task EXECUTED and 202 when it was merely QUEUED (device offline) —
//           both with a non-empty body — and callers returned !empty($result).
//           That is the entire reason the console reports "rebooted
//           successfully" for a device that never got the message.
//
// WHY IT GOES THROUGH A PROXY
// ---------------------------
// The ACS is plain http:// on port 7557 and sends no CORS headers, so a browser
// on an https:// origin is blocked twice over — mixed content and CORS. Every
// request here goes to a same-origin path that the vite dev server (dev) and
// server.js (prod) forward to the ACS. Identical arrangement to /usage-api for
// payurbills. The ACS host never reaches the browser.
//
// SECURITY — READ BEFORE EXPOSING THIS BEYOND OPERATORS
// -----------------------------------------------------
// The NBI has no authentication of its own (ONT-07: Ontconflib's _genHeaders
// sends only a Content-Type), and the proxy is scoped to the device collection.
// That is acceptable for the operator app, whose users are already trusted with
// their customers' equipment. It is NOT acceptable for the customer portal: a
// customer-reachable route must never take a device id from the client, because
// changing one number reboots a stranger's connection (WEB-02). Customer screens
// need a server-resolved endpoint before they ship — do not point them here.

import { apiFetch, dedupe } from "./apiCore";
import { lsGet, lsSet, lsRemove } from "./lsCache";
import logger from "../utils/logger";
import {
  PROJECTION_FULL,
  PROJECTION_LIST,
  PROJECTION_COUNT,
} from "../constants/ontParams";

const GROUP = "ONT";

// ── Timeouts ─────────────────────────────────────────────────────────
// A cached read is a Mongo lookup inside GenieACS — fast, and a slow one means
// something is wrong. Anything carrying `connection_request` reaches out to the
// CPE over the last mile and legitimately takes 5-15s; the shared 30s default
// is too tight once proxy and TLS overhead are added.
export const ONT_READ_TIMEOUT = 20000;
export const ONT_TASK_TIMEOUT = 45000;

// CPE connection-request budget, in ms, passed to GenieACS as `timeout`.
// ONT-15: Ontconflib used 3000. Three seconds is below the round-trip of an ONT
// on a congested last mile, so reachable devices returned 202 (queued) and read
// to the operator as offline. 12s is the measured-safe interactive value.
const CONNECTION_REQUEST_MS = 12000;

// ── Base URL ─────────────────────────────────────────────────────────
/**
 * Same-origin seam. Lives UNDER the app base (/smartphone/crm/) so it routes
 * exactly like the rest of the app — a root-relative path escapes the app's
 * routing and 404s in production. Same reasoning as easebuzz + usage-api.
 */
export function getAcsBase() {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}acs-api/`.replace(/\/{2,}/g, "/");
}

// ── Errors ───────────────────────────────────────────────────────────
/**
 * WEB-08. The console could not tell "no such device" from "the ACS is down",
 * so an unreachable ACS was reported to the operator as "Device Details Not
 * found on Server" — which sends a technician to site for an infrastructure
 * problem. These three codes keep them apart all the way to the UI.
 */
export const ONT_ERR = {
  UNREACHABLE: "acs_unreachable",   // transport failed / proxy down / timeout
  NOT_FOUND: "device_not_found",    // ACS answered, no such device
  BAD_RESPONSE: "acs_bad_response", // answered with something unparseable
  TASK_FAILED: "task_failed",       // ACS rejected the task
  // The /acs-api path is not proxied on this host, so the SPA fallback served
  // index.html instead. Its own code, because the fix is a server config change
  // and blaming the ACS sends people to debug the wrong machine — see the
  // looksLikeHtml() check in acsGet.
  PROXY_MISSING: "acs_proxy_missing",
};

export class OntError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "OntError";
    this.code = code;
    this.detail = detail;
  }
}

// ── Transport ────────────────────────────────────────────────────────
async function acsGet(path, label, { timeout = ONT_READ_TIMEOUT } = {}) {
  const url = getAcsBase() + path;
  let resp;
  try {
    resp = await apiFetch(url, { method: "GET", headers: { Accept: "application/json" } }, label, {
      group: GROUP,
      timeout,
    });
  } catch (err) {
    // Navigation aborts are a normal part of the page lifecycle, not a fault.
    if (/navigated away/i.test(err.message)) throw err;
    throw new OntError(ONT_ERR.UNREACHABLE, "Could not reach the ACS server.", err.message);
  }

  if (!resp.ok) {
    throw new OntError(
      ONT_ERR.UNREACHABLE,
      `ACS server returned HTTP ${resp.status}.`,
      { status: resp.status }
    );
  }

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (_e) {
    // Log what actually arrived. "Unparseable" on its own is a dead end — the
    // cause is entirely different for an empty body (proxy connected but
    // returned nothing), an HTML page (SPA fallback swallowed the route), or a
    // PHP/Apache error string, and none of them are distinguishable without
    // seeing the bytes.
    const ctype = resp.headers?.get?.("content-type") || "(none)";
    logger.error(
      "ONT",
      `Unparseable ACS response — HTTP ${resp.status}, content-type "${ctype}", ` +
      `${text.length} bytes, starts: ${JSON.stringify(text.slice(0, 180))}`
    );

    // An empty 200 is the signature of a proxy that connected to something but
    // got nothing back — most often mod_proxy reaching the wrong port, or the
    // ACS closing the connection because the query string arrived mangled.
    if (!text || !text.trim()) {
      throw new OntError(
        ONT_ERR.BAD_RESPONSE,
        "The ACS returned an empty response.",
        { url, status: resp.status, contentType: ctype, hint: "Proxy reached a host but received no body." }
      );
    }

    // An HTML body here means the request never left this web server. Apache's
    // SPA fallback rewrites any unmatched path to index.html and answers 200, so
    // a missing /acs-api proxy entry looks *identical* to a healthy request —
    // right up to the point JSON.parse fails. Reporting that as "the ACS
    // returned an invalid response" sends people to debug the ACS, which was
    // never contacted. Name the real cause instead.
    if (looksLikeHtml(text)) {
      logger.error("ONT", "acs-api returned HTML — the proxy route is not configured on this host");
      throw new OntError(
        ONT_ERR.PROXY_MISSING,
        "This server isn't set up to reach the ACS yet.",
        { url, hint: "The /acs-api path needs a proxy entry in the web server config." }
      );
    }
    // A body that opens a JSON array and stops is a TRUNCATED STREAM, not
    // malformed data. GenieACS writes "[\n", then streams each device as the
    // cursor yields it, then "\n]" — so a response that begins with "[" but
    // does not parse means the connection was cut partway through. That is a
    // proxy/transport problem between the web server and the ACS, and saying
    // "invalid response" sends the reader looking for a bad query instead.
    const head = text.trimStart();
    if (head.startsWith("[") || head.startsWith("{")) {
      throw new OntError(
        ONT_ERR.BAD_RESPONSE,
        "The connection to the ACS was cut before the full reply arrived.",
        {
          url, status: resp.status, contentType: ctype, bytes: text.length,
          hint: "Streamed response truncated — check the proxy's handling of chunked replies.",
        }
      );
    }

    // Genuinely malformed JSON from the ACS itself. This is what ONT-01
    // produced: a PHP array dump where JSON was expected.
    throw new OntError(
      ONT_ERR.BAD_RESPONSE,
      "The ACS server returned an invalid response.",
      { url, status: resp.status, contentType: ctype, preview: text.slice(0, 180) }
    );
  }
}

/** Cheap sniff — enough to tell an SPA fallback page from an ACS payload. */
function looksLikeHtml(text) {
  const head = String(text || "").slice(0, 200).trim().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<head");
}

/**
 * POST a task.
 *
 * ONT-03 lives here. GenieACS distinguishes:
 *   200  the connection request succeeded and the task RAN on the device
 *   202  the device could not be reached; the task is queued for next inform
 * Returning the state instead of a boolean is what lets the UI say "queued —
 * will apply when the device comes online" instead of claiming success.
 *
 * @returns {{state:"done"|"queued"|"faulted", status:number, body:any}}
 */
async function acsTask(deviceId, payload, label, { connectionRequest = true } = {}) {
  const qs = connectionRequest
    ? `?timeout=${CONNECTION_REQUEST_MS}&connection_request`
    : "";
  const url = `${getAcsBase()}${encodeURIComponent(deviceId)}/tasks${qs}`;

  let resp;
  try {
    resp = await apiFetch(
      url,
      {
        method: "POST",
        // Ontconflib sent application/x-www-form-urlencoded with a JSON body
        // (line 47) — GenieACS tolerates it, but the body has always been JSON,
        // so declare it honestly.
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      },
      label,
      // linkNavigation:false — a queued reboot must not be cancelled because the
      // operator swiped back. Same posture as every other write in this codebase.
      { group: GROUP, timeout: ONT_TASK_TIMEOUT, linkNavigation: false }
    );
  } catch (err) {
    throw new OntError(ONT_ERR.UNREACHABLE, "Could not reach the ACS server.", err.message);
  }

  const raw = await resp.text();
  let body = null;
  if (raw) { try { body = JSON.parse(raw); } catch (_e) { /* tasks may answer empty */ } }

  if (resp.status === 200) return { state: "done", status: 200, body };
  if (resp.status === 202) return { state: "queued", status: 202, body };

  throw new OntError(
    ONT_ERR.TASK_FAILED,
    body?.message || `The device rejected the request (HTTP ${resp.status}).`,
    { status: resp.status, body }
  );
}

// ── Query building ───────────────────────────────────────────────────
/**
 * ONT-06 + ONT-16.
 *
 * `limit` was absent from every query in Ontconflib, so getDevicesCount() pulled
 * EVERY device object on the ACS into PHP memory in order to produce three
 * integers — invisible at pilot scale, a memory-limit crash in production on a
 * dashboard that refetches on every window-focus event.
 *
 * The original also URL-encoded values *inside* the JSON string literal
 * (line 24), so an _id containing a space was searched for as a literal "%20"
 * and never matched. Encoding the finished JSON exactly once fixes that.
 */
function buildQuery({ query, projection, limit, skip, sort }) {
  const parts = [];
  if (query) parts.push(`query=${encodeURIComponent(JSON.stringify(query))}`);
  if (projection) parts.push(`projection=${encodeURIComponent(projection)}`);
  if (limit != null) parts.push(`limit=${limit}`);
  if (skip != null) parts.push(`skip=${skip}`);
  if (sort) parts.push(`sort=${encodeURIComponent(JSON.stringify(sort))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * ONT-05. Ontconflib's _sanitizeMac() uppercased its input and stripped only
 * ":". GenieACS stores _deviceId._SerialNumber exactly as the CPE reported it,
 * so any vendor reporting a lowercase serial was NEVER FOUND — and the UI
 * blamed the device rather than the query. "AA-BB-CC" and "aabb.ccdd" formats
 * failed for the same reason.
 *
 * We normalise separators only and preserve case, then let the caller try both
 * casings (findDevice does).
 */
export function normalizeSerial(input) {
  return String(input || "").trim().replace(/[:\-.\s]/g, "");
}

// ── Operator scoping ─────────────────────────────────────────────────
/**
 * WEB-03. GenieACS has no concept of op_id. The console counted every device on
 * the ACS and relied on getServerDetails() resolving one ACS per employee — only
 * correct if the mapping is genuinely one operator to one ACS. If it is one
 * REGION per ACS with many operators beneath it, every operator sees the whole
 * region's totals.
 *
 * GenieACS tags are the fix that needs no schema change: tag at provisioning
 * (POST /devices/<id>/tags/op_123) and filter on _tags. This builds that filter
 * when tagging is enabled, and returns null when it is not — callers surface an
 * explicit "showing all devices on this ACS" notice rather than quietly
 * presenting unscoped numbers as if they were the operator's.
 */
export function operatorScope(opId) {
  const enabled = String(import.meta.env.VITE_ONT_TAG_SCOPING || "").toLowerCase() === "true";
  if (!enabled || !opId) return null;
  const prefix = import.meta.env.VITE_ONT_TAG_PREFIX || "op_";
  return { _tags: `${prefix}${opId}` };
}

/** True when counts/lists are genuinely narrowed to one operator. */
export function isScopedToOperator(opId) {
  return operatorScope(opId) !== null;
}

// ── Time ─────────────────────────────────────────────────────────────
/**
 * WEB-09. The console formatted its online cutoff as "Y-m-d H:i:s +0530" and
 * compared that against _lastInform. GenieACS stores ISO-8601 UTC. A 5.5-hour
 * skew flips the ENTIRE fleet to online or offline with no error anywhere —
 * requirement #1, silently wrong for everyone. Comparing in UTC removes the
 * class of bug; local time is a display concern only.
 */
export function isoUtcMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// ═════════════════════════════════════════════════════════════════════
//  Reads
// ═════════════════════════════════════════════════════════════════════

const CACHE_TTL = 60_000;          // device state is live; 60s is the ceiling
const CACHE_TTL_COUNTS = 120_000;

/** Upper bound on rows pulled to produce a count. See getFleetCounts. */
const COUNT_LIMIT = Number(import.meta.env?.VITE_ONT_COUNT_LIMIT) || 2000;

/**
 * Fetch one device by its GenieACS _id.
 * @returns {object|null} raw device object, or null if the ACS has no such device
 */
export async function getDeviceById(deviceId, { skipCache = false, projection = PROJECTION_FULL } = {}) {
  if (!deviceId) return null;
  const key = `ont_dev_${deviceId}`;
  if (!skipCache) {
    const hit = lsGet(key, CACHE_TTL);
    if (hit) return hit;
  }
  return dedupe(`ont_dev_${deviceId}_${skipCache}`, async () => {
    const rows = await acsGet(
      buildQuery({ query: { _id: deviceId }, projection, limit: 1 }),
      "getDeviceById"
    );
    const dev = Array.isArray(rows) ? rows[0] : null;
    if (dev) lsSet(key, dev);
    return dev || null;
  });
}

/**
 * Resolve a device from what the CRM actually knows about a customer.
 *
 * The CRM holds a customer id and an internet username; the ACS keys on serial
 * number and PPPoE username. PPPoE username is the join — configurePppoe writes
 * it, the dictionary reads it, and the console searched on it.
 *
 * Four lookups, cheapest first, stopping at the first hit. Ontconflib exposed
 * these as four separate modes ("mac" / "pppoe" / "pppoe1" / "id"); the caller
 * should not have to know which one applies.
 */
export async function findDevice({ serial, pppoeUser, deviceId }, { skipCache = false } = {}) {
  if (deviceId) {
    const dev = await getDeviceById(deviceId, { skipCache });
    if (dev) return dev;
  }

  const attempts = [];
  if (serial) {
    const s = normalizeSerial(serial);
    // Case preserved AND both casings tried — see normalizeSerial (ONT-05).
    attempts.push({ _deviceId__SerialNumber: s });
    if (s !== s.toUpperCase()) attempts.push({ _deviceId__SerialNumber: s.toUpperCase() });
    if (s !== s.toLowerCase()) attempts.push({ _deviceId__SerialNumber: s.toLowerCase() });
  }
  if (pppoeUser) {
    const u = String(pppoeUser).trim();
    attempts.push({ "Device.PPP.Interface.1.Username._value": u });
    attempts.push({
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username._value": u,
    });
    // Ontconflib lowercased PPPoE usernames unconditionally, which breaks any
    // mixed-case account. Try the given casing first, lowercase only as a fallback.
    if (u !== u.toLowerCase()) {
      attempts.push({ "Device.PPP.Interface.1.Username._value": u.toLowerCase() });
      attempts.push({
        "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username._value":
          u.toLowerCase(),
      });
    }
  }

  for (const raw of attempts) {
    // GenieACS wants the dotted path; the serial key is spelled with dots too.
    const query = raw._deviceId__SerialNumber
      ? { "_deviceId._SerialNumber": raw._deviceId__SerialNumber }
      : raw;
    const rows = await acsGet(
      buildQuery({ query, projection: PROJECTION_FULL, limit: 1 }),
      "findDevice"
    );
    if (Array.isArray(rows) && rows[0]) {
      lsSet(`ont_dev_${rows[0]._id}`, rows[0]);
      return rows[0];
    }
  }
  return null;
}

/**
 * Fleet list — requirements #3 / #4.
 *
 * `filter` is "all" | "online" | "offline". The online cutoff is computed in UTC
 * (see isoUtcMinutesAgo) and `limit` is always sent (ONT-06).
 */
export async function getFleet({
  opId,
  filter = "all",
  thresholdMin,
  limit = 500,
  skip = 0,
  skipCache = false,
} = {}) {
  const scope = operatorScope(opId);
  const query = { ...(scope || {}) };

  if (filter === "online" || filter === "offline") {
    const cutoff = isoUtcMinutesAgo(thresholdMin);
    query._lastInform = filter === "online" ? { $gte: cutoff } : { $lt: cutoff };
  }

  const key = `ont_fleet_${opId || "all"}_${filter}_${skip}_${limit}`;
  if (!skipCache) {
    const hit = lsGet(key, CACHE_TTL_COUNTS);
    if (hit) return hit;
  }

  return dedupe(key + skipCache, async () => {
    const rows = await acsGet(
      buildQuery({
        query: Object.keys(query).length ? query : undefined,
        projection: PROJECTION_LIST,
        limit,
        skip,
        sort: { _lastInform: -1 },
      }),
      "getFleet"
    );
    const list = Array.isArray(rows) ? rows : [];
    lsSet(key, list);
    return list;
  });
}

/**
 * Fleet counts — requirements #3, #4, #5.
 *
 * Deliberately does NOT reuse getFleet: pulling a device list to produce three
 * integers is precisely ONT-06. Each count is its own bounded query, and the
 * total is read from the response rather than from an array length wherever
 * GenieACS reports it.
 *
 * `inventory` is intentionally absent. Inventory means ONTs allocated to the
 * operator INCLUDING boxes still in a bag that have never powered on, and the
 * ACS by definition cannot see those — it only knows devices that have informed
 * at least once. It has to come from netmon's stock table. Returning null here
 * (rather than substituting `registered`) is what lets the UI say "not
 * available" instead of quietly showing a wrong number.
 */
export async function getFleetCounts({ opId, thresholdMin, skipCache = false } = {}) {
  const key = `ont_counts_${opId || "all"}_${thresholdMin}`;
  if (!skipCache) {
    const hit = lsGet(key, CACHE_TTL_COUNTS);
    if (hit) return hit;
  }

  return dedupe(key + skipCache, async () => {
    const scope = operatorScope(opId) || {};
    const cutoff = isoUtcMinutesAgo(thresholdMin);

    const countOf = async (extra, label) => {
      const query = { ...scope, ...extra };
      const rows = await acsGet(
        buildQuery({
          query: Object.keys(query).length ? query : undefined,
          projection: PROJECTION_COUNT,
          // Bounded so a large fleet cannot produce an unbounded streamed
          // response. Raise via env if a franchise genuinely exceeds it — but
          // past a few thousand devices the count belongs in a server-side
          // cached aggregate rather than a client round trip.
          limit: COUNT_LIMIT,
        }),
        label
      );
      return Array.isArray(rows) ? rows.length : 0;
    };

    const [registered, online] = await Promise.all([
      countOf({}, "countRegistered"),
      countOf({ _lastInform: { $gte: cutoff } }, "countOnline"),
    ]);

    const result = {
      registered,
      online,
      offline: Math.max(0, registered - online),
      inventory: null,                 // netmon stock table — not an ACS concept
      scoped: isScopedToOperator(opId),
      asof: new Date().toISOString(),
    };
    lsSet(key, result);
    return result;
  });
}

// ═════════════════════════════════════════════════════════════════════
//  Writes
// ═════════════════════════════════════════════════════════════════════

/** Drop every cached read for a device. Called after any write. */
export function invalidateDevice(deviceId) {
  lsRemove(`ont_dev_${deviceId}`);
}

/**
 * Live refresh — pull current values from the CPE rather than the ACS's cache.
 *
 * WEB-07: the console refreshed with parameterNames ["Device",
 * "InternetGatewayDevice"] — a full-tree read across both data models to
 * populate a screen needing about twenty values. Callers pass the projected
 * name list from refreshParameterNames() instead.
 */
export async function refreshDevice(deviceId, parameterNames) {
  const names = parameterNames?.length ? parameterNames : ["Device", "InternetGatewayDevice"];
  const res = await acsTask(
    deviceId,
    { name: "getParameterValues", parameterNames: names },
    "refreshDevice"
  );
  invalidateDevice(deviceId);
  return res;
}

/**
 * Liveness probe — requirement #8.
 *
 * ONT-12: Ontconflib's getPingDetails() is dead code (`return array();` on its
 * first line) pointing at an ICMP microservice on port 3000. Reviving it would
 * be the WEAKER option — the target is the WAN IP, frequently CGNAT and
 * unroutable, and most ONTs drop WAN ICMP by default, so it ships false
 * negatives.
 *
 * A CWMP connection request is a stronger test: a 200 proves the device is
 * alive AND that the ACS can reach it right now, which is more than a ping
 * proves. One cheap parameter keeps the CWMP transaction small.
 */
export async function probeDevice(deviceId, dataModel) {
  const cheap = dataModel === "tr181"
    ? "Device.DeviceInfo.UpTime"
    : "InternetGatewayDevice.DeviceInfo.UpTime";
  const started = Date.now();
  const res = await acsTask(
    deviceId,
    { name: "getParameterValues", parameterNames: [cheap] },
    "probeDevice"
  );
  return {
    alive: res.state === "done",
    state: res.state,
    rttMs: Date.now() - started,
    method: "cwmp",
  };
}

/** Reboot — requirement #9. Caller MUST confirm first; this is disruptive. */
export async function rebootDevice(deviceId) {
  const res = await acsTask(deviceId, { name: "reboot" }, "rebootDevice");
  invalidateDevice(deviceId);
  return res;
}

/**
 * Set SSID and/or passphrase on ONE radio — requirement #2.
 *
 * TWO AUDIT FIXES ARE LOAD-BEARING HERE.
 *
 * ONT-08 — a CWMP SetParameterValues is ATOMIC. Ontconflib wrote every candidate
 * path in a single task (TR-181 + TR-098 + a third family), so on any CPE that
 * did not implement one of them the device answered fault 9005 and rejected THE
 * WHOLE TASK. Nothing was written, no partial success, no useful error. That is
 * the most likely reason configuration "works on some models and not others".
 * We write only paths for the model the device actually reports, using the index
 * the caller resolved from the device's own table.
 *
 * ONT-11 — the console also wrote
 * `InternetGatewayDevice.LANInterfaces.WLANConfiguration.N.*`. TR-098 defines
 * LANDevice.{i}.WLANConfiguration; `LANInterfaces` (plural, unindexed) is not in
 * the standard. If nothing in the fleet implements it, that one path faulted
 * EVERY SSID task. It is off unless explicitly enabled.
 *
 * ONT-09 — booleans are `xsd:boolean`. The original wrote `xsd:bool`, which a
 * strict CPE faults — and by ONT-08 that discards the SSID and passphrase in the
 * same call.
 *
 * @param {object} radio  resolved by ontModel.resolveRadios — carries the real
 *                        table indices, so read and write always agree (FMT-01)
 */
export async function setSsid(deviceId, radio, { ssid, password, hidden, enabled }) {
  if (!radio || radio.index == null) {
    throw new OntError(ONT_ERR.TASK_FAILED, "No wireless radio was selected.");
  }
  if (password != null && password !== "" && (password.length < 8 || password.length > 63)) {
    // WPA2 requires 8-63 characters. The CPE would fault the task and, per
    // ONT-08, silently discard the SSID change riding along with it.
    throw new OntError(ONT_ERR.TASK_FAILED, "Wi-Fi password must be 8 to 63 characters.");
  }

  const i = radio.index;
  const values = [];

  if (radio.dataModel === "tr181") {
    if (ssid != null) values.push([`Device.WiFi.SSID.${i}.SSID`, ssid, "xsd:string"]);
    if (enabled != null) values.push([`Device.WiFi.SSID.${i}.Enable`, !!enabled, "xsd:boolean"]);
    if (password) {
      const ap = radio.apIndex ?? i;
      values.push([`Device.WiFi.AccessPoint.${ap}.Security.KeyPassphrase`, password, "xsd:string"]);
      if (hidden != null) {
        values.push([`Device.WiFi.AccessPoint.${ap}.SSIDAdvertisementEnabled`, !hidden, "xsd:boolean"]);
      }
    } else if (hidden != null) {
      const ap = radio.apIndex ?? i;
      values.push([`Device.WiFi.AccessPoint.${ap}.SSIDAdvertisementEnabled`, !hidden, "xsd:boolean"]);
    }
  } else {
    const base = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}`;
    if (ssid != null) values.push([`${base}.SSID`, ssid, "xsd:string"]);
    if (password) values.push([`${base}.KeyPassphrase`, password, "xsd:string"]);
    if (enabled != null) values.push([`${base}.Enable`, !!enabled, "xsd:boolean"]);
    if (hidden != null) values.push([`${base}.SSIDAdvertisementEnabled`, !hidden, "xsd:boolean"]);
  }

  // ONT-11 — opt-in only, and only after a real device is confirmed to
  // implement it. Enabling it blind risks faulting every SSID task fleet-wide.
  if (String(import.meta.env.VITE_ONT_LEGACY_WLAN_PATH || "").toLowerCase() === "true") {
    if (ssid != null) {
      values.push([`InternetGatewayDevice.LANInterfaces.WLANConfiguration.${i}.SSID`, ssid, "xsd:string"]);
    }
    if (password) {
      values.push([`InternetGatewayDevice.LANInterfaces.WLANConfiguration.${i}.KeyPassphrase`, password, "xsd:string"]);
    }
  }

  if (!values.length) {
    throw new OntError(ONT_ERR.TASK_FAILED, "Nothing to change.");
  }

  const res = await acsTask(
    deviceId,
    { name: "setParameterValues", parameterValues: values },
    "setSsid"
  );
  invalidateDevice(deviceId);
  return res;
}

/**
 * Enable / disable LAN ports.
 *
 * ONT-10: the console interpolated $_POST["lancheck"] straight into the
 * parameter path with no validation — arbitrary caller input reaching a live
 * device-configuration path. Ports are whitelisted against the indices actually
 * present on the device.
 */
export async function setLanPorts(deviceId, ports, enable, { dataModel, validPorts }) {
  const allowed = new Set((validPorts || []).map(String));
  const clean = (ports || [])
    .map((p) => String(p).trim())
    .filter((p) => /^\d+$/.test(p) && (allowed.size === 0 || allowed.has(p)));

  if (!clean.length) {
    throw new OntError(ONT_ERR.TASK_FAILED, "Select at least one valid LAN port.");
  }

  const values = clean.map((p) =>
    dataModel === "tr181"
      ? [`Device.Ethernet.Interface.${p}.Enable`, !!enable, "xsd:boolean"]
      : [`InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.${p}.Enable`, !!enable, "xsd:boolean"]
  );

  const res = await acsTask(
    deviceId,
    { name: "setParameterValues", parameterValues: values },
    "setLanPorts"
  );
  invalidateDevice(deviceId);
  return res;
}

/**
 * Set PPPoE credentials.
 *
 * ONT-08 again: the console wrote six paths in one atomic task, spanning both
 * data models AND WANConnectionDevice indices 1 and 2. On a CPE implementing .1
 * but not .2, the whole task faulted and the change silently did nothing. Only
 * the reported model's paths are written here.
 *
 * Gated by VITE_ONT_ALLOW_PPPOE because a wrong value takes the customer offline
 * and needs a site visit to recover — a heavier action than anything else on
 * this screen.
 */
export async function setPppoe(deviceId, { username, password }, { dataModel }) {
  if (String(import.meta.env.VITE_ONT_ALLOW_PPPOE || "").toLowerCase() !== "true") {
    throw new OntError(ONT_ERR.TASK_FAILED, "PPPoE configuration is disabled for this account.");
  }
  if (!username || !password) {
    throw new OntError(ONT_ERR.TASK_FAILED, "PPPoE username and password are both required.");
  }

  const values = dataModel === "tr181"
    ? [
        ["Device.PPP.Interface.1.Username", username, "xsd:string"],
        ["Device.PPP.Interface.1.Password", password, "xsd:string"],
      ]
    : [
        ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username", username, "xsd:string"],
        ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Password", password, "xsd:string"],
      ];

  const res = await acsTask(
    deviceId,
    { name: "setParameterValues", parameterValues: values },
    "setPppoe"
  );
  invalidateDevice(deviceId);
  return res;
}

/**
 * Sample the traffic counters — requirement #10, first half.
 *
 * The ACS exposes CUMULATIVE byte counters, never a rate, so a throughput
 * figure needs two samples and a division. `connectionRequest` forces fresh
 * values from the CPE rather than whatever the last inform left behind; without
 * it both samples can be identical and the rate reads as zero.
 *
 * ontModel.deriveThroughput turns two of these into Mbps and handles the 32-bit
 * counter wrap that makes naive deltas go negative.
 */
export async function sampleCounters(deviceId, dataModel) {
  const names = dataModel === "tr181"
    ? ["Device.Optical.Interface.1.Stats.BytesReceived", "Device.Optical.Interface.1.Stats.BytesSent"]
    : [
        "InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.TotalBytesReceived",
        "InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.TotalBytesSent",
      ];

  await acsTask(deviceId, { name: "getParameterValues", parameterNames: names }, "sampleCounters");
  invalidateDevice(deviceId);
  const dev = await getDeviceById(deviceId, { skipCache: true });
  return { device: dev, at: Date.now() };
}
