import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  CreditCardIcon,
  CalendarDaysIcon,
  BanknotesIcon,
  UserIcon,
  DevicePhoneMobileIcon,
  DocumentTextIcon
} from "@heroicons/react/24/outline";
import { getOrderHistoryFor } from "../services/orderApis";
import { canonicalServiceKey, filterOrdersByService } from "../constants/services";
import { formatCustomerId } from "../services/helpers";
import { getUser } from "../services/safeStorage";
import BottomNav from "../components/BottomNav";
import { Loader } from "@/components/ui";
import { jsPDF } from "jspdf";

// Helper function to parse date strings like "30-01-2026 16:32:54" to Date object
const parsePaymentDate = (dateStr) => {
  if (!dateStr) return new Date(0);
  // Handle format: "DD-MM-YYYY HH:MM:SS"
  const parts = dateStr.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (parts) {
    const [, day, month, year, hour, min, sec] = parts;
    return new Date(year, month - 1, day, hour, min, sec);
  }
  // Fallback: try standard Date parsing
  return new Date(dateStr);
};

const firstText = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const getStableOrderKey = (order) => {
  const stableId = firstText(
    order?.orderid,
    order?.order_id,
    order?.orderno,
    order?.order_no,
    order?.txn_id,
    order?.txnid,
    order?.transactionid,
    order?.transaction_id,
    order?.paymentid,
    order?.payment_id,
    order?.receiptid,
    order?.receipt_id,
    order?.invoiceid,
    order?.invoice_id
  );

  return stableId ? `stable:${stableId}` : "";
};

const toAmount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstAmount = (...values) => {
  for (const value of values) {
    const parsed = toAmount(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const firstPositiveAmount = (...values) => {
  for (const value of values) {
    const parsed = toAmount(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
};

const toCents = (amount) => {
  const parsed = toAmount(amount);
  if (parsed === null) return null;
  return Math.round(parsed * 100);
};

const fromCents = (cents) => {
  if (cents === null || cents === undefined) return 0;
  return cents / 100;
};

const normalizeResidualBalanceCents = (balanceCents, { subtotalCents, paidCents, billedCents } = {}) => {
  if (!balanceCents || balanceCents <= 0) return 0;

  // Older Internet receipts can carry a small residual (commonly
  // Re.1, then 2/3 after repeated renewal) even when the operator
  // wallet debit succeeded. If the row
  // otherwise has a precise subtotal/paid value, do not let that
  // residual become the displayed balance or reduce the subtotal.
  if (
    balanceCents <= 500 &&
    (
      (subtotalCents > 0 && paidCents !== null) ||
      (billedCents > 0 && Math.abs(billedCents - subtotalCents) <= 100)
    )
  ) {
    return 0;
  }

  return balanceCents;
};

const normalizeSubtaxes = (order) => {
  const source = order?.subtaxes || order?.taxdetails?.subtaxes || order?.tax_details;
  if (Array.isArray(source)) {
    return source.map((tax) => ({
      key: tax?.key || tax?.name || tax?.taxname || tax?.title || tax?.label || "Tax",
      perc: tax?.perc ?? tax?.percentage ?? tax?.tax_perc ?? "",
      value: firstAmount(tax?.value, tax?.amount, tax?.tax_amount, tax?.amt) || 0,
    })).filter((tax) => tax.value > 0);
  }

  if (source && typeof source === "object") {
    return Object.entries(source).map(([key, tax]) => ({
      key: tax?.key || tax?.name || tax?.taxname || tax?.title || tax?.label || key,
      perc: tax?.perc ?? tax?.percentage ?? tax?.tax_perc ?? "",
      value: firstAmount(tax?.value, tax?.amount, tax?.tax_amount, tax?.amt, tax) || 0,
    })).filter((tax) => tax.value > 0);
  }

  const cgst = firstAmount(order?.cgst, order?.CGST);
  const sgst = firstAmount(order?.sgst, order?.SGST);
  return [
    cgst !== null ? { key: "CGST", perc: 9, value: cgst } : null,
    sgst !== null ? { key: "SGST", perc: 9, value: sgst } : null,
  ].filter(Boolean);
};

const getPaymentBreakdown = (order, serviceType) => {
  const planRate = firstAmount(order?.plan_rate, order?.planrate, order?.base_amt, order?.baseamount) || 0;
  const subtaxes = normalizeSubtaxes(order);
  const taxTotal = subtaxes.reduce((sum, tax) => sum + (toCents(tax.value) || 0), 0);
  const discount = firstAmount(order?.discount, order?.discount_amt, order?.discountamount) || 0;
  const otherCharges = (firstPositiveAmount(
    order?.other_charges,
    order?.othercharges,
    order?.other_charges_amt,
    order?.other_amt,
    order?.othamt,
    order?.othcharge?.amt,
    order?.shareinfo?.othamt
  ) ?? firstAmount(
    order?.other_charges,
    order?.othercharges,
    order?.other_charges_amt,
    order?.other_amt,
    order?.othamt,
    order?.othcharge?.amt,
    order?.shareinfo?.othamt
  )) || 0;

  const paidRaw = firstAmount(
    order?.paid_amt,
    order?.paidamount,
    order?.paid_amount,
    order?.receivedamount,
    order?.totalpaid,
    order?.total_amt,
    order?.totalamount,
    order?.total_amount,
    order?.cashpaid
  );

  const balanceAmount = (firstPositiveAmount(
    order?.balance_amt,
    order?.balanceamount,
    order?.balance_amount,
    order?.balamt,
    order?.dueamount,
    order?.shareinfo?.balamt
  ) ?? firstAmount(
    order?.balance_amt,
    order?.balanceamount,
    order?.balance_amount,
    order?.balamt,
    order?.dueamount,
    order?.shareinfo?.balamt
  )) || 0;

  const calculatedSubtotalCents =
    (toCents(planRate) || 0) +
    taxTotal +
    (toCents(otherCharges) || 0) -
    (toCents(discount) || 0);

  const billedTotal = firstAmount(
    order?.grandtotal,
    order?.payable_amt,
    order?.payableamount,
    order?.rounded_total,
    order?.round_total
  );
  const fallbackSubtotal = firstAmount(order?.subtotal, order?.sub_total);
  const paidCents = toCents(paidRaw);
  const billedCents = toCents(billedTotal);
  const fallbackCents = toCents(fallbackSubtotal);
  const balanceCents = normalizeResidualBalanceCents(toCents(balanceAmount) || 0, {
    subtotalCents: calculatedSubtotalCents,
    paidCents,
    billedCents,
  });

  const paidMinusBalanceCents =
    paidCents !== null && balanceCents > 0 && paidCents >= balanceCents
      ? (paidCents - balanceCents)
      : null;

  const subtotalCents =
    (calculatedSubtotalCents > 0)
      ? calculatedSubtotalCents
      : (billedCents !== null && billedCents > 0)
        ? billedCents
        : (paidMinusBalanceCents !== null)
        ? paidMinusBalanceCents
        : (fallbackCents !== null ? fallbackCents : 0);

  const paidAmountCents = paidCents !== null && paidCents >= 0 ? paidCents : subtotalCents;

  // Internet receipts never carry a customer balance. Any positive
  // "balance" on an Internet row is the share-settlement phantom
  // (customer total − operator wallet debit) that older saves recorded
  // as paid=walletDebit; left alone it shows as an orange Balance card
  // and appears to grow 20 → 40 across renewals. For Internet, the
  // customer paid the full cycle bill, so Total Paid == subtotal and
  // the displayed balance is always zero.
  const isInternet = serviceType === 'internet';
  // Updated behavior: normalized internet balances are displayed; only
  // zero-balance rows keep the old paid=subtotal presentation.
  const displayPaidCents =
    isInternet && balanceCents === 0 && paidAmountCents < subtotalCents
      ? subtotalCents
      : paidAmountCents;
  const displayBalanceCents = balanceCents;

  return {
    planRate: fromCents(toCents(planRate) || 0),
    subtaxes,
    discount: fromCents(toCents(discount) || 0),
    otherCharges: fromCents(toCents(otherCharges) || 0),
    subtotal: fromCents(subtotalCents),
    paidAmount: fromCents(displayPaidCents),
    balanceAmount: fromCents(displayBalanceCents),
  };
};

export default function PaymentHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const customerData = location.state?.customer;
  const cableDetails = location.state?.cableDetails;
  const serviceType = canonicalServiceKey(location.state?.serviceType); // 'fofi' | 'internet' | 'cabletv' | undefined
  const fofiboxid = location.state?.fofiboxid; // present only when navigated from FoFi page
  const cableboxid = location.state?.cableboxid; // present only when navigated from Cable TV / IPTV page

  // Discovery toggle: ?debugOrders=1 OR dev build. Renders a JSON
  // dump of the raw response at the bottom so we can confirm what
  // fields the backend actually returns (servicekey, planid, ...).
  const debugOrders = import.meta.env.DEV ||
    new URLSearchParams(location.search).get('debugOrders') === '1';

  const [orderHistory, setOrderHistory] = useState(null);
  const [rawResponse, setRawResponse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchOrderHistory() {
      setLoading(true);
      setError("");
      try {
        const user = getUser();
        const apiopid = cableDetails?.body?.op_id || customerData?.op_id || user?.op_id;
        const cid = customerData?.customer_id;
        // Perf-tracked via orderApis

        let allOrders = [];

        // First, check for recent payments stored in localStorage (for payments not yet synced to API)
        if (serviceType === 'fofi') {
          try {
            const recentPaymentsJson = localStorage.getItem('fofi_recent_payments');
            if (recentPaymentsJson) {
              const recentPayments = JSON.parse(recentPaymentsJson);
              // Filter payments for this customer and not older than 24 hours
              const now = Date.now();
              const validPayments = recentPayments.filter(p =>
                p.cid === cid && (now - p.timestamp) < 24 * 60 * 60 * 1000
              );
              if (validPayments.length > 0) {
                // Found recent local payments
                allOrders = [...allOrders, ...validPayments.map(p => ({ ...p, servicekey: 'fofi', _source: 'localStorage' }))];
              }
            }
          } catch (localErr) {
            // Failed to read local payments — non-critical
          }
        }

        // Fetch payment history through the service-aware selector
        // (mirrors native, see orderApis.getOrderHistoryFor):
        // - FoFi / Cable TV → /ServiceApis/ordersList keyed on the customer
        //   id + servid; already server-filtered, rows tagged authoritative.
        // - Internet → generic /apis/custpayhistory (ALL payments), filtered
        //   client-side below via the central service registry.
        try {
          const userid = customerData?.username || customerData?.customer_id || cid;
          // username = operator app_username (native sends this to ordersList).
          const apiCtx = { apiopid, cid, userid, username: user?.username };
          console.log("🔵 [PaymentHistory] Fetching for serviceType:", serviceType, "ctx:", apiCtx);
          const custPayData = await getOrderHistoryFor(serviceType, apiCtx);
          setRawResponse(custPayData);
          console.log("🟢 [PaymentHistory] response (source: " + (custPayData?._source || 'unknown') + "):", custPayData);

          if (custPayData?.body && Array.isArray(custPayData.body)) {
            allOrders = [...allOrders, ...custPayData.body];
            console.log(`🟢 [PaymentHistory] Orders from API (${custPayData?._source}):`, custPayData.body.length);
          } else {
            console.warn("⚠️ [PaymentHistory] API returned no data or error:", custPayData?.status?.err_msg);
          }
        } catch (apiErr) {
          console.error("❌ [PaymentHistory] order history API error:", apiErr.message);
        }

        console.log("🔵 [PaymentHistory] Total orders before filter:", allOrders.length);

        // Service filter — uses central registry. Resolver checks
        // every plausible identifier field (servicekey, serv_key,
        // service_key, srvtype, servid, services_app, ...) then
        // falls back to plan-name regex. Legacy unclassified generic
        // rows are kept only under Internet to avoid cross-service leaks.
        if (serviceType) {
          const before = allOrders.length;
          allOrders = filterOrdersByService(allOrders, serviceType, null, {
            unclassifiedServiceKey: 'internet',
          });
          console.log(`🔵 [PaymentHistory] Service filter "${serviceType}": ${before} → ${allOrders.length}`);
        }

        // Remove duplicates only when the backend gives a stable order/payment
        // identifier. Older rows often share amount/plan fields or omit dates,
        // so collapsing by those fields can hide valid historic receipts.
        const uniqueOrders = [];
        const seen = new Set();
        for (const order of allOrders) {
          const key = getStableOrderKey(order);
          if (!key || !seen.has(key)) {
            if (key) seen.add(key);
            uniqueOrders.push(order);
          }
        }

        // Sort by payment date (newest first)
        uniqueOrders.sort((a, b) => {
          const dateA = parsePaymentDate(a.payment_date);
          const dateB = parsePaymentDate(b.payment_date);
          return dateB - dateA;
        });

        console.log("🟢 [PaymentHistory] Final orders:", uniqueOrders.length);

        if (uniqueOrders.length === 0) {
          setError("No payment history found for this customer");
          setOrderHistory({ body: [] });
        } else {
          setOrderHistory({ body: uniqueOrders, status: { err_code: 0 } });
        }
      } catch (err) {
        console.error("❌ [PaymentHistory] Failed to fetch order history:", err);
        setError("Failed to fetch order history. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    if (customerData) {
      fetchOrderHistory();
    }
  }, [customerData, cableDetails, serviceType, fofiboxid, cableboxid]);

  const orders = orderHistory?.body || [];

  const handleDownload = (order) => {
    const breakdown = getPaymentBreakdown(order, serviceType);
    const customerName = order.name || customerData?.name || "N/A";
    const customerId = formatCustomerId(order.cid || customerData?.customer_id);
    const mobile = order.mobile || customerData?.mobile || "N/A";

    // Create PDF document
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Colors matching UI
    const primaryColor = [79, 70, 229]; // indigo-600
    const purpleColor = [147, 51, 234]; // purple-600
    const grayColor = [107, 114, 128]; // gray-500
    const darkGray = [31, 41, 55]; // gray-800

    // Header background
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, pageWidth, 40, 'F');

    // Header text
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("PAYMENT RECEIPT", pageWidth / 2, 18, { align: "center" });

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text("BBNL - Bangalore Broadband Network Limited", pageWidth / 2, 28, { align: "center" });
    doc.setFontSize(10);
    doc.text(serviceType === 'fofi' ? 'FoFi Smart Box Service' : 'Internet Service', pageWidth / 2, 35, { align: "center" });

    y = 50;

    // Helper function to draw section header
    const drawSectionHeader = (title, yPos) => {
      doc.setFillColor(238, 242, 255); // indigo-50
      doc.roundedRect(15, yPos, pageWidth - 30, 10, 2, 2, 'F');
      doc.setTextColor(...primaryColor);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(title, 20, yPos + 7);
      return yPos + 15;
    };

    // Helper function to draw label-value pair
    const drawLabelValue = (label, value, yPos, labelColor = grayColor, valueColor = darkGray) => {
      doc.setTextColor(...labelColor);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(label, 20, yPos);
      doc.setTextColor(...valueColor);
      doc.setFont("helvetica", "bold");
      doc.text(String(value), pageWidth - 20, yPos, { align: "right" });
      return yPos + 8;
    };

    // Payment Date section
    doc.setFillColor(238, 242, 255);
    doc.roundedRect(15, y, pageWidth - 30, 14, 3, 3, 'F');
    doc.setTextColor(...grayColor);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Payment Date", 20, y + 6);
    doc.setTextColor(...darkGray);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(order.payment_date || "N/A", 20, y + 12);
    y += 20;

    // Customer Details Section
    y = drawSectionHeader("CUSTOMER DETAILS", y);
    y = drawLabelValue("Customer Name", customerName, y);
    y = drawLabelValue("Customer ID", customerId, y);
    y = drawLabelValue("Mobile Number", mobile, y);
    if (order.gstno) {
      y = drawLabelValue("GST Number", order.gstno, y);
    }
    y += 5;

    // Payment Details Section
    y = drawSectionHeader("PAYMENT DETAILS", y);
    y = drawLabelValue("Payment Mode", (order.pymt_mode || "N/A").toUpperCase(), y);
    y = drawLabelValue("Payment Type", (order.pymt_type || "N/A").toUpperCase(), y);
    if (order.orderid) {
      y = drawLabelValue("Order ID", order.orderid, y);
    }
    y += 5;

    // Plan Details Section
    y = drawSectionHeader("PLAN DETAILS", y);
    doc.setFillColor(238, 242, 255);
    doc.roundedRect(15, y, pageWidth - 30, 14, 3, 3, 'F');
    doc.setTextColor(...primaryColor);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(order.plan_name || "N/A", 20, y + 9);
    doc.setTextColor(...primaryColor);
    doc.text(`Rs. ${formatAmount(breakdown.planRate)} /month`, pageWidth - 20, y + 9, { align: "right" });
    y += 22;

    // Payment Breakdown Section
    y = drawSectionHeader("PAYMENT BREAKDOWN", y);

    // Draw breakdown box
    const breakdownStartY = y;
    doc.setFillColor(249, 250, 251); // gray-50

    // Calculate box height based on content
    let lineCount = 2; // Plan Rate + Subtotal
    if (breakdown.subtaxes.length > 0) lineCount += breakdown.subtaxes.length;
    if (breakdown.discount > 0) lineCount++;
    if (breakdown.otherCharges > 0) lineCount++;
    const boxHeight = lineCount * 8 + 15;

    doc.roundedRect(15, y, pageWidth - 30, boxHeight, 3, 3, 'F');
    y += 8;

    // Plan Rate
    y = drawLabelValue("Plan Rate", `Rs. ${formatAmount(breakdown.planRate)}`, y);

    // Taxes
    if (breakdown.subtaxes.length > 0) {
      breakdown.subtaxes.forEach(tax => {
        y = drawLabelValue(`${tax.key} (${tax.perc}%)`, `Rs. ${formatAmount(tax.value)}`, y);
      });
    }

    // Discount
    if (breakdown.discount > 0) {
      y = drawLabelValue("Discount", `-Rs. ${formatAmount(breakdown.discount)}`, y, grayColor, [22, 163, 74]); // green
    }

    // Other Charges
    if (breakdown.otherCharges > 0) {
      y = drawLabelValue("Other Charges", `Rs. ${formatAmount(breakdown.otherCharges)}`, y);
    }

    // Subtotal line
    doc.setDrawColor(229, 231, 235);
    doc.line(20, y, pageWidth - 20, y);
    y += 6;
    y = drawLabelValue("Subtotal", `Rs. ${formatAmount(breakdown.subtotal)}`, y);
    y += 8;

    // Total Paid - Purple highlight box
    doc.setFillColor(250, 245, 255); // purple-50
    doc.roundedRect(15, y, pageWidth - 30, 18, 3, 3, 'F');
    doc.setTextColor(...purpleColor);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Total Paid", 20, y + 12);
    doc.setFontSize(16);
    doc.text(`Rs. ${formatAmount(breakdown.paidAmount)}`, pageWidth - 20, y + 12, { align: "right" });
    y += 25;

    // Balance Amount (if any)
    if (breakdown.balanceAmount > 0) {
      doc.setFillColor(255, 247, 237); // orange-50
      doc.roundedRect(15, y, pageWidth - 30, 16, 3, 3, 'F');
      doc.setTextColor(234, 88, 12); // orange-600
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Balance Amount", 20, y + 11);
      doc.setFontSize(14);
      doc.text(`Rs. ${formatAmount(breakdown.balanceAmount)}`, pageWidth - 20, y + 11, { align: "right" });
      y += 22;
    }

    // Footer
    y += 10;
    doc.setDrawColor(229, 231, 235);
    doc.line(15, y, pageWidth - 15, y);
    y += 8;

    doc.setTextColor(...grayColor);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Thank you for your payment!", pageWidth / 2, y, { align: "center" });
    y += 5;
    doc.text("For support, contact BBNL Customer Care.", pageWidth / 2, y, { align: "center" });
    y += 8;
    doc.setFontSize(8);
    doc.text(`Generated on: ${new Date().toLocaleString('en-IN')}`, pageWidth / 2, y, { align: "center" });

    // Create filename with date and customer ID
    const dateStr = (order.payment_date || "").replace(/[:\s]/g, '-').replace(/\//g, '-');
    const fileName = `BBNL_Receipt_${customerId}_${dateStr || Date.now()}.pdf`;

    // Download the PDF
    doc.save(fileName);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    return dateStr;
  };

  const formatAmount = (amount) => {
    const parsed = toAmount(amount);
    if (parsed === null) return "0.00";
    return parsed.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  if (!customerData) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
          <button onClick={() => navigate(-1)} className="p-1 mr-3">
            <ArrowLeftIcon className="h-6 w-6 text-white" />
          </button>
          <h1 className="text-lg font-medium text-white">Payment History</h1>
        </header>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center py-10 px-6 bg-white rounded-2xl shadow-lg">
            <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">No customer data available</p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">
          {serviceType === 'fofi' ? ' Payment History' : 'Payment History'}
        </h1>
      </header>

      {/* Customer Info Banner */}
      <div className="bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
            {serviceType === 'fofi' ? (
              <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Blue circle background */}
                <circle cx="50" cy="50" r="50" fill="url(#fofiGradientPH)" />
                {/* Top dome/arc */}
                <path d="M25 48 Q50 22, 75 48" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
                {/* Three horizontal wave lines */}
                <line x1="22" y1="55" x2="78" y2="55" stroke="white" strokeWidth="5" strokeLinecap="round" />
                <line x1="26" y1="66" x2="74" y2="66" stroke="white" strokeWidth="5" strokeLinecap="round" />
                <line x1="32" y1="77" x2="68" y2="77" stroke="white" strokeWidth="4" strokeLinecap="round" />
                <defs>
                  <linearGradient id="fofiGradientPH" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#38BDF8" />
                    <stop offset="100%" stopColor="#0284C7" />
                  </linearGradient>
                </defs>
              </svg>
            ) : (
              <UserIcon className="w-6 h-6 text-white" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-white font-semibold text-base">
              {customerData.name || "Customer"}
            </h2>
            <p className="text-white/80 text-sm">
              ID: {formatCustomerId(customerData.customer_id)}
            </p>
            {serviceType === 'fofi' && (
              <p className="text-white/70 text-xs mt-0.5">FoFi Smart Box</p>
            )}
          </div>
        </div>
      </div>

      {/* API Error Banner */}
      {error && (
        <div className="mx-4 mt-4 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
          <div className="flex-shrink-0 w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mt-0.5">
            <span className="text-red-500 text-sm font-bold">✕</span>
          </div>
          <p className="text-red-600 text-sm flex-1">{error}</p>
        </div>
      )}

      <div className="flex-1 px-4 py-4 pb-24">
        {/* Payment Cards */}
        {loading ? (
          <Loader size="lg" color="indigo" text="Loading payment history..." className="py-10" />
        ) : orders.length > 0 ? (
          <div className="space-y-4">
            {orders.map((order, idx) => {
              const breakdown = getPaymentBreakdown(order, serviceType);

              return (
              <div
                key={order.orderid || idx}
                className="bg-white rounded-2xl shadow-lg overflow-hidden"
              >
                {/* Card Header */}
                <div className="bg-gradient-to-r from-indigo-50 to-blue-50 px-4 py-3 flex items-center justify-between border-b border-indigo-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <CalendarDaysIcon className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Date</p>
                      <p className="text-sm font-semibold text-gray-800">{formatDate(order.payment_date)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownload(order)}
                    className="w-10 h-10 bg-indigo-100 hover:bg-indigo-200 rounded-xl flex items-center justify-center transition-colors"
                    title="Download Receipt"
                  >
                    <ArrowDownTrayIcon className="w-5 h-5 text-indigo-600" />
                  </button>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-3">
                  {/* Plan Info - Highlighted */}
                  <div className="bg-indigo-50 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DocumentTextIcon className="w-5 h-5 text-indigo-500" />
                        <span className="text-sm font-semibold text-indigo-700">
                          {order.plan_name || "N/A"}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-indigo-600">
                        ₹{formatAmount(breakdown.planRate)} /month
                      </span>
                    </div>
                  </div>

                  {/* Customer Details Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Customer Name */}
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <UserIcon className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs text-gray-500">Name</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {order.name || customerData.name || "N/A"}
                      </p>
                    </div>

                    {/* Mobile */}
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <DevicePhoneMobileIcon className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs text-gray-500">Mobile</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800">
                        {order.mobile || customerData.mobile || "N/A"}
                      </p>
                    </div>

                    {/* Payment Mode */}
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CreditCardIcon className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs text-gray-500">Payment Mode</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 capitalize">
                        {order.pymt_mode || "N/A"}
                      </p>
                    </div>

                    {/* Payment Type */}
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CreditCardIcon className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs text-gray-500">Payment Type</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 capitalize">
                        {order.pymt_type || "N/A"}
                      </p>
                    </div>
                  </div>

                  {/* Payment Breakdown */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Payment Breakdown</p>

                    {/* Plan Rate */}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Plan Rate</span>
                      <span className="text-gray-800 font-medium">₹{formatAmount(breakdown.planRate)}</span>
                    </div>

                    {/* Taxes */}
                    {breakdown.subtaxes.length > 0 && breakdown.subtaxes.map((tax, taxIdx) => (
                      <div key={taxIdx} className="flex justify-between text-sm">
                        <span className="text-gray-600">{tax.key} ({tax.perc}%)</span>
                        <span className="text-gray-800 font-medium">₹{formatAmount(tax.value)}</span>
                      </div>
                    ))}

                    {/* Discount */}
                    {breakdown.discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-green-600">Discount</span>
                        <span className="text-green-600 font-medium">-₹{formatAmount(breakdown.discount)}</span>
                      </div>
                    )}

                    {/* Other Charges */}
                    {breakdown.otherCharges > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Other Charges</span>
                        <span className="text-gray-800 font-medium">₹{formatAmount(breakdown.otherCharges)}</span>
                      </div>
                    )}

                    {/* Subtotal */}
                    <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="text-gray-800 font-medium">₹{formatAmount(breakdown.subtotal)}</span>
                    </div>
                  </div>

                  {/* Total Amount - Highlighted */}
                  <div className="flex items-center justify-between bg-purple-50 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <BanknotesIcon className="w-5 h-5 text-purple-600" />
                      <span className="text-gray-600 text-sm font-medium">Total Paid</span>
                    </div>
                    <span className="text-xl font-bold text-purple-600">
                      ₹{formatAmount(breakdown.paidAmount)}
                    </span>
                  </div>

                  {/* Balance Amount (if any) */}
                  {breakdown.balanceAmount > 0 && (
                    <div className="flex items-center justify-between bg-orange-50 rounded-xl p-3">
                      <span className="text-orange-600 text-sm font-medium">Balance Amount</span>
                      <span className="text-lg font-bold text-orange-600">
                        ₹{formatAmount(breakdown.balanceAmount)}
                      </span>
                    </div>
                  )}

                  {/* GST Number (if available) */}
                  {order.gstno && (
                    <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
                      <span>GST No: <span className="font-medium text-gray-700">{order.gstno}</span></span>
                    </div>
                  )}

                  {/* Customer ID */}
                  <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
                    <span>Customer ID: <span className="font-medium text-indigo-600">{formatCustomerId(order.cid || customerData.customer_id)}</span></span>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg p-6 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <DocumentTextIcon className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-gray-800 font-semibold mb-2">No Results</h3>
            <p className="text-gray-500 text-sm">No payment history found.</p>
          </div>
        )}

        {/* Summary */}
        {!loading && !error && orders.length > 0 && (
          <div className="mt-4 bg-white rounded-2xl shadow-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Total Payments</span>
              <span className="text-lg font-bold text-indigo-600">{orders.length}</span>
            </div>
          </div>
        )}

        {/* Discovery panel — DEV or ?debugOrders=1 only.
            Shows the raw response so we can confirm which fields
            (servicekey, planid, srvtype, ...) the backend actually
            returns per order. Once we know, we can tighten the
            registry resolver and remove this panel. */}
        {debugOrders && rawResponse && (
          <details className="mt-4 bg-yellow-50 border border-yellow-300 rounded-2xl p-4">
            <summary className="cursor-pointer text-sm font-semibold text-yellow-800">
              🔍 Discovery: raw API response (source: {rawResponse._source || 'unknown'}, items: {Array.isArray(rawResponse.body) ? rawResponse.body.length : 0})
            </summary>
            <div className="mt-3 space-y-3 text-xs">
              <div>
                <p className="font-semibold text-gray-700">Filter context</p>
                <pre className="bg-white rounded p-2 overflow-auto max-h-32">
{JSON.stringify({ serviceType, fofiboxid, customerId: customerData?.customer_id }, null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-gray-700">Keys present on first 3 orders</p>
                <pre className="bg-white rounded p-2 overflow-auto max-h-40">
{JSON.stringify(
  (Array.isArray(rawResponse.body) ? rawResponse.body : []).slice(0, 3).map(o => Object.keys(o || {})),
  null,
  2
)}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-gray-700">First order (full)</p>
                <pre className="bg-white rounded p-2 overflow-auto max-h-72">
{JSON.stringify((Array.isArray(rawResponse.body) ? rawResponse.body[0] : null) || {}, null, 2)}
                </pre>
              </div>
            </div>
          </details>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
