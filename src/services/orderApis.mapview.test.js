import { describe, it, expect } from "vitest";
import { mapOrderView, getReceiptUrl, getInvoiceUrl } from "./orderApis";

describe("mapOrderView", () => {
  it("maps a FoFi/Cable ordersList row (native OrderDetails schema)", () => {
    const v = mapOrderView({
      ordernumber: "BBFOF25260003464",
      orderdate: "13-11-2025 04:26:50 PM",
      totalamount: "153.40",
      taxamount: "23.40",
      discountamount: "0.00",
      othercharges: "0.00",
      paymentmode: "offline",
      txnstatus: "success",
    });
    expect(v.orderNumber).toBe("BBFOF25260003464");
    expect(v.orderDate).toBe("13-11-2025 04:26:50 PM");
    expect(v.totalAmount).toBeCloseTo(153.4);
    expect(v.taxAmount).toBeCloseTo(23.4);
    expect(v.paymentMode).toBe("offline");
    expect(v.status).toBe("success");
  });

  it("maps an Internet custpayhistory row and defaults status to SUCCESS", () => {
    const v = mapOrderView({
      orderid: "24250000335",
      payment_date: "14-05-2024 04:19:21 PM",
      grandtotal: "306.68",
      cgst: "23.34",
      sgst: "23.34",
      discount: "0",
      other_charges: "0",
      pymt_mode: "online",
      // no explicit status field
    });
    expect(v.orderNumber).toBe("24250000335");
    expect(v.totalAmount).toBeCloseTo(306.68);
    expect(v.taxAmount).toBeCloseTo(46.68); // cgst + sgst
    expect(v.paymentMode).toBe("online");
    expect(v.status).toBe("SUCCESS");
  });

  it("falls back to subtaxes array for tax when no explicit tax field", () => {
    const v = mapOrderView({ subtaxes: [{ value: "9.00" }, { amount: "9.00" }] });
    expect(v.taxAmount).toBeCloseTo(18);
  });

  it("builds receipt/invoice urls with billnum = order number", () => {
    expect(getReceiptUrl("BBFOF1")).toMatch(/cable\/receipt\?billnum=BBFOF1$/);
    expect(getInvoiceUrl("BBFOF1")).toMatch(/cable\/invoice\?billnum=BBFOF1$/);
  });

  it("trims stray whitespace from billnum (else server returns 'Invalid Bill number')", () => {
    expect(getReceiptUrl("  BBFOF1\n")).toMatch(/billnum=BBFOF1$/);
    expect(getInvoiceUrl(" 24250000335 ")).toMatch(/billnum=24250000335$/);
  });
});
