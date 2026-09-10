/**
 * Wire-contract tests — Voice Call ("voicecall").
 *
 * Same discipline as contract.test.js: mock `fetch` and assert the EXACT
 * request each voice function puts on the wire. Each assertion cites the line
 * in the Android app it encodes, because that source — not this file — is the
 * authority for the payload.
 *
 *   crmapp-new-master/app/src/employee/.../Fragments/
 *     EmployeeCommonPaymentInfoFragment.java
 *       :177-191  requestServer()          → service/paymentinfo/{servicekey}
 *       :487-513  generateOrderRequest()   → ServiceApis/cabletv/generateorder
 *     CustomerCompleteOverviewFragment.java
 *       :598-601  getUserAssignedItems     {servkey, userid}
 *       :1404-14  getMyPlanDetails         {servicekey, userid, fofiboxid, voipnumber}
 *
 * These prove what WE send. They do not prove the backend accepts it.
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

function lastRequest() {
  const [url, opts] = fetchMock.mock.calls.at(-1);
  return { url, opts, headers: opts?.headers || {}, body: JSON.parse(opts.body) };
}

const OK = { status: { err_code: 0, err_msg: "Success" }, body: {} };

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(mockResponse(OK));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
//  paymentinfo/voicecall
// ══════════════════════════════════════════════════════════════════════
describe("voice paymentinfo contract", () => {
  test("posts to service/paymentinfo/voicecall — NOT the fofi path", async () => {
    const { getVoicePaymentInfo } = await import("./voiceApis.js");
    await getVoicePaymentInfo({ userid: "cust1", voipnumber: "08012345678", servid: "5" });

    const { url, opts } = lastRequest();
    expect(url).toBe("https://test.example/prod/service/paymentinfo/voicecall");
    expect(opts.method).toBe("POST");
  });

  test("sends exactly the 8 PaymnentInfoDetailsRequest fields native sends", async () => {
    const { getVoicePaymentInfo } = await import("./voiceApis.js");
    await getVoicePaymentInfo({
      fofi_box_id: "BOX-1",
      planid: "77",
      priceid: "99",
      servid: "5",
      userid: "cust1",
      username: "operator1",
      voipnumber: "08012345678",
    });

    const { body } = lastRequest();
    expect(Object.keys(body).sort()).toEqual([
      "fofi_box_id", "planid", "priceid", "servapptype",
      "servid", "userid", "username", "voipnumber",
    ]);
    // Constants.CONGIF_PAYMENT_FROM
    expect(body.servapptype).toBe("crmapp");
    // The operator's app_username — native passes the `username` bundle arg,
    // which EmployeeCustomerListFragment:314 seeded from app_username.
    expect(body.username).toBe("operator1");
    // …and userid is the CUSTOMER. Swapping these is the classic mistake.
    expect(body.userid).toBe("cust1");
  });

  test("snake_case fofi_box_id survives — the model field is not camelCase", async () => {
    const { getVoicePaymentInfo } = await import("./voiceApis.js");
    await getVoicePaymentInfo({ userid: "c", fofi_box_id: "BBNL-BOX-9" });
    const { body } = lastRequest();
    expect(body.fofi_box_id).toBe("BBNL-BOX-9");
    expect(body.fofiboxid).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  cabletv/generateorder — the voice leg
// ══════════════════════════════════════════════════════════════════════
describe("voice generateorder contract", () => {
  const FULL = {
    userid: "cust1",
    username: "operator1",
    servid: "5",
    paidamount: 304.44,
    transactionid: "TXN-1",
    fofiboxid: "BOX-1",
    planid: "77",
    priceid: "99",
    voipnumber: "08012345678",
  };

  test("posts to the shared Android cable order path", async () => {
    const { generateVoiceOrder } = await import("./voiceApis.js");
    await generateVoiceOrder(FULL);
    expect(lastRequest().url).toBe("https://test.example/prod/ServiceApis/cabletv/generateorder");
  });

  test("RENEW leg: 17 keys and paytype ABSENT", async () => {
    // EmployeeCommonPaymentInfoFragment.generateOrderRequest() :487-513 never
    // touches paytype, so Gson drops it. Sending it here would put a key on
    // the renewal wire body that native has never sent.
    const { generateVoiceOrder } = await import("./voiceApis.js");
    await generateVoiceOrder(FULL);

    const { body } = lastRequest();
    expect(Object.keys(body).sort()).toEqual([
      "bankname", "banktxnid", "fofiboxid", "gateway", "gatewaytxnid",
      "orderedbytype", "paidamount", "paymentmode", "payresponse",
      "planid", "priceid", "servid", "transactionid", "txnstatus",
      "userid", "username", "voipnumber",
    ]);
    expect("paytype" in body).toBe(false);
    // Nor any of the cable-only arrays.
    expect(body.channelid).toBeUndefined();
    expect(body.packageid).toBeUndefined();
    expect(body.payrequest).toBeUndefined();
  });

  test("UPGRADE leg: the same 17 keys PLUS paytype:'upgrade'", async () => {
    // RegistrationPaymentOverviewActivity.generateOrderRequest() :298-301
    //   if (isUpgrade) setPaytype("upgrade"); else setPaytype("");
    const { generateVoiceOrder } = await import("./voiceApis.js");
    await generateVoiceOrder({ ...FULL, paytype: "upgrade" });

    const { body } = lastRequest();
    expect(body.paytype).toBe("upgrade");
    expect(Object.keys(body).length).toBe(18);
  });

  test("an explicitly empty paytype is still sent (native's non-upgrade branch)", async () => {
    // setPaytype("") is a REAL assignment — Gson keeps an empty string. Only
    // `undefined` means "never assigned".
    const { generateVoiceOrder } = await import("./voiceApis.js");
    await generateVoiceOrder({ ...FULL, paytype: "" });
    expect(lastRequest().body.paytype).toBe("");
  });

  test("paidamount is numeric on the wire, never a string", async () => {
    const { generateVoiceOrder } = await import("./voiceApis.js");
    await generateVoiceOrder({ ...FULL, paidamount: "304.44" });
    const { body } = lastRequest();
    expect(body.paidamount).toBe(304.44);
    expect(typeof body.paidamount).toBe("number");
  });

  test("native defaults: offline / crmapp / success", async () => {
    const { generateVoiceOrder } = await import("./voiceApis.js");
    await generateVoiceOrder(FULL);
    const { body } = lastRequest();
    expect(body.paymentmode).toBe("offline");
    expect(body.orderedbytype).toBe("crmapp");
    expect(body.txnstatus).toBe("success");
  });

  test("the voip number is carried onto the order, not dropped", async () => {
    const { generateVoiceOrder } = await import("./voiceApis.js");
    await generateVoiceOrder(FULL);
    expect(lastRequest().body.voipnumber).toBe("08012345678");
  });

  test("username on the order matches the one paymentinfo was quoted with", async () => {
    // The backend binds the transactionid to `username`; a mismatch between
    // the two calls comes back as "Invalid transaction id" or a bogus
    // wallet-balance rejection. Same trap already documented for FoFi.
    const { getVoicePaymentInfo, generateVoiceOrder } = await import("./voiceApis.js");
    await getVoicePaymentInfo({ userid: "cust1", username: "operator1", servid: "5" });
    const quoted = lastRequest().body.username;
    await generateVoiceOrder({ ...FULL, username: "operator1" });
    expect(lastRequest().body.username).toBe(quoted);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  servid resolution + plan extraction
// ══════════════════════════════════════════════════════════════════════
describe("voice service id + plans", () => {
  test("resolveVoiceServiceId reads `id` off the servServiceList row, never a constant", async () => {
    const { resolveVoiceServiceId } = await import("./voiceApis.js");
    const id = await resolveVoiceServiceId([
      { id: "1", title: "Internet", keyword: "internet" },
      { id: "5", title: "Voice Call", keyword: "voicecall" },
      { id: "3", title: "FoFi", keyword: "fofi" },
    ]);
    expect(id).toBe("5");
    // Resolved from state — no network call needed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("falls back to servServiceList when nav state has no rows", async () => {
    fetchMock.mockResolvedValue(mockResponse({
      status: { err_code: 0 },
      body: [{ id: "7", title: "Voice Call", keyword: "voicecall" }],
    }));
    const { resolveVoiceServiceId } = await import("./voiceApis.js");
    expect(await resolveVoiceServiceId(null)).toBe("7");
    expect(fetchMock.mock.calls.at(-1)[0]).toContain("ServiceApis/servServiceList");
  });

  test("returns '' — not a guessed id — when voice is not provisioned", async () => {
    const { resolveVoiceServiceId } = await import("./voiceApis.js");
    expect(await resolveVoiceServiceId([{ id: "1", keyword: "internet" }])).toBe("");
  });

  test("extractVoicePlans reads body.voicecall_plans (ServicePlansListAdapter:103)", async () => {
    const { extractVoicePlans } = await import("./voiceApis.js");
    const plans = extractVoicePlans({
      body: {
        fofi_plans: [{ planid: "1" }],
        voicecall_plans: [{ planid: "77", planname: "Voice 199", planrate: "199", priceid: "99", servid: "5" }],
      },
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].planid).toBe("77");
  });

  test("extractVoicePlans is empty-safe on a response with no voice plans", async () => {
    const { extractVoicePlans } = await import("./voiceApis.js");
    expect(extractVoicePlans({ body: { fofi_plans: [] } })).toEqual([]);
    expect(extractVoicePlans(null)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  overview calls reuse the shared generalApis functions
// ══════════════════════════════════════════════════════════════════════
describe("voice overview contract", () => {
  test("getUserAssignedItems is queried with servkey 'voicecall' (the SERVICE key)", async () => {
    // Native passes serviceKey, not the "voip" bucket name that appears in
    // the RESPONSE — getting this wrong returns an empty body.
    const { getUserAssignedItems } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: { voip: [], fofi: [], internet: [] } }));
    await getUserAssignedItems("voicecall", "cust1", true);

    const { url, body } = lastRequest();
    expect(url).toBe("https://test.example/prod/ServiceApis/getUserAssignedItems");
    expect(body).toEqual({ servkey: "voicecall", userid: "cust1" });
  });

  test("getMyPlanDetails carries the voip number, which is what voice keys on", async () => {
    const { getMyPlanDetails } = await import("./generalApis.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: {} }));
    await getMyPlanDetails({
      servicekey: "voicecall",
      userid: "cust1",
      fofiboxid: "BOX-1",
      voipnumber: "08012345678",
    }, true);

    const { url, body } = lastRequest();
    expect(url).toContain("ServiceApis/getMyPlanDetails");
    expect(body).toEqual({
      fofiboxid: "BOX-1",
      servicekey: "voicecall",
      userid: "cust1",
      voipnumber: "08012345678",
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  the money split (shared with FoFi — same PaymentInfoSummaryModel)
// ══════════════════════════════════════════════════════════════════════
describe("voice payment breakdown", () => {
  // EmployeeCommonPaymentInfoFragment:231
  //   amountdeductable = total_amt − final_split_data.OPERATOR.amount
  const BODY = {
    planname: "Voice Unlimited",
    planrate: "199.00",
    tax_details: [{ title: "CGST", amt: 17.91 }, { title: "SGST", amt: 17.91 }],
    other_amt: "0.00",
    balance_amt: "0.00",
    total_amt: "234.82",
    final_split_data: { OPERATOR: { amount: "81.70" } },
    transactionid: "TXN-9",
  };

  // ── REAL response, captured live 2026-08-17 ────────────────────────
  // POST https://netmontest.bbnl.in/netmon/service/paymentinfo/voicecall
  //   {fofi_box_id:"", planid:"35", priceid:"81", servapptype:"crmapp",
  //    servid:"5", userid:"namich", username:"superadmin",
  //    voipnumber:"90555100079"}
  // Trimmed to the fields this screen reads. Captured, not invented — the
  // shapes below are the reason this file exists (see contract.test.js).
  const LIVE_VOICECALL = {
    id: "81",
    planid: "35",
    planrate: "100.00",
    planname: "UNLIMITED CALLING",
    total_amt: 118,          // NUMBER on the wire, not a string
    tax: 18,
    other_amt: 0,
    balance_amt: "0",        // …while this one IS a string. Both occur.
    tax_details: [
      { title: "SGST", percent: "9%", amt: 9 },
      { title: "CGST", percent: "9%", amt: 9 },
    ],
    fofishare: 60,
    oprtrshare: 39.2,
    tds: 0.8,
    softwarecharges: 0,
    final_split_data: {
      BBNL: { amount: 18.8 },
      OPERATOR: { amount: 39.2 },
      FOFI: { amount: 60 },
    },
    transactionid: "SERV-2608-5-0000137",
    paymode: "easebuzz",
  };

  test("LIVE fixture: every Review row matches the captured response", async () => {
    const { buildFofiBreakdown } = await import("./fofiPaymentBreakdown.js");
    expect(buildFofiBreakdown(LIVE_VOICECALL)).toEqual({
      planName: "UNLIMITED CALLING",
      planRate: 100,
      cgst: 9,
      sgst: 9,
      otherCharges: 0,
      balanceAmount: 0,
      totalAmount: 118,
      operatorShare: 39.2,
      amountDeductable: 78.8,   // 118 − 39.2
      transactionId: "SERV-2608-5-0000137",
    });
  });

  test("LIVE fixture: total_amt arrives as a NUMBER and survives intact", async () => {
    // Guard against a future `String(total_amt)` "tidy-up": paidamount must
    // stay numeric on generateorder, and 118 must not become "118".
    const { buildFofiBreakdown } = await import("./fofiPaymentBreakdown.js");
    expect(typeof LIVE_VOICECALL.total_amt).toBe("number");
    expect(buildFofiBreakdown(LIVE_VOICECALL).totalAmount).toBe(118);
  });

  test("LIVE fixture: the split block has five parties — only OPERATOR is ours", async () => {
    // BBNL / OPERATOR / FOFI / BSNL / V4 all appear. Reading the wrong one
    // (e.g. FOFI's 60) would quote a wallet deduction of 58 instead of 78.8.
    const { fofiOperatorShare } = await import("./fofiPaymentBreakdown.js");
    expect(fofiOperatorShare(LIVE_VOICECALL)).toBe(39.2);
    expect(fofiOperatorShare(LIVE_VOICECALL)).not.toBe(LIVE_VOICECALL.fofishare);
  });

  test("Operator Share comes from final_split_data.OPERATOR.amount", async () => {
    const { buildFofiBreakdown } = await import("./fofiPaymentBreakdown.js");
    expect(buildFofiBreakdown(BODY).operatorShare).toBe(81.7);
  });

  test("Amount Deductable is total_amt minus the operator share", async () => {
    const { buildFofiBreakdown } = await import("./fofiPaymentBreakdown.js");
    expect(buildFofiBreakdown(BODY).amountDeductable).toBe(153.12);
  });

  test("the wallet gate uses the DEDUCTABLE while the order charges the TOTAL", async () => {
    // Native onViewClicked():404 gates on `walletbalance >= amountdeductable`
    // but generateOrderRequest():493 sends `paidamount = totalAmount`. These
    // are different numbers on purpose; conflating them either blocks valid
    // payments or under-charges the order.
    const { buildFofiBreakdown } = await import("./fofiPaymentBreakdown.js");
    const b = buildFofiBreakdown(BODY);
    expect(b.amountDeductable).not.toBe(b.totalAmount);
    expect(b.totalAmount).toBe(234.82);
  });
});
