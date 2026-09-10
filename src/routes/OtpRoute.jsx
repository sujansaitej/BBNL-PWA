import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { hasPendingAuth } from "../services/pendingAuth";
import logger from "../utils/logger";

/**
 * Guard for /verify-otp.
 *
 * This route cannot use PrivateRoute: by design there is no session while the
 * OTP is outstanding, so PrivateRoute would bounce a legitimately mid-login
 * operator to /login. It cannot be unguarded either, or the screen becomes a
 * URL anyone can open. The correct entry condition is an outstanding challenge.
 */
export default function OtpRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const pending = hasPendingAuth();

  // An outstanding challenge OUTRANKS an existing session, deliberately.
  //
  // These two states should never coexist — Login tears the session down before
  // parking a challenge, and login() drops the challenge on success — but if
  // they ever do, the safe reading is "someone is mid-authentication", not
  // "already in". Checking isAuthenticated first would let a stale session on
  // the device carry the operator past an OTP that was genuinely issued.
  if (pending) {
    return children;
  }

  // No challenge outstanding and already verified — nothing left to prove. Also
  // stops a completed session being walked back into the OTP screen via history.
  if (isAuthenticated) {
    let loginType = null;
    try { loginType = localStorage.getItem("loginType"); } catch (_) {}
    return <Navigate to={loginType === "customer" ? "/cust/dashboard" : "/"} replace />;
  }

  logger.security("OTP_ROUTE_NO_PENDING", { redirectTo: "/login" });
  return <Navigate to="/login" replace />;
}
