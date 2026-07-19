import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import PrivateRoute from "./PrivateRoute";
import ErrorBoundary from "../components/ErrorBoundary";
import Services from "../pages/Services";

// Redirect unknown service routes back to the customer's services list
function ServiceFallback() {
  const { customerId } = useParams();
  return <Navigate to={`/customer/${customerId}/services`} replace />;
}

// Lightweight loading fallback
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-dvh">
    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
  </div>
);

// Safe sessionStorage helpers — never throw (Safari private browsing, quota full)
function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
function ssRemove(k) { try { sessionStorage.removeItem(k); } catch (_) {} }

// Retry wrapper for lazy imports — handles chunk 404s after deployments.
// On failure it lets ErrorBoundary handle recovery (single retry path).
// Previous approach had two independent retry loops (lazyRetry + ErrorBoundary)
// with separate guard keys, causing up to 4 reloads before showing the error UI.
function lazyRetry(importFn) {
  return lazy(() =>
    importFn()
      .then((mod) => {
        ssRemove("chunk-reload");
        return mod;
      })
      .catch((err) => {
        // Let ErrorBoundary handle all recovery (it purges caches + reloads once).
        // This avoids a double-retry loop between lazyRetry and ErrorBoundary.
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
const InternetService = lazyRetry(() => import("../pages/services/InternetService"));
const VoiceService = lazyRetry(() => import("../pages/services/VoiceService"));
const FoFiSmartBox = lazyRetry(() => import("../pages/services/FoFiSmartBox"));
const IPTVService = lazyRetry(() => import("../pages/services/IPTVService"));
const PaymentHistory = lazyRetry(() => import("../pages/PaymentHistory"));
const OrderDetail = lazyRetry(() => import("../pages/OrderDetail"));
const UploadDocuments = lazyRetry(() => import("../pages/UploadDocuments"));
const FofiPayment = lazyRetry(() => import("../pages/FofiPayment"));
const CustomerDashboard = lazyRetry(() => import("../pages/customer/Dashboard"));
const CustomerProfile = lazyRetry(() => import("../pages/customer/Profile"));
const CustomerServiceLink = lazyRetry(() => import("../pages/customer/ServiceLink"));
const CustomerServiceHome = lazyRetry(() => import("../pages/customer/ServiceHome"));
const CustomerOrderHistory = lazyRetry(() => import("../pages/customer/OrderHistory"));
const CustomerPaymentSummary = lazyRetry(() => import("../pages/customer/PaymentSummary"));
const CustomerPaymentStatus = lazyRetry(() => import("../pages/customer/PaymentStatus"));
const CustomerInternetPayment = lazyRetry(() => import("../pages/customer/InternetPaymentSummary"));
const CustomerRaiseTicket = lazyRetry(() => import("../pages/customer/RaiseTicket"));
const CustomerTicketStatus = lazyRetry(() => import("../pages/customer/TicketStatus"));
const CustomerDataUsage = lazyRetry(() => import("../pages/customer/DataUsage"));
const CustomerPayments = lazyRetry(() => import("../pages/customer/CustomerPayments"));
const OTTHub = lazyRetry(() => import("../pages/customer/OTTHub"));
const OTTPlayer = lazyRetry(() => import("../pages/customer/OTTPlayer"));
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
          path="/cust/profile"
          element={
            <PrivateRoute>
              <CustomerProfile />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet"
          element={
            <PrivateRoute>
              <CustomerServiceLink keyword="internet" />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet/home"
          element={
            <PrivateRoute>
              <CustomerServiceHome />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet/pay"
          element={
            <PrivateRoute>
              <CustomerInternetPayment />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet/pay/status"
          element={
            <PrivateRoute>
              <CustomerPaymentStatus />
            </PrivateRoute>
          }
        />

        {/* ── FoFi Smart Box (servicekey: fofi) ── */}
        <Route
          path="/cust/fofi"
          element={
            <PrivateRoute>
              <CustomerServiceLink keyword="fofi" />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/fofi/home"
          element={
            <PrivateRoute>
              <CustomerServiceHome />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/fofi/orders"
          element={
            <PrivateRoute>
              <CustomerOrderHistory />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/fofi/pay"
          element={
            <PrivateRoute>
              <CustomerPaymentSummary />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/fofi/pay/status"
          element={
            <PrivateRoute>
              <CustomerPaymentStatus />
            </PrivateRoute>
          }
        />

        {/* ── IPTV (servicekey: cabletv) ── */}
        <Route
          path="/cust/iptv"
          element={
            <PrivateRoute>
              <CustomerServiceLink keyword="cabletv" />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/iptv/home"
          element={
            <PrivateRoute>
              <CustomerServiceHome />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/iptv/orders"
          element={
            <PrivateRoute>
              <CustomerOrderHistory />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/iptv/pay"
          element={
            <PrivateRoute>
              <CustomerPaymentSummary />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/iptv/pay/status"
          element={
            <PrivateRoute>
              <CustomerPaymentStatus />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet/raise-ticket"
          element={
            <PrivateRoute>
              <CustomerRaiseTicket />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet/ticket-status"
          element={
            <PrivateRoute>
              <CustomerTicketStatus />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet/usage"
          element={
            <PrivateRoute>
              <CustomerDataUsage />
            </PrivateRoute>
          }
        />
        <Route
          path="/cust/internet/payments"
          element={
            <PrivateRoute>
              <CustomerPayments />
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
        {/* Catch-all for undefined service routes — redirect back to services list instead of login */}
        <Route
          path="/customer/:customerId/service/*"
          element={
            <PrivateRoute>
              <ServiceFallback />
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
          path="/payment-history/order"
          element={
            <PrivateRoute>
              <OrderDetail />
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

        {/* ── OTT Routes ── */}
        <Route path="/cust/ott" element={<OTTHub />} />
        <Route path="/cust/ott/player" element={<OTTPlayer />} />

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
