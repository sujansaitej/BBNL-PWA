import { describe, test, expect } from "vitest";
import {
  fofiOperatorShare,
  fofiAmountDeductable,
  buildFofiBreakdown,
  parseFofiAmount,
} from "./fofiPaymentBreakdown.js";

// ══════════════════════════════════════════════════════════════════════
//  The QA screenshot: plan "FOFI-Box + FTA ONLY".
//
//    Plan Rate ₹130.00 · CGST ₹11.70 · SGST ₹11.70 · Other ₹0.00
//    Balance ₹181.12   · Total ₹334.52
//    Operator Share ₹153.40
//    Amount Deductable ₹181.12      (= 334.52 − 153.40)
//
//  The PWA showed ₹0.00 because `isFoFiFtaOnlyPlan()` matched the words
//  "FTA ONLY" in the plan name and short-circuited to zero.
// ══════════════════════════════════════════════════════════════════════
const FTA_ONLY = {
  planname: "FOFI-Box + FTA ONLY",
  planrate: "130.00",
  total_amt: 334.52,
  other_amt: 0,
  balance_amt: 181.12,
  oprtrshare: 153.4,
  fofishare: 0,
  tds: 0,
  transactionid: "SERV-0408-3-1234567",
  tax_details: [
    { title: "CGST", amt: 11.7 },
    { title: "SGST", amt: 11.7 },
  ],
  final_split_data: {
    BBNL: { amount: 181.12 },
    OPERATOR: { amount: 153.4 },
    FOFI: { amount: 0 },
  },
  // The backend quirk that sent the old ladder down the wrong path.
  deduction: { totalamount: "0.00" },
};

describe("FoFi Review screen — Android parity", () => {
  test("Amount Deductable is total_amt − OPERATOR.amount", () => {
    expect(fofiAmountDeductable(FTA_ONLY)).toBe(181.12);
  });

  test("Operator Share comes from final_split_data.OPERATOR.amount", () => {
    expect(fofiOperatorShare(FTA_ONLY)).toBe(153.4);
  });

  test("every row matches the Android Review screen", () => {
    const b = buildFofiBreakdown(FTA_ONLY);
    expect(b.planName).toBe("FOFI-Box + FTA ONLY");
    expect(b.planRate).toBe(130);
    expect(b.cgst).toBe(11.7);
    expect(b.sgst).toBe(11.7);
    expect(b.otherCharges).toBe(0);
    expect(b.balanceAmount).toBe(181.12);
    expect(b.totalAmount).toBe(334.52);
    expect(b.operatorShare).toBe(153.4);
    expect(b.amountDeductable).toBe(181.12);
  });

  test("total − operator share is internally consistent", () => {
    const b = buildFofiBreakdown(FTA_ONLY);
    expect(b.totalAmount - b.operatorShare).toBeCloseTo(b.amountDeductable, 2);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  THE REGRESSION GUARD.
//
//  May 2026 production incident, re-opened Aug 2026: a plan-name test
//  ("FTA", "ftaonly") was used to decide that a plan was free. "FTA" names
//  the included channel tier (Free To Air), not the price. There is no
//  plan-name test that can tell you what a plan costs.
// ══════════════════════════════════════════════════════════════════════
describe("regression: the plan name must never influence the amount", () => {
  const NAMES = [
    "FOFI-Box + FTA ONLY",
    "fta only",
    "FTAONLY",
    "FoFi Dhamaka Offer",
    "DHAMAKA",
    "KAN_HINDI SUPER SAVER",
    "",
  ];

  test("identical numbers produce an identical deductable for every name", () => {
    const results = NAMES.map((planname) =>
      fofiAmountDeductable({ ...FTA_ONLY, planname })
    );
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(181.12);
  });

  test("an FTA-named plan is never forced to zero", () => {
    expect(fofiAmountDeductable(FTA_ONLY)).not.toBe(0);
  });

  test("a Dhamaka-named plan is never forced to the hardcoded 35.40", () => {
    const dhamaka = { ...FTA_ONLY, planname: "FoFi Dhamaka Offer" };
    expect(fofiAmountDeductable(dhamaka)).toBe(181.12);
    expect(fofiAmountDeductable(dhamaka)).not.toBe(35.4);
  });

  test('deduction.totalamount "0.00" no longer hijacks the result', () => {
    // The old ladder read this first and treated 0 as "no deduction".
    expect(fofiAmountDeductable(FTA_ONLY)).toBe(181.12);
  });

  test("fofishare / FOFI split no longer override the subtraction", () => {
    const withFofiShare = {
      ...FTA_ONLY,
      fofishare: 42,
      final_split_data: { ...FTA_ONLY.final_split_data, FOFI: { amount: 99 } },
    };
    expect(fofiAmountDeductable(withFofiShare)).toBe(181.12);
  });
});

describe("a genuinely free plan still reads as zero — from the numbers", () => {
  test("total 0 and operator 0 → deductable 0", () => {
    const free = {
      planname: "Free Trial Pack",
      total_amt: 0,
      oprtrshare: 0,
      final_split_data: { OPERATOR: { amount: 0 } },
    };
    expect(fofiAmountDeductable(free)).toBe(0);
    expect(fofiOperatorShare(free)).toBe(0);
  });

  test("operator keeps the whole bill → deductable 0", () => {
    const allOperator = {
      total_amt: 200,
      final_split_data: { OPERATOR: { amount: 200 } },
    };
    expect(fofiAmountDeductable(allOperator)).toBe(0);
  });
});

describe("degraded responses", () => {
  test("falls back to oprtrshare when the split block is missing", () => {
    const noSplit = { total_amt: 334.52, oprtrshare: 153.4 };
    expect(fofiOperatorShare(noSplit)).toBe(153.4);
    expect(fofiAmountDeductable(noSplit)).toBe(181.12);
  });

  test("no share information at all → the whole total is deductable", () => {
    expect(fofiAmountDeductable({ total_amt: 334.52 })).toBe(334.52);
  });

  test("missing total falls back to the caller's previous value", () => {
    expect(fofiAmountDeductable({}, { fallback: 181.12 })).toBe(181.12);
    expect(fofiAmountDeductable({}, {})).toBe(0);
    expect(fofiAmountDeductable(null, { fallback: null })).toBe(0);
  });

  test("string amounts with commas and currency noise", () => {
    const noisy = {
      total_amt: "1,334.52",
      final_split_data: { OPERATOR: { amount: "153.40" } },
    };
    expect(fofiAmountDeductable(noisy)).toBe(1181.12);
  });

  test("a negative result is surfaced, not hidden — native does not clamp", () => {
    const inconsistent = {
      total_amt: 100,
      final_split_data: { OPERATOR: { amount: 150 } },
    };
    expect(fofiAmountDeductable(inconsistent)).toBe(-50);
  });
});

describe("buildFofiBreakdown edge cases", () => {
  test("tax titles are matched case-insensitively and default to 0", () => {
    const b = buildFofiBreakdown({
      total_amt: 100,
      tax_details: [{ title: "cgst", amt: "9.00" }],
      final_split_data: { OPERATOR: { amount: 50 } },
    });
    expect(b.cgst).toBe(9);
    expect(b.sgst).toBe(0);
  });

  test("plan name falls back to the caller's, then to N/A", () => {
    expect(buildFofiBreakdown({}, { fallbackPlanName: "From Nav" }).planName).toBe("From Nav");
    expect(buildFofiBreakdown({}).planName).toBe("N/A");
  });
});

describe("parseFofiAmount", () => {
  test("keeps a real zero, rejects junk and objects", () => {
    expect(parseFofiAmount(0)).toBe(0);
    expect(parseFofiAmount("0.00")).toBe(0);
    expect(parseFofiAmount("")).toBeNull();
    expect(parseFofiAmount(null)).toBeNull();
    expect(parseFofiAmount({})).toBeNull();
    expect(parseFofiAmount("abc")).toBeNull();
  });
});
