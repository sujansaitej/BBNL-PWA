
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path";
import { VitePWA } from 'vite-plugin-pwa'
import streamProxyPlugin from "./stream-proxy-plugin.js"

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

  return defineConfig({
    plugins: [
      react(),
      streamProxyPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/logo.png'],
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
          navigateFallbackDenylist: [/^\/api/, /^\/iptv-api/, /^\/showimage/, /^\/adimage/],
          // Runtime caching strategies for Android Chrome performance
          runtimeCaching: [
            // IPTV channel logos & ad images — CacheFirst
            // Serves cached logos instantly; only hits the network on a
            // cache miss.  Channel logos rarely change so CacheFirst avoids
            // unnecessary background refetches for 275+ images.
            // Matches both dev relative paths (/showimage/...) and
            // production cross-origin URLs (.../Cabletvapis/showimage/...).
            // Auth headers from fetchImage() are preserved on the Request
            // object, so Workbox forwards them on cache-miss network calls.
            {
              urlPattern: /\/(?:showimage|adimage)\//i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'channel-assets-v1',
                expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // JS/CSS app assets — Stale-While-Revalidate (instant load, background refresh)
            {
              urlPattern: /\.(?:js|css)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'app-assets',
                expiration: { maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Static images (icons, splash, favicons) — Cache-First (never re-fetch until expired)
            {
              urlPattern: /\/icons\/.*\.(?:png|jpg|svg|ico|webp)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'static-icons',
                expiration: { maxEntries: 40, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // General images — Cache-First with shorter expiry
            {
              urlPattern: /\.(?:png|jpg|jpeg|gif|svg|webp|ico)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: { maxEntries: 120, maxAgeSeconds: 14 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
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
            { src: basePath + 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: basePath + 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
          ]
        }
      })
    ],
    base: env.VITE_API_APP_DIR_PATH,
    esbuild: {
      drop: mode === 'production' ? ['debugger'] : [],
      pure: mode === 'production' ? ['console.log', 'console.debug', 'console.info', 'console.warn', 'console.error'] : [],
    },
    build: {
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
          target: "https://netmontest.bbnl.in/netmon/",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    }
  })
}
