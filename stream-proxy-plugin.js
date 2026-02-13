// Custom Vite plugin that proxies stream requests via HTTP/2.
// The stream server requires HTTP/2+ and sends broken CORS headers
// (Access-Control-Allow-Origin: *, *).
// This plugin fetches via HTTP/2, pipes with backpressure, and returns clean headers.

import http2 from "node:http2";
import { pipeline } from "node:stream";

const STREAM_HOST = process.env.STREAM_HOST || "livestream.bbnl.in";
const PREFIX = "/stream";
const SESSION_MAX_AGE = 600_000; // Rotate session every 10 minutes

let h2Session = null;
let sessionCreatedAt = 0;
let nextSession = null;
let activeRequestCount = 0;
let pingInterval = null;

// Set of error codes that are normal during HLS streaming
// (HLS.js frequently cancels segments when switching quality or seeking)
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

function safeCreateSession() {
  try {
    const session = http2.connect(`https://${STREAM_HOST}`, {
      rejectUnauthorized: false,
      settings: { initialWindowSize: 8 * 1024 * 1024 },
    });
    // Attach error handler IMMEDIATELY to prevent uncaught exceptions
    session.on("error", (err) => {
      if (!isBenign(err)) {
        console.error("[Stream Proxy] session error:", err.message);
      }
      if (session === h2Session) h2Session = null;
      if (session === nextSession) nextSession = null;
    });
    return session;
  } catch (err) {
    console.error("[Stream Proxy] http2.connect() failed:", err.message);
    return null;
  }
}

function setupSessionHandlers(session, label) {
  if (!session) return;
  // Error handler already attached in safeCreateSession, but add close/goaway
  session.on("close", () => {
    if (h2Session === session) h2Session = null;
    if (nextSession === session) nextSession = null;
  });
  session.on("goaway", () => {
    console.log(`[Stream Proxy] ${label} GOAWAY — will reconnect on next request`);
    if (session === h2Session) h2Session = null;
    if (session === nextSession) nextSession = null;
  });
}

function startPing() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (h2Session && !h2Session.closed && !h2Session.destroyed) {
      try {
        h2Session.ping(Buffer.alloc(8), (err) => {
          if (err) {
            if (!isBenign(err)) {
              console.error("[Stream Proxy] Ping failed:", err.message);
            }
            h2Session = null;
            if (pingInterval) clearInterval(pingInterval);
          }
        });
      } catch (_) {
        h2Session = null;
        if (pingInterval) clearInterval(pingInterval);
      }
    } else {
      if (pingInterval) clearInterval(pingInterval);
    }
  }, 30_000);
}

function getSession() {
  const now = Date.now();
  const alive = h2Session && !h2Session.closed && !h2Session.destroyed;
  const age = now - sessionCreatedAt;
  const fresh = age < SESSION_MAX_AGE;

  // Pre-warm the next session at 80% of session lifetime
  if (alive && fresh && age > SESSION_MAX_AGE * 0.8 && !nextSession) {
    console.log("[Stream Proxy] Pre-warming next HTTP/2 session");
    nextSession = safeCreateSession();
    setupSessionHandlers(nextSession, "Pre-warm");
  }

  if (alive && fresh) return h2Session;
  if (alive && !fresh && activeRequestCount > 0) return h2Session;

  // Let old session drain
  if (h2Session && !h2Session.closed) {
    const old = h2Session;
    setTimeout(() => { try { if (!old.closed) old.close(); } catch (_) {} }, 45_000);
  }

  // Swap to pre-warmed session
  if (nextSession && !nextSession.closed && !nextSession.destroyed) {
    console.log("[Stream Proxy] Swapping to pre-warmed session");
    h2Session = nextSession;
    nextSession = null;
    sessionCreatedAt = now;
    startPing();
    return h2Session;
  }

  // Create new session
  console.log("[Stream Proxy] Opening new HTTP/2 session");
  h2Session = safeCreateSession();
  sessionCreatedAt = now;
  setupSessionHandlers(h2Session, "Main");
  startPing();
  return h2Session;
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
    // Attach error handler IMMEDIATELY to prevent uncaught exceptions
    req.on("error", (err) => {
      if (!isBenign(err)) {
        console.error("[Stream Proxy] h2 request error:", err.code || err.message);
      }
    });
    return req;
  } catch (err) {
    console.error("[Stream Proxy] session.request() threw:", err.message);
    return null;
  }
}

export default function streamProxyPlugin() {
  return {
    name: "stream-proxy",
    configureServer(server) {
      try { getSession(); } catch (_) {}

      console.log(`[Stream Proxy] Plugin registered — proxying /stream → ${STREAM_HOST}`);

      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith(PREFIX)) return next();

        // Wrap the entire handler in try-catch to prevent server crashes
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
  const host = req.headers.host || "";
  const allowed =
    origin === `http://${host}` ||
    origin === `https://${host}` ||
    referer.startsWith(`http://${host}`) ||
    referer.startsWith(`https://${host}`) ||
    (!origin && !referer);

  if (!allowed) {
    safeWriteHead(res, 403, { "Content-Type": "text/plain" });
    safeEnd(res, "Forbidden");
    return;
  }

  const corsOrigin = origin || `http://${host}`;

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

  const streamPath = req.url.slice(PREFIX.length);

  let session;
  try {
    session = getSession();
  } catch (err) {
    console.error("[Stream Proxy] getSession error:", err.message);
    send502(res);
    return;
  }

  if (!session || session.closed || session.destroyed) {
    console.error("[Stream Proxy] No valid session available");
    send502(res);
    return;
  }

  activeRequestCount++;

  const reqHeaders = {
    ":method": "GET",
    ":path": streamPath,
    ":authority": STREAM_HOST,
    "accept": "*/*",
  };

  let h2Req = safeRequest(session, reqHeaders);

  if (!h2Req) {
    activeRequestCount = Math.max(0, activeRequestCount - 1);
    if (session === h2Session) h2Session = null;

    // Retry once with a fresh session
    try {
      const fresh = getSession();
      if (!fresh || fresh.closed || fresh.destroyed) {
        send502(res);
        return;
      }
      activeRequestCount++;
      h2Req = safeRequest(fresh, reqHeaders);
      if (!h2Req) {
        activeRequestCount = Math.max(0, activeRequestCount - 1);
        send502(res);
        return;
      }
    } catch (retryErr) {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      console.error("[Stream Proxy] retry failed:", retryErr.message);
      send502(res);
      return;
    }
  }

  h2Req.setTimeout(30_000, () => {
    try { h2Req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
  });

  // When the browser aborts, cancel the upstream H2 request
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
          console.error("[Stream Proxy] pipeline error:", err.code || err.message);
        }
      });
    } catch (err) {
      if (!isBenign(err)) {
        console.error("[Stream Proxy] response handler error:", err.message);
      }
      send502(res);
    }
  });

  h2Req.on("close", () => {
    activeRequestCount = Math.max(0, activeRequestCount - 1);
  });

  // Additional error handler for logging non-benign errors and sending 502
  // (the initial handler from safeRequest() prevents uncaught exceptions,
  //  this one handles the HTTP response side)
  h2Req.on("error", (err) => {
    if (isBenign(err)) return;
    console.error("[Stream Proxy] stream error:", err.message);
    send502(res);
  });

  h2Req.end();
}
