/**
 * Operator tools — wire contracts for apis/custusage and apis/resetmac.
 *
 * Fixtures come from the Android CRM app's employee flavour (ApiInterface
 * lines 855-884, dataUsageReport, ResetMacFragment and their Gson models),
 * NOT from live traffic.
 *
 * The point of these tests is the CREDENTIAL BLOCK. Both endpoints sit under
 * `apis/` and take Android's NEW_* set with an `apptype` header. The sibling
 * endpoint apis/custpayhistory was verified live to reject both the main and
 * the internet-payment credentials outright, so a "cleanup" that routes these
 * through getHeaders() would 401 every call with no local signal.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/prod/");
vi.stubEnv("VITE_API_AUTH_KEY", "TEST_AUTH_KEY");
vi.stubEnv("VITE_API_USERNAME", "testuser");
vi.stubEnv("VITE_API_PASSWORD", "testpass");
vi.stubEnv("VITE_API_APP_USER_TYPE", "employee");
vi.stubEnv("VITE_API_APP_USER_TYPE_CUST", "customer");
vi.stubEnv("VITE_API_APP_VERSION", "1.2.0");

const BASE = "https://test.example/prod/";

let fetchMock;
function mockResponse(payload, { status = 200 } = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}
function lastRequest() {
  const [url, opts] = fetchMock.mock.calls.at(-1);
  return { url, opts, headers: opts?.headers || {} };
}
function lastForm() {
  return Object.fromEntries(new URLSearchParams(lastRequest().opts.body));
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(mockResponse({ status: { err_code: 0 } }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  localStorage.setItem("loginType", "franchisee");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
//  Data usage
// ══════════════════════════════════════════════════════════════════════
describe("getCustomerDataUsage", () => {
  test("POSTs form {apiopid, cid, adminuser, from, to} to apis/custusage", async () => {
    const { getCustomerDataUsage } = await import("./operatorTools.js");
    fetchMock.mockResolvedValue(
      mockResponse({
        body: { download: "29.3G", upload: "4.1G", total: "33.4G", limit: "Unlimited", fromdate: "1-8-2026", todate: "31-8-2026" },
        status: { err_code: 0, err_msg: "success" },
      })
    );

    const res = await getCustomerDataUsage({
      apiopid: "BBNL_OP49",
      cid: "bbnl_op49_c4491",
      adminuser: "demopwa",
      from: "1-8-2026",
      to: "31-8-2026",
    });

    const { url, opts } = lastRequest();
    expect(url).toBe(`${BASE}apis/custusage`);
    expect(opts.method).toBe("POST");
    expect(lastForm()).toEqual({
      apiopid: "BBNL_OP49",
      cid: "bbnl_op49_c4491",
      adminuser: "demopwa",
      from: "1-8-2026",
      to: "31-8-2026",
    });
    expect(res.ok).toBe(true);
    expect(res.download).toBe("29.3G");
    expect(res.limit).toBe("Unlimited");
  });

  test("keeps the THIRD credential set and the `apptype` header", async () => {
    const { getCustomerDataUsage } = await import("./operatorTools.js");
    await getCustomerDataUsage({ apiopid: "OP", cid: "C", adminuser: "u", from: "1-1-2026", to: "2-1-2026" });
    const { headers } = lastRequest();
    expect(headers.Authorization).toBe("c4f79e15f8c6ed0715a8ea44aebc38d8");
    expect(headers.username).toBe("e2798af12a7a0f4f70b4d69efbc25f4d");
    expect(headers.password).toBe("c1f377afbaa874acbb6b61f66957710a");
    expect(headers.apptype).toBe("employee");
    // `appkeytype` is the OTHER block's key. Its presence means someone
    // swapped this call onto getHeaders() and it will 401 in production.
    expect(headers.appkeytype).toBeUndefined();
  });

  test("err_code 1 is reported as not-ok with the backend's own message", async () => {
    const { getCustomerDataUsage } = await import("./operatorTools.js");
    fetchMock.mockResolvedValue(mockResponse({ body: null, status: { err_code: 1, err_msg: "user id not exists" } }));
    const res = await getCustomerDataUsage({ apiopid: "OP", cid: "nope", adminuser: "u", from: "", to: "" });
    expect(res.ok).toBe(false);
    expect(res.message).toBe("user id not exists");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Reset MAC
// ══════════════════════════════════════════════════════════════════════
describe("resetCustomerMac", () => {
  test("POSTs form {apiopid, cid, adminuser} to apis/resetmac", async () => {
    const { resetCustomerMac } = await import("./operatorTools.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0, err_msg: "success" } }));

    const res = await resetCustomerMac({ apiopid: "BBNL_OP118", cid: "118c1373", adminuser: "demopwa" });

    const { url, opts } = lastRequest();
    expect(url).toBe(`${BASE}apis/resetmac`);
    expect(opts.method).toBe("POST");
    expect(lastForm()).toEqual({ apiopid: "BBNL_OP118", cid: "118c1373", adminuser: "demopwa" });
    expect(res.ok).toBe(true);
    expect(res.message).toBe("success");
  });

  test("is NOT the customer endpoint — apis/cust/resetmac/ takes only {userid}", async () => {
    const { resetCustomerMac } = await import("./operatorTools.js");
    await resetCustomerMac({ apiopid: "OP", cid: "C", adminuser: "u" });
    const { url } = lastRequest();
    expect(url).not.toContain("cust/resetmac");
    expect(Object.keys(lastForm())).not.toContain("userid");
  });

  test("surfaces the failure message instead of throwing on err_code 1", async () => {
    const { resetCustomerMac } = await import("./operatorTools.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1, err_msg: "please enter user id" } }));
    const res = await resetCustomerMac({ apiopid: "OP", cid: "", adminuser: "u" });
    expect(res.ok).toBe(false);
    expect(res.message).toBe("please enter user id");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Date format
// ══════════════════════════════════════════════════════════════════════
describe("toDMY", () => {
  test("emits Android's UNPADDED d-M-yyyy", () => {
    // Android builds this by concatenation: dayOfMonth + "-" +
    // (monthOfYear + 1) + "-" + year. "05-07-2026" is a different string
    // and has never been tested against this backend.
    return import("./operatorTools.js").then(({ toDMY }) => {
      expect(toDMY("2026-07-05")).toBe("5-7-2026");
      expect(toDMY("2026-12-25")).toBe("25-12-2026");
      expect(toDMY("")).toBe("");
      expect(toDMY("not-a-date")).toBe("");
    });
  });
});

describe("bareCustomerId", () => {
  test("strips the [OPID] suffix custpayhistory decorates cid with", async () => {
    const { bareCustomerId } = await import("./operatorTools.js");
    // VERIFIED 2026-08-31 against netmontest: custpayhistory RETURNS
    // "testrag7 [BBNL_OP49]" but custusage/resetmac/custpayhistory all
    // reject that exact string as input.
    expect(bareCustomerId("testrag7 [BBNL_OP49]")).toBe("testrag7");
    expect(bareCustomerId("testrag7")).toBe("testrag7");
    expect(bareCustomerId("")).toBe("");
    expect(bareCustomerId(undefined)).toBe("");
  });

  test("the wire calls normalise cid, so a pasted decorated id still works", async () => {
    const { getCustomerDataUsage, resetCustomerMac } = await import("./operatorTools.js");
    await getCustomerDataUsage({ apiopid: "OP", cid: "testrag7 [BBNL_OP49]", adminuser: "u", from: "1-1-2026", to: "2-1-2026" });
    expect(lastForm().cid).toBe("testrag7");
    await resetCustomerMac({ apiopid: "OP", cid: "testrag7 [BBNL_OP49]", adminuser: "u" });
    expect(lastForm().cid).toBe("testrag7");
  });
});

describe("splitUsage", () => {
  test("splits value and unit, and leaves a bare number unitless", async () => {
    const { splitUsage } = await import("./operatorTools.js");
    expect(splitUsage("29.3G")).toEqual({ num: 29.3, unit: "GB" });
    expect(splitUsage("512M")).toEqual({ num: 512, unit: "MB" });
    // Android falls through to "Tb" for anything with no G/M — a bare
    // number is NOT terabytes, so no unit is claimed here.
    expect(splitUsage("0")).toEqual({ num: 0, unit: "" });
    expect(splitUsage("")).toEqual({ num: 0, unit: "" });
  });
});
