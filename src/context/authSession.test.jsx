/** @vitest-environment jsdom */
/**
 * Session-lifetime policy, encoded as a test.
 *
 * Reported Aug 2026: "the app is getting logged out frequently — once the user
 * has logged in it should not get logged out until the user logs out."
 *
 * Two independent causes lived in AuthContext:
 *   1. a hard 7-day cap measured from `loginTimestamp`, which login() wrote
 *      once and nothing ever refreshed. Daily users were still signed out on
 *      the seventh day.
 *   2. a MISSING `loginTimestamp` counted as expiry, so losing one auxiliary
 *      key (storage eviction, a partial write) discarded a valid session.
 *
 * These tests drive the real provider. The property they pin: nothing but an
 * explicit logout — or an AUTH_SCHEMA_VERSION bump — ends a session.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("../services/iptvPrefetch", () => ({ runIptvPrefetch: () => {} }));
vi.mock("../services/prefetch", () => ({ invalidateIptvServiceStatusCache: () => {} }));

const USER = { username: "demopwa", firstname: "Demo", op_id: "BBNL_OP49" };

// Mirrors AUTH_SCHEMA_VERSION in AuthContext.jsx. Kept as a literal on purpose:
// if someone bumps the constant without meaning to sign everyone out, the
// "restores a session written under the current schema" test below fails.
const CURRENT_SCHEMA = "2";

const DAY = 24 * 60 * 60 * 1000;

let logoutRef = null;

function Probe() {
  const { isAuthenticated, user, logout } = useAuth();
  logoutRef = logout;
  return <div>{isAuthenticated ? `in:${user.username}` : "out"}</div>;
}

function mount() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

/** Write a stored session exactly as login() would have, `ageMs` ago. */
function seedSession({ ageMs = 0, schema = CURRENT_SCHEMA, timestamp = true } = {}) {
  localStorage.setItem("user", JSON.stringify(USER));
  if (timestamp) {
    localStorage.setItem("loginTimestamp", String(Date.now() - ageMs));
  }
  if (schema !== null) localStorage.setItem("authSchemaVersion", schema);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  logoutRef = null;
});
afterEach(cleanup);

describe("session survives until the operator logs out", () => {
  test("restores a session written under the current schema", () => {
    seedSession();
    mount();
    expect(screen.getByText("in:demopwa")).toBeTruthy();
  });

  test("a 30-day-old session is STILL restored (no absolute cap)", () => {
    // This is the regression. Under the old 7-day cap this rendered "out".
    seedSession({ ageMs: 30 * DAY });
    mount();
    expect(screen.getByText("in:demopwa")).toBeTruthy();
  });

  test("a 400-day-old session is still restored", () => {
    seedSession({ ageMs: 400 * DAY });
    mount();
    expect(screen.getByText("in:demopwa")).toBeTruthy();
  });

  test("a missing loginTimestamp is repaired, not treated as expiry", () => {
    seedSession({ timestamp: false });
    mount();
    expect(screen.getByText("in:demopwa")).toBeTruthy();
    // Repaired so later reads have something to work with.
    expect(localStorage.getItem("loginTimestamp")).toBeTruthy();
  });

  test("restore stamps lastSeenAt", () => {
    seedSession({ ageMs: 10 * DAY });
    mount();
    expect(Number(localStorage.getItem("lastSeenAt"))).toBeGreaterThan(0);
  });
});

describe("the session still ends when it must", () => {
  test("logout() clears the session and every session key", () => {
    seedSession();
    localStorage.setItem("register_form_draft", "{}");
    localStorage.setItem("custActiveAccount", "{}");
    mount();
    expect(screen.getByText("in:demopwa")).toBeTruthy();

    act(() => logoutRef());

    expect(screen.getByText("out")).toBeTruthy();
    expect(localStorage.getItem("user")).toBeNull();
    // Shared-device hygiene: drafts and the linked customer must not outlive
    // the session either.
    expect(localStorage.getItem("register_form_draft")).toBeNull();
    expect(localStorage.getItem("custActiveAccount")).toBeNull();
  });

  test("a session written under an older schema is discarded", () => {
    seedSession({ schema: "1" });
    mount();
    expect(screen.getByText("out")).toBeTruthy();
    expect(localStorage.getItem("user")).toBeNull();
  });

  test("a session with no schema marker at all is discarded", () => {
    seedSession({ schema: null });
    mount();
    expect(screen.getByText("out")).toBeTruthy();
  });

  test("a stored session with no username is discarded", () => {
    localStorage.setItem("user", JSON.stringify({ firstname: "Nameless" }));
    localStorage.setItem("authSchemaVersion", CURRENT_SCHEMA);
    mount();
    expect(screen.getByText("out")).toBeTruthy();
  });

  test("corrupt JSON is discarded rather than thrown", () => {
    localStorage.setItem("user", "{not json");
    localStorage.setItem("authSchemaVersion", CURRENT_SCHEMA);
    mount();
    expect(screen.getByText("out")).toBeTruthy();
  });
});
