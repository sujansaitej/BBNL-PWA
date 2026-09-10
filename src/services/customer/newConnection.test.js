/**
 * New Connection — a signed-in customer requesting an additional connection.
 *
 * REQUIREMENT: the request must appear in the OPERATOR PORTAL's Tickets page,
 * under its New Connection section. That section is Apis/getNewConnectionTicket,
 * which selects tickets whose `subject` AND `group1` are both the literal
 * 'new Connection'.
 *
 * NOT A PORT. The Android APK has this as a bottom-nav tab, but the source
 * snapshot in crmapp-new-master is OLDER than that build — its third tab is
 * `bottom_menu_info`, titled "Info", whose handler is a Toast("Coming soon!")
 * with the fragment commented out. So this is written against the BACKEND that
 * produces the required outcome, not against Android code.
 *
 * THE ENDPOINT, read from
 * application/modules/WebModule/controllers/WebMod/Sections.php::newConnection()
 * and confirmed live on 2026-09-01 by walking its validation with incomplete
 * payloads (nothing was created):
 *
 *   {}                                  -> "Please enter name"
 *   {name}                              -> "Please enter email"
 *   {name,email}                        -> "Please enter username"
 *   {name,email,uname}                  -> "Please enter address"
 *   {name,email,uname,address}          -> "Please enter mobile"
 *   {name,email,uname,address,mobileno} -> "Please enter pincode"
 *   pincode="1"                         -> "Pincode must be 6"
 *
 * It is UNAUTHENTICATED (the probes sent no credentials) and takes a JSON body.
 * It answers a DIFFERENT envelope from the rest of the API:
 * `{result, status:{errcode, message}}` with 200/400 — not
 * `{status:{err_code}}` where 0 means success.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/netmon/");

const apiFetch = vi.fn();
vi.mock("../apiCore", async (orig) => ({
  ...(await orig()),
  apiFetch: (...a) => apiFetch(...a),
}));

import {
  requestNewConnection,
  validateNewConnection,
  NEW_CONNECTION_LIMITS,
} from "./newConnection";

const reply = (errcode, message) => ({
  ok: true,
  status: 200,
  json: async () => ({ result: null, status: { errcode, message } }),
  text: async () => "",
});

const VALID = {
  name: "Asha Rao", email: "asha@example.com", uname: "asharao",
  address: "12 Main Road", mobileno: "9000000001", pincode: "560001",
};

const sent = () => {
  const [url, opts] = apiFetch.mock.calls.at(-1);
  return { url, opts, body: JSON.parse(opts.body) };
};

beforeEach(() => {
  apiFetch.mockReset().mockResolvedValue(
    reply(200, "Thank you, Our callcenter team will soon connect you")
  );
});

describe("the request reaches the endpoint that feeds the operator's queue", () => {
  test("posts to webmodapi/webnewConnection", async () => {
    await requestNewConnection(VALID);
    expect(sent().url).toBe("https://test.example/netmon/webmodapi/webnewConnection");
    expect(sent().opts.method).toBe("POST");
  });

  // The controller reads _POSTVAR from the raw input stream. A form body leaves
  // every field empty and it answers "Please enter name" no matter what.
  test("the body is JSON, not form-urlencoded", async () => {
    await requestNewConnection(VALID);
    expect(sent().opts.headers["Content-Type"]).toBe("application/json");
    expect(() => JSON.parse(sent().opts.body)).not.toThrow();
  });

  // The error messages say "username" and "mobile", but the FIELDS are `uname`
  // and `mobileno`. Sending the names from the messages gets the same error
  // back forever, which is exactly how this was nearly mis-implemented.
  test("uses the field names the controller reads, not the ones its errors name", async () => {
    await requestNewConnection(VALID);
    const body = sent().body;
    expect(body).toHaveProperty("uname", "asharao");
    expect(body).toHaveProperty("mobileno", "9000000001");
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("mobile");
  });

  test("sends every field the endpoint validates", async () => {
    await requestNewConnection(VALID);
    for (const k of ["name", "email", "uname", "address", "mobileno", "pincode"]) {
      expect(sent().body[k], k).toBeTruthy();
    }
  });

  // Raises a ticket. The load-balancer retry in apiCore must never replay it,
  // or the operator receives the same request twice.
  test("the call is never marked retryable", async () => {
    await requestNewConnection(VALID);
    expect(apiFetch.mock.calls.at(-1)[3]).toMatchObject({ idempotent: false });
  });
});

// The wrapper sets $reqArvar['address'] but Complaints/newComplaint reads
// `custAddress` — the names do not match, so the address never reaches the
// ticket. `comments` DOES survive, so the address is repeated there. Without
// this the operator opens a request with nowhere to send an engineer.
describe("the address survives the backend's dropped-field bug", () => {
  test("address and pincode are repeated in comments", async () => {
    await requestNewConnection(VALID);
    const { comments } = sent().body;
    expect(comments).toContain("12 Main Road");
    expect(comments).toContain("560001");
  });

  test("the customer's own notes are kept alongside it", async () => {
    await requestNewConnection({ ...VALID, comments: "Second floor, blue gate" });
    expect(sent().body.comments).toContain("Second floor, blue gate");
    expect(sent().body.comments).toContain("12 Main Road");
  });

  test("the trail names who asked, so the ticket is attributable", async () => {
    await requestNewConnection(VALID);
    expect(sent().body.comments).toContain("asharao");
  });
});

// errcode is an HTTP-STYLE code — 200 is success. Reading it with the usual
// envelope rule (err_code 0 = success) would invert every outcome.
describe("the unusual envelope is read correctly", () => {
  test("errcode 200 is success and carries the backend's wording", async () => {
    const res = await requestNewConnection(VALID);
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/callcenter team will soon connect you/i);
  });

  test("errcode 400 is a failure", async () => {
    apiFetch.mockResolvedValue(reply(400, "Pincode must be 6"));
    expect(await requestNewConnection(VALID)).toEqual({ ok: false, message: "Pincode must be 6" });
  });

  // 0 is NOT success here, unlike every other endpoint in this app.
  test("errcode 0 is not mistaken for success", async () => {
    apiFetch.mockResolvedValue(reply(0, "whatever"));
    expect((await requestNewConnection(VALID)).ok).toBe(false);
  });

  test("a transport failure throws rather than reading as a refusal", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}), text: async () => "" });
    await expect(requestNewConnection(VALID)).rejects.toThrow(/HTTP 502/);
  });
});

describe("validation mirrors Sections.php::newConnection", () => {
  test("a valid form passes", () => {
    expect(validateNewConnection(VALID)).toEqual({});
  });

  test("every field is required", () => {
    expect(Object.keys(validateNewConnection({})).sort()).toEqual([
      "address", "email", "mobileno", "name", "pincode", "uname",
    ]);
  });

  test.each([
    ["pincode", "1234", /must be 6 digits/i],
    ["pincode", "abcdef", /only digits/i],
    ["mobileno", "12345", /at least 10 digits/i],
    ["mobileno", "1234567890123456", /at most 15 digits/i],
    ["email", "notanemail", /valid email/i],
    ["name", "12345", /should contain letters/i],
  ])("%s = %j is rejected", (field, value, expected) => {
    expect(validateNewConnection({ ...VALID, [field]: value })[field]).toMatch(expected);
  });

  // Sections.php:394 rejects these outright.
  test.each(["0000000000", "1111111111", "3333333333"])("the blocked mobile %s is rejected", (m) => {
    expect(validateNewConnection({ ...VALID, mobileno: m }).mobileno).toMatch(/valid mobile/i);
  });

  test("the limits match what the backend told us", () => {
    expect(NEW_CONNECTION_LIMITS.pincodeLength).toBe(6);
  });
});
