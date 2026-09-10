import { describe, test, expect } from "vitest";
import {
  buildInternetBreakdown,
  pickMonthOneEntry,
  backendMessage,
  amount,
} from "./internetPaymentBreakdown.js";

// ══════════════════════════════════════════════════════════════════════
//  Fixture A — the QA screenshot the parity fix was raised against.
//
//  Plan 100mbpsulspecial as the Android app renders it:
//    Plan Rate 2100.00  CGST 189.00  SGST 189.00  Total 2478.00
//    Operator Share 2090.00  ISP Share 0.00  Software Charges 10.00  TDS 0.00
//    Amount Deductable 388.00     (= 2478 − 2090)
//
//  `planrate` (700) and `planamt` (2100) deliberately differ — reading the
//  wrong one is what put ₹700 on the PWA screen.
// ══════════════════════════════════════════════════════════════════════
const SCREENSHOT = {
  error: 0,
  result: {
    message: [],
    ispending: "no",
    planrate: "700.00",
    planname: "100mbpsulspecial",
    othcharge: { amt: 0, reason: "" },
    wallet: { flag: 1, avlbal: "1883143.83" },
    planrates: {
      1: {
        othcharge: { amt: 0, reason: "" },
        planrate: "700.00",
        planamt: 2100,
        subtotal: 2100,
        noofdays: 30,
        total: 2478,
        taxdetails: {
          title: "GST Tax",
          perc: 18,
          value: 378,
          subtaxes: { CGST: { perc: "9", value: 189 }, SGST: { perc: "9", value: 189 } },
        },
        shareinfo: {
          bbnlshare: 0,
          optrshare: 2090,
          tds: 0,
          gst: 378,
          softcharge: 10,
          totbbnlshare: 388,
          balamt: 0,
          month: 1,
          prate: "700.00",
        },
        month: 1,
        title: "1 Month",
      },
    },
  },
};

// ══════════════════════════════════════════════════════════════════════
//  Fixture B — trimmed from the real production capture in
//  tools/api-response-output.txt (userid=iptvuser, opid=BBNL_OP49).
//
//  This one is the counter-example that pins the two derivations:
//    backend CGST value is 0, but subtotal × perc/100 would be 0.09
//    totbbnlshare is 10, but total − optrshare is 1
// ══════════════════════════════════════════════════════════════════════
const CAPTURED_ENTRY_1 = {
  othcharge: { amt: 0, reason: "" },
  planrate: "1.00",
  planamt: 1,
  subtotal: 1,
  noofdays: 30,
  total: 1,
  taxdetails: {
    title: "GST Tax",
    perc: 18,
    value: 0,
    subtaxes: { CGST: { perc: "9", value: 0 }, SGST: { perc: "9", value: 0 } },
  },
  shareinfo: {
    bbnlshare: 0,
    optrshare: 0,
    tds: 0,
    gst: 0.18,
    softcharge: 10,
    totbbnlshare: 10,
    balamt: 0,
    month: 1,
    prate: "1.00",
  },
  month: 1,
  title: "1 Month",
};

const CAPTURED_ENTRY_3 = {
  ...CAPTURED_ENTRY_1,
  planrate: 0,
  planamt: 0,
  subtotal: 0,
  noofdays: 90,
  total: 0,
  shareinfo: { ...CAPTURED_ENTRY_1.shareinfo, month: 3, prate: 0 },
  month: 3,
  title: "3 Months",
};

const CAPTURED = {
  error: 0,
  result: {
    message: [],
    ispending: "no",
    planrate: 1,
    planname: "3days_plan_bbnl",
    othcharge: { amt: 0, reason: "" },
    wallet: { flag: 1, avlbal: "13713.51" },
    planrates: { 1: CAPTURED_ENTRY_1, 3: CAPTURED_ENTRY_3 },
    planrates_android: [CAPTURED_ENTRY_1, CAPTURED_ENTRY_3],
  },
};

describe("internet payment breakdown — Android parity", () => {
  test("renders every row exactly as EmployeeCommonPaymentInfoFragment does", () => {
    const b = buildInternetBreakdown(SCREENSHOT);
    expect(b.ok).toBe(true);
    expect(b.planName).toBe("100mbpsulspecial");
    expect(b.planRate).toBe(2100);
    expect(b.cgst).toBe(189);
    expect(b.sgst).toBe(189);
    expect(b.otherCharges).toBe(0);
    expect(b.balanceAmount).toBe(0);
    expect(b.totalAmount).toBe(2478);
    expect(b.operatorShare).toBe(2090);
    expect(b.ispShare).toBe(0);
    expect(b.softwareCharges).toBe(10);
    expect(b.tds).toBe(0);
    expect(b.amountDeductable).toBe(388);
  });

  test("Plan Rate is planamt, not planrate — the ₹700 vs ₹2100 regression", () => {
    const b = buildInternetBreakdown(SCREENSHOT);
    expect(b.planRate).toBe(2100);
    expect(b.planRate).not.toBe(700);
  });

  test("taxes are the backend's values, never recomputed from the percentage", () => {
    // subtotal 1 × 9% = 0.09; the backend bills 0 and the invoice is its own.
    const b = buildInternetBreakdown(CAPTURED);
    expect(b.cgst).toBe(0);
    expect(b.sgst).toBe(0);
    expect(b.cgst).not.toBe(0.09);
  });

  test("Total is the backend's total, not planRate + taxes", () => {
    const b = buildInternetBreakdown(CAPTURED);
    expect(b.totalAmount).toBe(1);
    expect(b.totalAmount).toBe(CAPTURED_ENTRY_1.total);
  });

  test("Amount Deductable is total − optrshare, not totbbnlshare", () => {
    const b = buildInternetBreakdown(CAPTURED);
    expect(b.amountDeductable).toBe(1);
    expect(b.amountDeductable).not.toBe(CAPTURED_ENTRY_1.shareinfo.totbbnlshare);
  });

  test("cashpaid is the full customer bill — what native sends to savePaymentApi", () => {
    expect(buildInternetBreakdown(SCREENSHOT).cashpaid).toBe(2478);
    expect(buildInternetBreakdown(CAPTURED).cashpaid).toBe(1);
  });

  test("Other Charges comes from the top-level othcharge", () => {
    const withOther = {
      ...SCREENSHOT,
      result: { ...SCREENSHOT.result, othcharge: { amt: "150.00", reason: "install" } },
    };
    expect(buildInternetBreakdown(withOther).otherCharges).toBe(150);
  });

  test("Balance Amount is shareinfo.balamt verbatim — small residuals are not suppressed", () => {
    const withBalance = {
      ...SCREENSHOT,
      result: {
        ...SCREENSHOT.result,
        planrates: {
          1: {
            ...SCREENSHOT.result.planrates[1],
            shareinfo: { ...SCREENSHOT.result.planrates[1].shareinfo, balamt: 1 },
          },
        },
      },
    };
    expect(buildInternetBreakdown(withBalance).balanceAmount).toBe(1);
  });

  test("wallet balance and pending flag are carried through", () => {
    const b = buildInternetBreakdown(CAPTURED);
    expect(b.walletBalance).toBeCloseTo(13713.51, 2);
    expect(b.isPending).toBe(false);
    const pending = {
      ...CAPTURED,
      result: { ...CAPTURED.result, ispending: "yes" },
    };
    expect(buildInternetBreakdown(pending).isPending).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  THE REGRESSION. This is the shape that produced the QA screenshot.
//
//  `planrates` is keyed by BILLING TIER — key "1" is the first tier, which
//  for a plan on a 3-month cycle is 90 days and ₹2100, not one month. The
//  sibling `planrates_android` array labels the same tiers by their real
//  month span, so its entries are month 3 / 6 / 12 and NONE is month 1.
//
//  The old selector checked `Array.isArray(planrates_android)` first and,
//  finding no month===1 entry, returned null WITHOUT falling back to
//  planrates["1"] — where the real breakdown was sitting the whole time.
//  Everything downstream then read the top-level result: plan rate 700 (the
//  monthly rate), and 0 for every tax and share field, with Amount
//  Deductable defaulting to the total. That is the screen, exactly.
//
//  Android is immune because InternetPaymentInfoRegModel has no
//  planrates_android field at all — it only ever reads planrates["1"]
//  (RegistrationPaymentOverviewActivity.java:417-433).
// ══════════════════════════════════════════════════════════════════════
const QUARTERLY_TIER = SCREENSHOT.result.planrates[1];
const QUARTERLY = {
  error: 0,
  result: {
    ...SCREENSHOT.result,
    planrates: { 1: QUARTERLY_TIER },
    // Same tier, labelled by its true 3-month span — no month===1 anywhere.
    planrates_android: [
      { ...QUARTERLY_TIER, month: 3, title: "3 Months", noofdays: 90 },
      { ...QUARTERLY_TIER, month: 6, title: "6 Months", noofdays: 180 },
      { ...QUARTERLY_TIER, month: 12, title: "12 Months", noofdays: 365 },
    ],
  },
};

describe("regression: planrates_android without a month-1 entry", () => {
  test("still finds the tier via planrates['1'] instead of giving up", () => {
    expect(pickMonthOneEntry(QUARTERLY.result)).toBe(QUARTERLY_TIER);
  });

  test("renders the Android figures, not the ₹700 all-zero screen", () => {
    const b = buildInternetBreakdown(QUARTERLY);
    expect(b.ok).toBe(true);
    expect(b.planRate).toBe(2100);
    expect(b.cgst).toBe(189);
    expect(b.sgst).toBe(189);
    expect(b.totalAmount).toBe(2478);
    expect(b.operatorShare).toBe(2090);
    expect(b.softwareCharges).toBe(10);
    expect(b.amountDeductable).toBe(388);
    // The exact wrong screen: plan rate 700, everything else zero.
    expect(b.planRate).not.toBe(700);
    expect(b.amountDeductable).not.toBe(b.planRate);
  });

  test("an empty planrates_android array does not shadow planrates either", () => {
    const empty = {
      ...QUARTERLY,
      result: { ...QUARTERLY.result, planrates_android: [] },
    };
    expect(buildInternetBreakdown(empty).totalAmount).toBe(2478);
  });
});

describe("month-1 entry selection", () => {
  test("prefers the literal '1' key, the way native indexes planrates", () => {
    expect(pickMonthOneEntry(CAPTURED.result)).toBe(CAPTURED_ENTRY_1);
  });

  test("never falls through to a longer-period entry", () => {
    const threeOnly = { planrates: { 3: CAPTURED_ENTRY_3 } };
    expect(pickMonthOneEntry(threeOnly)).toBeNull();
  });

  test("reads the planrates_android array when planrates is absent", () => {
    const arrayOnly = { planrates_android: [CAPTURED_ENTRY_3, CAPTURED_ENTRY_1] };
    expect(pickMonthOneEntry(arrayOnly)).toBe(CAPTURED_ENTRY_1);
  });

  test("falls back to shareinfo.month when the entry carries no month", () => {
    const { month, ...noMonth } = CAPTURED_ENTRY_1;
    expect(pickMonthOneEntry({ planrates: [noMonth] })).toBe(noMonth);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Failing closed. Each of these previously rendered a plausible-looking
//  all-zero bill with Amount Deductable = Plan Rate and an armed
//  PROCEED TO PAY, which under-bills the customer.
// ══════════════════════════════════════════════════════════════════════
describe("responses with no usable breakdown are errors, not zeros", () => {
  test("no planrates at all", () => {
    const b = buildInternetBreakdown({
      error: 0,
      result: { planname: "100mbpsulspecial", planrate: "700.00", message: [] },
    });
    expect(b.ok).toBe(false);
    expect(b.totalAmount).toBeUndefined();
    expect(b.cashpaid).toBeUndefined();
  });

  test("surfaces the backend's own message, the way native does", () => {
    const b = buildInternetBreakdown({
      error: 0,
      result: { planname: null, message: ["Plan not assigned to this user"] },
    });
    expect(b.ok).toBe(false);
    expect(b.message).toBe("Plan not assigned to this user");
  });

  test("result returned as a bare error string", () => {
    const b = buildInternetBreakdown({ error: 1, result: "User not found" });
    expect(b.ok).toBe(false);
    expect(b.message).toBe("User not found");
  });

  test("missing result entirely", () => {
    expect(buildInternetBreakdown({ error: 1 }).ok).toBe(false);
    expect(buildInternetBreakdown(null).ok).toBe(false);
  });

  test("month-1 entry present but carrying no total", () => {
    const { total, totalamt, ...noTotal } = CAPTURED_ENTRY_1;
    const b = buildInternetBreakdown({
      result: { ...CAPTURED.result, planrates: { 1: noTotal }, planrates_android: undefined },
    });
    expect(b.ok).toBe(false);
  });

  test("always carries a fallback message so the screen is never blank", () => {
    const b = buildInternetBreakdown({ error: 0, result: { planname: "x" } });
    expect(b.ok).toBe(false);
    expect(b.message.length).toBeGreaterThan(0);
  });

  test("wallet balance survives a failed breakdown so the header still renders", () => {
    const b = buildInternetBreakdown({
      result: { planname: "x", wallet: { avlbal: "42.50" } },
    });
    expect(b.ok).toBe(false);
    expect(b.walletBalance).toBe(42.5);
  });
});

describe("amount parsing", () => {
  test("keeps a legitimate zero rather than falling through", () => {
    expect(amount(0)).toBe(0);
    expect(amount("0.00")).toBe(0);
  });

  test("handles decimal strings, currency noise, and junk", () => {
    expect(amount("2,478.00")).toBe(2478);
    expect(amount("₹388.00")).toBe(388);
    expect(amount(undefined)).toBe(0);
    expect(amount("abc")).toBe(0);
  });

  test("rounds to paise", () => {
    expect(amount(44.9091)).toBe(44.91);
  });
});

describe("backendMessage", () => {
  test("skips empty entries in the message array", () => {
    expect(backendMessage({ result: { message: ["", "  ", "real reason"] } })).toBe("real reason");
  });

  test("falls back to the standard envelope err_msg", () => {
    expect(backendMessage({ result: {}, status: { err_msg: "Invalid User Credentials" } }))
      .toBe("Invalid User Credentials");
  });

  test("returns empty string when there is nothing to report", () => {
    expect(backendMessage({ result: {} })).toBe("");
  });
});
