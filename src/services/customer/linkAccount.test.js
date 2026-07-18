/**
 * Customer account-linking — wire contract + response-branch tests.
 *
 * Run: npx vitest run
 *
 * Fixtures are derived from the Android source (LinkCableAccounts_Fragment,
 * ServiceOTPAuthFragment, ApiInterface + the ServiceOTPModel / ServiceCustDetails
 * Gson models) — NOT from live traffic. Nothing in this flow has been exercised
 * against a real backend, so a green run here proves internal consistency
 * only. See the note at the bottom of tickets.test.js for the same caveat.
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

// body.userdata (custServiceOtp) and body[] rows (getServRegCastNos) share
// this exact field set — ServiceCustDetails in Android.
const USERDATA = {
  name: "Pwa Testing",
  mobileno: "9945762186",
  emailid: "pwa@example.com",
  address: "12 Main St",
  loginid: "pwaapptest2",
  userid: "pwaapptest2",
  servid: "1",
  logo: "uploads/op49.png",
  compname: "BBNL",
  castregid: "REG-8891",     // unlink key — NOT userid
  issubscribed: "yes",
  page: "general",
  opid: "BBNL_OP49",
};

const LINK_DIRECT = {
  status: { err_code: 0, err_msg: "Success" },
  body: { otpstatus: "no", otprefid: "1", is_ott_subscribed: "no", otp_datatype: "numeric", otp_totchars: "4", userdata: USERDATA },
};
const LINK_NEEDS_OTP = {
  status: { err_code: 0, err_msg: "OTP sent" },
  body: { otpstatus: "yes", otprefid: "99231", is_ott_subscribed: "no", otp_datatype: "numeric", otp_totchars: "6", userdata: USERDATA },
};
const LINK_REJECTED = { status: { err_code: 1, err_msg: "Invalid user id" } };

const SERVICE_LIST = {
  status: { err_code: 0, err_msg: "ok" },
  body: [
    { id: "3", title: "FoFi", keyword: "fofi", img: "img/fofi.png", description: "Smart box" },
    { id: "1", title: "Internet", keyword: "internet", img: "img/internet.png", description: "Broadband" },
    { id: "2", title: "Cable TV", keyword: "cabletv", img: "img/cable.png", description: "TV" },
  ],
};

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
  fetchMock = vi.fn().mockResolvedValue(mockResponse(LINK_DIRECT));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
//  linkServiceAccount — POST ServiceApis/custServiceOtp
// ══════════════════════════════════════════════════════════════════════
describe("linkServiceAccount", () => {
  test("POSTs form {username,servicekey,userid} to the ServiceApis path", async () => {
    const { linkServiceAccount } = await import("./linkAccount.js");
    await linkServiceAccount({ username: "appuser", servicekey: "internet", userid: "pwaapptest2" });
    const { url, opts } = lastRequest();
    // Capital-S ServiceApis, no trailing slash — Android's baseApiName.
    expect(url).toBe(`${BASE}ServiceApis/custServiceOtp`);
    expect(opts.method).toBe("POST");
    expect(lastForm()).toEqual({ username: "appuser", servicekey: "internet", userid: "pwaapptest2" });
  });

  test("sends the MAIN credential block, not the ticket APIS block", async () => {
    const { linkServiceAccount } = await import("./linkAccount.js");
    await linkServiceAccount({ username: "appuser", servicekey: "internet", userid: "x" });
    const { headers } = lastRequest();
    expect(headers.Authorization).toBe("TEST_AUTH_KEY");
    expect(headers.username).toBe("testuser");
    // The ticket endpoints use a completely different hardcoded set; sending
    // that here returns "Header Authorization Failed!".
    expect(headers.Authorization).not.toBe("c4f79e15f8c6ed0715a8ea44aebc38d8");
  });

  test("otpstatus 'no' links immediately and returns the account", async () => {
    const { linkServiceAccount } = await import("./linkAccount.js");
    const r = await linkServiceAccount({ username: "a", servicekey: "internet", userid: "pwaapptest2" });
    expect(r.ok).toBe(true);
    expect(r.needsOtp).toBe(false);
    expect(r.account).toMatchObject({
      userid: "pwaapptest2",
      opid: "BBNL_OP49",
      address: "12 Main St",
      mobileno: "9945762186",
      castregid: "REG-8891",
      servicekey: "internet",
    });
  });

  test("otpstatus 'yes' does NOT link — it returns an otprefid to verify with", async () => {
    const { linkServiceAccount } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse(LINK_NEEDS_OTP));
    const r = await linkServiceAccount({ username: "a", servicekey: "internet", userid: "x" });
    expect(r.ok).toBe(true);
    expect(r.needsOtp).toBe(true);
    expect(r.otprefid).toBe("99231");
    // otp_totchars arrives as a STRING; the input's maxLength needs a number.
    expect(r.otpTotChars).toBe(6);
    expect(typeof r.otpTotChars).toBe("number");
  });

  test("err_code 1 returns the backend reason instead of throwing", async () => {
    const { linkServiceAccount } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse(LINK_REJECTED));
    const r = await linkServiceAccount({ username: "a", servicekey: "internet", userid: "nope" });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Invalid user id");
    // A rejected link must not leave a half-populated account behind.
    expect(r.account).toBeUndefined();
  });

  test("HTTP failure throws rather than reporting a silent success", async () => {
    const { linkServiceAccount } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse("<html>502</html>", { status: 502 }));
    await expect(linkServiceAccount({ username: "a", userid: "b" })).rejects.toThrow(/HTTP 502/);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  verifyServiceOtp — POST ServiceApis/custServOtpVerification
// ══════════════════════════════════════════════════════════════════════
describe("verifyServiceOtp", () => {
  test("POSTs the five fields Android sends", async () => {
    const { verifyServiceOtp } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0, err_msg: "ok" }, body: USERDATA }));
    await verifyServiceOtp({ username: "appuser", otprefid: "99231", otpcode: "123456", servicekey: "internet", userid: "pwaapptest2" });
    expect(lastRequest().url).toBe(`${BASE}ServiceApis/custServOtpVerification`);
    expect(lastForm()).toEqual({
      username: "appuser", otprefid: "99231", otpcode: "123456",
      servicekey: "internet", userid: "pwaapptest2",
    });
  });

  test("success returns the same account shape as the direct link path", async () => {
    const { verifyServiceOtp, linkServiceAccount } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: USERDATA }));
    const viaOtp = await verifyServiceOtp({ username: "a", otpcode: "1", servicekey: "internet" });

    fetchMock.mockResolvedValue(mockResponse(LINK_DIRECT));
    const direct = await linkServiceAccount({ username: "a", servicekey: "internet", userid: "x" });

    // Both routes must yield an identical account object, so the caller can
    // treat them the same. Note verify's payload is body itself, while link's
    // is body.userdata — a real asymmetry this normalisation hides.
    expect(viaOtp.account).toEqual(direct.account);
  });

  test("a wrong OTP is reported, not thrown, and yields no account", async () => {
    const { verifyServiceOtp } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1, err_msg: "Invalid OTP" } }));
    const r = await verifyServiceOtp({ username: "a", otpcode: "0000" });
    expect(r.ok).toBe(false);
    expect(r.account).toBeNull();
    expect(r.message).toBe("Invalid OTP");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Service resolution
// ══════════════════════════════════════════════════════════════════════
describe("resolveService", () => {
  test("finds the service by keyword and exposes its numeric id", async () => {
    const { resolveService } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse(SERVICE_LIST));
    const svc = await resolveService("internet");
    // The id is NOT hardcoded — constants/services.js has INTERNET.servid = null
    // precisely because it was never confirmed. It must come from this list.
    expect(svc.servid).toBe("1");
    expect(svc.servicekey).toBe("internet");
    expect(svc.title).toBe("Internet");
  });

  test("builds the icon URL from `img`, not `icon`", async () => {
    const { resolveService } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse(SERVICE_LIST));
    const svc = await resolveService("internet");
    // Android's PrimaryServicesAdapter reads getImg(); `icon` is a different,
    // unused field. Base URL + relative path, joined without a double slash.
    expect(svc.iconUrl).toBe(`${BASE}img/internet.png`);
    expect(svc.iconUrl).not.toContain("//img");
  });

  test("returns null for a service the account does not have", async () => {
    const { resolveService } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse(SERVICE_LIST));
    await expect(resolveService("satellite")).resolves.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Linked list + unlink
// ══════════════════════════════════════════════════════════════════════
describe("linked accounts list", () => {
  test("GETs getServRegCastNos with servid + username", async () => {
    const { getLinkedAccounts } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [USERDATA] }));
    await getLinkedAccounts({ servid: "1", username: "appuser", servicekey: "internet" });
    const { url, opts } = lastRequest();
    expect(opts.method).toBe("GET");
    expect(url).toContain("ServiceApis/getServRegCastNos?");
    expect(url).toContain("servid=1");
    expect(url).toContain("username=appuser");
  });

  test("normalises rows and drops any without a userid", async () => {
    const { getLinkedAccounts } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(
      mockResponse({ status: { err_code: 0 }, body: [USERDATA, { name: "ghost" }, null] })
    );
    const rows = await getLinkedAccounts({ servid: "1", username: "a", servicekey: "internet" });
    expect(rows).toHaveLength(1);
    expect(rows[0].userid).toBe("pwaapptest2");
  });

  test("an absent body yields [] rather than throwing", async () => {
    const { getLinkedAccounts } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1, err_msg: "none" } }));
    await expect(getLinkedAccounts({ servid: "1", username: "a" })).resolves.toEqual([]);
  });

  test("removeLinkedAccount sends castregid as `regid`", async () => {
    const { removeLinkedAccount } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0, err_msg: "Removed" } }));
    const r = await removeLinkedAccount({ regid: "REG-8891" });
    expect(lastRequest().url).toBe(`${BASE}ServiceApis/delServRegCasNos`);
    const body = lastRequest().opts.body;
    // Sending the userid here silently deletes nothing — the backend keys on
    // the registration id.
    expect(new URLSearchParams(body).get("regid")).toBe("REG-8891");
    expect(r.ok).toBe(true);
  });

  test("a failed removal reports ok:false and does not throw", async () => {
    const { removeLinkedAccount } = await import("./linkAccount.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1, err_msg: "Cannot remove" } }));
    const r = await removeLinkedAccount({ regid: "R" });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Cannot remove");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Active-account persistence
// ══════════════════════════════════════════════════════════════════════
describe("active account persistence", () => {
  test("round-trips through localStorage", async () => {
    const { setActiveAccount, getActiveAccount, normalizeLinkedAccount } = await import("./linkAccount.js");
    const acc = normalizeLinkedAccount(USERDATA, "internet");
    setActiveAccount(acc);
    expect(getActiveAccount()).toEqual(acc);
  });

  test("clearActiveAccount removes it", async () => {
    const { setActiveAccount, clearActiveAccount, getActiveAccount, normalizeLinkedAccount } = await import("./linkAccount.js");
    setActiveAccount(normalizeLinkedAccount(USERDATA, "internet"));
    clearActiveAccount();
    expect(getActiveAccount()).toBeNull();
  });

  test("a corrupt stored value returns null instead of throwing", async () => {
    const { getActiveAccount, ACTIVE_ACCOUNT_KEY } = await import("./linkAccount.js");
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, "{not json");
    expect(getActiveAccount()).toBeNull();
  });

  test("an account with no userid is never stored", async () => {
    const { setActiveAccount, getActiveAccount } = await import("./linkAccount.js");
    setActiveAccount({ name: "nobody" });
    // A half-populated account would send empty ids to every ticket call.
    expect(getActiveAccount()).toBeNull();
  });

  test("the storage key is the one AuthContext clears on logout", async () => {
    const { ACTIVE_ACCOUNT_KEY } = await import("./linkAccount.js");
    // This value is duplicated as a literal in AuthContext's logout and
    // session-expiry paths. If it changes here and not there, a customer's
    // name/mobile/address survives into the next login on a shared device.
    expect(ACTIVE_ACCOUNT_KEY).toBe("custActiveAccount");
  });
});
