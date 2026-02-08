import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import streamProxyPlugin from "./stream-proxy-plugin.js";

export default defineConfig({
  plugins: [
    react(),
    streamProxyPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
        suppressWarnings: true,
      },
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Fo-Fi - Free-to-Air Streaming",
        short_name: "Fo-Fi",
        description: "Watch free-to-air TV channels, live streams, and radio — anywhere, anytime.",
        theme_color: "#0000FF",
        background_color: "#0000FF",
        display: "standalone",
        display_override: ["standalone"],
        orientation: "portrait",
        scope: "/",
        start_url: "/home",
        categories: ["entertainment", "news"],
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/showimage/, /^\/adimage/, /^\/stream/],
        runtimeCaching: [
          {
            // API calls — network first, fallback to cache
            urlPattern: /\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Channel logos & ad images — cache first
            urlPattern: /\/(showimage|adimage)\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // External images (CDN etc.)
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "static-image-cache",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://124.40.244.211",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/netmon/cabletvapis"),
      },
      "/showimage": {
        target: "http://124.40.244.211/netmon/Cabletvapis",
        changeOrigin: true,
      },
      "/adimage": {
        target: "http://124.40.244.211/netmon/Cabletvapis",
        changeOrigin: true,
      },
    },
  },
});
