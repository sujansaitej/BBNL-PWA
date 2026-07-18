import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  UserIcon,
  DocumentTextIcon,
  ReceiptRefundIcon,
  DocumentArrowDownIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { mapOrderView, getReceiptUrl, getInvoiceUrl } from "../services/orderApis";
import { canonicalServiceKey } from "../constants/services";
import { formatCustomerId } from "../services/helpers";
import BottomNav from "../components/BottomNav";

const formatMoney = (value) =>
  "₹" + (Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isSuccess = (status) => String(status || "").toLowerCase().includes("success");

const EXT_BY_TYPE = { "application/pdf": "pdf", "text/html": "html", "image/png": "png", "image/jpeg": "jpg" };

// Fetch the server document and save it to device storage under a meaningful
// name. Avoids the blank in-app tab that window.open() produced: the endpoint
// serves the PDF with `Content-Disposition: inline`, so the installed PWA tried
// to render it in a webview instead of downloading. The server sets
// Access-Control-Allow-Origin:* and needs no auth (matches native's plain GET).
async function downloadDocument(url, baseName) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("Empty document");

  const ext = EXT_BY_TYPE[(blob.type || "").split(";")[0].trim()] || "pdf";
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${baseName}.${ext}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

// Row of the native-style label:value detail table.
function Row({ label, children, valueClass = "text-gray-800" }) {
  return (
    <div className="flex items-start px-4 py-3 border-b border-gray-100 last:border-b-0">
      <span className="w-36 shrink-0 text-sm text-gray-500">{label}</span>
      <span className={`flex-1 text-sm font-medium break-words ${valueClass}`}>: {children}</span>
    </div>
  );
}

export default function OrderDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const order = location.state?.order;
  const customer = location.state?.customer;
  const serviceType = canonicalServiceKey(location.state?.serviceType);

  const [busy, setBusy] = useState(null); // 'receipt' | 'invoice' | null
  const [docError, setDocError] = useState("");

  const Header = () => (
    <header
      className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
    >
      <button onClick={() => navigate(-1)} className="p-1 mr-3" aria-label="Go back">
        <ArrowLeftIcon className="h-6 w-6 text-white" />
      </button>
      <h1 className="text-lg font-medium text-white">Order Details</h1>
    </header>
  );

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center py-10 px-6 bg-white rounded-2xl shadow-lg">
            <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium mb-4">No order selected</p>
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium"
            >
              Back to Order History
            </button>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const v = mapOrderView(order);
  const ok = isSuccess(v.status);

  const handleDownload = async (type) => {
    if (busy) return;
    setDocError("");
    setBusy(type);
    const url = type === "receipt" ? getReceiptUrl(v.orderNumber) : getInvoiceUrl(v.orderNumber);
    const baseName = `BBNL_${type === "receipt" ? "Receipt" : "Invoice"}_${v.orderNumber}`;
    try {
      await downloadDocument(url, baseName);
    } catch (e) {
      console.error("[OrderDetail] document download failed:", e.message);
      setDocError(`Could not download the ${type}. Please try again.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      {/* Customer banner — Name + User Id */}
      <div className="bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <UserIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex text-white text-sm">
              <span className="w-16 text-white/70">Name</span>
              <span className="font-semibold truncate">: {customer?.name || "Customer"}</span>
            </div>
            <div className="flex text-white text-sm mt-0.5">
              <span className="w-16 text-white/70">User Id</span>
              <span className="font-semibold truncate">: {formatCustomerId(customer?.customer_id)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 pb-24">
        {/* Detail table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <Row label="Order Number">{v.orderNumber || "—"}</Row>
          <Row label="Order Date">{v.orderDate || "—"}</Row>
          <Row label="Total Amount" valueClass="text-gray-900 tabular-nums">{formatMoney(v.totalAmount)}</Row>
          <Row label="Tax Amount" valueClass="text-gray-800 tabular-nums">{formatMoney(v.taxAmount)}</Row>
          <Row label="Discount Amount" valueClass="text-gray-800 tabular-nums">{formatMoney(v.discountAmount)}</Row>
          <Row label="Other Charges" valueClass="text-gray-800 tabular-nums">{formatMoney(v.otherCharges)}</Row>
          <Row label="Payment mode" valueClass="text-gray-800 capitalize">{v.paymentMode || "—"}</Row>
          <Row label="Order Status" valueClass={ok ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
            {String(v.status).toUpperCase()}
          </Row>
        </div>

        {/* Receipt / Invoice — native shows these only for successful orders.
            Downloads the server document to device storage. */}
        {ok && v.orderNumber && (
          <>
            <div className="grid grid-cols-2 gap-4 mt-5">
              <button
                onClick={() => handleDownload("receipt")}
                disabled={!!busy}
                className="flex flex-col items-center gap-2 bg-white rounded-2xl shadow-sm border border-gray-100 py-5 hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-60 disabled:active:scale-100"
              >
                <span className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                  {busy === "receipt" ? (
                    <ArrowPathIcon className="w-6 h-6 text-indigo-600 animate-spin" />
                  ) : (
                    <ReceiptRefundIcon className="w-6 h-6 text-indigo-600" />
                  )}
                </span>
                <span className="text-sm font-semibold text-indigo-700">
                  {busy === "receipt" ? "Downloading…" : "Receipt"}
                </span>
              </button>
              <button
                onClick={() => handleDownload("invoice")}
                disabled={!!busy}
                className="flex flex-col items-center gap-2 bg-white rounded-2xl shadow-sm border border-gray-100 py-5 hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-60 disabled:active:scale-100"
              >
                <span className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                  {busy === "invoice" ? (
                    <ArrowPathIcon className="w-6 h-6 text-indigo-600 animate-spin" />
                  ) : (
                    <DocumentArrowDownIcon className="w-6 h-6 text-indigo-600" />
                  )}
                </span>
                <span className="text-sm font-semibold text-indigo-700">
                  {busy === "invoice" ? "Downloading…" : "Invoice"}
                </span>
              </button>
            </div>
            {docError && (
              <p className="mt-3 text-center text-sm text-red-600" role="alert">{docError}</p>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
