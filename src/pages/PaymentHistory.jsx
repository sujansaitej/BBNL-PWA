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
import { getOrderHistory } from "../services/orderApis";
import { formatCustomerId } from "../services/helpers";
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

export default function PaymentHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const customerData = location.state?.customer;
  const cableDetails = location.state?.cableDetails;
  const serviceType = location.state?.serviceType; // 'fofi' or 'internet' or undefined

  const [orderHistory, setOrderHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchOrderHistory() {
      setLoading(true);
      setError("");
      try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const apiopid = cableDetails?.body?.op_id || customerData?.op_id || user?.op_id;
        const cid = customerData?.customer_id;
        console.log("🔵 [PaymentHistory] Fetching order history for:", { apiopid, cid, serviceType });

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
                console.log("🟢 [PaymentHistory] Found recent local payments:", validPayments.length);
                allOrders = [...allOrders, ...validPayments.map(p => ({ ...p, _source: 'localStorage' }))];
              }
            }
          } catch (localErr) {
            console.warn("⚠️ [PaymentHistory] Failed to read local payments:", localErr.message);
          }
        }

        // Fetch payment history from custpayhistory API
        // Pass servicekey: 'fofi' for FoFi Box orders to get proper order history
        try {
          const apiParams = { apiopid, cid };
          if (serviceType === 'fofi') {
            apiParams.servicekey = 'fofi';
          }
          console.log("🔵 [PaymentHistory] API params:", apiParams);
          const custPayData = await getOrderHistory(apiParams);
          console.log("🟢 [PaymentHistory] custpayhistory response:", custPayData);

          if (custPayData?.status?.err_code === 0 && custPayData?.body && Array.isArray(custPayData.body)) {
            allOrders = [...allOrders, ...custPayData.body];
            console.log("🟢 [PaymentHistory] Orders from custpayhistory:", custPayData.body.length);
          } else if (custPayData?.body && Array.isArray(custPayData.body)) {
            // API returned data even without explicit success code
            allOrders = [...allOrders, ...custPayData.body];
            console.log("🟢 [PaymentHistory] Orders from custpayhistory (no status):", custPayData.body.length);
          } else {
            console.warn("⚠️ [PaymentHistory] custpayhistory API returned no data or error:", custPayData?.status?.err_msg);
          }
        } catch (apiErr) {
          console.error("❌ [PaymentHistory] custpayhistory API error:", apiErr.message);
        }

        console.log("🔵 [PaymentHistory] Total orders:", allOrders.length);

        // Note: custpayhistory API returns ALL payments for a customer
        // We show all payments regardless of service type since the API doesn't filter by service

        // Remove duplicates based on payment_date and total_amt
        const uniqueOrders = [];
        const seen = new Set();
        for (const order of allOrders) {
          const key = `${order.payment_date}_${order.total_amt}_${order.plan_name}`;
          if (!seen.has(key)) {
            seen.add(key);
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
  }, [customerData, cableDetails, serviceType]);

  const orders = orderHistory?.body || [];

  const handleDownload = (order) => {
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
    doc.text(`Rs. ${formatAmount(order.plan_rate)} /month`, pageWidth - 20, y + 9, { align: "right" });
    y += 22;

    // Payment Breakdown Section
    y = drawSectionHeader("PAYMENT BREAKDOWN", y);

    // Draw breakdown box
    const breakdownStartY = y;
    doc.setFillColor(249, 250, 251); // gray-50

    // Calculate box height based on content
    let lineCount = 2; // Plan Rate + Subtotal
    if (order.subtaxes && order.subtaxes.length > 0) lineCount += order.subtaxes.length;
    if (order.discount > 0) lineCount++;
    if (order.other_charges > 0) lineCount++;
    const boxHeight = lineCount * 8 + 15;

    doc.roundedRect(15, y, pageWidth - 30, boxHeight, 3, 3, 'F');
    y += 8;

    // Plan Rate
    y = drawLabelValue("Plan Rate", `Rs. ${formatAmount(order.plan_rate)}`, y);

    // Taxes
    if (order.subtaxes && order.subtaxes.length > 0) {
      order.subtaxes.forEach(tax => {
        y = drawLabelValue(`${tax.key} (${tax.perc}%)`, `Rs. ${formatAmount(tax.value)}`, y);
      });
    }

    // Discount
    if (order.discount > 0) {
      y = drawLabelValue("Discount", `-Rs. ${formatAmount(order.discount)}`, y, grayColor, [22, 163, 74]); // green
    }

    // Other Charges
    if (order.other_charges > 0) {
      y = drawLabelValue("Other Charges", `Rs. ${formatAmount(order.other_charges)}`, y);
    }

    // Subtotal line
    doc.setDrawColor(229, 231, 235);
    doc.line(20, y, pageWidth - 20, y);
    y += 6;
    y = drawLabelValue("Subtotal", `Rs. ${formatAmount(order.subtotal)}`, y);
    y += 8;

    // Total Paid - Purple highlight box
    doc.setFillColor(250, 245, 255); // purple-50
    doc.roundedRect(15, y, pageWidth - 30, 18, 3, 3, 'F');
    doc.setTextColor(...purpleColor);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Total Paid", 20, y + 12);
    doc.setFontSize(16);
    doc.text(`Rs. ${formatAmount(order.paid_amt || order.total_amt)}`, pageWidth - 20, y + 12, { align: "right" });
    y += 25;

    // Balance Due (if any)
    if (order.balance_amt > 0) {
      doc.setFillColor(255, 247, 237); // orange-50
      doc.roundedRect(15, y, pageWidth - 30, 16, 3, 3, 'F');
      doc.setTextColor(234, 88, 12); // orange-600
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Balance Due", 20, y + 11);
      doc.setFontSize(14);
      doc.text(`Rs. ${formatAmount(order.balance_amt)}`, pageWidth - 20, y + 11, { align: "right" });
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
    if (!amount) return "0";
    return Number(amount).toLocaleString('en-IN');
  };

  if (!customerData) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
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
      <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
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
            {orders.map((order, idx) => (
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
                        ₹{formatAmount(order.plan_rate)} /month
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
                      <span className="text-gray-800 font-medium">₹{formatAmount(order.plan_rate)}</span>
                    </div>

                    {/* Taxes */}
                    {order.subtaxes && order.subtaxes.length > 0 && order.subtaxes.map((tax, taxIdx) => (
                      <div key={taxIdx} className="flex justify-between text-sm">
                        <span className="text-gray-600">{tax.key} ({tax.perc}%)</span>
                        <span className="text-gray-800 font-medium">₹{formatAmount(tax.value)}</span>
                      </div>
                    ))}

                    {/* Discount */}
                    {order.discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-green-600">Discount</span>
                        <span className="text-green-600 font-medium">-₹{formatAmount(order.discount)}</span>
                      </div>
                    )}

                    {/* Other Charges */}
                    {order.other_charges > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Other Charges</span>
                        <span className="text-gray-800 font-medium">₹{formatAmount(order.other_charges)}</span>
                      </div>
                    )}

                    {/* Subtotal */}
                    <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="text-gray-800 font-medium">₹{formatAmount(order.subtotal)}</span>
                    </div>
                  </div>

                  {/* Total Amount - Highlighted */}
                  <div className="flex items-center justify-between bg-purple-50 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <BanknotesIcon className="w-5 h-5 text-purple-600" />
                      <span className="text-gray-600 text-sm font-medium">Total Paid</span>
                    </div>
                    <span className="text-xl font-bold text-purple-600">
                      ₹{formatAmount(order.paid_amt || order.total_amt)}
                    </span>
                  </div>

                  {/* Balance Amount (if any) */}
                  {order.balance_amt > 0 && (
                    <div className="flex items-center justify-between bg-orange-50 rounded-xl p-3">
                      <span className="text-orange-600 text-sm font-medium">Balance Due</span>
                      <span className="text-lg font-bold text-orange-600">
                        ₹{formatAmount(order.balance_amt)}
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
            ))}
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
      </div>

      <BottomNav />
    </div>
  );
}
