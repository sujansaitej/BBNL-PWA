import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * A route reachable WITHOUT a session — and only without one.
 *
 * Every route in this app was previously PrivateRoute or OtpRoute, because
 * until customer sign-up there was nothing a signed-out visitor was allowed to
 * see except /login itself. Sign-up is the first genuinely public screen, so
 * this is the wrapper for it.
 *
 * It is not merely "no guard". A signed-in customer who lands on /signup —
 * from a bookmark, a shared link, or the back button after registering — must
 * not be shown an account-creation form while holding a session; that is how
 * someone ends up creating a second account by accident. They go to the
 * dashboard instead, which is the mirror image of what PrivateRoute does.
 */
export default function PublicRoute({ children }) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) return <Navigate to="/" replace />;

  return children;
}
