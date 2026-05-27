const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4180);
const BASE = "/smartphone/crm";
const API_PREFIX = "/prod/";
const API_TARGET = "https://bbnlnetmon.bbnl.in/prod/";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function proxyApi(req, res) {
  const target = new URL(req.url.replace(/^\/prod\//, ""), API_TARGET);
  const headers = { ...req.headers, host: target.host, origin: undefined, referer: undefined };
  const upstream = https.request(target, { method: req.method, headers }, (apiRes) => {
    res.writeHead(apiRes.statusCode || 502, {
      ...apiRes.headers,
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,username,password,appkeytype,appversion,x-app-package,content-type",
    });
    apiRes.pipe(res);
  });
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("Proxy error: " + err.message);
  });
  req.pipe(upstream);
}

function serveFile(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath.startsWith(BASE)) urlPath = urlPath.slice(BASE.length) || "/";
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(file);
  if (!ext || !fs.existsSync(file)) file = path.join(DIST, "index.html");
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,username,password,appkeytype,appversion,x-app-package,content-type",
    });
    res.end();
    return;
  }
  if (req.url.startsWith(API_PREFIX)) return proxyApi(req, res);
  serveFile(req, res);
}).listen(PORT, () => {
  console.log(`Local production preview: http://localhost:${PORT}${BASE}/login`);
});
