import { createContext, useContext, useState, useEffect } from "react";
import logger from "../utils/logger";
import { lsClearAll } from "../services/lsCache";
import { runIptvPrefetch } from "../services/iptvPrefetch";
import { invalidateIptvServiceStatusCache } from "../services/prefetch";
import { clearPendingAuth } from "../services/pendingAuth";
import { recordInstall, seedInstallGeneration } from "../services/installGeneration";

const AuthContext = createContext();

/**
 * Bumped whenever a stored session can no longer be trusted. A session without
 * the current marker is discarded on load and the operator logs in again.
 *
 * v2 — sessions written before the OTP fix were created at password-check time,
 * before the second factor ran, so any of them may belong to someone who
 * skipped OTP entirely. They cannot be distinguished from good ones and are all
 * invalidated. Without this, the bypass survives on already-logged-in devices
 * for up to the 7-day session lifetime after the fix ships.
 */
const AUTH_SCHEMA_VERSION = "2";

/**
 * Every key that must not outlive a session. Single list because the expiry
 * path, logout and the schema purge previously maintained three near-identical
 * copies, and a key added to one but not the others leaks across sessions on a
 * shared device.
 */
const SESSION_KEYS = [
  "user",
  "loginTimestamp",
  "loginType",
  "otprefid",
  // Registration-form drafts — without these, re-login reveals the previous
  // operator's in-progress Add User data (and survives PWA reinstall on
  // Android WebView).
  "register_form_draft",
  "registrationData",
  "photoFileId",
  "addrproofIds",
  "idcardIds",
  "filerefid",
  // Linked service account — carries the customer's name, mobile and address,
  // so it must not outlive the session on a shared device.
  "custActiveAccount",
  // Telemetry only — see the session-lifetime note in the restore effect.
  "lastSeenAt",
];

function purgeSession() {
  SESSION_KEYS.forEach((k) => {
    try { localStorage.removeItem(k); } catch (_) {}
  });
  clearPendingAuth();
  lsClearAll();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore user from localStorage on first render.
  //
  // ── SESSION LIFETIME POLICY (changed Aug 2026) ──────────────────────────
  // A session now ends ONLY when the operator taps Log out (or when the
  // schema check below invalidates it). There is deliberately no idle or
  // absolute timeout.
  //
  // What was here before: a hard 7-day cap measured from `loginTimestamp`,
  // which was written once by login() and never refreshed. Operators using
  // the app every day were still signed out every seventh day, which is the
  // "app logs itself out about once a week" report. Two smaller faults made
  // it worse — a MISSING `loginTimestamp` was also treated as expiry, so
  // losing one auxiliary key (quota eviction, a partial write on a low-end
  // Android) discarded an otherwise valid session.
  //
  // `loginTimestamp` is still written and still refreshed on each restore,
  // but it is now telemetry, not an authority: nothing revokes a session
  // because of it. If a timeout is ever wanted again, reintroduce it here as
  // a SLIDING window over `lastSeenAt` — not as a fixed cap over login time.
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        // Validate session has proper API data (not stale from old bug)
        if (parsed && parsed.username) {
          // ── Untrusted-schema check ──
          // The one remaining reason a stored session is discarded: it was
          // written under trust assumptions that no longer hold (see the
          // AUTH_SCHEMA_VERSION note above). Bump that constant ONLY for a
          // security change, never for a routine release — every bump signs
          // every operator out.
          const schema = localStorage.getItem("authSchemaVersion");

          if (schema !== AUTH_SCHEMA_VERSION) {
            purgeSession();
            logger.security("SESSION_SCHEMA_INVALIDATED", {
              username: parsed.username,
              found: schema || "none",
              expected: AUTH_SCHEMA_VERSION,
            });
          } else {
            // Repair, don't revoke: a session that survived with its
            // timestamp missing is still a valid session.
            try {
              if (!localStorage.getItem("loginTimestamp")) {
                localStorage.setItem("loginTimestamp", String(Date.now()));
              }
              localStorage.setItem("lastSeenAt", String(Date.now()));
            } catch (_) {}
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

  // ── Reinstalling the app ends the session (Aug 2026) ───────────────────
  // Reported: install → log in → uninstall → reinstall → the app opens
  // already logged in. It should ask for credentials.
  //
  // Nothing is wrong with the restore above: an installed PWA is a WebAPK and
  // its storage belongs to the ORIGIN inside Chrome's profile, not to the
  // installed package, so uninstalling never removed the session in the first
  // place. See services/installGeneration.js for why no API can tell us the
  // app was uninstalled, and how counting `appinstalled` events answers the
  // question we can actually ask — "is this install replacing an earlier one?"
  //
  // Note what this is NOT: it is not a return of the 7-day cap, and it does
  // not fire on a first install. An operator who signs in inside Chrome and
  // then installs the app keeps their session, which is the case the previous
  // BrowserGate handler got wrong.
  useEffect(() => {
    seedInstallGeneration();

    const handleInstalled = () => {
      const { generation, isReinstall } = recordInstall();
      if (!isReinstall) return;

      // Read the name off disk rather than closing over `user`, so this
      // listener is registered once for the app's lifetime instead of being
      // torn down and re-added on every sign-in.
      let previous = "none";
      try {
        previous = JSON.parse(localStorage.getItem("user") || "null")?.username || "none";
      } catch (_) {}

      // Purge unconditionally, even with no `user`: the registration drafts
      // and linked-account details in SESSION_KEYS belong to the removed
      // install just as much as the session does.
      setUser(null);
      purgeSession();
      logger.security("SESSION_ENDED_ON_REINSTALL", { username: previous, generation });
    };

    window.addEventListener("appinstalled", handleInstalled);
    return () => window.removeEventListener("appinstalled", handleInstalled);
  }, []);

  /**
   * Commit a session. This is the app's only grant of authority — ~40 sites
   * read `localStorage.user` as proof of identity — so for an OTP-protected
   * account it must be called ONLY after the code is verified. Callers on the
   * login screen must park the identity with setPendingAuth() instead.
   */
  const login = (userDetails) => {
    invalidateIptvServiceStatusCache();
    // The challenge is settled; drop it so a session and a pending record can
    // never coexist.
    clearPendingAuth();

    // Persist BEFORE trusting the in-memory state. localStorage.setItem throws
    // on a full quota, and the old code ignored that: React state said "logged
    // in", nothing reached disk, and the next app launch restored nothing — an
    // operator on a storage-pressured phone was silently signed out every time
    // they reopened the app. On failure, drop the `_c:` API caches (the only
    // reclaimable space we own) and try once more.
    const persist = () => {
      localStorage.setItem("user", JSON.stringify(userDetails));
      localStorage.setItem("loginTimestamp", String(Date.now()));
      localStorage.setItem("lastSeenAt", String(Date.now()));
      localStorage.setItem("authSchemaVersion", AUTH_SCHEMA_VERSION);
    };
    try {
      persist();
    } catch (_) {
      lsClearAll();
      try {
        persist();
      } catch (err) {
        // Nothing can be stored — a session that cannot be written is not a
        // session. Report it rather than handing back a login that evaporates.
        logger.security("LOGIN_PERSIST_FAILED", {
          username: userDetails?.username,
          reason: err?.message || "storage unavailable",
        });
        const e = new Error(
          "Could not save your session — device storage is full or blocked. " +
          "Free up some space and sign in again."
        );
        e.code = "SESSION_PERSIST_FAILED";
        throw e;
      }
    }

    setUser(userDetails);
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
    purgeSession();
    logger.security("LOGOUT", { username: prev });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-dvh text-lg font-semibold">
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
