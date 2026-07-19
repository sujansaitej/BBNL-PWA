
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

function htaccessPlugin(basePath) {
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

  # If the requested file or directory exists, serve it directly
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
      htaccessPlugin(basePath),
      appleIconPlugin(appleIcon),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/logo.png', 'img/logo.png'],
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
          navigateFallbackDenylist: [/^\/api/, /^\/iptv-api/, /^\/showimage/, /^\/adimage/, /^\/usage-api/],
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
          name: 'Fo-Fi CRM',
          short_name: 'Fo-Fi',
          description: 'Fo-Fi CRM — Customer Relationship Management',
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
      drop: mode === 'production' ? ['debugger'] : [],
      pure: mode === 'production' ? ['console.log', 'console.debug', 'console.info'] : [],
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
      },
    }
  })
}
