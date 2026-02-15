// Custom Vite plugin that proxies stream requests via HTTP/2.
// The stream servers require HTTP/2+ and send broken CORS headers
// (Access-Control-Allow-Origin: *, *).
// This plugin fetches via HTTP/2, pipes with backpressure, and returns clean headers.
//
// URL format: /stream/<hostname>/<path>
// e.g. /stream/livestream.bbnl.in/hls/ch1.m3u8
//      /stream/livestream2.bbnl.in/hls/ch2.m3u8

import http2 from "node:http2";
import { pipeline } from "node:stream";

const PREFIX = "/stream/";
const SESSION_MAX_AGE = 600_000; // Rotate session every 10 minutes

// Allowed stream hosts — only these hostnames can be proxied
const ALLOWED_HOSTS = new Set(
  (process.env.STREAM_HOSTS || "livestream.bbnl.in,livestream2.bbnl.in")
    .split(",").map(h => h.trim().toLowerCase()).filter(Boolean)
);

// Per-host HTTP/2 session pool
const sessionPool = new Map(); // host → { session, nextSession, createdAt, activeCount, pingTimer }

const BENIGN_ERRORS = new Set([
  "ERR_HTTP2_STREAM_CANCEL",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
  "ERR_HTTP2_STREAM_ERROR",
  "ERR_HTTP2_SESSION_ERROR",
  "ERR_HTTP2_INVALID_SESSION",
  "ERR_HTTP2_GOAWAY_SESSION",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_SOCKET_CLOSED",
  "ERR_HTTP2_ERROR",
  "NGHTTP2_INTERNAL_ERROR",
]);

function isBenign(err) {
  if (!err) return true;
  if (BENIGN_ERRORS.has(err.code)) return true;
  if (typeof err.message === "string" && (
    err.message.includes("GOAWAY") ||
    err.message.includes("destroyed") ||
    err.message.includes("closed") ||
    err.message.includes("socket hang up")
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
      if (!isBenign(err)) console.error(`[Stream Proxy:${host}] session error:`, err.message);
      const pool = sessionPool.get(host);
      if (pool) {
        if (pool.session === session) pool.session = null;
        if (pool.nextSession === session) pool.nextSession = null;
      }
    });
    return session;
  } catch (err) {
    console.error(`[Stream Proxy:${host}] http2.connect() failed:`, err.message);
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
    console.log(`[Stream Proxy:${host}] ${label} GOAWAY — will reconnect`);
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
            if (!isBenign(err)) console.error(`[Stream Proxy:${host}] Ping failed:`, err.message);
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

// Safe response helpers — never throw
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
      if (!isBenign(err)) console.error("[Stream Proxy] h2 request error:", err.code || err.message);
    });
    return req;
  } catch (err) {
    console.error("[Stream Proxy] session.request() threw:", err.message);
    return null;
  }
}

// Parse target host and path from URL: /stream/<hostname>/<path>
function parseStreamUrl(url) {
  const rest = url.slice(PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 1) return null;
  const host = rest.slice(0, slashIdx).toLowerCase();
  const streamPath = rest.slice(slashIdx);
  if (!ALLOWED_HOSTS.has(host)) return null;
  return { host, streamPath };
}

export default function streamProxyPlugin() {
  return {
    name: "stream-proxy",
    configureServer(server) {
      // Pre-warm sessions for all allowed hosts
      for (const host of ALLOWED_HOSTS) {
        try { getSession(host); } catch (_) {}
      }

      const hostList = [...ALLOWED_HOSTS].join(", ");
      console.log(`[Stream Proxy] Plugin registered — proxying /stream/{host}/... → HTTP/2`);
      console.log(`[Stream Proxy] Allowed hosts: ${hostList}`);

      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith(PREFIX)) return next();

        try {
          handleStreamRequest(req, res);
        } catch (err) {
          console.error("[Stream Proxy] Unhandled error in middleware:", err.message);
          send502(res);
        }
      });
    },
  };
}

function handleStreamRequest(req, res) {
  // ── Origin / Referer gate ──
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const reqHost = req.headers.host || "";
  const allowed =
    origin === `http://${reqHost}` ||
    origin === `https://${reqHost}` ||
    referer.startsWith(`http://${reqHost}`) ||
    referer.startsWith(`https://${reqHost}`) ||
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
  try {
    session = getSession(streamHost);
  } catch (err) {
    console.error(`[Stream Proxy:${streamHost}] getSession error:`, err.message);
    send502(res);
    return;
  }

  if (!session || session.closed || session.destroyed) {
    console.error(`[Stream Proxy:${streamHost}] No valid session available`);
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

    // Retry once with a fresh session
    try {
      const fresh = getSession(streamHost);
      if (!fresh || fresh.closed || fresh.destroyed) {
        send502(res);
        return;
      }
      pool.activeCount++;
      h2Req = safeRequest(fresh, reqHeaders);
      if (!h2Req) {
        pool.activeCount = Math.max(0, pool.activeCount - 1);
        send502(res);
        return;
      }
    } catch (retryErr) {
      pool.activeCount = Math.max(0, pool.activeCount - 1);
      console.error(`[Stream Proxy:${streamHost}] retry failed:`, retryErr.message);
      send502(res);
      return;
    }
  }

  h2Req.setTimeout(30_000, () => {
    try { h2Req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
  });

  const cancelH2 = () => {
    try {
      if (!h2Req.closed && !h2Req.destroyed) {
        h2Req.close(http2.constants.NGHTTP2_CANCEL);
      }
    } catch (_) {}
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
      if (headers["content-length"]) {
        outHeaders["Content-Length"] = headers["content-length"];
      }

      safeWriteHead(res, status, outHeaders);

      pipeline(h2Req, res, (err) => {
        if (err && !isBenign(err)) {
          console.error(`[Stream Proxy:${streamHost}] pipeline error:`, err.code || err.message);
        }
      });
    } catch (err) {
      if (!isBenign(err)) {
        console.error(`[Stream Proxy:${streamHost}] response handler error:`, err.message);
      }
      send502(res);
    }
  });

  h2Req.on("close", () => {
    pool.activeCount = Math.max(0, pool.activeCount - 1);
  });

  h2Req.on("error", (err) => {
    if (isBenign(err)) return;
    console.error(`[Stream Proxy:${streamHost}] stream error:`, err.message);
    send502(res);
  });

  h2Req.end();
}
