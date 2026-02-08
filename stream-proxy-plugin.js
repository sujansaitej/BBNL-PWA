// Custom Vite plugin that proxies stream requests via HTTP/2.
// The stream server (livestream.bbnl.in) requires HTTP/2+ and sends
// broken CORS headers (Access-Control-Allow-Origin: *, *).
// This plugin fetches via HTTP/2, pipes with backpressure, and returns clean headers.

import http2 from "node:http2";
import { pipeline } from "node:stream";

const STREAM_HOST = "livestream.bbnl.in";
const PREFIX = "/stream";
const SESSION_MAX_AGE = 600_000; // Rotate session every 10 minutes

let h2Session = null;
let sessionCreatedAt = 0;
let nextSession = null; // Pre-warmed replacement session
let activeRequestCount = 0;
let pingInterval = null;

function setupSessionHandlers(session, label) {
  session.on("error", (err) => {
    console.error(`[Stream Proxy] ${label} session error:`, err.message);
    if (session === h2Session) h2Session = null;
    if (session === nextSession) nextSession = null;
  });
  session.on("close", () => {
    if (h2Session === session) h2Session = null;
    if (nextSession === session) nextSession = null;
  });
  session.on("goaway", () => {
    console.log(`[Stream Proxy] ${label} GOAWAY — will reconnect`);
    if (session === h2Session) h2Session = null;
    if (session === nextSession) nextSession = null;
  });
}

function createSession() {
  return http2.connect(`https://${STREAM_HOST}`, {
    settings: { initialWindowSize: 8 * 1024 * 1024 }, // 8MB per-stream window
  });
}

function startPing() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (h2Session && !h2Session.closed && !h2Session.destroyed) {
      h2Session.ping(Buffer.alloc(8), (err) => {
        if (err) {
          console.error("[Stream Proxy] Ping failed, recycling session:", err.message);
          h2Session = null;
          if (pingInterval) clearInterval(pingInterval);
        }
      });
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
    nextSession = createSession();
    setupSessionHandlers(nextSession, "Pre-warm");
  }

  // If session is alive and fresh, reuse it
  if (alive && fresh) return h2Session;

  // If stale but requests still in flight, keep using it
  if (alive && !fresh && activeRequestCount > 0) return h2Session;

  // Let old session drain its in-flight streams, then close
  if (h2Session && !h2Session.closed) {
    const old = h2Session;
    setTimeout(() => { if (!old.closed) old.close(); }, 45_000);
  }

  // Swap to pre-warmed session if available
  if (nextSession && !nextSession.closed && !nextSession.destroyed) {
    console.log("[Stream Proxy] Swapping to pre-warmed HTTP/2 session");
    h2Session = nextSession;
    nextSession = null;
    sessionCreatedAt = now;
    startPing();
    return h2Session;
  }

  // Create new session
  console.log("[Stream Proxy] Opening new HTTP/2 session");
  h2Session = createSession();
  sessionCreatedAt = now;
  setupSessionHandlers(h2Session, "Main");
  startPing();
  return h2Session;
}

export default function streamProxyPlugin() {
  return {
    name: "stream-proxy",
    configureServer(server) {
      // Pre-warm the HTTP/2 session so first segment fetch is fast
      try { getSession(); } catch (_) {}

      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith(PREFIX)) return next();

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Range, Content-Type",
            "Access-Control-Max-Age": "86400",
          });
          res.end();
          return;
        }

        const streamPath = req.url.slice(PREFIX.length);

        let session;
        try {
          session = getSession();
        } catch (err) {
          console.error("[Stream Proxy] Connect error:", err.message);
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Stream proxy connection error");
          return;
        }

        activeRequestCount++;

        const h2Req = session.request({
          ":method": "GET",
          ":path": streamPath,
          ":authority": STREAM_HOST,
          "accept": "*/*",
        });

        // Abort stuck requests after 30s
        h2Req.setTimeout(30_000, () => {
          h2Req.close(http2.constants.NGHTTP2_CANCEL);
        });

        h2Req.on("response", (headers) => {
          if (res.headersSent) return;

          const status = headers[":status"] || 502;
          const short = streamPath.split("?")[0];

          if (status >= 400) {
            console.error(`[Stream Proxy] Upstream ${status} for ${short}`);
          }

          const outHeaders = {
            "Content-Type": headers["content-type"] || "application/octet-stream",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Cache-Control": "no-store",
          };
          // Forward Content-Length so browser can size its receive buffer
          if (headers["content-length"]) {
            outHeaders["Content-Length"] = headers["content-length"];
          }

          res.writeHead(status, outHeaders);

          // pipeline() handles backpressure and stream cleanup automatically
          pipeline(h2Req, res, (err) => {
            if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
              console.error("[Stream Proxy] pipe error:", err.message);
            }
          });
        });

        h2Req.on("close", () => {
          activeRequestCount = Math.max(0, activeRequestCount - 1);
        });

        h2Req.on("error", (err) => {
          if (err.code === "ERR_HTTP2_STREAM_CANCEL") return;
          console.error("[Stream Proxy] request error:", err.message);
          // DO NOT null the session here — individual stream errors should not
          // kill the whole session. Session-level error/goaway handlers cover real failures.
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain" });
          }
          if (!res.writableEnded) res.end("Stream proxy error");
        });

        h2Req.end();
      });
    },
  };
}
