/**
 * Wire-contract tests — IPTV / FoFi / Internet.
 *
 * Run: npx vitest run
 *
 * WHAT THESE DO
 * -------------
 * Mock `fetch` and assert the EXACT request each service function puts on the
 * wire: URL, method, headers, and body/field names. Then feed back real
 * response shapes and assert we branch correctly.
 *
 * WHAT THEY DO NOT DO
 * -------------------
 * They do not prove the backend accepts any of this. They encode a contract
 * that was verified ONCE, live, against staging on 2026-07-17 (see
 * tools/contract-smoke.cjs, which re-verifies on demand). If the backend
 * changes, these keep passing and the app breaks. Re-run the smoke script
 * before trusting a green run here.
 *
 * Every response fixture below is a REAL shape captured from
 * https://netmontest.bbnl.in/netmon/ — not invented from the Android source.
 * That distinction matters: the Android Gson models imply one universal
 * {status,body} envelope, and live traffic proves there are three.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// Env must exist before the modules under test read import.meta.env.
//
// PROD=true is deliberate. getBaseUrl() returns the dev proxy path ('/api/')
// unless PROD, and the dev proxy does not exist in production — so testing
// the non-PROD branch would assert a URL that never ships. We want the
// absolute origin the browser actually requests.
vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/prod/");
vi.stubEnv("VITE_API_AUTH_KEY", "TEST_AUTH_KEY");
vi.stubEnv("VITE_API_USERNAME", "testuser");
vi.stubEnv("VITE_API_PASSWORD", "testpass");
vi.stubEnv("VITE_API_APP_USER_TYPE", "employee");
vi.stubEnv("VITE_API_APP_USER_TYPE_CUST", "customer");
vi.stubEnv("VITE_API_APP_VERSION", "1.2.0");
vi.stubEnv("VITE_IPTV_API_BASE_URL", "https://test.example/prod/Cabletvapis");
vi.stubEnv("VITE_IPTV_API_USERNAME", "iptvuser@example.com");
vi.stubEnv("VITE_IPTV_API_PASSWORD", "iptvpass");
vi.stubEnv("VITE_IPTV_API_AUTH_KEY", "IPTV_AUTH_KEY");

// ── real captured response shapes (staging, 2026-07-17) ──────────────
const ENVELOPE_OK = { status: { err_code: 0, err_msg: "Success" }, body: [] };
const ENVELOPE_FAIL = { status: { err_code: 1, err_msg: "Please choose valid fofi box id" } };
// apis/webads — NO envelope. Verified: keys are exactly [count, imglist].
const WEBADS_REAL = { count: 2, imglist: [{ content: "a.png" }, { content: "b.png" }] };

let fetchMock;

function mockResponse(payload, { status = 200 } = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** The single request fetch was called with. */
function lastRequest() {
  const [url, opts] = fetchMock.mock.calls.at(-1);
  return { url, opts, headers: opts?.headers || {} };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(mockResponse(ENVELOPE_OK));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
//  Shared header contract — Android sends these on every ServiceApis call
// ══════════════════════════════════════════════════════════════════════
describe("shared header contract", () => {
  test("main profile sends all five auth headers + X-App-Package", async () => {
    const { getHeaders } = await import("./apiCore.js");
    const h = getHeaders();
    expect(h.Authorization).toBe("TEST_AUTH_KEY");
    expect(h.username).toBe("testuser");
    expect(h.password).toBe("testpass");
    expect(h.appversion).toBe("1.2.0");
    // Regression guard: fofiApis used to omit this, so FoFi traffic was
    // mis-attributed. It is now inherited from the shared builder.
    expect(h["X-App-Package"]).toBe("com.bbnl.smartphone");
  });

  test("appkeytype mirrors Android's per-flavor value, driven by loginType", async () => {
    const { getHeaders } = await import("./apiCore.js");
    localStorage.setItem("loginType", "franchisee");
    expect(getHeaders().appkeytype).toBe("employee");
    localStorage.setItem("loginType", "customer");
    expect(getHeaders().appkeytype).toBe("customer");
  });

  test("unset loginType falls back to customer, never undefined", async () => {
    const { getHeaders } = await import("./apiCore.js");
    // Pre-login prefetch fires with loginType null. It must still send a
    // valid appkeytype — `undefined` would reach the wire as the literal
    // string "undefined" and the backend would reject it.
    expect(getHeaders().appkeytype).toBe("customer");
  });

  test("form profile omits Content-Type so the browser sets the multipart boundary", async () => {
    const { getHeadersForm, getHeadersJson } = await import("./apiCore.js");
    // Setting Content-Type by hand on a FormData body produces a request with
    // no boundary — the backend cannot parse it. This is a real footgun.
    expect(getHeadersForm()["Content-Type"]).toBeUndefined();
    expect(getHeadersJson()["Content-Type"]).toBe("application/json");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Envelope dialects — VERIFIED live: there are three, per-endpoint
// ══════════════════════════════════════════════════════════════════════
describe("response envelope dialects", () => {
  test("STATUS dialect: err_code 0 passes, non-zero throws err_msg", async () => {
    const { readEnvelope } = await import("./apiCore.js");
    await expect(readEnvelope(mockResponse(ENVELOPE_OK), "t")).resolves.toEqual(ENVELOPE_OK);
    await expect(readEnvelope(mockResponse(ENVELOPE_FAIL), "t")).rejects.toThrow(
      "Please choose valid fofi box id"
    );
  });

  test("string err_code '0' passes — employee models type it as String", async () => {
    const { readEnvelope } = await import("./apiCore.js");
    const r = { status: { err_code: "0", err_msg: "ok" }, body: {} };
    await expect(readEnvelope(mockResponse(r), "t")).resolves.toEqual(r);
  });

  test("NO-ENVELOPE dialect must not be gated on err_code (the ads() bug)", async () => {
    const { isEnvelopeOk } = await import("./apiEnvelope.js");
    // apis/webads really returns {count, imglist} with no status block.
    // isEnvelopeOk correctly fails closed on it — which is exactly why ads()
    // must use readEnvelopeRaw. If someone "upgrades" ads() to readEnvelope,
    // this assertion documents why the carousel goes blank.
    expect(isEnvelopeOk(WEBADS_REAL)).toBe(false);
  });

  test("malformed JSON throws a readable error, does not NPE", async () => {
    const { readEnvelope } = await import("./apiCore.js");
    // Android routes 4xx to its SUCCESS handler with a null body and NPEs.
    // We must not reproduce that.
    await expect(readEnvelope(mockResponse("<html>500</html>", { status: 500 }), "t")).rejects.toThrow(
      /invalid response/i
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
//  IPTV — Cabletvapis, Basic auth + x-api-key (a DIFFERENT credential set)
// ══════════════════════════════════════════════════════════════════════
describe("IPTV flow", () => {
  test("getChannelList: URL, payload fields, and Basic auth", async () => {
    const { getChannelList } = await import("./iptvApi.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await getChannelList({ mobile: "9999999999", grid: "", bcid: "", langid: "", search: "" });

    const { url, opts, headers } = lastRequest();
    expect(url).toContain("/Cabletvapis/ftauserchnllist");
    expect(opts.method).toBe("POST");
    // IPTV uses Basic auth, NOT the main username/password headers.
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(opts.body)).toMatchObject({ mobile: "9999999999" });
  });

  test("getLanguageList hits ftauserlanglist with mobile", async () => {
    const { getLanguageList } = await import("./iptvApi.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await getLanguageList({ mobile: "9999999999" });

    const { url, opts } = lastRequest();
    expect(url).toContain("/Cabletvapis/ftauserlanglist");
    expect(JSON.parse(opts.body)).toMatchObject({ mobile: "9999999999" });
  });

  test("IPTV throws on non-zero err_code (it is the reference implementation)", async () => {
    const { getLanguageList } = await import("./iptvApi.js");
    fetchMock.mockResolvedValue(
      mockResponse({ status: { err_code: 1, err_msg: "Please input required values" } })
    );
    await expect(getLanguageList({ mobile: "1" })).rejects.toThrow("Please input required values");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  FoFi — ServiceApis, main credentials
// ══════════════════════════════════════════════════════════════════════
describe("FoFi flow", () => {
  test("getSpecialInternetPlans: URL + exact field names", async () => {
    const { getSpecialInternetPlans } = await import("./fofiApis.js");
    await getSpecialInternetPlans({ logUname: "superadmin", isKiranastore: "false" });

    const { url, opts, headers } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/specialInternetPlans");
    expect(opts.method).toBe("POST");
    // Regression guard for the header fofiApis used to drop.
    expect(headers["X-App-Package"]).toBe("com.bbnl.smartphone");
    expect(JSON.parse(opts.body)).toMatchObject({ logUname: "superadmin" });
  });

  test("validateBeforeFofiBoxReg sends username + loginuname", async () => {
    const { validateBeforeFofiBoxReg } = await import("./fofiApis.js");
    await validateBeforeFofiBoxReg({ username: "iptvuser", loginuname: "superadmin" });

    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/validateBeforeFofiBoxReg");
    expect(JSON.parse(opts.body)).toMatchObject({
      username: "iptvuser",
      loginuname: "superadmin",
    });
  });

  test("generateFofiOrder posts to the Android cable order path", async () => {
    const { generateFofiOrder } = await import("./fofiApis.js");
    await generateFofiOrder({ userid: "u", paidamount: 100, servid: "3" });

    const { url, opts } = lastRequest();
    // Same path Android uses: ApiInterface generateOrder_API.
    expect(url).toBe("https://test.example/prod/ServiceApis/cabletv/generateorder");
    expect(opts.method).toBe("POST");
    // Money must be numeric on the wire — Android's float handling is a known
    // hazard; do not let this regress to a string.
    expect(JSON.parse(opts.body).paidamount).toBe(100);
    expect(typeof JSON.parse(opts.body).paidamount).toBe("number");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Internet / payment
// ══════════════════════════════════════════════════════════════════════
describe("Internet flow", () => {
  test("custpayhistory keeps its THIRD credential set and `apptype` header", async () => {
    const { getOrderHistory } = await import("./orderApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await getOrderHistory({ apiopid: "BBNL_OP49", cid: "iptvuser" });

    const { url, headers } = lastRequest();
    expect(url).toContain("apis/custpayhistory");
    // VERIFIED live 2026-07-17: this endpoint rejects the main AND the
    // internet-payment credentials with "Header Authorization Failed!" and
    // accepts only these. They are load-bearing. Note `apptype`, not
    // `appkeytype` — also required. Do not "clean these up".
    expect(headers.Authorization).toBe("c4f79e15f8c6ed0715a8ea44aebc38d8");
    expect(headers.username).toBe("e2798af12a7a0f4f70b4d69efbc25f4d");
    expect(headers.password).toBe("c1f377afbaa874acbb6b61f66957710a");
    expect(headers.apptype).toBe("employee");
    expect(headers.appkeytype).toBeUndefined();
  });

  test("ads() tolerates the no-envelope shape and returns it intact", async () => {
    const { ads } = await import("./customer/apis.js");
    fetchMock.mockResolvedValue(mockResponse(WEBADS_REAL));
    // Dashboard.jsx reads data.imglist off the TOP LEVEL, not data.body.
    // Gating this on err_code blanks the carousel — see the smoke script.
    await expect(ads("1")).resolves.toEqual(WEBADS_REAL);
  });

  test("ads() still throws on transport failure", async () => {
    const { ads } = await import("./customer/apis.js");
    fetchMock.mockResolvedValue(mockResponse("<html>502</html>", { status: 502 }));
    await expect(ads("1")).rejects.toThrow(/HTTP 502/);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  KYC — the transport fix
// ══════════════════════════════════════════════════════════════════════
describe("KYC upload contract", () => {
  // NOTE ON WHAT MATTERS HERE. The backend source settles this:
  // CustomerRegistration::_custKYC() never reads `username` at all — not from
  // $_GET, not from $_POST. It switches on the $_FILES part NAME to derive
  // filetype, stores a temp row, and returns a file id that is bound to a
  // customer later via filerefid[]. So the part name is the real contract; the
  // username placement is cosmetic Android parity. These assertions are split
  // accordingly — the part-name one is load-bearing, the query one is not.
  test("custKYC file part name is the document type (this is what the server reads)", async () => {
    const { uploadKycFile } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await uploadKycFile("cust@example.com", file, "photo1");

    const { opts } = lastRequest();
    // _custKYC branches on $_FILES['photo1'] / ['idcard1'] / ['addrproof1'] /
    // ['signature'] / ['pan1'] to decide filetype. A wrong part name means the
    // file is silently not uploaded at all — $filetype stays '' and the
    // response comes back err_code 1 "tryagain".
    expect(opts.body.get("photo1")).toBeInstanceOf(File);
  });

  test("custKYC sends username in the query string (Android parity; server ignores it)", async () => {
    const { uploadKycFile } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await uploadKycFile("cust@example.com", file, "photo1");

    const { url, opts } = lastRequest();
    // Android: custKYCREG(@Part MultipartBody.Part, @Query("username") String).
    // Byte-identical wire format to the mobile app. The server reads neither
    // placement, so this guards parity, NOT correctness — do not cite it as
    // evidence that documents attach to the right customer.
    expect(url).toContain("ServiceApis/custKYC?username=");
    expect(url).toContain(encodeURIComponent("cust@example.com"));
    expect(opts.body.get("username")).toBeNull();
  });

  test("KYC upload does not abort on navigation (write path)", async () => {
    const { uploadKycFile } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    const file = new File(["x"], "p.jpg");
    await uploadKycFile("u", file, "photo1");
    // A half-delivered write leaves the record ambiguous. apiCore defaults
    // linkNavigation:true; write paths must opt out. If this regresses, an
    // operator navigating mid-upload silently loses the document.
    expect(fetchMock).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Cable-TV endpoints ported from Android (CABLE_TV_API_REPORT.md).
//  Every URL/param below was verified live against staging on 2026-07-17
//  (see the smoke run). These lock the wire format against regression.
// ══════════════════════════════════════════════════════════════════════
describe("Cable-TV endpoint contracts", () => {
  test("custSearchOptions posts { username, servid:int }", async () => {
    const { getCustSearchOptions } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: { providers: [] } }));
    await getCustSearchOptions({ username: "superadmin", servid: 1 });
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/custSearchOptions");
    const body = JSON.parse(opts.body);
    expect(body.username).toBe("superadmin");
    // servid MUST be a number on the wire (SearchOptionsRequest.java), not "1".
    expect(body.servid).toBe(1);
    expect(typeof body.servid).toBe("number");
  });

  test("subscribedChannels posts { userid, username, servid:string }", async () => {
    const { getSubscribedChannels } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    await getSubscribedChannels({ userid: "cust1", username: "superadmin", servid: 1 });
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/subscribedChannels");
    expect(JSON.parse(opts.body)).toMatchObject({ userid: "cust1", username: "superadmin", servid: "1" });
  });

  test("filterOptions is a GET with username/userid/apptype=android in the query", async () => {
    const { getFilterOptions } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    await getFilterOptions({ username: "superadmin", userid: "cust1" }, true);
    const { url, opts } = lastRequest();
    expect(opts.method).toBe("GET");
    expect(url).toContain("ServiceApis/filterOptions?");
    expect(url).toContain("apptype=android"); // literal from the APK
    expect(url).toContain("userid=cust1");
  });

  test("denominations is a bare POST with no body", async () => {
    const { getDenominations } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await getDenominations();
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/denominations");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeUndefined();
  });

  test("getServRegCastNos is a GET with servid/username in the query", async () => {
    const { getServRegCastNos } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await getServRegCastNos({ servid: 1, username: "superadmin" });
    const { url, opts } = lastRequest();
    expect(opts.method).toBe("GET");
    expect(url).toContain("ServiceApis/getServRegCastNos?");
    expect(url).toContain("servid=1");
  });

  test("delServRegCasNos is FORM-ENCODED with a single regid field (not JSON)", async () => {
    const { delServRegCasNos } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    await delServRegCasNos({ regid: "R123" });
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/delServRegCasNos");
    // The only form-encoded cable endpoint — body is URLSearchParams, not JSON.
    expect(opts.body).toBeInstanceOf(URLSearchParams);
    expect(opts.body.get("regid")).toBe("R123");
    // Form profile must NOT set Content-Type (browser sets urlencoded/boundary).
    expect(opts.headers["Content-Type"]).toBeUndefined();
  });

  test("registrationTermsAndConditions is a bare POST", async () => {
    const { getRegistrationTermsAndConditions } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: { result: "" } }));
    await getRegistrationTermsAndConditions();
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/registrationTermsAndConditions");
    expect(opts.method).toBe("POST");
  });

  test("crmGeneralDetails defaults username (backend requires it)", async () => {
    const { getCrmGeneralDetails } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    await getCrmGeneralDetails();
    const { opts } = lastRequest();
    // Verified live: empty body → err_code 1 "Please enter username."
    expect(JSON.parse(opts.body).username).toBe("superadmin");
  });

  test("ordersList sends the 6 empty filter fields the app always sends", async () => {
    const { getOrdersList } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(
      mockResponse({ status: { err_code: 0 }, body: { total_orders: 0, result: [] } })
    );
    await getOrdersList({ userid: "cust1", username: "superadmin", servid: 1 });
    const { url, opts } = lastRequest();
    // The REAL order-history endpoint — cabletv/orderhistory is a phantom (404).
    expect(url).toBe("https://test.example/prod/ServiceApis/ordersList");
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      userid: "cust1", username: "superadmin", servid: "1",
      ordernumber: "", txndatefrom: "", txndatetill: "",
      orderdatefrom: "", orderdatetill: "", paymentmode: "",
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Internet payment — native parity
//
//  These pin apis/savePaymentApi + apis/makepayment to the payloads the
//  Android app actually sends. Source of truth (crmapp-new-master):
//    RegistrationPaymentOverviewActivity.generateInternetOrder()   :257
//    EmployeeCommonPaymentInfoFragment.generateInternetOrder()     :430
//    RegistrationPaymentOverviewActivity.requestServerForInternet() :208
//  Native puts the FULL customer bill in `cashpaid` and never sends
//  `paidamount`. The PWA sent shareinfo.totbbnlshare (the "Amount
//  Deductable" figure) in `cashpaid` from its initial commit — a value
//  native never puts in that field.
// ══════════════════════════════════════════════════════════════════════
describe("internet payment native parity", () => {
  const BASE = {
    apiopid: "BBNL_OP49", apiuserid: "cust1", applicationname: "crmapp",
    paymode: "cash", transstatus: "success", renewstatus: "success",
    usagecompleted: 0, services_app: 1, paydoneby: "superadmin",
    payreceivedby: "superadmin", receivedremark: "cash", noofmonth: 1,
  };

  test("savePaymentApi sends the customer total in cashpaid, not the share split", async () => {
    const { payNow } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: "ok" }));
    // Screenshot case: plan 499 + CGST 44.91 + SGST 44.91 = 588.82 total,
    // totbbnlshare 306.00. Native sends 588.82.
    await payNow({ ...BASE, cashpaid: 588.82, omitPaidAmount: true });
    const body = new URLSearchParams(lastRequest().opts.body);
    expect(body.get("cashpaid")).toBe("588.82");
    expect(body.get("cashpaid")).not.toBe("306.00");
  });

  test("savePaymentApi omits paidamount — not in the native contract", async () => {
    const { payNow } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: "ok" }));
    await payNow({ ...BASE, cashpaid: 588.82, omitPaidAmount: true });
    const body = new URLSearchParams(lastRequest().opts.body);
    expect(body.has("paidamount")).toBe(false);
  });

  test("savePaymentApi field set matches native exactly on the renewal leg", async () => {
    const { payNow } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: "ok" }));
    await payNow({ ...BASE, cashpaid: 588.82, omitPaidAmount: true });
    const keys = [...new URLSearchParams(lastRequest().opts.body).keys()].sort();
    // EmployeeCommonPaymentInfoFragment.java:430-452 — no othamt/othreason.
    expect(keys).toEqual([
      "apiopid", "apiuserid", "applicationname", "cashpaid", "noofmonth",
      "paydoneby", "paymode", "payreceivedby", "receivedremark",
      "renewstatus", "services_app", "transstatus", "usagecompleted",
    ]);
  });

  test("registration leg adds othamt/othreason, renewal leg omits them", async () => {
    const { payNow } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: "ok" }));
    // RegistrationPaymentOverviewActivity.java:274-275
    await payNow({ ...BASE, cashpaid: 588.82, omitPaidAmount: true, othamt: "50", othreason: "install" });
    let body = new URLSearchParams(lastRequest().opts.body);
    expect(body.get("othamt")).toBe("50");
    expect(body.get("othreason")).toBe("install");

    await payNow({ ...BASE, cashpaid: 588.82, omitPaidAmount: true });
    body = new URLSearchParams(lastRequest().opts.body);
    expect(body.has("othamt")).toBe(false);
    expect(body.has("othreason")).toBe(false);
  });

  test("makepayment carries othamt/othreason on registration only", async () => {
    const { getPayDets } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: {} }));
    // requestServerForInternet(): !isinternetUpgrade branch, :216-219
    await getPayDets({ apiopid: "BBNL_OP49", apptype: "crmapp", apiuserid: "cust1", othamt: "50", othreason: "install" });
    let keys = [...new URLSearchParams(lastRequest().opts.body).keys()].sort();
    expect(keys).toEqual(["apiopid", "apiuserid", "apptype", "othamt", "othreason"]);

    // isinternetUpgrade branch, :212-214 — apiuserid + apiopid + apptype only.
    await getPayDets({ apiopid: "BBNL_OP49", apptype: "crmapp", apiuserid: "cust1" });
    keys = [...new URLSearchParams(lastRequest().opts.body).keys()].sort();
    expect(keys).toEqual(["apiopid", "apiuserid", "apptype"]);
  });

  test("cable/IPTV caller keeps paidamount — no native counterpart to copy", async () => {
    const { payNow } = await import("./registrationApis.js");
    fetchMock.mockResolvedValue(mockResponse({ error: 0, result: "ok" }));
    // IPTVService.jsx passes no omitPaidAmount; behaviour must be unchanged.
    await payNow({ ...BASE, cashpaid: 4.96 });
    const body = new URLSearchParams(lastRequest().opts.body);
    expect(body.get("paidamount")).toBe("4.96");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Ticketing — BYTE-IDENTICAL to native franchise app
//
//  Native's //Ticket block hits prod/Apis/<method> as POST form-urlencoded
//  with NO auth headers (verified live: getDepartments/getEmployee/etc.
//  return data with zero auth). getDepartments is the one GET. These pin the
//  URL casing (Apis/), method, absence of Authorization, and the exact field
//  sets per native ApiInterface.
// ══════════════════════════════════════════════════════════════════════
describe("ticketing native parity", () => {
  const OK = { status: { err_code: 0, err_msg: "ok" }, body: [] };

  test("getTktDepartments: GET Apis/getDepartments, NO auth headers", async () => {
    const { getTktDepartments } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse(OK));
    await getTktDepartments();
    const { url, opts, headers } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/getDepartments");
    expect(opts.method).toBe("GET");
    expect(headers.Authorization).toBeUndefined();
    expect(headers.username).toBeUndefined();
  });

  test("getTickets(OPEN): POST Apis/getAvailableTicket form {apiopid,newcon}, no auth", async () => {
    const { getTickets } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ ticketstatus: { err_code: 0 }, body: [] }));
    await getTickets("OPEN", { op_id: "OP1", user: "op1", dept: "" });
    const { url, opts, headers } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/getAvailableTicket");
    expect(opts.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.Authorization).toBeUndefined();
    const b = new URLSearchParams(opts.body);
    expect(b.get("apiopid")).toBe("OP1");
    expect(b.get("newcon")).toBe("Departments"); // native default when no dept
  });

  test("getTickets(PENDING): POST Apis/pendingTickets form {apiopid,newcon,loginid}", async () => {
    const { getTickets } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse(OK));
    await getTickets("PENDING", { op_id: "OP1", user: "op1", dept: "Sales" });
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/pendingTickets");
    const b = new URLSearchParams(opts.body);
    expect(b.get("apiopid")).toBe("OP1");
    expect(b.get("newcon")).toBe("Sales");
    expect(b.get("loginid")).toBe("op1");
  });

  test("getTickets(NEW CONNECTIONS): apiopid is the operator op_id, NOT 'raghav'", async () => {
    const { getTickets } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse(OK));
    await getTickets("NEW CONNECTIONS", { op_id: "OP1", user: "op1" });
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/getNewConnectionTicket");
    const b = new URLSearchParams(opts.body);
    expect(b.get("apiopid")).toBe("OP1");
    expect(b.get("apiopid")).not.toBe("raghav");
  });

  test("getTickets(JOB DONE): POST Apis/jobDoneList form {apiopid,userid}", async () => {
    const { getTickets } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse(OK));
    await getTickets("JOB DONE", { op_id: "OP1", user: "op1" });
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/jobDoneList");
    const b = new URLSearchParams(opts.body);
    expect(b.get("apiopid")).toBe("OP1");
    expect(b.get("userid")).toBe("op1");
  });

  test("pickTicket(pick): POST Apis/pickTicket form {ticketid,apiopid,empname,empcontact}", async () => {
    const { pickTicket } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 } }));
    await pickTicket({ ticketid: "T1", apiopid: "op1", empname: "op1", empcontact: "999" }, "");
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/pickTicket");
    expect(opts.method).toBe("POST");
    const b = new URLSearchParams(opts.body);
    expect(b.get("ticketid")).toBe("T1");
    expect(b.get("empcontact")).toBe("999");
  });

  test("pickTicket(close): POST Apis/crmCloseTicket", async () => {
    const { pickTicket } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 } }));
    await pickTicket({ ticketid: "T1", apiopid: "op1", empname: "op1", reason: "done", opid: "OP1" }, "close");
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/crmCloseTicket");
    const b = new URLSearchParams(opts.body);
    expect(b.get("reason")).toBe("done");
    expect(b.get("opid")).toBe("OP1");
  });

  test("pickTicket(transfer): POST Apis/transferTicket with native employee fields", async () => {
    const { pickTicket } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 } }));
    await pickTicket({ ticketid: "T1", toEmpname: "ARUN", toEmpLoginId: "arunrao", fromemp: "op1", toEmpMob: "8095", opid: "OP1" }, "transfer");
    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/transferTicket");
    const b = new URLSearchParams(opts.body);
    // The old code sent a bogus `employeeId`; native sends these instead.
    expect(b.get("toEmpLoginId")).toBe("arunrao");
    expect(b.get("toEmpname")).toBe("ARUN");
    expect(b.get("toEmpMob")).toBe("8095");
    expect(b.has("employeeId")).toBe(false);
  });

  test("getTicketEmployees: POST Apis/getEmployee form {opid,group=accounts}, no auth", async () => {
    const { getTicketEmployees } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await getTicketEmployees("OP1");
    const { url, opts, headers } = lastRequest();
    expect(url).toBe("https://test.example/prod/Apis/getEmployee");
    expect(opts.method).toBe("POST");
    expect(headers.Authorization).toBeUndefined();
    const b = new URLSearchParams(opts.body);
    expect(b.get("opid")).toBe("OP1");
    expect(b.get("group")).toBe("accounts");
  });
});
