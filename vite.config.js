
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path";
import { fileURLToPath } from "node:url";
import { VitePWA } from 'vite-plugin-pwa'
import streamProxyPlugin from "./stream-proxy-plugin.js"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generates .htaccess in dist/ with the correct RewriteBase
 * derived from VITE_API_APP_DIR_PATH. This replaces the static
 * public/.htaccess so test (/pwa/crm/) and prod (/smartphone/crm/)
 * builds both get the right SPA fallback.
 */
/**
 * Swap the apple-touch-icon filename in index.html at build time
 * so test builds get the dark icon and production gets the blue icon.
 */
function appleIconPlugin(appleIconFile) {
  return {
    name: 'swap-apple-icon',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/apple-icon-180\.png/g, appleIconFile);
    },
  };
}

/**
 * index.html hardcoded a preconnect/dns-prefetch to the PRODUCTION API host.
 * Every build shipped it, so the test and preproduction bundles opened a TLS
 * connection to production on boot and warmed nothing for the host they
 * actually talk to. Point the hint at whatever this build targets.
 */
function apiPreconnectPlugin(apiBaseUrl) {
  let origin = '';
  try { origin = new URL(apiBaseUrl).origin; } catch (_) { /* leave as authored */ }
  return {
    name: 'retarget-api-preconnect',
    apply: 'build',
    transformIndexHtml(html) {
      if (!origin) return html;
      return html.replace(/https:\/\/bbnlnetmon\.bbnl\.in/g, origin);
    },
  };
}

function htaccessPlugin(basePath, acsUrl, qr, emitEzpay) {
  return {
    name: 'generate-htaccess',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '.htaccess',
        source: `<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase ${basePath}

  # ── TR-069 ACS proxy ──────────────────────────────────────────────
  # The ACS is plain http:// on port 7557 and sends no CORS headers, so the
  # browser cannot call it directly (mixed content AND CORS). It has to be
  # reached through a same-origin path, and this is that path.
  #
  # Shipped here rather than left to the vhost because the SPA fallback below
  # would otherwise swallow it: an unmatched /acs-api request is neither a file
  # nor a directory, so it gets rewritten to index.html and answered with
  # HTTP 200 and an HTML body. The PWA then fails on JSON.parse and — before
  # this rule existed — reported it as "the ACS server returned an invalid
  # response", pointing the reader at a machine that was never contacted.
  #
  # Needs mod_proxy + mod_proxy_http loaded and AllowOverride FileInfo.
  #
  # NE (noescape) matters here. Our queries carry a URL-encoded JSON object —
  # ?query=%7B%22_id%22%3A...%7D — and without NE mod_rewrite re-escapes the
  # substitution, turning %7B into %257B. GenieACS then searches for a device
  # literally named "%7B..." , matches nothing, and answers with something the
  # client cannot parse.
  <IfModule mod_proxy.c>
    # GenieACS STREAMS its device list: it writes "[\\n", then each device as the
    # Mongo cursor yields it, then "\\n]". There is no Content-Length, so the
    # response is chunked — and Apache's proxy truncating that stream after the
    # first flush is a well-known failure mode, seen here as a 2-byte body
    # containing just "[\\n".
    #
    # Asking the backend for HTTP/1.0 removes chunked encoding from the equation
    # (the backend buffers and signals the end by closing), and disabling
    # keepalive stops Apache reusing a connection the ACS considers finished.
    SetEnv force-proxy-request-1.0 1
    SetEnv proxy-nokeepalive 1
    RewriteRule ^acs-api/?(.*)$ ${acsUrl}$1 [P,QSA,NE,L]
  </IfModule>

  # If mod_proxy is unavailable the rule above never fires. Fail loudly with a
  # 502 rather than silently serving the SPA shell, so the cause is obvious.
  RewriteRule ^acs-api($|/) - [R=502,L]

  # ── Netmon QR / SSO proxy ─────────────────────────────────────────
  # The QrcodeAuthentication service matches its credential headers
  # CASE-SENSITIVELY — only exactly Authorization, username, password
  # are accepted; anything else returns the bare body 'failed' at HTTP 200.
  # Browsers ALWAYS lowercase header names (the Fetch API normalises them,
  # and JavaScript cannot override it), so the service is unreachable from a
  # browser no matter what the app sends. Android is unaffected only because
  # OkHttp transmits the casing Retrofit was given.
  #
  # Apache can send the casing the service wants, so the request goes through
  # here and mod_headers attaches the credentials on the way out. That also
  # keeps them OUT of the JavaScript bundle, where they were readable by
  # anyone with devtools.
  #
  # Needs mod_proxy + mod_proxy_http + mod_headers, and AllowOverride FileInfo.
  SetEnvIf Request_URI "qr-api/" QRPROXY=1
  <IfModule mod_headers.c>
    RequestHeader set Authorization "${qr.authKey}" env=QRPROXY
    RequestHeader set username "${qr.username}" env=QRPROXY
    RequestHeader set password "${qr.password}" env=QRPROXY
  </IfModule>
  <IfModule mod_proxy.c>
    RewriteRule ^qr-api/?(.*)$ ${qr.origin}/QrcodeAuthentication/$1 [P,QSA,L]
  </IfModule>

  # Same reasoning as acs-api: fail loudly instead of serving the SPA shell,
  # which would surface as a JSON parse error pointing nowhere useful.
  RewriteRule ^qr-api($|/) - [R=502,L]

${emitEzpay ? `  # ── Easebuzz checkout proxy — TEST BUILDS ONLY ────────────────────
  # payment/initiateLink is a SERVER-TO-SERVER endpoint: it sends no CORS
  # headers, so the browser cannot call testpay.easebuzz.in directly and has to
  # reach it through a same-origin path. The vite dev proxy and server.js both
  # already carry this seam; without it here, the Apache-hosted TEST build
  # answered the POST with the SPA shell at HTTP 200 (measured 2026-08-31 on
  # netmontest: 10462 bytes of text/html) and checkout died on JSON.parse.
  #
  # DELIBERATELY ABSENT FROM PRODUCTION AND PREPROD BUILDS.
  # Those hosts ALREADY proxy this at the VHOST level — verified the same day,
  # bbnlnetmon and bbnlpwa both answered the same probe with a real Easebuzz
  # body ("Invalid merchant key"), not the SPA shell. Emitting a second,
  # per-directory proxy over a working vhost one buys nothing and risks the one
  # flow that must not break. Only the test host lacks it, so only the test
  # build ships it. See htaccessPlugin's emitEzpay argument.
  #
  # !! REQUIRES SSLProxyEngine On IN THE VHOST !!
  # Unlike acs-api and qr-api, this target MUST be https — Easebuzz publishes
  # no http endpoint, and card traffic must not be downgraded. RewriteRule [P]
  # to an https backend needs SSLProxyEngine, which is a vhost-level directive
  # that .htaccess CANNOT set; without it Apache answers 500. If you cannot
  # enable it, put the equivalent ProxyPass in the test vhost instead (which is
  # what production does), or host the bundle with server.js, which proxies
  # this itself.
  <IfModule mod_proxy.c>
    RewriteRule ^ezpay-test/?(.*)$ https://testpay.easebuzz.in/$1 [P,QSA,L]
  </IfModule>

  # Same reasoning again — a missing mod_proxy must not look like a payment
  # failure. 502 says "the seam is not wired", which is the actual fault.
  RewriteRule ^ezpay-test($|/) - [R=502,L]

` : ``}  # If the requested file or directory exists, serve it directly
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d

  # Otherwise, redirect everything to index.html (SPA fallback)
  RewriteRule . index.html [L]
</IfModule>
`,
      });
    },
  };
}

export default ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // IPTV auth headers — needed by /showimage and /adimage endpoints
  const iptvAuth = "Basic " + Buffer.from(
    `${env.VITE_IPTV_API_USERNAME || ""}:${env.VITE_IPTV_API_PASSWORD || ""}`
  ).toString("base64");
  const iptvKey = env.VITE_IPTV_API_AUTH_KEY || "";

  function addIptvAuth(proxy) {
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.setHeader("Authorization", iptvAuth);
      proxyReq.setHeader("x-api-key", iptvKey);
    });
  }

  const basePath = env.VITE_API_APP_DIR_PATH || '/';
  const isTest = mode === 'test';

  // ── Easebuzz gateway guard ────────────────────────────────────────
  // THE BUG THIS EXISTS TO PREVENT SHIPPED, and cost every production payment.
  //
  // easebuzz.js derives its gateway from `MODE === "production" ? "prod"
  // : "test"`. The mode NAME is not the deployment target. The bundle live on
  // bbnlnetmon on 3 Aug 2026 was built under a non-production mode while
  // carrying production values throughout, so EZ_ENV folded to "test": it used
  // the SANDBOX key and posted to the ezpay-test seam. bbnlnetmon proxies only
  // ezpay-prod, so that seam answered 403 and initiateLink threw
  // "Could not start payment (HTTP 403)" on the first step of every payment.
  //
  // Each .env now states VITE_EASEBUZZ_ENV outright. These two checks make a
  // missing or contradictory value a BUILD FAILURE rather than a silent
  // downgrade discovered in production.
  const ezEnv = String(env.VITE_EASEBUZZ_ENV || '').toLowerCase();
  if (!ezEnv) {
    throw new Error(
      `[easebuzz] VITE_EASEBUZZ_ENV is not set for mode "${mode}". Set it to ` +
      `"prod" or "test" in .env.${mode} — leaving it unset makes the gateway ` +
      `follow the build's MODE NAME, which is how a production deployment ` +
      `silently ended up on the sandbox.`
    );
  }
  if (!['prod', 'test'].includes(ezEnv)) {
    throw new Error(`[easebuzz] VITE_EASEBUZZ_ENV must be "prod" or "test", got "${ezEnv}".`);
  }
  if (mode === 'production' && ezEnv !== 'prod') {
    throw new Error(
      `[easebuzz] a production build must use the live gateway, but ` +
      `VITE_EASEBUZZ_ENV is "${ezEnv}". Refusing to build a production bundle ` +
      `that would take payments through the sandbox.`
    );
  }
  // Preproduction rehearses the PRODUCTION artifact, so it strips the same
  // calls. Gated on mode === 'production' alone, a preprod bundle would keep
  // console.log and stop being a faithful rehearsal — and any log-based
  // check would pass on preprod and silently vanish in prod.
  const STRIPPED_BUILD = mode === 'production' || mode === 'preprod';
  // Test build: dark/black icons — Production build: blue icons
  const iconPrefix = isTest ? 'icon-192-test' : 'icon-192';
  const iconPrefix512 = isTest ? 'icon-512-test' : 'icon-512';
  const appleIcon = isTest ? 'apple-icon-180-test.png' : 'apple-icon-180.png';

  // Unique build stamp — used by client-side cache health check to detect
  // when the running app is stale after a new deployment.
  const buildId = Date.now().toString(36);

  return defineConfig({
    define: {
      'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(buildId),
    },
    plugins: [
      react(),
      streamProxyPlugin(),
      htaccessPlugin(basePath, env.VITE_ACS_URL || "http://acs.bfnl.services:7557/devices/", {
        // Same origin the API lives on — the QR service sits at that host's root.
        // MUST be http:// — RewriteRule [P] to https:// needs SSLProxyEngine,
        // which .htaccess cannot set, and Apache answers 500. See .env notes.
        origin: env.VITE_QR_PROXY_UPSTREAM
          || (() => { try { return new URL(env.VITE_API_BASE_URL).origin; } catch (_) { return ""; } })(),
        authKey: env.VITE_WEBLOGIN_AUTH_KEY || "",
        username: env.VITE_WEBLOGIN_USERNAME || "",
        password: env.VITE_WEBLOGIN_PASSWORD || "",
      },
        // Emit the Easebuzz seam for the TEST build only. bbnlnetmon and
        // bbnlpwa already proxy ezpay at the vhost level (both answered a
        // probe with a real Easebuzz body, 2026-08-31); netmontest does not
        // and served the SPA shell instead. Shipping a second proxy to hosts
        // that already have a working one is pure risk on the money path.
        isTest),
      appleIconPlugin(appleIcon),
      apiPreconnectPlugin(env.VITE_API_BASE_URL || ''),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/logo.png', 'img/logo.png', 'img/logo-white.png'],
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Activate new SW immediately — don't wait for all tabs to close
          skipWaiting: true,
          clientsClaim: true,
          // Don't precache heavy lazy-loaded chunks — they'll be runtime-cached
          // on first use via the StaleWhileRevalidate rule below.
          // Precaching ~1.4MB of rarely-used libraries (HLS, PDF, Maps, Swiper,
          // Framer-Motion) forces Android Chrome to download them ALL on first
          // visit, even if the user never opens those features.
          globIgnores: ['**/hls-*.js', '**/maps-*.js', '**/pdf-*.js', '**/swiper-*.js', '**/animations-*.js'],
          // Navigation Preload: fires network request in parallel with SW boot.
          // Saves 50-100ms on Android Chrome where SW startup is slow.
          // vite-plugin-pwa doesn't expose Workbox's navigationPreload option,
          // so we inject a small activate listener via importScripts.
          importScripts: [basePath + 'sw-nav-preload.js', basePath + 'sw-api-cache.js'],
          // Navigate to cached shell for SPA offline support
          navigateFallback: basePath + 'index.html',
          // /acs-api is live device state — a service-worker-cached "Online" is
          // worse than no answer, so it must never be served from a cache.
          navigateFallbackDenylist: [/^\/api/, /^\/iptv-api/, /^\/showimage/, /^\/adimage/, /^\/usage-api/, /acs-api/],
          // Runtime caching strategies for Android Chrome performance
          runtimeCaching: [
            // IPTV channel logos & ad images — CacheFirst
            // Serves cached logos instantly; only hits the network on a cache miss.
            // Matches: /showimage/ and /adimage/ paths (production server).
            {
              urlPattern: /\/(?:showimage|adimage)\//i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'channel-assets-v4',
                // 500 entries = 275 channel logos + ~30 language logos + ~50 ad images + headroom
                expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // JS/CSS app assets — Stale-While-Revalidate (instant load, background refresh)
            // Only cache real 200 responses — opaque (0) responses could be error pages
            // masquerading as JS, which would permanently break the app with CacheFirst.
            {
              urlPattern: /\.(?:js|css)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'app-assets',
                expiration: { maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Static images (icons, splash, favicons) — Cache-First (never re-fetch until expired)
            {
              urlPattern: /\/icons\/.*\.(?:png|jpg|svg|ico|webp)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'static-icons',
                expiration: { maxEntries: 40, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // General images — Cache-First with shorter expiry
            {
              urlPattern: /\.(?:png|jpg|jpeg|gif|svg|webp|ico)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: { maxEntries: 120, maxAgeSeconds: 14 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Google Fonts stylesheets — Stale-While-Revalidate
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-stylesheets',
                expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Google Fonts webfont files — Cache-First (font files rarely change)
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        manifest: {
          id: basePath,
          name: 'BBNL CRM',
          // short_name is what Android/iOS print under the home-screen icon.
          // Keep it to a single word — longer labels are ellipsised by the
          // launcher, which is how "Fo-Fi CRM" used to render as "Fo-Fi C…".
          short_name: 'BBNL',
          description: 'BBNL CRM — Customer Relationship Management',
          start_url: basePath,
          scope: basePath,
          display: 'standalone',
          background_color: '#0f172a',
          theme_color: '#0f172a',
          icons: [
            { src: basePath + `icons/${iconPrefix}.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: basePath + `icons/${iconPrefix512}.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: basePath + `icons/${iconPrefix}.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: basePath + `icons/${iconPrefix512}.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        }
      })
    ],
    base: env.VITE_API_APP_DIR_PATH,
    esbuild: {
      drop: STRIPPED_BUILD ? ['debugger'] : [],
      pure: STRIPPED_BUILD ? ['console.log', 'console.debug', 'console.info'] : [],
    },
    build: {
      // Explicit downlevel target so older mobile WebViews in the field
      // (iOS 14 Safari, Android Chrome 87) can parse the shipped bundles.
      // Without this, Vite's default `modules` target uses features (class
      // fields, logical assignment, some private-method forms) that parse-
      // error on those older browsers, which shows up as the app "loading
      // fine on one phone and blank on another". esbuild downlevels to
      // meet the most restrictive target in this list.
      target: ['es2019', 'safari14', 'chrome87', 'firefox78', 'edge88'],
      // Suppress Vite's eager <link rel="modulepreload"> for heavy chunks.
      // Without this, Vite injects modulepreload hints for pdf (574KB),
      // maps (146KB), animations (120KB), hls (509KB), swiper (68KB) into
      // index.html — causing the browser to download & parse ~1.4MB of JS
      // on EVERY page load even though those chunks are lazy-loaded.
      // Only vendor-react (the shared runtime) should be eagerly preloaded.
      modulePreload: {
        resolveDependencies(filename, deps) {
          // Only preload the entry chunk's own direct imports
          // Heavy library chunks (loaded via lazy()) will load on demand
          const heavyChunks = ['hls', 'maps', 'pdf', 'swiper', 'animations'];
          return deps.filter(dep =>
            !heavyChunks.some(name => dep.includes(name))
          );
        },
      },
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            'hls': ['hls.js'],
            'maps': ['leaflet', 'leaflet-geometryutil'],
            'pdf': ['jspdf', 'html2canvas'],
            'swiper': ['swiper'],
            'animations': ['framer-motion'],
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          }
        }
      }
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      allowedHosts: ["46af63302b70.ngrok-free.app"],
      proxy: {
        "/iptv-api": {
          target: "http://124.40.244.211/netmon/",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/iptv-api/, ""),
          configure: addIptvAuth,
        },
        "/showimage": {
          target: "http://124.40.244.211",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => `/netmon/Cabletvapis${path}`,
          configure: addIptvAuth,
        },
        "/adimage": {
          target: "http://124.40.244.211",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => `/netmon/Cabletvapis${path}`,
          configure: addIptvAuth,
        },
        "/api": {
          target: "http://124.40.244.211/netmon/",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        // Easebuzz initiateLink is server-to-server (no CORS). Proxy it
        // same-origin so the browser can obtain an access_key. Paths live under
        // the app base so they route like the app; server.js mirrors this in
        // prod (the PHP backend is untouched).
        [`${basePath}ezpay-test`.replace(/\/{2,}/g, "/")]: {
          target: "https://testpay.easebuzz.in",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(new RegExp(`^${basePath}ezpay-test`.replace(/\/{2,}/g, "/")), ""),
        },
        [`${basePath}ezpay-prod`.replace(/\/{2,}/g, "/")]: {
          target: "https://pay.easebuzz.in",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(new RegExp(`^${basePath}ezpay-prod`.replace(/\/{2,}/g, "/")), ""),
        },
        // Data usage report lives on payurbills.co.in, a third-party host that
        // returns a STATIC `Access-Control-Allow-Origin: https://bbnl.co.in`
        // regardless of the requesting Origin (verified against the live
        // endpoint). No browser origin but bbnl.co.in can ever read that
        // response, so this cannot be fixed client-side — Android only works
        // because native HTTP has no CORS. Proxy it same-origin.
        // Same arrangement as /ezpay-* above: path under the app base, mirrored
        // by server.js in prod (the PHP backend is untouched).
        [`${basePath}usage-api`.replace(/\/{2,}/g, "/")]: {
          target: "https://payurbills.co.in/best2/General/",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(new RegExp(`^${basePath}usage-api`.replace(/\/{2,}/g, "/")), ""),
        },
        // ── TR-069 ACS (GenieACS northbound interface) ──
        // The ACS is plain http:// on port 7557 and sends no Access-Control-*
        // headers, so a browser on an https:// origin is blocked twice over:
        // mixed content AND CORS. Neither is fixable client-side. Same
        // same-origin seam as /usage-api above; server.js mirrors it in prod.
        //
        // SECURITY: the NBI has no authentication of its own, so this proxy is
        // the only thing standing between a browser and the whole device fleet.
        // server.js restricts the prod seam to the device collection; keep this
        // dev target pointed at /devices/ for the same reason.
        [`${basePath}acs-api`.replace(/\/{2,}/g, "/")]: {
          target: env.VITE_ACS_URL || "http://acs.bfnl.services:7557/devices/",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(new RegExp(`^${basePath}acs-api`.replace(/\/{2,}/g, "/")), ""),
        },
        // ── Netmon QR / SSO seam ──
        // The .htaccess above only exists in a BUILD. Without this, "Scan To
        // Login" and "Login To Netmon" are dead in `npm run dev`: the request
        // matches no proxy, vite serves index.html at HTTP 200, and qrAuth
        // reports an HTML body it cannot parse. server.js mirrors this seam so
        // a Node-hosted build behaves the same way.
        //
        // The credentials are attached here rather than in the browser because
        // the QrcodeAuthentication service matches header names
        // CASE-SENSITIVELY (`Authorization`, `username`, `password`) and the
        // Fetch API lowercases them with no way to opt out. Node's
        // setHeader preserves the casing it is given, so this hop can satisfy
        // it where the browser never can.
        [`${basePath}qr-api`.replace(/\/{2,}/g, "/")]: {
          target: env.VITE_QR_PROXY_UPSTREAM
            || (() => { try { return new URL(env.VITE_API_BASE_URL).origin; } catch (_) { return "http://124.40.244.211"; } })(),
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(
            new RegExp(`^${basePath}qr-api`.replace(/\/{2,}/g, "/")),
            "/QrcodeAuthentication"
          ),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Authorization", env.VITE_WEBLOGIN_AUTH_KEY || "");
              proxyReq.setHeader("username", env.VITE_WEBLOGIN_USERNAME || "");
              proxyReq.setHeader("password", env.VITE_WEBLOGIN_PASSWORD || "");
            });
          },
        },
      },
    }
  })
}
