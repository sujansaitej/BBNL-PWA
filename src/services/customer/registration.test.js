/**
 * Customer self sign-up — the "New Connection" funnel.
 *
 * Ported from the Android customer flavour's RegistrationActivity, reached from
 * LoginActivity's "Sign Up" link.
 *
 * EVERY RULE BELOW WAS CONFIRMED AGAINST THE LIVE BACKEND on 2026-09-01 by
 * submitting deliberately invalid payloads — each failed validation, so no
 * account was created and no welcome SMS was sent:
 *
 *   (all blank)          -> "Please enter first name."
 *   firstname=123        -> "First name should contain only alphabets."
 *   mobileno=123456789   -> "Mobile-no is invalid."
 *   username=ab          -> "Username length should be at least 5 characters."
 *   password=x           -> "Password length should be at least 8 characters."
 *   pincode=1234         -> "Please enter valid pincode."
 *   password=Pass{word1  -> "Password is not allowed ... don't use (\", ~, +, |, {, }, [, ], ;, ')"
 *   username=namich      -> "Username already exists, enter different username."
 *
 * The backend returns ONLY `$error[0]` — the first failure — and no body at
 * all. That is the whole reason validateSignUp() exists: without it the
 * customer would discover one broken field per round trip, which is exactly
 * what Android does with its nine-deep nested if and one Toast at a time.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/netmon/");
vi.stubEnv("VITE_API_AUTH_KEY", "KEY");
vi.stubEnv("VITE_API_USERNAME", "bbnl");
vi.stubEnv("VITE_API_PASSWORD", "PASS");
vi.stubEnv("VITE_API_APP_USER_TYPE_CUST", "customer");
vi.stubEnv("VITE_API_APP_VERSION", "1.2.0");

const apiFetch = vi.fn();
vi.mock("../apiCore", async (orig) => ({
  ...(await orig()),
  apiFetch: (...a) => apiFetch(...a),
}));

import {
  registerCustomer,
  validateSignUp,
  fieldForServerError,
  SIGNUP_LIMITS,
  FORBIDDEN_PASSWORD_CHARS,
} from "./registration";

const envelope = (err_code, err_msg) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: { err_code, err_msg } }),
  text: async () => "",
});

/** A payload that passes every client-side rule. */
const VALID = {
  firstname: "Asha", lastname: "Rao", mobileno: "9000000001",
  emailid: "asha@example.com", username: "asharao",
  password: "Passw0rd1", address: "12 Main Road", pincode: "560001",
};

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset().mockResolvedValue(envelope(0, "Registration successful."));
});

describe("the wire contract matches Android's @FormUrlEncoded @POST", () => {
  const sent = () => {
    const [url, opts] = apiFetch.mock.calls.at(-1);
    return { url, opts, fields: Object.fromEntries(new URLSearchParams(opts.body)) };
  };

  test("posts to ServiceApis/custRegistration", async () => {
    await registerCustomer(VALID);
    expect(sent().url).toBe("https://test.example/netmon/ServiceApis/custRegistration");
    expect(sent().opts.method).toBe("POST");
  });

  // The controller reads $this->input->post(), which never sees a JSON body —
  // sending JSON would leave every field null and fail on "enter first name".
  test("the body is form-urlencoded, not JSON", async () => {
    await registerCustomer(VALID);
    const { opts } = sent();
    expect(() => JSON.parse(opts.body)).toThrow();
    expect(opts.body).toContain("firstname=Asha");
  });

  test("sends exactly the ten fields Android declares", async () => {
    await registerCustomer(VALID);
    expect(Object.keys(sent().fields).sort()).toEqual([
      "address", "emailid", "firstname", "lastname", "latitude",
      "longitude", "mobileno", "password", "pincode", "username",
    ]);
  });

  // RegistrationActivity:189-190 hardcodes both to "" — the form has no map.
  test("latitude and longitude default to empty, as Android does", async () => {
    await registerCustomer(VALID);
    expect(sent().fields.latitude).toBe("");
    expect(sent().fields.longitude).toBe("");
  });

  test("whitespace is trimmed off, but the password is sent verbatim", async () => {
    await registerCustomer({ ...VALID, firstname: "  Asha  ", password: "  Pass word  " });
    expect(sent().fields.firstname).toBe("Asha");
    // Trimming a password silently changes the credential the customer chose,
    // and the backend md5()s whatever it receives.
    expect(sent().fields.password).toBe("  Pass word  ");
  });

  // THIS CREATES AN ACCOUNT AND FIRES AN EMAIL + SMS. It must never be picked
  // up by the load-balancer retry in apiCore, or a flaky node means two
  // accounts and two welcome messages.
  test("the call is never marked retryable", async () => {
    await registerCustomer(VALID);
    expect(apiFetch.mock.calls.at(-1)[3]).toMatchObject({ idempotent: false });
  });
});

describe("the response has no body — only err_code decides", () => {
  test("err_code 0 is success and carries the server's message", async () => {
    apiFetch.mockResolvedValue(envelope(0, "Registration successful."));
    expect(await registerCustomer(VALID)).toEqual({ ok: true, message: "Registration successful." });
  });

  test("err_code 1 is a failure and its message is surfaced verbatim", async () => {
    apiFetch.mockResolvedValue(envelope(1, "Username already exists, enter different username."));
    const res = await registerCustomer(VALID);
    expect(res.ok).toBe(false);
    expect(res.message).toBe("Username already exists, enter different username.");
  });

  test("a transport failure throws rather than reading as a refusal", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => "" });
    await expect(registerCustomer(VALID)).rejects.toThrow(/HTTP 500/);
  });
});

describe("client-side validation mirrors the backend's own rules", () => {
  test("a valid form produces no errors", () => {
    expect(validateSignUp(VALID)).toEqual({});
  });

  test("every field is required", () => {
    const errs = validateSignUp({});
    expect(Object.keys(errs).sort()).toEqual([
      "address", "emailid", "firstname", "lastname",
      "mobileno", "password", "pincode", "username",
    ]);
  });

  // Unlike Android, which Toasts one at a time, all failures come back at once.
  test("it reports every broken field together, not one per attempt", () => {
    const errs = validateSignUp({ ...VALID, username: "ab", password: "x", pincode: "1" });
    expect(Object.keys(errs).sort()).toEqual(["password", "pincode", "username"]);
  });

  test.each([
    ["firstname", "123", /only letters/i],
    ["lastname", "99", /only letters/i],
    ["mobileno", "123456789", new RegExp(`${SIGNUP_LIMITS.mobileLength} digits`)],
    ["mobileno", "abcdefghij", /only digits/i],
    ["emailid", "notanemail", /valid email/i],
    ["username", "ab", new RegExp(`${SIGNUP_LIMITS.usernameMin} characters`)],
    ["username", "has space", /letters, numbers and underscore/i],
    ["password", "short", new RegExp(`${SIGNUP_LIMITS.passwordMin} characters`)],
    ["pincode", "1234", new RegExp(`${SIGNUP_LIMITS.pincodeLength} digits`)],
  ])("%s = %j is rejected", (field, value, expected) => {
    expect(validateSignUp({ ...VALID, [field]: value })[field]).toMatch(expected);
  });

  test.each(FORBIDDEN_PASSWORD_CHARS)("a password containing %s is rejected", (ch) => {
    expect(validateSignUp({ ...VALID, password: `Passw0rd${ch}` }).password).toMatch(/cannot contain/i);
  });

  // A 10-digit mobile was accepted live (the next error was about username),
  // which is how the exact length was established rather than assumed.
  test("a 10-digit mobile passes", () => {
    expect(validateSignUp({ ...VALID, mobileno: "9000000001" }).mobileno).toBeUndefined();
  });
});

// Uniqueness is the one class of failure the client cannot predict, so the
// server's single message has to land under the right input rather than only
// in a banner the customer has to map back to a field themselves.
describe("the server's one error is routed to the field it belongs to", () => {
  test.each([
    ["Username already exists, enter different username.", "username"],
    ["Mobile-no already exists.", "mobileno"],
    ["Email-id already exists.", "emailid"],
    ["Please enter valid pincode.", "pincode"],
    ["Password is not allowed, try different password.", "password"],
    ["First name should contain only alphabets.", "firstname"],
  ])("%j -> %s", (message, field) => {
    expect(fieldForServerError(message)).toBe(field);
  });

  test("an unrecognised message is left for the form-level banner", () => {
    expect(fieldForServerError("Something unexpected happened")).toBeNull();
    expect(fieldForServerError("")).toBeNull();
  });
});
