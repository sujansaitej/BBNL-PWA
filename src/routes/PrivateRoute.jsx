import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import logger from "../utils/logger";

export default function PrivateRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    logger.security("UNAUTHORIZED_ACCESS", { path: location.pathname, redirectTo: "/login" });
    return <Navigate to="/login" replace />;
  }

  return children;
}
