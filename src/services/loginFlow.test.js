import { describe, test, expect } from "vitest";
import {
  resolveLoginOutcome,
  homeFor,
  otpLength,
  otpDataType,
  otpContradiction,
  classifyOtpFailure,
  firstSentence,
} from "./loginFlow";

const BODY = {
  username: "demopwa",
  firstname: "Demo",
  lastname: "Operator",
  emailid: "demo@bbnl.in",
  mobileno: "9000000001",
  op_id: "BBNL_OP49",
  photo: "",
};

const ok = (extra) => ({ status: { err_code: 0, err_msg: "Success" }, body: { ...BODY, ...extra } });

describe("resolveLoginOutcome — OTP must gate the session", () => {
  test("otpstatus 'yes' returns action 'otp', never 'session'", () => {
    const r = resolveLoginOutcome(ok({ otpstatus: "yes", otprefid: "99231" }), "franchisee");
    // The regression this file exists for: QA found that a correct password
    // plus the back button got into the app without an OTP, because the login
    // handler created the session before reading otpstatus.
    expect(r.action).toBe("otp");
    expect(r.action).not.toBe("session");
    expect(r.otprefid).toBe("99231");
    expect(r.user.username).toBe("demopwa");
  });

  test("otpstatus 'no' returns action 'session'", () => {
    const r = resolveLoginOutcome(ok({ otpstatus: "no" }), "franchisee");
    expect(r.action).toBe("session");
    expect(r.user.op_id).toBe("BBNL_OP49");
  });

  test.each(["YES", "Yes", "yEs", " yes ", "y", "Y", "true", "1"])(
    "case/format variant %j still requires OTP",
    (variant) => {
      // `otpstatus === 'yes'` alone would hand out a session for every one of
      // these — the same bypass through a different door.
      expect(resolveLoginOutcome(ok({ otpstatus: variant }), "franchisee").action).toBe("otp");
    }
  );

  test.each(["no", "NO", "No", "n", "false", "0", ""])(
    "negative variant %j does not require OTP",
    (variant) => {
      expect(resolveLoginOutcome(ok({ otpstatus: variant }), "franchisee").action).toBe("session");
    }
  );

  test("a missing otpstatus grants a session (documented, deliberate)", () => {
    // Absent means the backend did not ask for a second factor. Failing closed
    // here would strand every no-OTP account on a code-less OTP screen.
    const body = { ...BODY };
    delete body.otpstatus;
    expect(resolveLoginOutcome({ status: { err_code: 0 }, body }, "franchisee").action).toBe("session");
  });

  test("otprefid is coerced to a string and defaults to empty", () => {
    expect(resolveLoginOutcome(ok({ otpstatus: "yes", otprefid: 99231 }), "franchisee").otprefid).toBe("99231");
    expect(resolveLoginOutcome(ok({ otpstatus: "yes" }), "franchisee").otprefid).toBe("");
  });
});

describe("resolveLoginOutcome — failures never grant a session", () => {
  test("err_code 1 is an error", () => {
    const r = resolveLoginOutcome(
      { status: { err_code: 1, err_msg: "Invalid username or password" } },
      "franchisee"
    );
    expect(r.action).toBe("error");
    expect(r.message).toMatch(/invalid/i);
  });

  test.each([2, 3, 99, -1, "1"])("non-zero err_code %j is an error, not a pass", (code) => {
    // The pre-fix shape was `if (err_code === 1) fail; else succeed`, so any
    // other code fell through as a successful login.
    const r = resolveLoginOutcome({ status: { err_code: code }, body: BODY }, "franchisee");
    expect(r.action).toBe("error");
  });

  test("a success envelope with no body is an error", () => {
    expect(resolveLoginOutcome({ status: { err_code: 0 } }, "franchisee").action).toBe("error");
  });

  test("a body with no username is an error", () => {
    const r = resolveLoginOutcome({ status: { err_code: 0 }, body: { firstname: "x" } }, "franchisee");
    expect(r.action).toBe("error");
  });

  test.each([null, undefined, {}, "", 0])("garbage response %j is an error", (resp) => {
    expect(resolveLoginOutcome(resp, "franchisee").action).toBe("error");
  });
});

describe("OTP dispatched but otpstatus doesn't say \"yes\"", () => {
  // Operators reported receiving the OTP SMS while the app took them straight
  // to the dashboard. That means a code was issued but the response did not
  // read as "yes" — most likely a case/format variant that the old strict
  // `otpstatus === 'yes'` comparison missed.
  test.each(["Yes", "YES", "yEs", " yes ", "1", "true", "TRUE", "Y", "sent", "SUCCESS"])(
    "value %j requires OTP",
    (variant) => {
      expect(resolveLoginOutcome(ok({ otpstatus: variant, otprefid: "99231" }), "franchisee").action)
        .toBe("otp");
    }
  );

  test("an UNRECOGNISED otpstatus requires OTP when a challenge was issued", () => {
    // Fail closed on the unknown — a code exists, so ask for it.
    const r = resolveLoginOutcome(ok({ otpstatus: "pending_verification", otprefid: "99231" }), "franchisee");
    expect(r.action).toBe("otp");
    expect(r.otprefid).toBe("99231");
  });

  test("an UNRECOGNISED otpstatus with NO otprefid must NOT block login", () => {
    // Nothing was issued, so an OTP screen would ask for a code that does not
    // exist. Never strand the operator.
    const body = { ...BODY, otpstatus: "weird_value" };
    delete body.otprefid;
    expect(resolveLoginOutcome({ status: { err_code: 0 }, body }, "franchisee").action).toBe("session");
  });

  test.each(["0", "null", "", "none"])(
    "explicit negative %j still logs in even with an otprefid present",
    (variant) => {
      // Honouring a stale otprefid here would lock out every no-OTP account.
      // Reported via LOGIN_OTP_CONTRADICTION instead of guessed at.
      expect(resolveLoginOutcome(ok({ otpstatus: variant, otprefid: "1" }), "franchisee").action)
        .toBe("session");
    }
  );
});

describe("otpContradiction — evidence for the backend team", () => {
  test("flags 'no' + a real otprefid", () => {
    expect(otpContradiction({ otpstatus: "no", otprefid: "99231" })).toBe(true);
  });

  test.each(["0", "", "null"])("does not flag negative %j with a placeholder otprefid", (ref) => {
    expect(otpContradiction({ otpstatus: "no", otprefid: ref })).toBe(false);
  });

  test("does not flag a normal no-OTP response", () => {
    expect(otpContradiction({ otpstatus: "no" })).toBe(false);
  });

  test("does not flag a normal OTP response", () => {
    expect(otpContradiction({ otpstatus: "yes", otprefid: "99231" })).toBe(false);
  });

  test("does not flag an absent otpstatus", () => {
    expect(otpContradiction({ otprefid: "99231" })).toBe(false);
  });
});

describe("OTP code shape follows the account, not a hardcoded 4", () => {
  // Android sizes its pin view from otp_totchars
  // (OTPVerificationActivity.onCreate). The PWA hardcoded 4, so a 6-character
  // account could never finish typing — the 4th keystroke auto-submitted a
  // truncated code. linkAccount.test.js already carries a real otp_totchars:"6".
  test("honours otp_totchars", () => {
    const r = resolveLoginOutcome(ok({ otpstatus: "yes", otp_totchars: "6" }), "franchisee");
    expect(r.otpLength).toBe(6);
  });

  test("defaults to 4 when absent", () => {
    expect(resolveLoginOutcome(ok({ otpstatus: "yes" }), "franchisee").otpLength).toBe(4);
  });

  test.each([["4", 4], ["6", 6], [8, 8], [6, 6]])("otp_totchars %j → %i", (given, want) => {
    expect(otpLength({ otp_totchars: given })).toBe(want);
  });

  test.each([null, undefined, "", "abc", 0, 3, 9, 999, -1, "1e3"])(
    "clamps junk otp_totchars %j to 4",
    (given) => {
      // A junk value must not render hundreds of inputs or fewer than a code.
      expect(otpLength({ otp_totchars: given })).toBe(4);
    }
  );

  test("honours alphanumeric otp_datatype", () => {
    const r = resolveLoginOutcome(
      ok({ otpstatus: "yes", otp_datatype: "alphanumeric" }),
      "franchisee"
    );
    expect(r.otpDataType).toBe("alphanumeric");
  });

  test.each(["numeric", "", null, undefined, "NUMERIC", "digits", "weird"])(
    "otp_datatype %j falls back to numeric",
    (given) => {
      expect(otpDataType({ otp_datatype: given })).toBe("numeric");
    }
  );

  test.each(["alphanumeric", "ALPHANUMERIC", " Alphanumeric "])(
    "otp_datatype %j is recognised as alphanumeric",
    (given) => {
      expect(otpDataType({ otp_datatype: given })).toBe("alphanumeric");
    }
  );

  test("code shape is absent from a no-OTP outcome", () => {
    const r = resolveLoginOutcome(ok({ otpstatus: "no" }), "franchisee");
    expect(r.action).toBe("session");
    expect(r.otpLength).toBeUndefined();
  });
});

describe("OTP failure classification", () => {
  // The exact string from the franchisee bug report — three server messages
  // concatenated. Charging this to the 5-attempt cap burned the operator's
  // remaining tries on a problem no code could fix.
  const REPORTED =
    "Login attempts has exhausted, Please try after sometime or contact BBNL 15 min left, " +
    "Invalid User Credentials, please enter right userid & password to login.";

  test("the reported franchisee message is 'blocked', not a wrong code", () => {
    expect(classifyOtpFailure(REPORTED)).toBe("blocked");
  });

  test.each([
    "Invalid User Credentials, please enter right userid & password to login.",
    "Login attempts has exhausted, Please try after sometime",
    "Please try after sometime or contact BBNL 15 min left",
    "Account locked",
    "Too many requests",
    "3 attempts left",
  ])("%j is blocked", (msg) => {
    expect(classifyOtpFailure(msg)).toBe("blocked");
  });

  test.each(["Invalid OTP", "Invalid otp code", "OTP expired", "Wrong code entered", ""])(
    "%j is a wrong-code failure",
    (msg) => {
      expect(classifyOtpFailure(msg)).toBe("wrong-code");
    }
  );

  test("firstSentence trims the concatenated server text", () => {
    const out = firstSentence(REPORTED);
    expect(out.length).toBeLessThan(REPORTED.length);
    expect(out).toMatch(/Login attempts has exhausted/);
    expect(out).not.toMatch(/userid/);
  });

  test("firstSentence caps very long single sentences", () => {
    const long = "x".repeat(400);
    expect(firstSentence(long).length).toBeLessThanOrEqual(120);
  });

  test("firstSentence falls back for empty input", () => {
    expect(firstSentence("")).toBe("Invalid OTP");
    expect(firstSentence(null)).toBe("Invalid OTP");
  });
});

describe("post-login destination", () => {
  test("franchisee lands on the operator dashboard", () => {
    expect(homeFor("franchisee")).toBe("/");
    expect(resolveLoginOutcome(ok({ otpstatus: "no" }), "franchisee").home).toBe("/");
  });

  test("customer lands on the customer dashboard", () => {
    expect(homeFor("customer")).toBe("/cust/dashboard");
    expect(resolveLoginOutcome(ok({ otpstatus: "no" }), "customer").home).toBe("/cust/dashboard");
  });

  test("loginType rides along so the OTP screen can route after verifying", () => {
    const r = resolveLoginOutcome(ok({ otpstatus: "yes", otprefid: "1" }), "customer");
    expect(r.loginType).toBe("customer");
    expect(r.home).toBe("/cust/dashboard");
  });
});
