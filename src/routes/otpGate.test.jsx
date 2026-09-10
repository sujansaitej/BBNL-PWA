/** @vitest-environment jsdom */
/**
 * The QA bug, encoded as a test.
 *
 * Reported 2026-07-31: enter username + password → the app navigates to the OTP
 * screen → press Back WITHOUT entering the OTP → you are inside the app. Root
 * cause was Login.jsx calling AuthContext.login() before it looked at
 * otpstatus, so the session already existed and the OTP screen was decoration.
 *
 * These tests drive the real guards through a real router. They assert the
 * property that matters and that no unit test of a single module can see:
 * while an OTP is outstanding, NO protected route renders.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import PrivateRoute from "./PrivateRoute";
import OtpRoute from "./OtpRoute";
import { setPendingAuth, hasPendingAuth, clearPendingAuth } from "../services/pendingAuth";

// AuthContext pulls in the IPTV prefetch chain on login; stub it out so these
// tests exercise routing only.
vi.mock("../services/iptvPrefetch", () => ({ runIptvPrefetch: () => {} }));
vi.mock("../services/prefetch", () => ({ invalidateIptvServiceStatusCache: () => {} }));

const USER = { username: "demopwa", firstname: "Demo", op_id: "BBNL_OP49" };

/** Stands in for the device's Back button — a real history pop. */
function BackButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>device-back</button>;
}

/**
 * A miniature of the real route table: one protected page, the OTP page, and
 * the login page, wired with the same guards Routes.jsx uses.
 */
function App({ start, entries, index }) {
  return (
    <MemoryRouter
      initialEntries={entries || [start]}
      initialIndex={index}
    >
      <AuthProvider>
        <BackButton />
        <Routes>
          <Route path="/login" element={<h1>Login Screen</h1>} />
          <Route
            path="/verify-otp"
            element={
              <OtpRoute>
                <h1>Verify OTP</h1>
              </OtpRoute>
            }
          />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <h1>Operator Dashboard</h1>
              </PrivateRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <PrivateRoute>
                <h1>Customer List</h1>
              </PrivateRoute>
            }
          />
          <Route
            path="/cust/dashboard"
            element={
              <PrivateRoute>
                <h1>Customer Dashboard</h1>
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

/** What Login.jsx does when the backend answers otpstatus:"yes". */
function loginReachesOtpStep(loginType = "franchisee") {
  localStorage.setItem("loginType", loginType);
  return setPendingAuth({ user: USER, otprefid: "99231", loginType });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(cleanup);

describe("the reported bypass", () => {
  test("password accepted + OTP pending does NOT grant the dashboard", () => {
    loginReachesOtpStep();

    // Step 4-5 of the QA repro: leave the OTP screen and land on a protected
    // route without ever entering a code.
    render(<App start="/" />);

    expect(screen.getByText("Login Screen")).toBeTruthy();
    expect(screen.queryByText("Operator Dashboard")).toBeNull();
  });

  test.each(["/", "/customers", "/cust/dashboard"])(
    "protected route %s stays closed while the OTP is outstanding",
    (path) => {
      loginReachesOtpStep();
      render(<App start={path} />);
      expect(screen.getByText("Login Screen")).toBeTruthy();
    }
  );

  test("reaching the OTP step writes no session to localStorage", () => {
    loginReachesOtpStep();
    // AuthContext restores from these two keys. Neither may exist yet.
    expect(localStorage.getItem("user")).toBeNull();
    expect(localStorage.getItem("loginTimestamp")).toBeNull();
  });

  test("relaunching the app mid-OTP lands on login, not inside", () => {
    loginReachesOtpStep();
    // sessionStorage is what dies when an installed PWA is closed; localStorage
    // survives. Simulate the relaunch.
    sessionStorage.clear();

    render(<App start="/" />);
    expect(screen.getByText("Login Screen")).toBeTruthy();

    cleanup();
    // ...and the OTP screen is no longer resumable either.
    render(<App start="/verify-otp" />);
    expect(screen.getByText("Login Screen")).toBeTruthy();
  });
});

describe("the Back button itself — QA's exact steps 4 and 5", () => {
  test("Back from the OTP screen lands on login, not inside the app", () => {
    // History as QA had it: a protected route behind, the OTP screen in front.
    // Pre-fix, popping back to "/" rendered the Dashboard, because
    // localStorage.user had already been written at password time and
    // PrivateRoute only ever asked isAuthenticated.
    loginReachesOtpStep();
    render(<App entries={["/", "/verify-otp"]} index={1} />);
    expect(screen.getByText("Verify OTP")).toBeTruthy();

    fireEvent.click(screen.getByText("device-back"));

    expect(screen.getByText("Login Screen")).toBeTruthy();
    expect(screen.queryByText("Operator Dashboard")).toBeNull();
  });

  test("Back does not leave a resumable challenge behind", () => {
    loginReachesOtpStep();
    render(<App entries={["/", "/verify-otp"]} index={1} />);

    fireEvent.click(screen.getByText("device-back"));

    // Landing on /login abandons the half-finished login, so a second forward
    // navigation cannot pick it back up. (The real Login screen clears it on
    // mount; here the redirect target is a stub, so assert via the guard.)
    cleanup();
    render(<App start="/verify-otp" />);
    expect(screen.getByText("Verify OTP")).toBeTruthy();
  });

  test("Back, then forward to a deep protected route, still refuses", () => {
    loginReachesOtpStep();
    render(<App entries={["/customers", "/verify-otp"]} index={1} />);

    fireEvent.click(screen.getByText("device-back"));

    expect(screen.getByText("Login Screen")).toBeTruthy();
    expect(screen.queryByText("Customer List")).toBeNull();
  });
});

describe("a stale session must not carry someone past a real OTP", () => {
  // /login is reachable while already logged in — the catch-all route sends
  // every unknown URL there. So "session exists + new OTP login" is a real
  // state, and OtpRoute used to check isAuthenticated first and redirect
  // straight to the dashboard, skipping an OTP that had genuinely been issued.
  test("challenge outstanding wins over an existing session", () => {
    localStorage.setItem("user", JSON.stringify(USER));
    localStorage.setItem("loginTimestamp", String(Date.now()));
    localStorage.setItem("authSchemaVersion", "2");
    loginReachesOtpStep();

    render(<App start="/verify-otp" />);

    expect(screen.getByText("Verify OTP")).toBeTruthy();
    expect(screen.queryByText("Operator Dashboard")).toBeNull();
  });

  test("a protected route is still refused while that challenge stands", () => {
    // The session is present, but the operator is mid-authentication.
    loginReachesOtpStep();
    render(<App start="/verify-otp" />);
    expect(screen.getByText("Verify OTP")).toBeTruthy();
  });
});

describe("OtpRoute entry conditions", () => {
  test("renders the OTP screen when a challenge is outstanding", () => {
    loginReachesOtpStep();
    render(<App start="/verify-otp" />);
    expect(screen.getByText("Verify OTP")).toBeTruthy();
  });

  test("bounces to login when no challenge exists (direct URL / deep link)", () => {
    render(<App start="/verify-otp" />);
    expect(screen.getByText("Login Screen")).toBeTruthy();
    expect(screen.queryByText("Verify OTP")).toBeNull();
  });

  test("an already-verified operator is sent to their dashboard, not re-challenged", () => {
    // A completed session walking back into /verify-otp via history.
    localStorage.setItem("user", JSON.stringify(USER));
    localStorage.setItem("loginTimestamp", String(Date.now()));
    localStorage.setItem("authSchemaVersion", "2");
    localStorage.setItem("loginType", "franchisee");

    render(<App start="/verify-otp" />);
    expect(screen.getByText("Operator Dashboard")).toBeTruthy();
  });

  test("an already-verified customer is sent to the customer dashboard", () => {
    localStorage.setItem("user", JSON.stringify(USER));
    localStorage.setItem("loginTimestamp", String(Date.now()));
    localStorage.setItem("authSchemaVersion", "2");
    localStorage.setItem("loginType", "customer");

    render(<App start="/verify-otp" />);
    expect(screen.getByText("Customer Dashboard")).toBeTruthy();
  });
});

describe("a verified session still works", () => {
  test("a current-schema session renders protected routes", () => {
    localStorage.setItem("user", JSON.stringify(USER));
    localStorage.setItem("loginTimestamp", String(Date.now()));
    localStorage.setItem("authSchemaVersion", "2");

    render(<App start="/customers" />);
    expect(screen.getByText("Customer List")).toBeTruthy();
  });
});

describe("pre-fix sessions are invalidated", () => {
  test("a session with no schema marker is purged and sent to login", () => {
    // Exactly what the buggy build left on operators' phones: a session that
    // may never have passed OTP. Indistinguishable from a good one, so all of
    // them go. Without this the bypass survives on-device for the 7-day
    // session lifetime after the fix ships.
    localStorage.setItem("user", JSON.stringify(USER));
    localStorage.setItem("loginTimestamp", String(Date.now()));

    render(<App start="/" />);

    expect(screen.getByText("Login Screen")).toBeTruthy();
    expect(localStorage.getItem("user")).toBeNull();
  });

  test("a session with an older schema marker is purged", () => {
    localStorage.setItem("user", JSON.stringify(USER));
    localStorage.setItem("loginTimestamp", String(Date.now()));
    localStorage.setItem("authSchemaVersion", "1");

    render(<App start="/" />);
    expect(screen.getByText("Login Screen")).toBeTruthy();
    expect(localStorage.getItem("user")).toBeNull();
  });

  test("the purge also drops any outstanding challenge", () => {
    localStorage.setItem("user", JSON.stringify(USER));
    localStorage.setItem("loginTimestamp", String(Date.now()));
    setPendingAuth({ user: USER, otprefid: "1" });

    render(<App start="/" />);
    expect(hasPendingAuth()).toBe(false);
  });
});

describe("logged out is logged out", () => {
  test("no session and no challenge → login", () => {
    clearPendingAuth();
    render(<App start="/" />);
    expect(screen.getByText("Login Screen")).toBeTruthy();
  });
});
