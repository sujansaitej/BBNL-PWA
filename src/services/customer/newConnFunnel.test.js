/**
 * New Connection — the guest funnel.
 *
 * Ported from Android's NewConnectionFragment
 * (employee/java/.../Activity/NewConnectionFragment.java — note the path: the
 * customer-facing screen lives under the *employee* source dir, and there is a
 * SECOND unrelated file of the same name in Fragments/ which is the operator's
 * ticket queue).
 *
 * The wire contract comes from the BACKEND, not that file: its two
 * `requestNewConnection(...)` calls both sit inside block comments and the
 * method is defined nowhere in the repo. Read from Apis.php and verified live
 * 2026-09-01 against netmontest.
 *
 * THE BUG THIS FIXES. QA: "currently in both testing and prod showing mobile
 * number not exist". requestNewConnection calls
 * Ticket_model::newConnUserExists($mob), which reads the `newconn_info` table —
 * and ONLY registerNewConnection writes to it. The APK calls the submit without
 * ever seeding that row, so it fails for everyone. Reproduced exactly:
 *
 *   POST Apis/requestNewConnection mobile=9000000001&services=3,7&lat=..&lng=..
 *   -> {"err_code":1,"err_msg":"Mobile no. not exists"}
 *
 * So submitRequest() registers FIRST, then requests.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/netmon/");
vi.stubEnv("VITE_WEBLOGIN_AUTH_KEY", "WEB_KEY");
vi.stubEnv("VITE_WEBLOGIN_USERNAME", "WEB_USER");
vi.stubEnv("VITE_WEBLOGIN_PASSWORD", "WEB_PASS");
vi.stubEnv("VITE_API_AUTH_KEY", "MAIN_KEY");
vi.stubEnv("VITE_API_USERNAME", "mainuser");
vi.stubEnv("VITE_API_PASSWORD", "mainpass");

const apiFetch = vi.fn();
vi.mock("../apiCore", async (orig) => ({
  ...(await orig()),
  apiFetch: (...a) => apiFetch(...a),
}));

import {
  getAvailableServices, loginNewCustomer, registerNewConnection,
  requestNewConnection, getNewConnectionStatus, submitRequest, validateRequest,
  getNearbyOperators, checkRequestAllowed, CAN_REQUEST,
} from "./newConnFunnel";

const envelope = (err_code, err_msg, body = null) => ({
  ok: true, status: 200,
  json: async () => ({ status: { err_code, err_msg }, body }),
  text: async () => "",
});

const call = (n = -1) => {
  const [url, opts, label, cfg] = apiFetch.mock.calls.at(n);
  return { url, opts, label, cfg, fields: Object.fromEntries(new URLSearchParams(opts.body)) };
};

const PROFILE = {
  fname: "Asha", lname: "Rao", mobile: "9000000001", email: "a@b.c",
  address: "12 Main Road", pincode: "560001", username: "asharao", password: "",
};

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset().mockResolvedValue(envelope(0, "ok"));
});

// Apis.php gates these five on their OWN key (:33-35, :51). Anything else —
// including the app's usual credentials — answers "Header Authorization
// Failed!", which is what cost several probes before the gate was found.
describe("the funnel uses its own credential set", () => {
  test.each([
    ["getAvailableServices", () => getAvailableServices()],
    ["loginNewCustomer", () => loginNewCustomer("9000000001")],
    ["registerNewConnection", () => registerNewConnection(PROFILE)],
    ["requestNewConnection", () => requestNewConnection({ mobile: "9", services: ["3"], lat: 1, lng: 2 })],
    ["getNewConnectionStatus", () => getNewConnectionStatus("9000000001")],
  ])("%s sends the WEBLOGIN credentials", async (_n, run) => {
    await run();
    const h = call().opts.headers;
    expect(h.Authorization).toBe("WEB_KEY");
    expect(h.username).toBe("WEB_USER");
    expect(h.password).toBe("WEB_PASS");
    // _headerAuth() compares only those three; the main set would be rejected.
    expect(h.Authorization).not.toBe("MAIN_KEY");
  });

  test.each([
    ["getAvailableServices", () => getAvailableServices(), "Apis/getAvailableServices"],
    ["requestNewConnection", () => requestNewConnection({ mobile: "9", services: [], lat: 1, lng: 2 }), "Apis/requestNewConnection"],
    ["getNewConnectionStatus", () => getNewConnectionStatus("9"), "Apis/getNewConnectionStatus"],
  ])("%s posts to the right url", async (_n, run, path) => {
    await run();
    expect(call().url).toBe(`https://test.example/netmon/${path}`);
    expect(call().opts.method).toBe("POST");
  });
});

describe("SELECT SERVICE comes from the backend", () => {
  test("multi + list are unwrapped", async () => {
    apiFetch.mockResolvedValue(envelope(0, "Services listed successfully", {
      list_type: "multi",
      list: [{ id: "1", title: "Cable TV" }, { id: "3", title: "Fo-Fi Smart Box" }],
    }));
    const r = await getAvailableServices();
    expect(r.ok).toBe(true);
    // list_type "multi" is why the picker is checkboxes, not radios.
    expect(r.multi).toBe(true);
    expect(r.services.map((s) => s.title)).toEqual(["Cable TV", "Fo-Fi Smart Box"]);
  });

  test("it is a read, so the load-balancer retry may replay it", async () => {
    await getAvailableServices();
    expect(call().cfg).toMatchObject({ idempotent: true });
  });
});

// THE HEADLINE FIX.
describe("submit seeds newconn_info before requesting", () => {
  test("registerNewConnection runs FIRST, then requestNewConnection", async () => {
    await submitRequest({ profile: PROFILE, services: ["3", "7"], lat: 13.02, lng: 77.59 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(call(0).url).toContain("Apis/registerNewConnection");
    expect(call(1).url).toContain("Apis/requestNewConnection");
  });

  // The row may already exist from an earlier attempt; that must not stop the
  // submit. Only the request's own verdict counts.
  test("a failed registration does not block the request", async () => {
    apiFetch
      .mockRejectedValueOnce(new Error("already registered"))
      .mockResolvedValueOnce(envelope(0, "Request submitted"));
    const r = await submitRequest({ profile: PROFILE, services: ["3"], lat: 1, lng: 2 });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Request submitted");
  });

  test("services go on the wire as a CSV of ids", async () => {
    await requestNewConnection({ mobile: "9000000001", services: ["3", "7"], lat: 13.02, lng: 77.59 });
    expect(call().fields).toMatchObject({
      mobile: "9000000001", services: "3,7", lat: "13.02", lng: "77.59",
    });
  });

  // Creates a ticket and sends an SMS — must never be replayed by the retry.
  test.each([
    ["registerNewConnection", () => registerNewConnection(PROFILE)],
    ["requestNewConnection", () => requestNewConnection({ mobile: "9", services: [], lat: 1, lng: 2 })],
  ])("%s is not retryable", async (_n, run) => {
    await run();
    expect(call().cfg).toMatchObject({ idempotent: false });
  });

  test("a signed-in customer is not signed up again", async () => {
    await registerNewConnection(PROFILE);
    expect(call().fields.do_signup).toBe("0");
  });
});

describe("the backend's own verdicts are surfaced", () => {
  test("'Mobile no. not exists' is reported, not swallowed", async () => {
    apiFetch.mockResolvedValue(envelope(1, "Mobile no. not exists"));
    const r = await requestNewConnection({ mobile: "9", services: ["3"], lat: 1, lng: 2 });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Mobile no. not exists");
  });

  // err_code 0 — the request IS on file, so this is success-shaped.
  test("'Request already made' counts as success", async () => {
    apiFetch.mockResolvedValue(envelope(0, "Request already made"));
    expect((await requestNewConnection({ mobile: "9", services: ["3"], lat: 1, lng: 2 })).ok).toBe(true);
  });

  test("ticket status unwraps the list and is keyed on mobile", async () => {
    apiFetch.mockResolvedValue(envelope(0, "Tickets listed successfully!", [
      { tid: "20260900001", status: "Available", subject: "New Connection" },
    ]));
    const r = await getNewConnectionStatus("9000000001");
    expect(call().fields).toEqual({ mobile: "9000000001" });
    expect(r.tickets).toHaveLength(1);
  });

  test("no records is an empty list, not an error", async () => {
    apiFetch.mockResolvedValue(envelope(0, "No records found", null));
    const r = await getNewConnectionStatus("9000000001");
    expect(r.ok).toBe(true);
    expect(r.tickets).toEqual([]);
  });
});

// requestNewConnection validates exactly {mobile, services, lat, lng} and
// reports the first missing one as "Missed field <name>".
describe("validation matches the four fields the backend requires", () => {
  const VALID = { mobile: "9000000001", services: ["3"], lat: 13.02, lng: 77.59 };

  test("a valid request passes", () => {
    expect(validateRequest(VALID)).toEqual({});
  });

  test.each([
    ["mobile", { mobile: "" }, /required/i],
    ["mobile", { mobile: "12345" }, /10-digit/i],
    ["services", { services: [] }, /at least one service/i],
    ["location", { lat: null, lng: null }, /mark your location/i],
  ])("%s is validated", (field, patch, expected) => {
    expect(validateRequest({ ...VALID, ...patch })[field]).toMatch(expected);
  });
});

/**
 * Nearby operators — the green pins and the Operator Details popup.
 *
 * This is the piece I twice told the user did not exist. It does: the CUSTOMER
 * app (bbnlcustomerapp-master, a SECOND repo) calls
 * `POST apis/cust/clientlatlong/` through a method named
 * `submitFeedback_And_Rating` — nothing to do with feedback. Verified live
 * 2026-09-01: 6 operators around 13.0296,77.5906.
 *
 * Two things make it unlike every other call in this file: a different
 * credential set (the `apis/*` block, Constants.CONGIF_*_APIS) and a THIRD
 * envelope shape, `{result:[...], msg:"success"}`.
 */
describe("nearby operators", () => {
  const OPERATORS = {
    ok: true, status: 200, text: async () => "",
    json: async () => ({
      result: [
        { sno: "BBNL_OP835", opt_id: "BBNL_OP835", opr_name: "ANAND CABLE", cnum: "8095596113",
          latitude: "13.03132800", longitude: "77.59131320", distance: "0.128691",
          optrAddr: "100,4TH MAIN ,AGS COLONY,ANANDANAGAR BANGLORE -560024" },
      ],
      msg: "success",
    }),
  };

  test("it uses the apis/* credential set, NOT the funnel's own", async () => {
    apiFetch.mockResolvedValue(OPERATORS);
    await getNearbyOperators({ lat: 13.02, lng: 77.59 });
    const h = call().opts.headers;
    expect(h.Authorization).toBe("c4f79e15f8c6ed0715a8ea44aebc38d8");
    expect(h.username).toBe("e2798af12a7a0f4f70b4d69efbc25f4d");
    expect(h.password).toBe("c1f377afbaa874acbb6b61f66957710a");
    // apptype "customerapp-v1" — a different header from the main profile's
    // appkeytype, and not interchangeable with it.
    expect(h.apptype).toBe("customerapp-v1");
    expect(h.Authorization).not.toBe("WEB_KEY");
  });

  test("it posts lat/lng to apis/cust/clientlatlong/", async () => {
    apiFetch.mockResolvedValue(OPERATORS);
    await getNearbyOperators({ lat: 13.02, lng: 77.59 });
    expect(call().url).toBe("https://test.example/netmon/apis/cust/clientlatlong/");
    expect(call().fields).toEqual({ lat: "13.02", lng: "77.59" });
    // A pure read — safe for the load-balancer retry.
    expect(call().cfg).toMatchObject({ idempotent: true });
  });

  // {result, msg} — neither status.err_code nor status.errcode.
  test("the third envelope shape is unwrapped into pin fields", async () => {
    apiFetch.mockResolvedValue(OPERATORS);
    const { ok, operators } = await getNearbyOperators({ lat: 13.02, lng: 77.59 });
    expect(ok).toBe(true);
    expect(operators).toEqual([{
      id: "BBNL_OP835", name: "ANAND CABLE", phone: "8095596113",
      address: "100,4TH MAIN ,AGS COLONY,ANANDANAGAR BANGLORE -560024",
      lat: 13.031328, lng: 77.5913132, distance: 0.128691,
    }]);
  });

  test("an operator without coordinates is dropped rather than pinned at 0,0", async () => {
    apiFetch.mockResolvedValue({
      ok: true, status: 200, text: async () => "",
      json: async () => ({ result: [{ opt_id: "A", opr_name: "No Coords" }], msg: "success" }),
    });
    expect((await getNearbyOperators({ lat: 1, lng: 2 })).operators).toEqual([]);
  });

  test("an empty area is an empty list, not a throw", async () => {
    apiFetch.mockResolvedValue({
      ok: true, status: 200, text: async () => "",
      json: async () => ({ result: [], msg: "success" }),
    });
    const r = await getNearbyOperators({ lat: 1, lng: 2 });
    expect(r.ok).toBe(true);
    expect(r.operators).toEqual([]);
  });
});

/**
 * The eligibility gate — `Apis/noofconnection/`.
 *
 * Ported from the customer app's `getConnReqCount`, which runs on entry and
 * again after every successful submit and drives whether SELECT SERVICE is
 * clickable at all.
 *
 * The trap: err_code says the OPPOSITE of what it looks like. Verified live
 * against netmontest — 0 means blocked, 1 means allowed — so the verdict must
 * come from err_msg, which is what Android does too (both err_code branches run
 * identical code).
 */
describe("eligibility gate", () => {
  const gate = (err_code, err_msg) => ({
    ok: true, status: 200, text: async () => "",
    json: async () => ({ status: { err_code, err_msg } }),
  });

  test("err_code 1 + 'no pending ticket' ALLOWS the request", async () => {
    apiFetch.mockResolvedValue(gate(1, "no pending ticket for new connection"));
    expect(await checkRequestAllowed("9945698745")).toEqual({
      allowed: true, reason: "no pending ticket for new connection",
    });
  });

  // The inversion, pinned: a 0 here is a refusal, not a success.
  test("err_code 0 + 'Request already made' BLOCKS it", async () => {
    apiFetch.mockResolvedValue(gate(0, "Request already made"));
    const r = await checkRequestAllowed("9000000001");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("Request already made");
  });

  test.each([
    ["limit exceeded"],            // more than 4 requests ever (Apis.php:5067)
    ["please enter required fields"],
  ])("'%s' blocks it too", async (msg) => {
    apiFetch.mockResolvedValue(gate(1, msg));
    expect((await checkRequestAllowed("9")).allowed).toBe(false);
  });

  test("it posts the mobile and uses the apis/* credential set", async () => {
    apiFetch.mockResolvedValue(gate(1, CAN_REQUEST));
    await checkRequestAllowed("9945698745");
    expect(call().url).toBe("https://test.example/netmon/Apis/noofconnection/");
    expect(call().fields).toEqual({ mobile: "9945698745" });
    expect(call().opts.headers.apptype).toBe("customerapp-v1");
  });
});
