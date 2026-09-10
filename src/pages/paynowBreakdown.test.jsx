/** @vitest-environment jsdom */
//
// Component smoke for the internet Proceed-to-Pay screen.
//
// The service-layer suite proves internetPaymentBreakdown.js maps the fields
// the way Android does. It cannot prove Paynow.jsx actually PUTS those numbers
// on screen — and that gap is exactly how the ₹700 all-zero bill shipped: the
// build was green the whole time. This file renders the real component against
// the real makepayment payload and reads the rendered rupee amounts back out.
//
// Reference: RegistrationPaymentOverviewActivity.java:417-433 (the "Review"
// screen in the QA screenshot) and EmployeeCommonPaymentInfoFragment.java:276-293.

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const getPayDets = vi.fn();
const payNow = vi.fn();
const getWalBal = vi.fn();

vi.mock("../services/registrationApis", () => ({
  getPayDets: (...a) => getPayDets(...a),
  payNow: (...a) => payNow(...a),
}));
vi.mock("../services/generalApis", () => ({
  getWalBal: (...a) => getWalBal(...a),
}));
// Layout mounts Header/Sidebar/BottomNav, which fetch on mount. Out of scope.
vi.mock("../layout/Layout", () => ({
  default: ({ children }) => <div>{children}</div>,
}));

import Paynow from "./Paynow.jsx";

// ── The payload behind the QA screenshot ────────────────────────────────
// Plan 100mbpsulspecial, a 3-month-cycle plan:
//   planrates["1"]  = first BILLING TIER → 90 days, planamt 2100, total 2478
//   result.planrate = the MONTHLY rate, 700
//   planrates_android labels the same tiers by month span → 3 / 6 / 12,
//                     so there is no month===1 entry anywhere in the array.
const TIER = {
  othcharge: { amt: 0, reason: "" },
  planrate: "700.00",
  planamt: 2100,
  subtotal: 2100,
  noofdays: 90,
  total: 2478,
  taxdetails: {
    title: "GST Tax",
    perc: 18,
    value: 378,
    subtaxes: { CGST: { perc: "9", value: 189 }, SGST: { perc: "9", value: 189 } },
  },
  shareinfo: {
    bbnlshare: 0, optrshare: 2090, tds: 0, gst: 378, softcharge: 10,
    totbbnlshare: 388, balamt: 0, month: 1, prate: "700.00",
  },
  month: 1,
  title: "1 Month",
};

const MAKEPAYMENT_OK = {
  error: 0,
  result: {
    message: [],
    ispending: "no",
    planname: "100mbpsulspecial",
    planrate: "700.00",
    othcharge: { amt: 0, reason: "" },
    wallet: { flag: 1, avlbal: "1883143.83" },
    planrates: { 1: TIER },
    planrates_android: [
      { ...TIER, month: 3, title: "3 Months" },
      { ...TIER, month: 6, title: "6 Months" },
      { ...TIER, month: 12, title: "12 Months" },
    ],
  },
};

const NAV_STATE = {
  userid: "cust1",
  servicekey: "internet",
  op_id: "BBNL_OP77",              // the CUSTOMER's op_id
  customer: { customer_id: "cust1" },
  planDetails: {
    body: {
      subscribed_services: [
        { servicekey: "internet", planname: "100mbpsulspecial", planrate: "700.00" },
      ],
    },
  },
};

function renderPaynow() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/paynow", state: NAV_STATE }]}>
      <Paynow />
    </MemoryRouter>
  );
}

/** The rupee amount rendered on the row labelled `label`. */
function rowAmount(label) {
  const cell = screen.getByText(label);
  const row = cell.closest("div");
  return row?.textContent?.replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(
    "user",
    JSON.stringify({ username: "superadmin", op_id: "BBNL_OP49" })
  );
  getWalBal.mockResolvedValue({
    status: { err_code: 0 },
    body: { wallet_balance: 1883143.83 },
  });
  payNow.mockResolvedValue({ error: 0, result: "ok" });
});

// This repo does not run vitest with `globals: true`, so RTL's auto-cleanup
// never registers and renders would accumulate across tests. Same convention as
// otpGate.test.jsx:99.
afterEach(cleanup);

describe("Paynow renders the Android figures", () => {
  test("every row matches the Android Review screen", async () => {
    getPayDets.mockResolvedValue(MAKEPAYMENT_OK);
    renderPaynow();

    await waitFor(() => expect(screen.getByText("Plan Name")).toBeTruthy());

    expect(rowAmount("Plan Name")).toContain("100mbpsulspecial");
    expect(rowAmount("Plan Rate")).toContain("₹2100.00");
    expect(rowAmount("CGST")).toContain("₹189.00");
    expect(rowAmount("SGST")).toContain("₹189.00");
    expect(rowAmount("Other Charges")).toContain("₹0.00");
    expect(rowAmount("Balance Amount")).toContain("₹0.00");
    expect(rowAmount("Total Amount")).toContain("₹2478.00");

    expect(rowAmount("Operator Share")).toContain("₹2090.00");
    expect(rowAmount("ISP Share")).toContain("₹0.00");
    expect(rowAmount("Software Charges")).toContain("₹10.00");
    expect(rowAmount("TDS")).toContain("₹0.00");
    expect(rowAmount("Amount Deductable")).toContain("₹388.00");
  });

  test("the old wrong screen is gone", async () => {
    getPayDets.mockResolvedValue(MAKEPAYMENT_OK);
    renderPaynow();
    await waitFor(() => expect(screen.getByText("Plan Rate")).toBeTruthy());
    // ₹700.00 was the monthly rate shown as the plan rate, and the deductable.
    expect(rowAmount("Plan Rate")).not.toContain("₹700.00");
    expect(rowAmount("Amount Deductable")).not.toContain("₹700.00");
  });

  test("makepayment gets the LOGGED-IN operator's op_id, not the customer's", async () => {
    getPayDets.mockResolvedValue(MAKEPAYMENT_OK);
    renderPaynow();
    await waitFor(() => expect(getPayDets).toHaveBeenCalled());
    const sent = getPayDets.mock.calls[0][0];
    // RegistrationPaymentOverviewActivity.java:212-214 — PREFS_KEY_OPID.
    expect(sent.apiopid).toBe("BBNL_OP49");
    expect(sent.apiopid).not.toBe("BBNL_OP77");
    expect(sent.apiuserid).toBe("cust1");
    // Renewal leg carries no other-charges (native's isinternetUpgrade branch).
    expect(sent.othamt).toBeUndefined();
    expect(sent.othreason).toBeUndefined();
  });

  test("PROCEED TO PAY sends the customer's full bill as cashpaid", async () => {
    getPayDets.mockResolvedValue(MAKEPAYMENT_OK);
    renderPaynow();
    await waitFor(() => expect(screen.getByText("Total Amount")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));
    await waitFor(() => expect(payNow).toHaveBeenCalled());

    const sent = payNow.mock.calls[0][0];
    expect(Number(sent.cashpaid)).toBe(2478);   // planrates["1"].total
    expect(Number(sent.noofmonth)).toBe(1);
    expect(sent.apiopid).toBe("BBNL_OP49");
    expect(sent.omitPaidAmount).toBe(true);
  });
});

describe("Paynow fails closed", () => {
  test("no usable breakdown shows the backend's reason and offers no payment", async () => {
    getPayDets.mockResolvedValue({
      error: 0,
      result: { planname: null, message: ["Plan not assigned to this user"] },
    });
    renderPaynow();

    await waitFor(() =>
      expect(screen.getByText("Payment details unavailable")).toBeTruthy()
    );
    expect(screen.getByText("Plan not assigned to this user")).toBeTruthy();
    // The fabricated bill must not be rendered at all.
    expect(screen.queryByText("Amount Deductable")).toBeNull();
    expect(screen.queryByRole("button", { name: /proceed to pay/i })).toBeNull();
    expect(payNow).not.toHaveBeenCalled();
    // Never a dead end.
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /go back/i })).toBeTruthy();
  });

  test("a wallet that cannot cover the deductable blocks the debit", async () => {
    getPayDets.mockResolvedValue(MAKEPAYMENT_OK);
    getWalBal.mockResolvedValue({
      status: { err_code: 0 },
      body: { wallet_balance: 100 },      // < 388
    });
    renderPaynow();
    await waitFor(() => expect(screen.getByText("Total Amount")).toBeTruthy());
    await waitFor(() => expect(rowAmount("Amount Deductable")).toContain("₹388.00"));

    await userEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));

    await waitFor(() => expect(screen.getByText(/Wallet Low Balance/i)).toBeTruthy());
    expect(payNow).not.toHaveBeenCalled();
  });

  test("a transport failure does not render a fabricated bill", async () => {
    getPayDets.mockRejectedValue(new Error("Request timed out. Please try again."));
    renderPaynow();
    await waitFor(() =>
      expect(screen.getByText("Payment details unavailable")).toBeTruthy()
    );
    expect(screen.queryByRole("button", { name: /proceed to pay/i })).toBeNull();
  });
});
