import { createContext, useContext, useState, useEffect } from "react";
import logger from "../utils/logger";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore user from localStorage on first render
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        // Validate session has proper API data (not stale from old bug)
        if (parsed && parsed.username) {
          setUser(parsed);
          logger.info("Auth", "Session restored from localStorage", { username: parsed.username, loginType: localStorage.getItem("loginType") });
        } else {
          localStorage.removeItem("user");
          logger.security("STALE_SESSION_REMOVED", { reason: "Missing username in stored session" });
        }
      } catch (err) {
        localStorage.removeItem("user");
        logger.security("CORRUPT_SESSION_REMOVED", { reason: err.message });
      }
    } else {
      logger.debug("Auth", "No stored session found");
    }
    setLoading(false);
  }, []);

  const login = (userDetails) => {
    setUser(userDetails);
    localStorage.setItem("user", JSON.stringify(userDetails));
    logger.security("LOGIN_SUCCESS", {
      username: userDetails.username,
      op_id: userDetails.op_id,
      loginType: localStorage.getItem("loginType"),
    });
  };

  const logout = () => {
    const prev = user?.username || "unknown";
    setUser(null);
    localStorage.removeItem("user");
    logger.security("LOGOUT", { username: prev });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-lg font-semibold">
        Loading...
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
