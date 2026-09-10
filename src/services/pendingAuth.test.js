import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  setPendingAuth,
  getPendingAuth,
  hasPendingAuth,
  clearPendingAuth,
  updatePendingOtpRef,
  recordFailedOtpAttempt,
  PENDING_AUTH_MAX_AGE,
  MAX_OTP_ATTEMPTS,
} from "./pendingAuth";

const USER = { username: "demopwa", firstname: "Demo", op_id: "BBNL_OP49" };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("pending auth escrow", () => {
  test("a parked challenge does NOT write localStorage.user", () => {
    setPendingAuth({ user: USER, otprefid: "998", loginType: "franchisee" });

    // This is the whole bug in one assertion. `localStorage.user` is what
    // AuthContext restores, what isAuthenticated derives from, and what ~40
    // getUser() call sites read. If parking a challenge writes it, the OTP
    // screen is decoration and the back button walks straight into the app.
    expect(localStorage.getItem("user")).toBeNull();
    expect(localStorage.getItem("loginTimestamp")).toBeNull();
    expect(hasPendingAuth()).toBe(true);
  });

  test("the challenge lives in sessionStorage, not localStorage", () => {
    setPendingAuth({ user: USER, otprefid: "998" });
    // sessionStorage dies with the app. A challenge that survived a relaunch
    // would be resumable by whoever opens the PWA next on a shared phone.
    expect(sessionStorage.getItem("pendingOtpAuth")).toBeTruthy();
    expect(localStorage.getItem("pendingOtpAuth")).toBeNull();
  });

  test("round-trips the identity and otprefid the OTP screen needs", () => {
    setPendingAuth({ user: USER, otprefid: 998, loginType: "customer" });
    const p = getPendingAuth();
    expect(p.user.username).toBe("demopwa");
    expect(p.otprefid).toBe("998"); // coerced to string for the form field
    expect(p.loginType).toBe("customer");
    expect(p.attempts).toBe(0);
  });

  test("refuses to park an identity with no username", () => {
    expect(setPendingAuth({ user: {}, otprefid: "1" })).toBe(false);
    expect(setPendingAuth({ user: null, otprefid: "1" })).toBe(false);
    expect(hasPendingAuth()).toBe(false);
  });

  test("expires after PENDING_AUTH_MAX_AGE and self-clears", () => {
    const t0 = 1_000_000;
    setPendingAuth({ user: USER, otprefid: "998" }, t0);

    expect(getPendingAuth(t0 + PENDING_AUTH_MAX_AGE - 1)).not.toBeNull();
    expect(getPendingAuth(t0 + PENDING_AUTH_MAX_AGE + 1)).toBeNull();
    // Self-cleaning: the expired record is gone, not merely reported absent.
    expect(sessionStorage.getItem("pendingOtpAuth")).toBeNull();
  });

  test("treats a corrupt record as absent and removes it", () => {
    sessionStorage.setItem("pendingOtpAuth", "{not json");
    expect(getPendingAuth()).toBeNull();
    expect(sessionStorage.getItem("pendingOtpAuth")).toBeNull();
  });

  test("treats a record missing startedAt as absent", () => {
    sessionStorage.setItem("pendingOtpAuth", JSON.stringify({ user: USER, otprefid: "1" }));
    expect(getPendingAuth()).toBeNull();
  });

  test("clearPendingAuth removes the challenge", () => {
    setPendingAuth({ user: USER, otprefid: "998" });
    clearPendingAuth();
    expect(hasPendingAuth()).toBe(false);
  });

  test("setPendingAuth reports false when storage refuses the write", () => {
    const spy = vi.spyOn(sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    // Login must read this as a failed login and stay put, never fall through
    // to login().
    expect(setPendingAuth({ user: USER, otprefid: "998" })).toBe(false);
    spy.mockRestore();
  });

  test("getPendingAuth returns null when storage reads throw", () => {
    const spy = vi.spyOn(sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    // Fails closed: unreadable storage means no challenge, not a valid one.
    expect(getPendingAuth()).toBeNull();
    expect(hasPendingAuth()).toBe(false);
    spy.mockRestore();
  });
});

describe("code shape survives the escrow", () => {
  test("carries otpLength and otpDataType through to the OTP screen", () => {
    setPendingAuth({ user: USER, otprefid: "1", otpLength: 6, otpDataType: "alphanumeric" });
    const p = getPendingAuth();
    expect(p.otpLength).toBe(6);
    expect(p.otpDataType).toBe("alphanumeric");
  });

  test("defaults to 4 numeric when unspecified", () => {
    setPendingAuth({ user: USER, otprefid: "1" });
    const p = getPendingAuth();
    expect(p.otpLength).toBe(4);
    expect(p.otpDataType).toBe("numeric");
  });

  test.each([0, 3, 9, 99, null, "abc", undefined])("clamps junk otpLength %j to 4", (given) => {
    setPendingAuth({ user: USER, otprefid: "1", otpLength: given });
    expect(getPendingAuth().otpLength).toBe(4);
  });

  test("a resend preserves the code shape", () => {
    setPendingAuth({ user: USER, otprefid: "1", otpLength: 6, otpDataType: "alphanumeric" });
    updatePendingOtpRef("2");
    const p = getPendingAuth();
    expect(p.otpLength).toBe(6);
    expect(p.otpDataType).toBe("alphanumeric");
  });
});

describe("resend", () => {
  test("updatePendingOtpRef swaps in the new ref id, preserving identity", () => {
    setPendingAuth({ user: USER, otprefid: "998", loginType: "customer" });
    expect(updatePendingOtpRef("1234")).toBe(true);

    const p = getPendingAuth();
    expect(p.otprefid).toBe("1234");
    expect(p.user.username).toBe("demopwa");
    expect(p.loginType).toBe("customer");
  });

  test("updatePendingOtpRef fails on an expired challenge", () => {
    const t0 = 1_000_000;
    setPendingAuth({ user: USER, otprefid: "998" }, t0);
    expect(updatePendingOtpRef("1234", t0 + PENDING_AUTH_MAX_AGE + 1)).toBe(false);
  });

  test("a resend does not reset the attempt counter", () => {
    setPendingAuth({ user: USER, otprefid: "998" });
    recordFailedOtpAttempt();
    recordFailedOtpAttempt();
    updatePendingOtpRef("1234");
    // Otherwise "resend" is an unlimited-brute-force button.
    expect(getPendingAuth().attempts).toBe(2);
  });
});

describe("attempt cap", () => {
  test("counts down and destroys the challenge on the last attempt", () => {
    setPendingAuth({ user: USER, otprefid: "998" });

    const seen = [];
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) seen.push(recordFailedOtpAttempt());

    expect(seen).toEqual([4, 3, 2, 1, 0]);
    // Exhausted → gone, so OtpRoute bounces the next render to /login.
    expect(hasPendingAuth()).toBe(false);
  });

  test("returns 0 when there is no challenge to charge", () => {
    expect(recordFailedOtpAttempt()).toBe(0);
  });

  test("a fresh login resets the counter", () => {
    setPendingAuth({ user: USER, otprefid: "998" });
    recordFailedOtpAttempt();
    recordFailedOtpAttempt();

    clearPendingAuth();
    setPendingAuth({ user: USER, otprefid: "999" });
    expect(getPendingAuth().attempts).toBe(0);
  });
});
