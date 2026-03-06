import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import PrivateRoute from "./PrivateRoute";
import ErrorBoundary from "../components/ErrorBoundary";

// Lightweight loading fallback
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
  </div>
);

// Safe sessionStorage helpers — never throw (Safari private browsing, quota full)
function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
function ssRemove(k) { try { sessionStorage.removeItem(k); } catch (_) {} }

// Retry wrapper for lazy imports — handles chunk 404s after deployments.
// On failure it purges stale caches + reloads once so the browser fetches
// fresh chunk filenames. If the reload already happened, the error
// propagates to ErrorBoundary which shows a user-friendly recovery UI.
function lazyRetry(importFn) {
  return lazy(() =>
    importFn()
      .then((mod) => {
        // Successful load — clear the retry flag so future deploys can also retry
        ssRemove("chunk-reload");
        return mod;
      })
      .catch((err) => {
        const key = "chunk-reload";
        if (!ssGet(key)) {
          ssSet(key, "1");
          // Purge runtime caches that may hold stale chunk references,
          // then reload to fetch fresh assets from the server.
          (async () => {
            try {
              if ("caches" in window) {
                const names = await caches.keys();
                const stale = names.filter(
                  (n) => n === "app-assets" || n.startsWith("workbox-precache")
                );
                await Promise.allSettled(stale.map((n) => caches.delete(n)));
              }
            } catch (_) {}
            window.location.reload();
          })();
          return new Promise(() => {}); // never resolves — page is reloading
        }
        ssRemove(key);
        // Already retried — let ErrorBoundary handle it
        throw err;
      })
  );
}

// Lazy-loaded pages — each becomes its own chunk, downloaded only when visited
const Login = lazyRetry(() => import("../pages/Login"));
const Dashboard = lazyRetry(() => import("../pages/Dashboard"));
const Profile = lazyRetry(() => import("../pages/Profile"));
const VerifyOTP = lazyRetry(() => import("../pages/VerifyOTP"));
const Register = lazyRetry(() => import("../pages/Register"));
const Plans = lazyRetry(() => import("../pages/Plans"));
const Subscribe = lazyRetry(() => import("../pages/Subscribe"));
const Paynow = lazyRetry(() => import("../pages/Paynow"));
const Customers = lazyRetry(() => import("../pages/Customerlist"));
const Tickets = lazyRetry(() => import("../pages/Tickets"));
const TicketsMap = lazyRetry(() => import("../pages/TicketsMap"));
const Support = lazyRetry(() => import("../pages/Support"));
const Services = lazyRetry(() => import("../pages/Services"));
const InternetService = lazyRetry(() => import("../pages/services/InternetService"));
const VoiceService = lazyRetry(() => import("../pages/services/VoiceService"));
const FoFiSmartBox = lazyRetry(() => import("../pages/services/FoFiSmartBox"));
const IPTVService = lazyRetry(() => import("../pages/services/IPTVService"));
const PaymentHistory = lazyRetry(() => import("../pages/PaymentHistory"));
const UploadDocuments = lazyRetry(() => import("../pages/UploadDocuments"));
const FofiPayment = lazyRetry(() => import("../pages/FofiPayment"));
const CustomerDashboard = lazyRetry(() => import("../pages/customer/Dashboard"));
const LiveTvPage = lazyRetry(() => import("../pages/iptv/LiveTvPage"));
const ChannelsPage = lazyRetry(() => import("../pages/iptv/ChannelsPage"));
const LanguagesPage = lazyRetry(() => import("../pages/iptv/LanguagesPage"));
const PlayerPage = lazyRetry(() => import("../pages/iptv/PlayerPage"));

export default function AppRoutes() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/verify-otp"
          element={
            <PrivateRoute>
              <VerifyOTP />
            </PrivateRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <Profile />
            </PrivateRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PrivateRoute>
              <Register />
            </PrivateRoute>
          }
        />
        <Route
          path="/plans"
          element={
            <PrivateRoute>
              <Plans />
            </PrivateRoute>
          }
        />
        <Route
          path="/subscribe"
          element={
            <PrivateRoute>
              <Subscribe />
            </PrivateRoute>
          }
        />
        <Route
          path="/paynow"
          element={
            <PrivateRoute>
              <Paynow />
            </PrivateRoute>
          }
        />
        <Route
          path="/payment"
          element={
            <PrivateRoute>
              <Paynow />
            </PrivateRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <PrivateRoute>
              <Customers />
            </PrivateRoute>
          }
        />
        <Route
          path="/tickets"
          element={
            <PrivateRoute>
              <Tickets />
            </PrivateRoute>
          }
        />
        <Route
          path="/support"
          element={
            <PrivateRoute>
              <Support />
            </PrivateRoute>
          }
        />
        <Route
          path="/smart-map"
          element={
            <PrivateRoute>
              <TicketsMap />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/dashboard"
          element={
            <PrivateRoute>
              <CustomerDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/customer/:customerId/services"
          element={
            <PrivateRoute>
              <Services />
            </PrivateRoute>
          }
        />
        <Route
          path="/customer/:customerId/service/internet"
          element={
            <PrivateRoute>
              <InternetService />
            </PrivateRoute>
          }
        />
        <Route
          path="/customer/:customerId/service/voice"
          element={
            <PrivateRoute>
              <VoiceService />
            </PrivateRoute>
          }
        />
        <Route
          path="/customer/:customerId/service/fofi-smart-box"
          element={
            <PrivateRoute>
              <FoFiSmartBox />
            </PrivateRoute>
          }
        />
        <Route
          path="/customer/:customerId/service/iptv"
          element={
            <PrivateRoute>
              <IPTVService />
            </PrivateRoute>
          }
        />
        <Route
          path="/payment-history"
          element={
            <PrivateRoute>
              <PaymentHistory />
            </PrivateRoute>
          }
        />
        <Route
          path="/upload-documents"
          element={
            <PrivateRoute>
              <UploadDocuments />
            </PrivateRoute>
          }
        />
        <Route
          path="/fofi-payment"
          element={
            <PrivateRoute>
              <FofiPayment />
            </PrivateRoute>
          }
        />

        {/* ── IPTV Live TV Routes (no auth required) ── */}
        <Route path="/cust/livetv" element={<LiveTvPage />} />
        <Route path="/cust/livetv/channels" element={<ChannelsPage />} />
        <Route path="/cust/livetv/languages" element={<LanguagesPage />} />
        <Route path="/cust/livetv/player" element={<PlayerPage />} />

        {/* Catch-all: redirect any undefined route to login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
