/** @vitest-environment jsdom */
/**
 * VerifyOTP — rendering and the verify handshake.
 *
 * Renders the real screen because the input rendering was rewritten: box count
 * and character class now come from the account's otp_totchars / otp_datatype
 * instead of a hardcoded four numeric boxes. A 6-character account previously
 * could not log in at all — the 4th keystroke auto-submitted a truncated code.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { setPendingAuth, getPendingAuth, hasPendingAuth } from "../services/pendingAuth";

const OTPauth = vi.fn();
const resendOTP = vi.fn();
vi.mock("../services/generalApis", () => ({
  OTPauth: (...a) => OTPauth(...a),
  resendOTP: (...a) => resendOTP(...a),
}));
vi.mock("../services/iptvPrefetch", () => ({ runIptvPrefetch: () => {} }));
vi.mock("../services/prefetch", () => ({ invalidateIptvServiceStatusCache: () => {} }));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

import VerifyOTP from "./VerifyOTP";

// jsdom ships no matchMedia; useDarkMode calls it on mount.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}

const USER = { username: "demopwa", firstname: "Demo", op_id: "BBNL_OP49" };

function show() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <VerifyOTP />
      </AuthProvider>
    </MemoryRouter>
  );
}

const boxes = () => screen.getAllByRole("textbox");

/** Type a full code, one character per box, as a user would. */
function typeCode(code) {
  const els = boxes();
  code.split("").forEach((ch, i) => fireEvent.change(els[i], { target: { value: ch } }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  OTPauth.mockReset();
  resendOTP.mockReset();
  navigate.mockReset();
});

afterEach(cleanup);

describe("code shape", () => {
  test("renders 4 boxes by default", () => {
    setPendingAuth({ user: USER, otprefid: "1" });
    show();
    expect(boxes()).toHaveLength(4);
  });

  test("renders 6 boxes for a 6-character account", () => {
    setPendingAuth({ user: USER, otprefid: "1", otpLength: 6 });
    show();
    expect(boxes()).toHaveLength(6);
    expect(screen.getByText(/6-digit code/i)).toBeTruthy();
  });

  test("a numeric account rejects letters", () => {
    setPendingAuth({ user: USER, otprefid: "1" });
    show();
    fireEvent.change(boxes()[0], { target: { value: "a" } });
    expect(boxes()[0].value).toBe("");
  });

  test("an alphanumeric account accepts letters", () => {
    setPendingAuth({ user: USER, otprefid: "1", otpLength: 6, otpDataType: "alphanumeric" });
    show();
    fireEvent.change(boxes()[0], { target: { value: "a" } });
    expect(boxes()[0].value).toBe("a");
    expect(screen.getByText(/6-character code/i)).toBeTruthy();
  });
});

describe("verify handshake", () => {
  test("a 6-char code is sent whole, not truncated at 4", async () => {
    setPendingAuth({ user: USER, otprefid: "99231", otpLength: 6 });
    OTPauth.mockResolvedValue({ status: { err_code: 1, err_msg: "Invalid OTP" } });
    show();

    typeCode("123456");

    await waitFor(() => expect(OTPauth).toHaveBeenCalled());
    // The bug this guards: auto-submit firing at 4 characters would have sent
    // "1234" and burned an attempt on a code the operator never finished.
    expect(OTPauth).toHaveBeenCalledWith("demopwa", "99231", "123456");
    expect(OTPauth).toHaveBeenCalledTimes(1);
  });

  test("a wrong code creates NO session and keeps the operator on the screen", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: 1, err_msg: "Invalid OTP" } });
    show();

    typeCode("1111");

    await waitFor(() => expect(OTPauth).toHaveBeenCalled());
    expect(localStorage.getItem("user")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    await screen.findByText(/Invalid OTP/i);
    expect(screen.getByText(/4 attempts left/i)).toBeTruthy();
  });

  test("a correct code commits the session and drops the escrow", async () => {
    setPendingAuth({ user: USER, otprefid: "99231", loginType: "franchisee" });
    OTPauth.mockResolvedValue({ status: { err_code: 0, err_msg: "Verified" } });
    show();

    typeCode("4321");

    await waitFor(() => expect(localStorage.getItem("user")).toBeTruthy());
    expect(JSON.parse(localStorage.getItem("user")).username).toBe("demopwa");
    expect(localStorage.getItem("authSchemaVersion")).toBe("2");
    expect(hasPendingAuth()).toBe(false);
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  test("a string err_code of \"0\" is still a success", async () => {
    // One backend status model types err_code as String (apiEnvelope.js:14-27).
    // A strict !== 0 check here would reject a valid OTP.
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: "0", err_msg: "Verified" } });
    show();

    typeCode("4321");

    await waitFor(() => expect(localStorage.getItem("user")).toBeTruthy());
  });

  test("a customer lands on the customer dashboard", async () => {
    setPendingAuth({ user: USER, otprefid: "99231", loginType: "customer" });
    OTPauth.mockResolvedValue({ status: { err_code: 0 } });
    show();

    typeCode("4321");

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/cust/dashboard", { replace: true }));
  });

  test("a non-1 failure code is treated as a failure, not a pass", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: 7, err_msg: "Expired" } });
    show();

    typeCode("4321");

    await waitFor(() => expect(OTPauth).toHaveBeenCalled());
    expect(localStorage.getItem("user")).toBeNull();
  });

  test("a network throw creates no session", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockRejectedValue(new Error("offline"));
    show();

    typeCode("4321");

    await waitFor(() => expect(OTPauth).toHaveBeenCalled());
    expect(localStorage.getItem("user")).toBeNull();
    await screen.findByText(/Network error/i);
  });
});

describe("backend lockout / credential errors are not wrong codes", () => {
  const REPORTED =
    "Login attempts has exhausted, Please try after sometime or contact BBNL 15 min left, " +
    "Invalid User Credentials, please enter right userid & password to login.";

  test("does not consume a client attempt", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: 1, err_msg: REPORTED } });
    show();

    typeCode("1234");
    await waitFor(() => expect(OTPauth).toHaveBeenCalled());

    // The franchisee bug: header-auth rejection charged against the 5-attempt
    // cap, so the operator lost their tries to a problem no code could fix.
    expect(getPendingAuth().attempts).toBe(0);
    expect(hasPendingAuth()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("shows a trimmed message, not the concatenated wall of text", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: 1, err_msg: REPORTED } });
    show();

    typeCode("1234");

    await screen.findByText(/Login attempts has exhausted/i);
    expect(screen.queryByText(/attempts left/i)).toBeNull();
    expect(screen.queryByText(/userid & password/i)).toBeNull();
  });

  test("a genuine wrong code still counts and still shows the counter", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: 1, err_msg: "Invalid OTP" } });
    show();

    typeCode("1234");
    await waitFor(() => expect(OTPauth).toHaveBeenCalled());

    expect(getPendingAuth().attempts).toBe(1);
    expect(screen.getByText(/4 attempts left/i)).toBeTruthy();
  });

  test("creates no session", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: 1, err_msg: REPORTED } });
    show();

    typeCode("1234");
    await waitFor(() => expect(OTPauth).toHaveBeenCalled());
    expect(localStorage.getItem("user")).toBeNull();
  });
});

describe("attempt cap", () => {
  test("the 5th wrong code tears down the challenge and returns to login", async () => {
    setPendingAuth({ user: USER, otprefid: "99231" });
    OTPauth.mockResolvedValue({ status: { err_code: 1, err_msg: "Invalid OTP" } });
    show();

    for (let i = 0; i < 5; i++) {
      typeCode("1111");
      await waitFor(() => expect(OTPauth).toHaveBeenCalledTimes(i + 1));
    }

    expect(hasPendingAuth()).toBe(false);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(localStorage.getItem("user")).toBeNull();
  });
});

describe("resend", () => {
  test("swaps in the new otprefid and keeps the code shape", async () => {
    setPendingAuth({ user: USER, otprefid: "99231", otpLength: 6 });
    resendOTP.mockResolvedValue({ status: { err_code: 0 }, body: { otprefid: "55555" } });
    show();

    // The resend button is disabled until the 30s countdown elapses; call the
    // handler through the DOM once enabled would need fake timers, so assert the
    // escrow contract directly via the service the handler uses.
    const { updatePendingOtpRef } = await import("../services/pendingAuth");
    updatePendingOtpRef("55555");

    const p = getPendingAuth();
    expect(p.otprefid).toBe("55555");
    expect(p.otpLength).toBe(6);
  });
});
