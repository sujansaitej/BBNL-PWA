// BBNL Stream Relay Server
// Deploy this on a VPS near international users (US/AU).
// It proxies /stream/* requests to Indian stream servers with segment caching.
// No static files needed — only handles stream proxying.
//
// Usage:
//   STREAM_HOSTS=livestream.bbnl.in,livestream2.bbnl.in \
//   ALLOWED_ORIGINS=https://bbnlnetmon.bbnl.in \
//   node relay-server.js
//
// Environment variables:
//   PORT             — listening port (default: 3000)
//   STREAM_HOSTS     — comma-separated allowed stream hosts
//   ALLOWED_ORIGINS  — comma-separated allowed CORS origins (your PWA domain)
//   TLS_CERT_PATH    — path to TLS cert (optional, use with TLS_KEY_PATH)
//   TLS_KEY_PATH     — path to TLS key (optional)

import http2 from "node:http2";
import http from "node:http";
import fs from "node:fs";
import { pipeline } from "node:stream";

const PORT = parseInt(process.env.PORT || "3000", 10);
const STREAM_PREFIX = "/stream/";
const SESSION_MAX_AGE = 600_000;

const ALLOWED_HOSTS = new Set(
  (process.env.STREAM_HOSTS || "livestream.bbnl.in,livestream2.bbnl.in")
    .split(",").map(h => h.trim().toLowerCase()).filter(Boolean)
);

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "https://bbnlnetmon.bbnl.in")
    .split(",").map(o => o.trim()).filter(Boolean)
);

// ── Segment Cache ──
const segmentCache = new Map();
let segmentCacheBytes = 0;
const SEG_CACHE_MAX = 200 * 1024 * 1024; // 200 MB (relay has dedicated RAM)
const SEG_CACHE_TTL = 30_000;

function getSegmentCache(key) {
  const e = segmentCache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { segmentCacheBytes -= e.buf.length; segmentCache.delete(key); return null; }
  return e;
}

function setSegmentCache(key, buf, contentType) {
  if (buf.length > 10 * 1024 * 1024) return;
  while (segmentCacheBytes + buf.length > SEG_CACHE_MAX && segmentCache.size > 0) {
    const oldest = segmentCache.keys().next().value;
    const old = segmentCache.get(oldest);
    segmentCacheBytes -= old.buf.length;
    segmentCache.delete(oldest);
  }
  segmentCache.set(key, { buf, contentType, exp: Date.now() + SEG_CACHE_TTL });
  segmentCacheBytes += buf.length;
}

// ── HTTP/2 session pool ──
const sessionPool = new Map();

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
      if (!isBenign(err)) console.error(`[Relay:${host}] session error:`, err.message);
      const pool = sessionPool.get(host);
      if (pool) {
        if (pool.session === session) pool.session = null;
        if (pool.nextSession === session) pool.nextSession = null;
      }
    });
    return session;
  } catch (err) {
    console.error(`[Relay:${host}] http2.connect() failed:`, err.message);
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
          if (err) { pool.session = null; clearInterval(pool.pingTimer); pool.pingTimer = null; }
        });
      } catch (_) { pool.session = null; clearInterval(pool.pingTimer); pool.pingTimer = null; }
    } else { clearInterval(pool.pingTimer); pool.pingTimer = null; }
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
  if (alive && fresh && age > SESSION_MAX_AGE * 0.8 && !pool.nextSession) {
    pool.nextSession = safeCreateH2(host);
    setupHandlers(host, pool.nextSession, "Pre-warm");
  }
  if (alive && fresh) return pool.session;
  if (alive && !fresh && pool.activeCount > 0) return pool.session;
  if (pool.session && !pool.session.closed) {
    const old = pool.session;
    setTimeout(() => { try { if (!old.closed) old.close(); } catch (_) {} }, 45_000);
  }
  if (pool.nextSession && !pool.nextSession.closed && !pool.nextSession.destroyed) {
    pool.session = pool.nextSession;
    pool.nextSession = null;
    pool.createdAt = now;
    startPing(host);
    return pool.session;
  }
  pool.session = safeCreateH2(host);
  pool.createdAt = now;
  setupHandlers(host, pool.session, "Main");
  startPing(host);
  return pool.session;
}

// ── Helpers ──
function safeWriteHead(res, status, headers) {
  try { if (!res.headersSent) res.writeHead(status, headers); } catch (_) {}
}
function safeEnd(res, body) {
  try { if (!res.writableEnded) res.end(body); } catch (_) {}
}
function send502(res) {
  safeWriteHead(res, 502, { "Content-Type": "text/plain" });
  safeEnd(res, "Stream relay error");
}

function safeRequest(session, headers) {
  try {
    const req = session.request(headers);
    req.on("error", (err) => {
      if (!isBenign(err)) console.error("[Relay] h2 request error:", err.code || err.message);
    });
    return req;
  } catch (err) { return null; }
}

function parseStreamUrl(url) {
  const rest = url.slice(STREAM_PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 1) return null;
  const host = rest.slice(0, slashIdx).toLowerCase();
  const streamPath = rest.slice(slashIdx);
  if (!ALLOWED_HOSTS.has(host)) return null;
  return { host, streamPath };
}

function rewriteM3u8(body, streamHost) {
  for (const host of ALLOWED_HOSTS) {
    const re = new RegExp(`https?://${host.replace(/\./g, "\\.")}(/[^\\s"']*)`, "g");
    body = body.replace(re, `/stream/${host}$1`);
  }
  body = body.replace(/^(\/\S+)$/gm, `/stream/${streamHost}$1`);
  body = body.replace(/URI="(\/[^"]+)"/gi, `URI="/stream/${streamHost}$1"`);
  return body;
}

// ── Stream proxy handler ──
function handleStreamRequest(req, res) {
  const origin = req.headers.origin || "";

  // CORS: only allow requests from the PWA domain
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    safeWriteHead(res, 403, { "Content-Type": "text/plain" });
    safeEnd(res, "Forbidden");
    return;
  }

  const corsOrigin = origin || [...ALLOWED_ORIGINS][0];

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

  const parsed = parseStreamUrl(req.url);
  if (!parsed) {
    safeWriteHead(res, 400, { "Content-Type": "text/plain" });
    safeEnd(res, "Invalid stream path");
    return;
  }

  const { host: streamHost, streamPath } = parsed;
  const isM3u8 = streamPath.endsWith(".m3u8") || streamPath.endsWith(".m3u");
  const isSegment = /\.(ts|m4s|fmp4|aac|mp4)(\?|$)/i.test(streamPath);

  // Check segment cache
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
        "X-Cache": "HIT",
      });
      safeEnd(res, cached.buf);
      return;
    }
  }

  let session;
  try { session = getSession(streamHost); } catch (err) { send502(res); return; }
  if (!session || session.closed || session.destroyed) { send502(res); return; }

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
    } catch (_) { pool.activeCount = Math.max(0, pool.activeCount - 1); send502(res); return; }
  }

  h2Req.setTimeout(30_000, () => {
    try { h2Req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
  });

  const cancelH2 = () => {
    try { if (!h2Req.closed && !h2Req.destroyed) h2Req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
  };
  res.on("close", cancelH2);
  res.on("error", cancelH2);

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
        const chunks = [];
        h2Req.on("data", (chunk) => chunks.push(chunk));
        h2Req.on("end", () => {
          try {
            let body = Buffer.concat(chunks).toString("utf-8");
            body = rewriteM3u8(body, streamHost);
            outHeaders["Content-Length"] = Buffer.byteLength(body);
            safeWriteHead(res, status, outHeaders);
            safeEnd(res, body);
          } catch (e) { send502(res); }
        });
      } else if (isSegment && status >= 200 && status < 300) {
        // Buffer segment, cache it, then send
        const segChunks = [];
        h2Req.on("data", (chunk) => segChunks.push(chunk));
        h2Req.on("end", () => {
          try {
            const buf = Buffer.concat(segChunks);
            setSegmentCache(`${streamHost}${streamPath.split('?')[0]}`, buf, contentType);
            outHeaders["Content-Length"] = buf.length;
            outHeaders["X-Cache"] = "MISS";
            safeWriteHead(res, status, outHeaders);
            safeEnd(res, buf);
          } catch (e) { if (!isBenign(e)) send502(res); }
        });
      } else {
        if (headers["content-length"]) outHeaders["Content-Length"] = headers["content-length"];
        safeWriteHead(res, status, outHeaders);
        pipeline(h2Req, res, (err) => {
          if (err && !isBenign(err)) console.error(`[Relay:${streamHost}] pipeline error:`, err.code || err.message);
        });
      }
    } catch (err) { if (!isBenign(err)) send502(res); }
  });

  h2Req.on("close", () => { pool.activeCount = Math.max(0, pool.activeCount - 1); });
  h2Req.on("error", (err) => { if (!isBenign(err)) send502(res); });
  h2Req.end();
}

// ── Health check + stats ──
function handleHealth(req, res) {
  const stats = {
    uptime: Math.floor(process.uptime()),
    cache: {
      entries: segmentCache.size,
      bytes: segmentCacheBytes,
      maxBytes: SEG_CACHE_MAX,
    },
    sessions: [...sessionPool.entries()].map(([host, pool]) => ({
      host,
      alive: !!(pool.session && !pool.session.closed),
      active: pool.activeCount,
    })),
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(stats, null, 2));
}

// ── Server ──
const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;
const useTLS = TLS_CERT_PATH && TLS_KEY_PATH;

function requestHandler(req, res) {
  if (req.url === "/health") { handleHealth(req, res); return; }
  if (req.url.startsWith(STREAM_PREFIX)) {
    try { handleStreamRequest(req, res); } catch (err) { send502(res); }
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found — this is a stream relay server");
}

let server;
if (useTLS) {
  server = http2.createSecureServer(
    { cert: fs.readFileSync(TLS_CERT_PATH), key: fs.readFileSync(TLS_KEY_PATH), allowHTTP1: true },
    requestHandler,
  );
} else {
  // Plain HTTP (put behind Caddy/nginx for auto-TLS)
  server = http.createServer(requestHandler);
}

// Pre-warm HTTP/2 sessions
for (const host of ALLOWED_HOSTS) {
  try { getSession(host); } catch (_) {}
}

const hostList = [...ALLOWED_HOSTS].join(", ");
const originList = [...ALLOWED_ORIGINS].join(", ");
server.listen(PORT, () => {
  console.log(`\n  BBNL Stream Relay`);
  console.log(`  ─────────────────`);
  console.log(`  Port:    ${PORT}`);
  console.log(`  TLS:     ${useTLS ? "yes" : "no (use reverse proxy)"}`);
  console.log(`  Origins: ${originList}`);
  console.log(`  Hosts:   ${hostList}`);
  console.log(`  Cache:   ${SEG_CACHE_MAX / 1024 / 1024} MB max, ${SEG_CACHE_TTL / 1000}s TTL`);
  console.log(`  Health:  http://localhost:${PORT}/health\n`);
});
