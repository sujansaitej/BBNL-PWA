import { Routes, Route } from "react-router-dom";
import PrivateRoute from "./PrivateRoute";
import Dashboard from "../pages/Dashboard";
import Profile from "../pages/Profile";
import Login from "../pages/Login";
import VerifyOTP from "../pages/VerifyOTP";
import Register from "../pages/Register";
import Plans from "../pages/Plans";
import Subscribe from "../pages/Subscribe";
import Paynow from "../pages/Paynow";
import Customers from "../pages/Customerlist";
import Tickets from "../pages/Tickets";
import SmartNavigationMap from "../pages/SmartNavigationMap";
import TicketsMap from "../pages/TicketsMap";
import Support from "../pages/Support";
import Services from "../pages/Services";
import InternetService from "../pages/services/InternetService";
import VoiceService from "../pages/services/VoiceService";
import FoFiSmartBox from "../pages/services/FoFiSmartBox";
import IPTVService from "../pages/services/IPTVService";
import PaymentHistory from "../pages/PaymentHistory";
import UploadDocuments from "../pages/UploadDocuments";
import FofiPayment from "../pages/FofiPayment";

export default function AppRoutes() {
  return (
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
    </Routes>
  );
}
