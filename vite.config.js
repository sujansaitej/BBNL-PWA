
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
      pure: mode === 'production' ? ['console.log', 'console.debug'] : [],
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            'hls': ['hls.js'],
            'maps': ['leaflet', 'leaflet-geometryutil'],
            'pdf': ['jspdf', 'html2canvas'],
            'swiper': ['swiper'],
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
