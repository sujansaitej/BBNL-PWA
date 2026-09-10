/** @vitest-environment jsdom */
/**
 * VoicePayment — the money screen.
 *
 * Fixture is the REAL staging response captured 2026-08-17 from
 * POST https://netmontest.bbnl.in/netmon/service/paymentinfo/voicecall
 * (plan 35 / price 81 / servid 5 / customer namich). The two numbers that
 * matter and are easy to swap:
 *
 *     total_amt                    = 118     → generateorder.paidamount
 *     total_amt − OPERATOR.amount  = 78.80   → the wallet gate
 *
 * Native gates on the DEDUCTABLE and charges the TOTAL
 * (EmployeeCommonPaymentInfoFragment:404 vs :493). Conflating them either
 * blocks valid payments or under-charges the order.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getVoicePaymentInfo = vi.fn();
const generateVoiceOrder = vi.fn();
vi.mock("../services/voiceApis", async (orig) => ({
  ...(await orig()),
  getVoicePaymentInfo: (...a) => getVoicePaymentInfo(...a),
  generateVoiceOrder: (...a) => generateVoiceOrder(...a),
}));

const killFofiTxn = vi.fn();
vi.mock("../services/fofiApis", () => ({ killFofiTxn: (...a) => killFofiTxn(...a) }));

const getWalBal = vi.fn();
vi.mock("../services/generalApis", () => ({
  getWalBal: (...a) => getWalBal(...a),
  getServiceList: vi.fn().mockResolvedValue({ status: { err_code: 0 }, body: [] }),
}));

vi.mock("../services/subscriptionCache", () => ({ invalidateSubscriptionCaches: () => {} }));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

import { ToastProvider } from "../components/ui/Toast";
import VoicePayment from "./VoicePayment";

// Captured live, trimmed to what the screen reads.
const LIVE_BODY = {
  id: "81",
  planid: "35",
  planrate: "100.00",
  planname: "UNLIMITED CALLING",
  total_amt: 118,
  other_amt: 0,
  balance_amt: "0",
  tax_details: [
    { title: "SGST", percent: "9%", amt: 9 },
    { title: "CGST", percent: "9%", amt: 9 },
  ],
  oprtrshare: 39.2,
  final_split_data: {
    BBNL: { amount: 18.8 },
    OPERATOR: { amount: 39.2 },
    FOFI: { amount: 60 },
  },
  transactionid: "SERV-2608-5-0000137",
};
const QUOTE = { status: { err_code: 0, err_msg: "Success!." }, body: LIVE_BODY };

const STATE = {
  customer: { customer_id: "namich", name: "namich sup", op_id: "BBNL_AG01" },
  customerId: "namich",
  userid: "namich",
  servid: "5",
  servicekey: "voicecall",
  voipnumber: "90555100079",
  fofi_box_id: "",
  planid: "35",
  priceid: "81",
  planName: "UNLIMITED CALLING",
  services: [],
  mode: "upgrade",
};

function show(state = STATE) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[{ pathname: "/voice-payment", state }]}>
        <VoicePayment />
      </MemoryRouter>
    </ToastProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("user", JSON.stringify({ username: "superadmin", op_id: "BBNL_OP49" }));
  navigate.mockReset();
  getVoicePaymentInfo.mockReset().mockResolvedValue(QUOTE);
  generateVoiceOrder.mockReset().mockResolvedValue({ status: { err_code: 0, err_msg: "Order placed" } });
  killFofiTxn.mockReset().mockResolvedValue({ status: { err_code: 0 } });
  // Staging operator wallet at capture time.
  getWalBal.mockReset().mockResolvedValue({ status: { err_code: 0 }, body: { wallet_balance: 302587.16 } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VoicePayment — the quote", () => {
  test("asks paymentinfo/voicecall with the 8 native fields", async () => {
    show();
    await waitFor(() => expect(getVoicePaymentInfo).toHaveBeenCalled());
    expect(getVoicePaymentInfo.mock.calls[0][0]).toEqual({
      fofi_box_id: "",
      planid: "35",
      priceid: "81",
      servapptype: "crmapp",
      servid: "5",
      userid: "namich",
      username: "superadmin",   // the OPERATOR, not the customer
      voipnumber: "90555100079",
    });
  });

  test("renders every Review row from the live response", async () => {
    show();
    expect(await screen.findByText(/UNLIMITED CALLING/)).toBeTruthy();
    expect(screen.getByText(": ₹100.00")).toBeTruthy();   // Plan Rate
    expect(screen.getAllByText(": ₹9.00").length).toBe(2); // CGST + SGST
    expect(screen.getByText(": ₹118.00")).toBeTruthy();    // Total
  });

  test("More Details shows Operator Share and Amount Deductable", async () => {
    show();
    fireEvent.click(await screen.findByText("More Details"));
    expect(await screen.findByText(": ₹39.20")).toBeTruthy();  // OPERATOR.amount
    expect(screen.getByText(": ₹78.80")).toBeTruthy();         // 118 − 39.20
  });

  test("wallet balance is shown from myWallet {servicekey:'voicecall'}", async () => {
    show();
    await waitFor(() => expect(getWalBal).toHaveBeenCalledWith({ loginuname: "superadmin", servicekey: "voicecall" }));
    expect(await screen.findByText("₹302587.16")).toBeTruthy();
  });

  test("a rejected quote hides the pay button and shows the backend message", async () => {
    getVoicePaymentInfo.mockResolvedValue({ status: { err_code: 1, err_msg: "Plan not available" } });
    show();
    expect(await screen.findByText("Plan not available")).toBeTruthy();
    expect(screen.queryByText("PROCEED TO PAY")).toBeNull();
  });
});

describe("VoicePayment — the two native gates", () => {
  test("wallet below the DEDUCTABLE blocks the payment", async () => {
    // 50 < 78.80 → blocked, even though it is also < the 118 total.
    getWalBal.mockResolvedValue({ status: { err_code: 0 }, body: { wallet_balance: 50 } });
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    expect(await screen.findByText("Wallet Low Balance")).toBeTruthy();
    expect(generateVoiceOrder).not.toHaveBeenCalled();
  });

  test("wallet above the deductable but BELOW the total still pays", async () => {
    // 100 is < the 118 customer total but >= the 78.80 wallet hit. Native
    // gates on the deductable only — gating on the total here would wrongly
    // block a legitimate payment.
    getWalBal.mockResolvedValue({ status: { err_code: 0 }, body: { wallet_balance: 100 } });
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    await waitFor(() => expect(generateVoiceOrder).toHaveBeenCalled());
  });

  test("a zero total is refused with 'No Amount to Pay'", async () => {
    getVoicePaymentInfo.mockResolvedValue({
      status: { err_code: 0 },
      body: { ...LIVE_BODY, total_amt: 0, final_split_data: { OPERATOR: { amount: 0 } } },
    });
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    expect(await screen.findByText("No Amount to Pay")).toBeTruthy();
    expect(generateVoiceOrder).not.toHaveBeenCalled();
  });
});

describe("VoicePayment — the order", () => {
  test("mode 'upgrade' sends paytype:'upgrade' (RegistrationPaymentOverviewActivity)", async () => {
    show({ ...STATE, mode: "upgrade" });
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    await waitFor(() => expect(generateVoiceOrder).toHaveBeenCalled());
    expect(generateVoiceOrder.mock.calls[0][0].paytype).toBe("upgrade");
  });

  test("mode 'renewal' sends NO paytype (EmployeeCommonPaymentInfoFragment)", async () => {
    show({ ...STATE, mode: "renewal" });
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    await waitFor(() => expect(generateVoiceOrder).toHaveBeenCalled());
    expect(generateVoiceOrder.mock.calls[0][0].paytype).toBeUndefined();
  });

  test("charges the TOTAL (118), not the deductable (78.80)", async () => {
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    await waitFor(() => expect(generateVoiceOrder).toHaveBeenCalled());

    const order = generateVoiceOrder.mock.calls[0][0];
    expect(order.paidamount).toBe(118);
    expect(order.paidamount).not.toBe(78.8);
  });

  test("sends the fresh transactionid and the operator username", async () => {
    getVoicePaymentInfo
      .mockResolvedValueOnce(QUOTE)  // mount
      .mockResolvedValueOnce({ status: { err_code: 0 }, body: { ...LIVE_BODY, transactionid: "SERV-FRESH-1" } });
    show();
    await screen.findByText(/UNLIMITED CALLING/);
    fireEvent.click(screen.getByText("PROCEED TO PAY"));
    await waitFor(() => expect(generateVoiceOrder).toHaveBeenCalled());

    const order = generateVoiceOrder.mock.calls[0][0];
    expect(order.transactionid).toBe("SERV-FRESH-1");
    expect(order.username).toBe("superadmin");
    expect(order.voipnumber).toBe("90555100079");
    expect(order.servid).toBe("5");
  });

  test("the stale mount reservation is killed when the refresh issues a new id", async () => {
    getVoicePaymentInfo
      .mockResolvedValueOnce(QUOTE)
      .mockResolvedValueOnce({ status: { err_code: 0 }, body: { ...LIVE_BODY, transactionid: "SERV-FRESH-1" } });
    show();
    await screen.findByText(/UNLIMITED CALLING/);
    fireEvent.click(screen.getByText("PROCEED TO PAY"));
    await waitFor(() => expect(killFofiTxn).toHaveBeenCalled());
    expect(killFofiTxn.mock.calls[0][0]).toMatchObject({
      userid: "namich", username: "superadmin", servid: "5", transactionid: "SERV-2608-5-0000137",
    });
  });

  test("a STICKY id (same on refresh) is NOT killed — that would void the payment", async () => {
    show();  // both calls return the same transactionid
    await screen.findByText(/UNLIMITED CALLING/);
    fireEvent.click(screen.getByText("PROCEED TO PAY"));
    await waitFor(() => expect(generateVoiceOrder).toHaveBeenCalled());
    expect(killFofiTxn).not.toHaveBeenCalled();
  });

  test("success returns to the overview with the post-payment refresh flags", async () => {
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    expect(await screen.findByText("Payment Success!")).toBeTruthy();

    fireEvent.click(screen.getByText("OK"));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const [path, opts] = navigate.mock.calls.at(-1);
    expect(path).toBe("/customer/namich/service/voice");
    expect(opts.state).toMatchObject({ refreshData: true, paymentSuccess: true });
  });

  test("a rejected order shows Failed and does NOT navigate away", async () => {
    generateVoiceOrder.mockResolvedValue({ status: { err_code: 1, err_msg: "Insufficient balance" } });
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    expect(await screen.findByText("Payment Failed!")).toBeTruthy();
    expect(screen.getByText("Insufficient balance")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("an 'invalid' rejection CLOSES the stranded reservation", async () => {
    // RegistrationPaymentOverviewActivity:398-400. Nothing else releases it:
    // native's back press does not, and this screen re-quotes rather than
    // reusing the id.
    generateVoiceOrder.mockResolvedValue({
      status: { err_code: 1, err_msg: "Invalid transaction id" },
    });
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    expect(await screen.findByText("Payment Failed!")).toBeTruthy();
    await waitFor(() => expect(killFofiTxn).toHaveBeenCalled());
    expect(killFofiTxn.mock.calls.at(-1)[0]).toMatchObject({
      userid: "namich", username: "superadmin", servid: "5",
      transactionid: "SERV-2608-5-0000137",
    });
  });

  test("a rejection that does NOT name the transaction leaves it alone", async () => {
    // Native's test is a substring match on "invalid" — a wallet or plan
    // rejection must not void an id the operator can still pay with.
    generateVoiceOrder.mockResolvedValue({ status: { err_code: 1, err_msg: "Insufficient balance" } });
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    expect(await screen.findByText("Payment Failed!")).toBeTruthy();
    expect(killFofiTxn).not.toHaveBeenCalled();
  });

  test("a network drop AFTER submit never says 'Failed' (double-charge guard)", async () => {
    generateVoiceOrder.mockRejectedValue(new Error("network"));
    show();
    fireEvent.click(await screen.findByText("PROCEED TO PAY"));
    expect(await screen.findByText("Payment Status Unconfirmed")).toBeTruthy();
    expect(screen.queryByText("Payment Failed!")).toBeNull();
  });

  test("an expired session is caught before any call is made", async () => {
    localStorage.removeItem("user");
    show();
    expect(await screen.findByText(/session has expired/i)).toBeTruthy();
    expect(getVoicePaymentInfo).not.toHaveBeenCalled();
  });
});
