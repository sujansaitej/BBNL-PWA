// Production server for BBNL CRM PWA
// Serves static files + proxies /stream via HTTP/2 to stream hosts.
// The /stream proxy always talks HTTP/2 outbound; the inbound listener
// depends on TLS (see TLS_CERT_PATH below).
//
// Usage:
//   npm run build
//   node server.js
//
// Environment variables (optional):
//   PORT            — listening port (default: 3000)
//   TLS_CERT_PATH   — path to TLS certificate file (PEM)
//   TLS_KEY_PATH    — path to TLS private key file (PEM)
//                     When both are set → HTTP/2 over TLS (h2, direct browser access)
//                     When omitted      → HTTP/1.1, for use behind a TLS-terminating
//                                         reverse proxy. Proxies speak HTTP/1.1 to
//                                         their upstreams (Traefik by default; nginx
//                                         cannot proxy_pass HTTP/2 at all), so an
//                                         h2c listener here would reject every
//                                         proxied request.
//   STREAM_HOSTS    — comma-separated allowed stream hosts
//                     (default: livestream.bbnl.in,livestream2.bbnl.in)

import http2 from "node:http2";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "dist");
const PORT = parseInt(process.env.PORT || "3000", 10);
const STREAM_PREFIX = "/stream/";
const BASE_PATH = "/smartphone/crm"; // Must match vite.config.js base
const SESSION_MAX_AGE = 600_000;

// Allowed stream hosts — only these hostnames can be proxied
const ALLOWED_HOSTS = new Set(
  (process.env.STREAM_HOSTS || "livestream.bbnl.in,livestream2.bbnl.in")
    .split(",").map(h => h.trim().toLowerCase()).filter(Boolean)
);

// ── MIME types ──
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mp4": "video/mp4",
};

// ── HTTP/2 session pool — one session per stream host ──
const sessionPool = new Map(); // host → { session, nextSession, createdAt, activeCount, pingTimer }

// ── Segment Cache — serves repeated .ts requests from memory ──
// When multiple viewers watch the same channel, only the first request
// fetches from origin. Subsequent requests get the cached segment instantly.
const segmentCache = new Map();
let segmentCacheBytes = 0;
const SEG_CACHE_MAX = 150 * 1024 * 1024; // 150 MB max
const SEG_CACHE_TTL = 25_000;            // 25s — covers ~4 live segments

function getSegmentCache(key) {
  const e = segmentCache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { segmentCacheBytes -= e.buf.length; segmentCache.delete(key); return null; }
  return e;
}

function setSegmentCache(key, buf, contentType) {
  if (buf.length > 10 * 1024 * 1024) return; // skip segments > 10 MB
  while (segmentCacheBytes + buf.length > SEG_CACHE_MAX && segmentCache.size > 0) {
    const oldest = segmentCache.keys().next().value;
    const old = segmentCache.get(oldest);
    segmentCacheBytes -= old.buf.length;
    segmentCache.delete(oldest);
  }
  segmentCache.set(key, { buf, contentType, exp: Date.now() + SEG_CACHE_TTL });
  segmentCacheBytes += buf.length;
}

const BENIGN_ERRORS = new Set([
  "ERR_HTTP2_STREAM_CANCEL", "ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_DESTROYED",
  "ERR_HTTP2_STREAM_ERROR", "ERR_HTTP2_SESSION_ERROR", "ERR_HTTP2_INVALID_SESSION",
  "ERR_HTTP2_GOAWAY_SESSION", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT",
  "EHOSTUNREACH", "ENETUNREACH", "ERR_SOCKET_CLOSED", "ERR_HTTP2_ERROR",
  "NGHTTP2_INTERNAL_ERROR",
]);

function isBenign(err) {
  if (!err) return true;
  if (BENIGN_ERRORS.has(err.code)) return true;
  if (typeof err.message === "string" && (
    err.message.includes("GOAWAY") || err.message.includes("destroyed") ||
    err.message.includes("closed") || err.message.includes("socket hang up")
  )) return true;
  return false;
}

function safeCreateH2(host) {
  try {
    const session = http2.connect(`https://${host}`, {
      rejectUnauthorized: false,
      settings: { initialWindowSize: 8 * 1024 * 1024 },
    });
    session.on("error", (err) => {
      if (!isBenign(err)) console.error(`[Stream:${host}] session error:`, err.message);
      const pool = sessionPool.get(host);
      if (pool) {
        if (pool.session === session) pool.session = null;
        if (pool.nextSession === session) pool.nextSession = null;
      }
    });
    return session;
  } catch (err) {
    console.error(`[Stream:${host}] http2.connect() failed:`, err.message);
    return null;
  }
}

function setupHandlers(host, session, label) {
  if (!session) return;
  session.on("close", () => {
    const pool = sessionPool.get(host);
    if (pool) {
      if (pool.session === session) pool.session = null;
      if (pool.nextSession === session) pool.nextSession = null;
    }
  });
  session.on("goaway", () => {
    console.log(`[Stream:${host}] ${label} GOAWAY — will reconnect`);
    const pool = sessionPool.get(host);
    if (pool) {
      if (pool.session === session) pool.session = null;
      if (pool.nextSession === session) pool.nextSession = null;
    }
  });
}

function startPing(host) {
  const pool = sessionPool.get(host);
  if (!pool) return;
  if (pool.pingTimer) clearInterval(pool.pingTimer);
  pool.pingTimer = setInterval(() => {
    if (pool.session && !pool.session.closed && !pool.session.destroyed) {
      try {
        pool.session.ping(Buffer.alloc(8), (err) => {
          if (err) {
            if (!isBenign(err)) console.error(`[Stream:${host}] Ping failed:`, err.message);
            pool.session = null;
            if (pool.pingTimer) { clearInterval(pool.pingTimer); pool.pingTimer = null; }
          }
        });
      } catch (_) {
        pool.session = null;
        if (pool.pingTimer) { clearInterval(pool.pingTimer); pool.pingTimer = null; }
      }
    } else {
      if (pool.pingTimer) { clearInterval(pool.pingTimer); pool.pingTimer = null; }
    }
  }, 30_000);
}

function getSession(host) {
  let pool = sessionPool.get(host);
  if (!pool) {
    pool = { session: null, nextSession: null, createdAt: 0, activeCount: 0, pingTimer: null };
    sessionPool.set(host, pool);
  }

  const now = Date.now();
  const alive = pool.session && !pool.session.closed && !pool.session.destroyed;
  const age = now - pool.createdAt;
  const fresh = age < SESSION_MAX_AGE;

  // Pre-warm at 80% lifetime
  if (alive && fresh && age > SESSION_MAX_AGE * 0.8 && !pool.nextSession) {
    pool.nextSession = safeCreateH2(host);
    setupHandlers(host, pool.nextSession, "Pre-warm");
  }
  if (alive && fresh) return pool.session;
  if (alive && !fresh && pool.activeCount > 0) return pool.session;

  // Drain old session
  if (pool.session && !pool.session.closed) {
    const old = pool.session;
    setTimeout(() => { try { if (!old.closed) old.close(); } catch (_) {} }, 45_000);
  }

  // Swap to pre-warmed
  if (pool.nextSession && !pool.nextSession.closed && !pool.nextSession.destroyed) {
    pool.session = pool.nextSession;
    pool.nextSession = null;
    pool.createdAt = now;
    startPing(host);
    return pool.session;
  }

  // Create new
  pool.session = safeCreateH2(host);
  pool.createdAt = now;
  setupHandlers(host, pool.session, "Main");
  startPing(host);
  return pool.session;
}

// ── Safe response helpers ──
function safeWriteHead(res, status, headers) {
  try { if (!res.headersSent) res.writeHead(status, headers); } catch (_) {}
}
function safeEnd(res, body) {
  try { if (!res.writableEnded) res.end(body); } catch (_) {}
}
function send502(res) {
  safeWriteHead(res, 502, { "Content-Type": "text/plain" });
  safeEnd(res, "Stream proxy error");
}

function safeRequest(session, headers) {
  try {
    const req = session.request(headers);
    req.on("error", (err) => {
      if (!isBenign(err)) console.error("[Stream] h2 request error:", err.code || err.message);
    });
    return req;
  } catch (err) {
    console.error("[Stream] session.request() threw:", err.message);
    return null;
  }
}

// ── Parse stream host and path from URL ──
// URL format: /stream/<hostname>/<path>
// e.g. /stream/livestream.bbnl.in/hls/ch1.m3u8
function parseStreamUrl(url) {
  // Strip "/stream/" prefix
  const rest = url.slice(STREAM_PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 1) return null;
  const host = rest.slice(0, slashIdx).toLowerCase();
  const streamPath = rest.slice(slashIdx);
  if (!ALLOWED_HOSTS.has(host)) return null;
  return { host, streamPath };
}

// ── Rewrite .m3u8 playlists so all URLs route through the proxy ──
function rewriteM3u8(body, streamHost) {
  const proxyBase = `${BASE_PATH}/stream`;
  // Replace full URLs for every allowed host → proxy path
  for (const host of ALLOWED_HOSTS) {
    const re = new RegExp(`https?://${host.replace(/\./g, "\\.")}(/[^\\s"']*)`, "g");
    body = body.replace(re, `${proxyBase}/${host}$1`);
  }
  // Replace absolute paths on non-comment lines → proxy path (belong to current host)
  body = body.replace(/^(\/\S+)$/gm, `${proxyBase}/${streamHost}$1`);
  // Replace absolute paths inside URI="…" attributes
  body = body.replace(/URI="(\/[^"]+)"/gi, `URI="${proxyBase}/${streamHost}$1"`);
  return body;
}

// ── Stream proxy handler ──
function handleStreamRequest(req, res) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const reqHost = req.headers.host || "";
  const allowed =
    origin === `http://${reqHost}` || origin === `https://${reqHost}` ||
    referer.startsWith(`http://${reqHost}`) || referer.startsWith(`https://${reqHost}`) ||
    (!origin && !referer);

  if (!allowed) {
    safeWriteHead(res, 403, { "Content-Type": "text/plain" });
    safeEnd(res, "Forbidden");
    return;
  }

  const corsOrigin = origin || `http://${reqHost}`;

  if (req.method === "OPTIONS") {
    safeWriteHead(res, 204, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type, X-App-Package",
      "Access-Control-Max-Age": "86400",
    });
    safeEnd(res);
    return;
  }

  // Parse target host from URL
  const parsed = parseStreamUrl(req.url);
  if (!parsed) {
    safeWriteHead(res, 400, { "Content-Type": "text/plain" });
    safeEnd(res, "Invalid stream host");
    return;
  }

  const { host: streamHost, streamPath } = parsed;
  const isSegment = /\.(ts|m4s|fmp4|aac|mp4)(\?|$)/i.test(streamPath);

  // Serve cached segment if available (cache hit = no origin fetch)
  if (isSegment) {
    const cacheKey = `${streamHost}${streamPath.split('?')[0]}`;
    const cached = getSegmentCache(cacheKey);
    if (cached) {
      safeWriteHead(res, 200, {
        "Content-Type": cached.contentType,
        "Content-Length": cached.buf.length,
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "no-store",
      });
      safeEnd(res, cached.buf);
      return;
    }
  }

  let session;
  try { session = getSession(streamHost); } catch (err) {
    console.error(`[Stream:${streamHost}] getSession error:`, err.message);
    send502(res);
    return;
  }

  if (!session || session.closed || session.destroyed) {
    send502(res);
    return;
  }

  const pool = sessionPool.get(streamHost);
  pool.activeCount++;

  const reqHeaders = {
    ":method": "GET",
    ":path": streamPath,
    ":authority": streamHost,
    "accept": "*/*",
    "x-app-package": "com.bbnl.smartphone",
  };

  let h2Req = safeRequest(session, reqHeaders);

  if (!h2Req) {
    pool.activeCount = Math.max(0, pool.activeCount - 1);
    pool.session = null;
    try {
      const fresh = getSession(streamHost);
      if (!fresh || fresh.closed || fresh.destroyed) { send502(res); return; }
      pool.activeCount++;
      h2Req = safeRequest(fresh, reqHeaders);
      if (!h2Req) { pool.activeCount = Math.max(0, pool.activeCount - 1); send502(res); return; }
    } catch (_) {
      pool.activeCount = Math.max(0, pool.activeCount - 1);
      send502(res);
      return;
    }
  }

  h2Req.setTimeout(30_000, () => {
    try { h2Req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
  });

  const cancelH2 = () => {
    try { if (!h2Req.closed && !h2Req.destroyed) h2Req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
  };
  res.on("close", cancelH2);
  res.on("error", cancelH2);

  const isM3u8 = streamPath.endsWith(".m3u8") || streamPath.endsWith(".m3u");

  h2Req.on("response", (headers) => {
    try {
      if (res.headersSent || res.writableEnded) return;
      const status = headers[":status"] || 502;
      const contentType = headers["content-type"] || "application/octet-stream";
      const outHeaders = {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "no-store",
      };

      if (isM3u8 || contentType.includes("mpegurl")) {
        // Buffer .m3u8 playlists and rewrite URLs so segments go through the proxy
        const chunks = [];
        h2Req.on("data", (chunk) => chunks.push(chunk));
        h2Req.on("end", () => {
          try {
            let body = Buffer.concat(chunks).toString("utf-8");
            body = rewriteM3u8(body, streamHost);
            outHeaders["Content-Length"] = Buffer.byteLength(body);
            safeWriteHead(res, status, outHeaders);
            safeEnd(res, body);
          } catch (e) {
            if (!isBenign(e)) console.error(`[Stream:${streamHost}] m3u8 rewrite error:`, e.message);
            send502(res);
          }
        });
      } else if (isSegment && status >= 200 && status < 300) {
        // Buffer segment for caching, then send to client
        const segChunks = [];
        h2Req.on("data", (chunk) => segChunks.push(chunk));
        h2Req.on("end", () => {
          try {
            const buf = Buffer.concat(segChunks);
            setSegmentCache(`${streamHost}${streamPath.split('?')[0]}`, buf, contentType);
            outHeaders["Content-Length"] = buf.length;
            safeWriteHead(res, status, outHeaders);
            safeEnd(res, buf);
          } catch (e) { if (!isBenign(e)) send502(res); }
        });
      } else {
        // Other binary data — stream directly with backpressure
        if (headers["content-length"]) outHeaders["Content-Length"] = headers["content-length"];
        safeWriteHead(res, status, outHeaders);
        pipeline(h2Req, res, (err) => {
          if (err && !isBenign(err)) console.error(`[Stream:${streamHost}] pipeline error:`, err.code || err.message);
        });
      }
    } catch (err) {
      if (!isBenign(err)) console.error(`[Stream:${streamHost}] response handler error:`, err.message);
      send502(res);
    }
  });

  h2Req.on("close", () => { pool.activeCount = Math.max(0, pool.activeCount - 1); });
  h2Req.on("error", (err) => { if (!isBenign(err)) send502(res); });
  h2Req.end();
}

// ── Easebuzz initiateLink proxy ──
// The browser cannot call Easebuzz's payment/initiateLink directly: it is a
// server-to-server endpoint with no CORS headers. This same-origin seam lets
// the PWA obtain an access_key. Locked to the single endpoint (never an open
// proxy). Mirrors the vite dev proxy so dev and prod behave identically.
const EZ_HOSTS = { test: "testpay.easebuzz.in", prod: "pay.easebuzz.in" };

function handleEzpayRequest(req, res, strippedUrl) {
  const m = strippedUrl.match(/^\/ezpay-(test|prod)(\/[^?]*)/);
  const host = m && EZ_HOSTS[m[1]];
  const upstreamPath = m && m[2];
  if (!host || req.method !== "POST" || upstreamPath !== "/payment/initiateLink") {
    safeWriteHead(res, 404, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ status: 0, data: "not_found" }));
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const upstream = https.request(
      {
        host, port: 443, method: "POST", path: "/payment/initiateLink",
        headers: {
          "Content-Type": req.headers["content-type"] || "application/x-www-form-urlencoded",
          "Content-Length": body.length,
          Accept: "application/json",
        },
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (up) => {
        safeWriteHead(res, up.statusCode || 502, {
          "Content-Type": up.headers["content-type"] || "application/json",
          "Cache-Control": "no-store",
        });
        pipeline(up, res, (err) => {
          if (err && !isBenign(err)) console.error("[Ezpay] pipe error:", err.message);
        });
      }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (err) => {
      console.error("[Ezpay] upstream error:", err.message);
      if (!res.headersSent) {
        safeWriteHead(res, 502, { "Content-Type": "application/json" });
        safeEnd(res, JSON.stringify({ status: 0, data: "proxy_error" }));
      }
    });
    upstream.end(body);
  });
  req.on("error", () => {
    if (!res.headersSent) { safeWriteHead(res, 400, { "Content-Type": "text/plain" }); safeEnd(res, "Bad request"); }
  });
}

// ── Data usage report proxy ──
// payurbills.co.in answers EVERY request with a static
// `Access-Control-Allow-Origin: https://bbnl.co.in` — it does not echo the
// caller's Origin — so the browser blocks it from our origin no matter what we
// send. Android is unaffected only because native HTTP has no CORS. Same
// same-origin seam as the Easebuzz proxy above, and locked to the single
// endpoint so it is never an open proxy.
const USAGE_HOST = "payurbills.co.in";
const USAGE_PATH = "/best2/General/overallAvgUsageReport/";

function handleUsageRequest(req, res, strippedUrl) {
  const m = strippedUrl.match(/^\/usage-api(\/[^?]*)/);
  const upstreamPath = m && m[1];
  if (req.method !== "POST" || upstreamPath !== "/overallAvgUsageReport/") {
    safeWriteHead(res, 404, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "not_found" }));
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const upstream = https.request(
      {
        host: USAGE_HOST, port: 443, method: "POST", path: USAGE_PATH,
        headers: {
          "Content-Type": req.headers["content-type"] || "application/x-www-form-urlencoded",
          "Content-Length": body.length,
          Accept: "application/json",
        },
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (up) => {
        safeWriteHead(res, up.statusCode || 502, {
          "Content-Type": up.headers["content-type"] || "application/json",
          "Cache-Control": "no-store",
        });
        pipeline(up, res, (err) => {
          if (err && !isBenign(err)) console.error("[Usage] pipe error:", err.message);
        });
      }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (err) => {
      console.error("[Usage] upstream error:", err.message);
      if (!res.headersSent) {
        safeWriteHead(res, 502, { "Content-Type": "application/json" });
        safeEnd(res, JSON.stringify({ error: 1, result: "proxy_error" }));
      }
    });
    upstream.end(body);
  });
  req.on("error", () => {
    if (!res.headersSent) { safeWriteHead(res, 400, { "Content-Type": "text/plain" }); safeEnd(res, "Bad request"); }
  });
}

// ── Netmon QR / SSO proxy ──
// Mirrors the qr-api rules the build writes into .htaccess, so a Node-hosted
// bundle behaves the same as an Apache-hosted one. Without it the request
// falls through to the SPA handler, comes back as index.html at HTTP 200, and
// both "Scan To Login" and "Login To Netmon" fail on a body they cannot parse.
//
// The credentials are attached HERE, never in the browser: the
// QrcodeAuthentication service compares header names case-sensitively — only
// `Authorization`, `username`, `password` — and the Fetch API lowercases every
// header name with no way to opt out, so the browser cannot satisfy it at all
// (a mismatch answers `failed` as a bare body, at HTTP 200). Node's setHeader
// preserves the casing it is handed. Keeping them server-side also keeps them
// out of the JS bundle.
const QR_UPSTREAM = process.env.QR_UPSTREAM || process.env.VITE_QR_PROXY_UPSTREAM || "";
const QR_AUTH_KEY = process.env.VITE_WEBLOGIN_AUTH_KEY || "";
const QR_USERNAME = process.env.VITE_WEBLOGIN_USERNAME || "";
const QR_PASSWORD = process.env.VITE_WEBLOGIN_PASSWORD || "";
// Narrow by design: these two are all the PWA calls. `getqrcode` mints login
// challenges and is deliberately NOT reachable through here.
const QR_ALLOWED = new Set(["apploginlink", "verifyqrcode"]);
const QR_MAX_BODY = 16 * 1024;

function handleQrRequest(req, res, strippedUrl) {
  const action = (strippedUrl.match(/^\/qr-api\/([A-Za-z0-9_-]+)/) || [])[1];
  if (req.method !== "POST" || !action || !QR_ALLOWED.has(action)) {
    safeWriteHead(res, 404, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "not_found" }));
    return;
  }
  if (!QR_UPSTREAM) {
    // Same intent as the .htaccess 502: name the missing piece instead of
    // letting the SPA fallback answer with an HTML shell.
    console.error("[QR] QR_UPSTREAM / VITE_QR_PROXY_UPSTREAM is not set");
    safeWriteHead(res, 502, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "qr_upstream_not_configured" }));
    return;
  }

  let up;
  try { up = new URL(QR_UPSTREAM); } catch (_) {
    safeWriteHead(res, 502, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "qr_upstream_invalid" }));
    return;
  }
  const isTls = up.protocol === "https:";
  const transport = isTls ? https : http;

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > QR_MAX_BODY) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (size > QR_MAX_BODY) return;
    const body = Buffer.concat(chunks);
    const upstream = transport.request(
      {
        host: up.hostname,
        port: up.port || (isTls ? 443 : 80),
        method: "POST",
        path: `/QrcodeAuthentication/${action}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          // Casing is load-bearing — see the note above.
          Authorization: QR_AUTH_KEY,
          username: QR_USERNAME,
          password: QR_PASSWORD,
        },
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (resp) => {
        safeWriteHead(res, resp.statusCode || 502, {
          "Content-Type": resp.headers["content-type"] || "application/json",
          "Cache-Control": "no-store",
        });
        pipeline(resp, res, (err) => {
          if (err && !isBenign(err)) console.error("[QR] pipe error:", err.message);
        });
      }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (err) => {
      console.error("[QR] upstream error:", err.message);
      if (!res.headersSent) {
        safeWriteHead(res, 502, { "Content-Type": "application/json" });
        safeEnd(res, JSON.stringify({ error: 1, result: "proxy_error" }));
      }
    });
    upstream.end(body);
  });
  req.on("error", () => {
    if (!res.headersSent) { safeWriteHead(res, 400, { "Content-Type": "text/plain" }); safeEnd(res, "Bad request"); }
  });
}

// ── TR-069 ACS proxy (GenieACS northbound interface) ──
// The ACS is plain http:// on port 7557 and returns no Access-Control-* headers,
// so a browser on our https:// origin is blocked twice over — mixed content AND
// CORS. Neither is fixable client-side, so the PWA talks to this same-origin
// seam and we make the cross-origin hop server-side. Same arrangement as the
// Easebuzz and usage-report proxies above.
//
// SECURITY — this proxy is the ONLY control in front of the fleet.
// The GenieACS NBI has no authentication of its own: anything that can reach
// port 7557 can reconfigure or reboot any ONT. So this seam is deliberately
// narrow:
//   * only the /devices collection is reachable (no /tasks, /faults, /presets,
//     /provisions, /files — those can rewrite ACS behaviour for every device)
//   * only GET (read) and POST (queue a task) — never PUT or DELETE
//   * a size cap on task bodies
// It is still an authenticated-operator-only surface. Do NOT route the customer
// portal through it: a customer-reachable path must never accept a device id
// from the client, because changing one number reaches a stranger's equipment.
const ACS_URL = process.env.ACS_URL || "http://acs.bfnl.services:7557/devices/";
const ACS_MAX_BODY = 256 * 1024;

function handleAcsRequest(req, res, strippedUrl) {
  const method = req.method;
  if (method !== "GET" && method !== "POST") {
    safeWriteHead(res, 405, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "method_not_allowed" }));
    return;
  }

  // Everything after /acs-api is appended to the ACS device collection URL.
  const rest = strippedUrl.replace(/^\/acs-api/, "") || "/";

  // Reject any attempt to climb out of /devices/ into another collection.
  if (rest.includes("..") || /%2e%2e/i.test(rest)) {
    safeWriteHead(res, 400, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "bad_path" }));
    return;
  }
  // POST is only ever a task queue: /<deviceId>/tasks?...
  if (method === "POST" && !/\/tasks(\?|$)/.test(rest)) {
    safeWriteHead(res, 403, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "forbidden_path" }));
    return;
  }

  let target;
  try {
    // Strip EVERY leading slash, not just one. A single strip leaves "//presets"
    // as "/presets", and a root-relative reference escapes the /devices/ base:
    //   new URL("/presets", "http://acs:7557/devices/")  -> http://acs:7557/presets
    // which reaches GenieACS's preset collection — provisioning logic for the
    // entire fleet. "///faults" is worse still: URL() reads it as a protocol-
    // relative authority and resolves to http://faults/, a different host.
    target = new URL(rest.replace(/^\/+/, ""), ACS_URL);
  } catch (_e) {
    safeWriteHead(res, 400, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "bad_url" }));
    return;
  }

  // Defence in depth: whatever the input did, the resolved URL must still sit
  // inside the configured device collection. Cheaper to assert than to reason
  // about every way URL() can be steered.
  if (!target.href.startsWith(ACS_URL)) {
    safeWriteHead(res, 403, { "Content-Type": "application/json" });
    safeEnd(res, JSON.stringify({ error: 1, result: "outside_device_collection" }));
    return;
  }

  const isTls = target.protocol === "https:";
  const agent = isTls ? https : http;

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on("data", (c) => {
    size += c.length;
    if (size > ACS_MAX_BODY) {
      aborted = true;
      safeWriteHead(res, 413, { "Content-Type": "application/json" });
      safeEnd(res, JSON.stringify({ error: 1, result: "body_too_large" }));
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on("end", () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);
    const headers = { Accept: "application/json" };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = body.length;
    }
    // The ACS NBI credential, when one is configured, lives HERE and never
    // reaches the browser.
    if (process.env.ACS_AUTH) headers.Authorization = process.env.ACS_AUTH;

    const upstream = agent.request(
      {
        protocol: target.protocol,
        host: target.hostname,
        port: target.port || (isTls ? 443 : 80),
        method,
        path: target.pathname + target.search,
        headers,
        rejectUnauthorized: false,
        // A connection_request reaches the CPE over the last mile; 12s is the
        // client-side budget, so allow headroom before giving up here.
        timeout: 50_000,
      },
      (up) => {
        // Status code passthrough is load-bearing: GenieACS answers 200 when a
        // task EXECUTED and 202 when it was only QUEUED because the device was
        // unreachable. Collapsing those is exactly the bug that made the old
        // console report "rebooted successfully" for offline devices.
        safeWriteHead(res, up.statusCode || 502, {
          "Content-Type": up.headers["content-type"] || "application/json",
          "Cache-Control": "no-store",
        });
        pipeline(up, res, (err) => {
          if (err && !isBenign(err)) console.error("[ACS] pipe error:", err.message);
        });
      }
    );

    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (err) => {
      console.error("[ACS] upstream error:", err.message);
      if (!res.headersSent) {
        safeWriteHead(res, 502, { "Content-Type": "application/json" });
        safeEnd(res, JSON.stringify({ error: 1, result: "acs_unreachable" }));
      }
    });

    if (method === "POST") upstream.end(body);
    else upstream.end();
  });

  req.on("error", () => {
    if (!res.headersSent) {
      safeWriteHead(res, 400, { "Content-Type": "text/plain" });
      safeEnd(res, "Bad request");
    }
  });
}

// ── Static file server ──
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);

  // Strip base path prefix
  if (urlPath.startsWith(BASE_PATH)) {
    urlPath = urlPath.slice(BASE_PATH.length) || "/";
  }

  let filePath = path.join(DIST_DIR, urlPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // If path is a directory or doesn't have an extension, serve index.html (SPA fallback)
  const ext = path.extname(filePath).toLowerCase();

  if (!ext || !fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(DIST_DIR, "index.html");
      fs.stat(indexPath, (err2, stats2) => {
        if (err2 || !stats2.isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(indexPath).pipe(res);
      });
      return;
    }

    const fileExt = path.extname(filePath).toLowerCase();
    const contentType = MIME[fileExt] || "application/octet-stream";

    const isHashed = /\.[a-f0-9]{8,}\./i.test(path.basename(filePath));
    const cacheControl = isHashed
      ? "public, max-age=31536000, immutable"
      : "no-cache";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Cache-Control": cacheControl,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ── HTTP/2 Server ──
const STREAM_PREFIX_WITH_BASE = BASE_PATH + STREAM_PREFIX; // /smartphone/crm/stream/

const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;
const useTLS = TLS_CERT_PATH && TLS_KEY_PATH;

function requestHandler(req, res) {
  // Same-origin proxy seams — match with or without the app base prefix.
  {
    let u = req.url;
    if (u.startsWith(BASE_PATH)) u = u.slice(BASE_PATH.length) || "/";
    if (u.startsWith("/ezpay-")) { handleEzpayRequest(req, res, u); return; }
    if (u.startsWith("/usage-api")) { handleUsageRequest(req, res, u); return; }
    if (u.startsWith("/acs-api")) { handleAcsRequest(req, res, u); return; }
    if (u.startsWith("/qr-api")) { handleQrRequest(req, res, u); return; }
  }

  // Strip base path prefix from stream requests so the handler sees /stream/...
  if (req.url.startsWith(STREAM_PREFIX_WITH_BASE)) {
    req.url = req.url.slice(BASE_PATH.length);
  }

  if (req.url.startsWith(STREAM_PREFIX)) {
    try {
      handleStreamRequest(req, res);
    } catch (err) {
      console.error("[Stream] Unhandled error:", err.message);
      send502(res);
    }
    return;
  }

  serveStatic(req, res);
}

let server;
if (useTLS) {
  server = http2.createSecureServer(
    {
      cert: fs.readFileSync(TLS_CERT_PATH),
      key: fs.readFileSync(TLS_KEY_PATH),
      allowHTTP1: false,
    },
    requestHandler,
  );
} else {
  // No TLS means we're behind a reverse proxy, and that upstream hop is
  // HTTP/1.1: Traefik defaults to it and nginx cannot proxy_pass HTTP/2 at
  // all. http2.createServer() is HTTP/2-only and rejects HTTP/1.1, which
  // surfaces at the proxy as a bare 500. Serving HTTP/1.1 here is what the
  // topology actually calls for; the /stream proxy is unaffected because it
  // negotiates HTTP/2 outbound via http2.connect().
  server = http.createServer(requestHandler);
}

// Pre-warm HTTP/2 sessions for all allowed hosts
for (const host of ALLOWED_HOSTS) {
  try { getSession(host); } catch (_) {}
}

const hostList = [...ALLOWED_HOSTS].join(", ");
const protocol = useTLS ? "https" : "http";
const h2Mode = useTLS ? "HTTP/2 (TLS)" : "HTTP/1.1 (behind reverse proxy; /stream still uses HTTP/2)";
server.listen(PORT, () => {
  console.log(`\n  BBNL CRM PWA — Production Server`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Proto:  ${h2Mode}`);
  console.log(`  App:    ${protocol}://localhost:${PORT}${BASE_PATH}`);
  console.log(`  Stream: /stream/{host}/... → HTTP/2 proxy`);
  console.log(`  Hosts:  ${hostList}`);
  console.log(`  Static: ${DIST_DIR}\n`);
});
