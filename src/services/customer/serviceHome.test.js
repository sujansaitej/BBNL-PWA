/**
 * Customer service-home — wire contracts for resetMac / data usage /
 * internet payment history, plus the pure helpers the home screen uses.
 *
 * Fixtures come from the Android source (CommonHomeScreenFragment,
 * ResetMacFragment, AverageUserReportFragment, InternetPaymentHistoryFragment
 * and their Gson models), NOT from live traffic. None of these has been
 * exercised against a real backend from the PWA.
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
//  Reset MAC
// ══════════════════════════════════════════════════════════════════════
describe("resetMac", () => {
  test("POSTs form {userid} to apis/cust/resetmac/ with the APIS block", async () => {
    const { resetMac } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(
      mockResponse({ body: { mac: "", macuserauth: "0" }, status: { err_code: 0, err_msg: "success" } })
    );
    await resetMac({ userid: "pwaapptest2" });
    const { url, opts, headers } = lastRequest();
    expect(url).toBe(`${BASE}apis/cust/resetmac/`);   // lowercase apis/, trailing slash
    expect(opts.method).toBe("POST");
    expect(lastForm()).toEqual({ userid: "pwaapptest2" });
    // The customer-app APIS block, same as the ticket endpoints — NOT the
    // main ServiceApis credentials.
    expect(headers.Authorization).toBe("c4f79e15f8c6ed0715a8ea44aebc38d8");
    expect(headers.apptype).toBe("customerapp-v1");
  });

  test("err_code 0 succeeds and surfaces the new mac", async () => {
    const { resetMac } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(
      mockResponse({ body: { mac: "AA:BB", macuserauth: "1" }, status: { err_code: 0, err_msg: "success" } })
    );
    const r = await resetMac({ userid: "u" });
    expect(r.ok).toBe(true);
    expect(r.mac).toBe("AA:BB");
  });

  test("non-zero err_code reports the backend message", async () => {
    const { resetMac } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1, err_msg: "Not allowed" } }));
    const r = await resetMac({ userid: "u" });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Not allowed");
  });

  test("HTTP failure throws — a silent 'success' would imply a reset that never happened", async () => {
    const { resetMac } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(mockResponse("<html>500</html>", { status: 500 }));
    await expect(resetMac({ userid: "u" })).rejects.toThrow(/HTTP 500/);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Data usage — different host, different envelope
// ══════════════════════════════════════════════════════════════════════
describe("data usage", () => {
  test("posts same-origin via the proxy, NOT the netmon base url and NOT the upstream host", async () => {
    const { getDataUsage, DATA_USAGE_URL } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: {} }));
    await getDataUsage({ apiopid: "OP1", apiuserid: "u", fromdt: "1-7-2026", todt: "18-7-2026" });
    const { url, headers } = lastRequest();
    expect(url).toBe(DATA_USAGE_URL);
    // Path lives under the app base (import.meta.env.BASE_URL) so it routes
    // like the rest of the app — same seam as easebuzz.getInitiateUrl(). A
    // root-relative path would escape the app's routing and 404 in prod.
    expect(url).toBe(`${import.meta.env.BASE_URL || "/"}usage-api/overallAvgUsageReport/`);
    expect(url).toMatch(/usage-api\/overallAvgUsageReport\/$/);
    expect(url).not.toContain("test.example");
    // Regression guard: the upstream host returns a static
    // `Access-Control-Allow-Origin: https://bbnl.co.in`, so calling it
    // directly from the browser is blocked by CORS ("Failed to fetch").
    expect(url).not.toContain("payurbills.co.in");
    // No auth on this one at all.
    expect(headers.Authorization).toBeUndefined();
  });

  test("sends the four fields Android sends", async () => {
    const { getDataUsage } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: {} }));
    await getDataUsage({ apiopid: "OP1", apiuserid: "cust1", fromdt: "1-7-2026", todt: "18-7-2026" });
    expect(lastForm()).toEqual({ apiopid: "OP1", apiuserid: "cust1", fromdt: "1-7-2026", todt: "18-7-2026" });
  });

  test("reads the {error,result} dialect, not {status,body}", async () => {
    const { getDataUsage } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(
      mockResponse({ error: 0, result: { upload: "29.3 Gb", download: "59.74 Gb", total: "89.04 Gb", balance: "Unlimited" } })
    );
    const r = await getDataUsage({});
    expect(r.ok).toBe(true);
    expect(r.upload).toBe("29.3 Gb");
    expect(r.balance).toBe("Unlimited");
  });

  test("error 1 is reported as not-ok", async () => {
    const { getDataUsage } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 1 }));
    expect((await getDataUsage({})).ok).toBe(false);
  });

  test("a PHP fatal error (HTML, HTTP 200) is not-ok rather than a thrown parse error", async () => {
    // Verbatim shape of what the live host returns for an account it does not
    // recognise — captured 2026-07-19 with apiuserid=THIS_USER_DOES_NOT_EXIST_XYZ.
    // It is HTTP 200 with an HTML body, so `resp.ok` does NOT catch it.
    const { getDataUsage } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(
      mockResponse(
        "<br />\n<b>Fatal error</b>:  Call to a member function query() on string in " +
          "<b>/var/www/html/best2/application/models/CustomerModel.php</b> on line <b>36</b><br />"
      )
    );

    // Must not reject: "Server returned an invalid response. Please try again."
    // blames the network and invites a retry that can never succeed.
    const r = await getDataUsage({ apiuserid: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.parseError).toBe(true);
    expect(r.balance).toBe("");
  });

  test("a well-formed error response is NOT flagged as a parse error", async () => {
    // Guards the distinction the UI copy depends on: error=2 means "bad
    // params", HTML means "unknown account". Different messages.
    const { getDataUsage } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(
      mockResponse({ error: 2, result: ["operator id is missing(apiopid)"] })
    );
    const r = await getDataUsage({});
    expect(r.ok).toBe(false);
    expect(r.parseError).toBe(false);
  });

  describe("toUsageDate", () => {
    test("formats d-M-yyyy WITHOUT zero padding", async () => {
      const { toUsageDate } = await import("./serviceHome.js");
      // Android builds this as dayOfMonth + "-" + (month+1) + "-" + year.
      // "05-07-2026" is a different string and has never been tested against
      // this endpoint.
      expect(toUsageDate("2026-07-05")).toBe("5-7-2026");
      expect(toUsageDate("2026-12-25")).toBe("25-12-2026");
      expect(toUsageDate(new Date(2026, 0, 1))).toBe("1-1-2026");
    });

    test("returns '' for an unparseable value rather than 'NaN-NaN-NaN'", async () => {
      const { toUsageDate } = await import("./serviceHome.js");
      expect(toUsageDate("")).toBe("");
      expect(toUsageDate("not-a-date")).toBe("");
    });
  });

  describe("usageToNumber", () => {
    test("strips the unit off a display string", async () => {
      const { usageToNumber } = await import("./serviceHome.js");
      expect(usageToNumber("29.3 Gb")).toBe(29.3);
      expect(usageToNumber("0")).toBe(0);
    });

    test("non-numeric values degrade to 0, never NaN", async () => {
      const { usageToNumber } = await import("./serviceHome.js");
      // "Unlimited" is a real balance value. NaN here would poison a width
      // calculation and blank the bar.
      expect(usageToNumber("Unlimited")).toBe(0);
      expect(usageToNumber(undefined)).toBe(0);
      expect(usageToNumber(null)).toBe(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Internet payment history
// ══════════════════════════════════════════════════════════════════════
describe("getInternetPaymentHistory", () => {
  test("POSTs form {apiopid,apiuserid} to apis/takebill/ with no auth", async () => {
    const { getInternetPaymentHistory } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, resultcount: "0", result: [] }));
    await getInternetPaymentHistory({ apiopid: "OP1", apiuserid: "cust1" });
    const { url, headers } = lastRequest();
    expect(url).toBe(`${BASE}apis/takebill/`);
    expect(lastForm()).toEqual({ apiopid: "OP1", apiuserid: "cust1" });
    expect(headers.Authorization).toBeUndefined();
  });

  test("returns rows from `result`", async () => {
    const { getInternetPaymentHistory } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(
      mockResponse({
        error: 0, resultcount: "1",
        result: [{ planname: "45Mbps", paid_amt: "588.82", payment_date: "2026-07-18", receipt_link: "https://x/r.pdf" }],
      })
    );
    const r = await getInternetPaymentHistory({ apiopid: "O", apiuserid: "c" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].paid_amt).toBe("588.82");
  });

  test("rows are kept even when `error` is non-zero", async () => {
    const { getInternetPaymentHistory } = await import("./serviceHome.js");
    // Android ignores `error` entirely here (its check is an empty block).
    // Blanking a customer's payment history over a flag the app has never
    // respected would be a regression against the native behaviour.
    fetchMock.mockResolvedValue(mockResponse({ error: 1, result: [{ paid_amt: "10" }] }));
    const r = await getInternetPaymentHistory({});
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  test("a missing result array yields [] rather than throwing", async () => {
    const { getInternetPaymentHistory } = await import("./serviceHome.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0 }));
    await expect(getInternetPaymentHistory({})).resolves.toMatchObject({ rows: [] });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Pure helpers
// ══════════════════════════════════════════════════════════════════════
describe("connectionsFor", () => {
  const BODY = {
    internet: [{ product_name: "INT-1", fserialno: "S1", primarybox: "yes" }],
    fofi: [{ product_name: "FOFI-1", fserialno: "S2" }],
    voip: [{ product_name: "VOIP-1", fserialno: "S3" }],
  };

  test("routes each service key to its own array", async () => {
    const { connectionsFor } = await import("./serviceHome.js");
    expect(connectionsFor(BODY, "internet")[0].product_name).toBe("INT-1");
    expect(connectionsFor(BODY, "voicecall")[0].product_name).toBe("VOIP-1");
    expect(connectionsFor(BODY, "fofi")[0].product_name).toBe("FOFI-1");
    // cabletv reads body.fofi in Android — deliberate, not a typo.
    expect(connectionsFor(BODY, "cabletv")[0].product_name).toBe("FOFI-1");
  });

  test("a customer with no connections gets [] instead of a crash", async () => {
    const { connectionsFor } = await import("./serviceHome.js");
    // Android leaves the list null here and throws NullPointerException on
    // the very next line. This helper exists to make that impossible.
    expect(connectionsFor({}, "internet")).toEqual([]);
    expect(connectionsFor(null, "internet")).toEqual([]);
    expect(connectionsFor({ internet: null }, "internet")).toEqual([]);
  });
});

describe("planRowFor", () => {
  const BODY = {
    subscribed_services: [
      { servicekey: "cabletv", planname: "TV Pack", expirydate: "2026-08-01" },
      { servicekey: "internet_fttx", planname: "45Mbps", expirydate: "2026-09-14 11:59:59 pm" },
    ],
  };

  test("matches on substring, as Android does", async () => {
    const { planRowFor } = await import("./serviceHome.js");
    // Android uses servicekey.contains(serviceKey), so "internet" matches a
    // row keyed "internet_fttx".
    expect(planRowFor(BODY, "internet").planname).toBe("45Mbps");
  });

  test("returns null when nothing matches or the body is empty", async () => {
    const { planRowFor } = await import("./serviceHome.js");
    expect(planRowFor(BODY, "voicecall")).toBeNull();
    expect(planRowFor({}, "internet")).toBeNull();
    expect(planRowFor(null, "internet")).toBeNull();
    expect(planRowFor(BODY, "")).toBeNull();
  });
});

describe("presentation helpers", () => {
  test("voicecall truncates the expiry date, others do not", async () => {
    const { formatExpiry } = await import("./serviceHome.js");
    expect(formatExpiry("2026-09-14 11:59:59 pm", "internet")).toBe("2026-09-14 11:59:59 pm");
    expect(formatExpiry("2026-09-14 11:59:59 pm", "voicecall")).toBe("2026-09-14");
    expect(formatExpiry("", "internet")).toBe("");
  });

  test("service titles match Android's per-key labels", async () => {
    const { serviceTitle } = await import("./serviceHome.js");
    expect(serviceTitle("internet")).toBe("Internet");
    expect(serviceTitle("cabletv")).toBe("OTT");     // yes, cabletv renders as "OTT"
    expect(serviceTitle("fofi")).toBe("FOFI");
    expect(serviceTitle("voicecall")).toBe("VOIP");
    expect(serviceTitle("unknown")).toBe("unknown");
  });

  test("the four action icons show for internet only", async () => {
    const { showsInternetActions } = await import("./serviceHome.js");
    expect(showsInternetActions("internet")).toBe(true);
    for (const k of ["cabletv", "fofi", "voicecall", ""]) {
      expect(showsInternetActions(k)).toBe(false);
    }
  });

  test("Proceed is gated on other_service_renewal.btn_status", async () => {
    const { isRenewEnabled } = await import("./serviceHome.js");
    expect(isRenewEnabled({ other_service_renewal: { btn_status: "enable" } })).toBe(true);
    expect(isRenewEnabled({ other_service_renewal: { btn_status: "disable" } })).toBe(false);
    expect(isRenewEnabled({})).toBe(false);
    expect(isRenewEnabled(null)).toBe(false);
  });
});
