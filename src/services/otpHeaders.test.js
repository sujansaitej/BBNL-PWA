/**
 * appkeytype during OTP verification.
 *
 * Franchisee OTP verification failed in production with "Invalid User
 * Credentials, please enter right userid & password to login" followed by the
 * backend's "Login attempts has exhausted ... 15 min left" lockout. Customer
 * login was unaffected.
 *
 * Cause: apiCore.getAppKeyType() picks the employee-vs-customer `appkeytype`
 * header from localStorage.loginType. `loginType` is a SESSION key, so anything
 * that purges the session removes it — and the login screen purges the session
 * on purpose before parking an OTP challenge, so no stale session can carry an
 * operator past the gate. With loginType gone, the selector fell through to the
 * customer default and sent a franchisee's custLoginVerification as
 * appkeytype=customer. Customers were fine because that default matched.
 *
 * These tests pin the header for both portals across every state the OTP step
 * can be in.
 */
import { describe, test, expect, beforeEach } from "vitest";
import { getHeadersForm, getHeadersJson } from "./apiCore";
import { setPendingAuth, clearPendingAuth } from "./pendingAuth";

const EMPLOYEE = import.meta.env.VITE_API_APP_USER_TYPE;
const CUSTOMER = import.meta.env.VITE_API_APP_USER_TYPE_CUST;

const USER = { username: "demopwa", op_id: "BBNL_OP49" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("appkeytype tracks the portal the login started in", () => {
  test("franchisee with loginType present → employee", () => {
    localStorage.setItem("loginType", "franchisee");
    expect(getHeadersForm().appkeytype).toBe(EMPLOYEE);
  });

  test("customer with loginType present → customer", () => {
    localStorage.setItem("loginType", "customer");
    expect(getHeadersForm().appkeytype).toBe(CUSTOMER);
  });

  test("franchisee with loginType PURGED still → employee, via the challenge", () => {
    // The exact production state: session purged, challenge parked, OTP being
    // verified. Before the fix this returned the customer key and the backend
    // rejected the operator's credentials.
    setPendingAuth({ user: USER, otprefid: "99231", loginType: "franchisee" });
    expect(localStorage.getItem("loginType")).toBeNull();
    expect(getHeadersForm().appkeytype).toBe(EMPLOYEE);
  });

  test("customer with loginType purged → customer", () => {
    setPendingAuth({ user: USER, otprefid: "99231", loginType: "customer" });
    expect(getHeadersForm().appkeytype).toBe(CUSTOMER);
  });

  test("resend uses the same header as verify (JSON profile)", () => {
    // custLoginResendOtp goes out with getHeadersJson, so it broke identically —
    // matching the reported "resend otp also having issue".
    setPendingAuth({ user: USER, otprefid: "99231", loginType: "franchisee" });
    expect(getHeadersJson().appkeytype).toBe(EMPLOYEE);
    expect(getHeadersJson().appkeytype).toBe(getHeadersForm().appkeytype);
  });

  test("localStorage wins when both are present and disagree", () => {
    localStorage.setItem("loginType", "franchisee");
    setPendingAuth({ user: USER, otprefid: "1", loginType: "customer" });
    expect(getHeadersForm().appkeytype).toBe(EMPLOYEE);
  });

  test("no loginType and no challenge → customer default", () => {
    clearPendingAuth();
    expect(getHeadersForm().appkeytype).toBe(CUSTOMER);
  });

  test("an expired challenge does not resurrect the employee key", () => {
    setPendingAuth({ user: USER, otprefid: "1", loginType: "franchisee" }, 1_000);
    // getPendingAuth self-expires, so the fallback is gone with it.
    expect(getHeadersForm().appkeytype).toBe(CUSTOMER);
  });

  test("the other credential fields are unchanged by the fallback", () => {
    setPendingAuth({ user: USER, otprefid: "1", loginType: "franchisee" });
    const h = getHeadersForm();
    expect(h.Authorization).toBe(import.meta.env.VITE_API_AUTH_KEY);
    expect(h.username).toBe(import.meta.env.VITE_API_USERNAME);
    expect(h["X-App-Package"]).toBe("com.bbnl.smartphone");
  });
});
