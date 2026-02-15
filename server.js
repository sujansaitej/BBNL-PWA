// Production server for BBNL CRM PWA
// Serves static files + proxies /stream via HTTP/2 to stream hosts
//
// Usage:
//   npm run build
//   node server.js
//
// Environment variables (optional):
//   PORT            — HTTP port (default: 3000)
//   STREAM_HOSTS    — comma-separated allowed stream hosts
//                     (default: livestream.bbnl.in,livestream2.bbnl.in)

import http from "node:http";
import http2 from "node:http2";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "dist");
const PORT = parseInt(process.env.PORT || "3000", 10);
const STREAM_PREFIX = "/stream/";
const BASE_PATH = "/pwa/crm"; // Must match vite.config.js base
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
      "Access-Control-Allow-Headers": "Range, Content-Type",
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

  h2Req.on("response", (headers) => {
    try {
      if (res.headersSent || res.writableEnded) return;
      const status = headers[":status"] || 502;
      const outHeaders = {
        "Content-Type": headers["content-type"] || "application/octet-stream",
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "no-store",
      };
      if (headers["content-length"]) outHeaders["Content-Length"] = headers["content-length"];
      safeWriteHead(res, status, outHeaders);
      pipeline(h2Req, res, (err) => {
        if (err && !isBenign(err)) console.error(`[Stream:${streamHost}] pipeline error:`, err.code || err.message);
      });
    } catch (err) {
      if (!isBenign(err)) console.error(`[Stream:${streamHost}] response handler error:`, err.message);
      send502(res);
    }
  });

  h2Req.on("close", () => { pool.activeCount = Math.max(0, pool.activeCount - 1); });
  h2Req.on("error", (err) => { if (!isBenign(err)) send502(res); });
  h2Req.end();
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

// ── HTTP Server ──
const STREAM_PREFIX_WITH_BASE = BASE_PATH + STREAM_PREFIX; // /pwa/crm/stream/

const server = http.createServer((req, res) => {
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
});

// Pre-warm HTTP/2 sessions for all allowed hosts
for (const host of ALLOWED_HOSTS) {
  try { getSession(host); } catch (_) {}
}

const hostList = [...ALLOWED_HOSTS].join(", ");
server.listen(PORT, () => {
  console.log(`\n  BBNL CRM PWA — Production Server`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  App:    http://localhost:${PORT}${BASE_PATH}`);
  console.log(`  Stream: /stream/{host}/... → HTTP/2 proxy`);
  console.log(`  Hosts:  ${hostList}`);
  console.log(`  Static: ${DIST_DIR}\n`);
});
