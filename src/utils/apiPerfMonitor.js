/**
 * API Performance Monitor — tracks every API call across the entire app.
 *
 * Captures: endpoint, method, duration, status, response size, connection type,
 * cache hit/miss, service category, and error details.
 *
 * Ring buffer of last 500 entries (memory-safe on mobile).
 * Provides real-time stats: avg/p95 latency, error rate, slowest endpoints.
 *
 * Usage:
 *   import perfMonitor from '../utils/apiPerfMonitor';
 *   const end = perfMonitor.start('POST', '/api/foo', 'General');
 *   // ... fetch ...
 *   end({ status: 200, size: 1234, cached: false });
 *
 *   perfMonitor.getReport();   // summary object
 *   perfMonitor.printReport(); // formatted console table
 */

const IS_DEV = import.meta.env.DEV;

const MAX_ENTRIES = 500;

// Ring buffer
const _entries = [];
let _totalCalls = 0;
let _totalErrors = 0;
let _totalCacheHits = 0;

// Per-endpoint aggregation
const _endpointStats = new Map();

// Session start
const _sessionStart = Date.now();

/**
 * Detect current connection type
 */
function getConnectionInfo() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return { type: "unknown", downlink: null, rtt: null };
  return {
    type: conn.effectiveType || "unknown",
    downlink: conn.downlink || null,
    rtt: conn.rtt || null,
  };
}

/**
 * Normalize endpoint for grouping (strip query params, timestamps, IDs)
 */
function normalizeEndpoint(url) {
  try {
    const u = new URL(url, "https://placeholder");
    // Remove query params for grouping
    let path = u.pathname;
    // Collapse numeric IDs to :id
    path = path.replace(/\/\d+/g, "/:id");
    return path;
  } catch {
    // Relative URL — just strip query
    return (url || "").split("?")[0];
  }
}

/**
 * Start tracking an API call. Returns a function to call when the request finishes.
 *
 * @param {string} method  HTTP method
 * @param {string} url     Full or relative URL
 * @param {string} service Category: 'General' | 'FoFi' | 'IPTV' | 'Registration' | 'Order' | 'Customer'
 * @param {string} [label] Human-readable label (e.g. function name)
 * @returns {function} end({ status, size, cached, error })
 */
function start(method, url, service, label) {
  const t0 = performance.now();
  const conn = getConnectionInfo();
  const ts = Date.now();

  return function end({ status = 0, size = 0, cached = false, error = null } = {}) {
    const duration = Math.round(performance.now() - t0);
    const normalizedUrl = normalizeEndpoint(url);
    const ok = status >= 200 && status < 400;

    _totalCalls++;
    if (!ok && !cached) _totalErrors++;
    if (cached) _totalCacheHits++;

    const entry = {
      ts,
      method,
      url: normalizedUrl,
      rawUrl: url,
      service,
      label: label || "",
      status,
      duration,
      size,
      cached,
      error: error ? String(error).slice(0, 200) : null,
      conn: conn.type,
      rtt: conn.rtt,
      downlink: conn.downlink,
    };

    // Ring buffer
    if (_entries.length >= MAX_ENTRIES) _entries.shift();
    _entries.push(entry);

    // Per-endpoint aggregation
    const key = `${method} ${normalizedUrl}`;
    let stat = _endpointStats.get(key);
    if (!stat) {
      stat = { calls: 0, errors: 0, totalDuration: 0, maxDuration: 0, minDuration: Infinity, service, label: label || "" };
      _endpointStats.set(key, stat);
    }
    stat.calls++;
    if (!ok && !cached) stat.errors++;
    stat.totalDuration += duration;
    if (duration > stat.maxDuration) stat.maxDuration = duration;
    if (duration < stat.minDuration) stat.minDuration = duration;

    // Auto-warn on slow requests (> 5s) in prod+dev
    if (duration > 5000) {
      console.warn(
        `[PERF] Slow API: ${method} ${normalizedUrl} took ${duration}ms (status: ${status}, network: ${conn.type})`,
      );
    }

    return entry;
  };
}

/**
 * Record a cache hit (no network call made)
 */
function recordCacheHit(service, label, url) {
  _totalCalls++;
  _totalCacheHits++;

  const entry = {
    ts: Date.now(),
    method: "CACHE",
    url: normalizeEndpoint(url || label),
    rawUrl: url || label,
    service,
    label: label || "",
    status: 200,
    duration: 0,
    size: 0,
    cached: true,
    error: null,
    conn: getConnectionInfo().type,
    rtt: null,
    downlink: null,
  };

  if (_entries.length >= MAX_ENTRIES) _entries.shift();
  _entries.push(entry);
}

/**
 * Get all raw entries (for export)
 */
function getEntries() {
  return [..._entries];
}

/**
 * Get a performance summary report
 */
function getReport() {
  const now = Date.now();
  const sessionDuration = Math.round((now - _sessionStart) / 1000);

  // Only network calls (exclude cache hits)
  const networkCalls = _entries.filter((e) => !e.cached);
  const durations = networkCalls.map((e) => e.duration).sort((a, b) => a - b);

  const avg = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;
  const p50 = durations.length ? durations[Math.floor(durations.length * 0.5)] : 0;
  const p95 = durations.length ? durations[Math.floor(durations.length * 0.95)] : 0;
  const p99 = durations.length ? durations[Math.floor(durations.length * 0.99)] : 0;
  const max = durations.length ? durations[durations.length - 1] : 0;

  // Error rate
  const errorRate = _totalCalls > 0 ? ((_totalErrors / _totalCalls) * 100).toFixed(1) : "0.0";
  const cacheHitRate = _totalCalls > 0 ? ((_totalCacheHits / _totalCalls) * 100).toFixed(1) : "0.0";

  // Slowest endpoints (top 10)
  const endpointList = [..._endpointStats.entries()]
    .map(([key, s]) => ({
      endpoint: key,
      service: s.service,
      calls: s.calls,
      errors: s.errors,
      avgMs: Math.round(s.totalDuration / s.calls),
      maxMs: s.maxDuration,
      minMs: s.minDuration === Infinity ? 0 : s.minDuration,
    }))
    .sort((a, b) => b.avgMs - a.avgMs);

  // By service
  const byService = {};
  for (const e of networkCalls) {
    if (!byService[e.service]) byService[e.service] = { calls: 0, errors: 0, totalMs: 0 };
    byService[e.service].calls++;
    if (e.status < 200 || e.status >= 400) byService[e.service].errors++;
    byService[e.service].totalMs += e.duration;
  }
  for (const svc of Object.values(byService)) {
    svc.avgMs = svc.calls ? Math.round(svc.totalMs / svc.calls) : 0;
  }

  // Recent errors
  const recentErrors = _entries.filter((e) => e.error || (e.status >= 400 && !e.cached)).slice(-10);

  // Connection breakdown
  const connBreakdown = {};
  for (const e of networkCalls) {
    connBreakdown[e.conn] = (connBreakdown[e.conn] || 0) + 1;
  }

  return {
    session: {
      durationSec: sessionDuration,
      totalCalls: _totalCalls,
      networkCalls: networkCalls.length,
      cacheHits: _totalCacheHits,
      errors: _totalErrors,
      errorRate: errorRate + "%",
      cacheHitRate: cacheHitRate + "%",
    },
    latency: { avgMs: avg, p50Ms: p50, p95Ms: p95, p99Ms: p99, maxMs: max },
    byService,
    slowestEndpoints: endpointList.slice(0, 10),
    recentErrors,
    connectionBreakdown: connBreakdown,
  };
}

/**
 * Print a formatted report to console
 */
function printReport() {
  const r = getReport();

  console.group("%c[API Performance Report]", "color:#00b4d8;font-weight:bold;font-size:14px");

  console.log(
    `%cSession: ${r.session.durationSec}s | Calls: ${r.session.totalCalls} | Network: ${r.session.networkCalls} | Cache Hits: ${r.session.cacheHits} (${r.session.cacheHitRate}) | Errors: ${r.session.errors} (${r.session.errorRate})`,
    "color:#ccc",
  );

  console.log(
    `%cLatency — Avg: ${r.latency.avgMs}ms | P50: ${r.latency.p50Ms}ms | P95: ${r.latency.p95Ms}ms | P99: ${r.latency.p99Ms}ms | Max: ${r.latency.maxMs}ms`,
    "color:#ffd166",
  );

  if (Object.keys(r.byService).length) {
    console.group("By Service");
    console.table(r.byService);
    console.groupEnd();
  }

  if (r.slowestEndpoints.length) {
    console.group("Slowest Endpoints (Top 10)");
    console.table(r.slowestEndpoints);
    console.groupEnd();
  }

  if (r.recentErrors.length) {
    console.group("Recent Errors");
    console.table(r.recentErrors.map((e) => ({ time: new Date(e.ts).toLocaleTimeString(), endpoint: e.url, status: e.status, duration: e.duration + "ms", error: e.error, network: e.conn })));
    console.groupEnd();
  }

  if (Object.keys(r.connectionBreakdown).length) {
    console.log("Connection Breakdown:", r.connectionBreakdown);
  }

  console.groupEnd();
  return r;
}

/**
 * Reset all tracked data
 */
function reset() {
  _entries.length = 0;
  _endpointStats.clear();
  _totalCalls = 0;
  _totalErrors = 0;
  _totalCacheHits = 0;
}

/**
 * Export entries as JSON string (for sharing with backend/support)
 */
function exportJSON() {
  return JSON.stringify({ report: getReport(), entries: getEntries() }, null, 2);
}

const perfMonitor = { start, recordCacheHit, getEntries, getReport, printReport, reset, exportJSON };

// Expose globally for console debugging
if (typeof window !== "undefined") {
  window.__apiPerf = perfMonitor;
}

export default perfMonitor;
