import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import PrivateRoute from "./PrivateRoute";

// Lightweight loading fallback
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
  </div>
);

// Lazy-loaded pages — each becomes its own chunk, downloaded only when visited
const Login = lazy(() => import("../pages/Login"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const Profile = lazy(() => import("../pages/Profile"));
const VerifyOTP = lazy(() => import("../pages/VerifyOTP"));
const Register = lazy(() => import("../pages/Register"));
const Plans = lazy(() => import("../pages/Plans"));
const Subscribe = lazy(() => import("../pages/Subscribe"));
const Paynow = lazy(() => import("../pages/Paynow"));
const Customers = lazy(() => import("../pages/Customerlist"));
const Tickets = lazy(() => import("../pages/Tickets"));
const TicketsMap = lazy(() => import("../pages/TicketsMap"));
const Support = lazy(() => import("../pages/Support"));
const Services = lazy(() => import("../pages/Services"));
const InternetService = lazy(() => import("../pages/services/InternetService"));
const VoiceService = lazy(() => import("../pages/services/VoiceService"));
const FoFiSmartBox = lazy(() => import("../pages/services/FoFiSmartBox"));
const IPTVService = lazy(() => import("../pages/services/IPTVService"));
const PaymentHistory = lazy(() => import("../pages/PaymentHistory"));
const UploadDocuments = lazy(() => import("../pages/UploadDocuments"));
const FofiPayment = lazy(() => import("../pages/FofiPayment"));
const CustomerDashboard = lazy(() => import("../pages/customer/Dashboard"));
const LiveTvPage = lazy(() => import("../pages/iptv/LiveTvPage"));
const ChannelsPage = lazy(() => import("../pages/iptv/ChannelsPage"));
const LanguagesPage = lazy(() => import("../pages/iptv/LanguagesPage"));
const PlayerPage = lazy(() => import("../pages/iptv/PlayerPage"));

export default function AppRoutes() {
  return (
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
  );
}
