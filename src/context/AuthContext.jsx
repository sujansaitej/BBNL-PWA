import { createContext, useContext, useState, useEffect } from "react";
import logger from "../utils/logger";
import { lsClearAll } from "../services/lsCache";
import { runIptvPrefetch } from "../services/iptvPrefetch";

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
          // ── Session expiry check (7 days) ──
          const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
          const tsRaw = localStorage.getItem("loginTimestamp");
          const loginTs = tsRaw ? Number(tsRaw) : 0;

          if (!loginTs || Date.now() - loginTs > SESSION_MAX_AGE) {
            localStorage.removeItem("user");
            localStorage.removeItem("loginTimestamp");
            localStorage.removeItem("loginType");
            localStorage.removeItem("otprefid");
            lsClearAll();
            logger.security("SESSION_EXPIRED", {
              username: parsed.username,
              age: loginTs ? Math.round((Date.now() - loginTs) / 3600000) + "h" : "no-timestamp",
            });
          } else {
            setUser(parsed);
            logger.info("Auth", "Session restored from localStorage", { username: parsed.username, loginType: localStorage.getItem("loginType") });
          }
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
    localStorage.setItem("loginTimestamp", String(Date.now()));
    logger.security("LOGIN_SUCCESS", {
      username: userDetails.username,
      op_id: userDetails.op_id,
      loginType: localStorage.getItem("loginType"),
    });
    // Trigger IPTV prefetch now that user data is available.
    // On fresh install, the startup prefetch skipped (no user yet).
    // This ensures channels, languages, and public IP are ready
    // before the user opens Live TV.
    runIptvPrefetch();
  };

  const logout = () => {
    const prev = user?.username || "unknown";
    setUser(null);
    localStorage.removeItem("user");
    localStorage.removeItem("loginTimestamp");
    localStorage.removeItem("loginType");
    localStorage.removeItem("otprefid");
    lsClearAll();
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
