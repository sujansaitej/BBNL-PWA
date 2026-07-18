import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  UserIcon,
  DocumentTextIcon,
  ReceiptRefundIcon,
  DocumentArrowDownIcon,
} from "@heroicons/react/24/outline";
import { mapOrderView, getReceiptUrl, getInvoiceUrl } from "../services/orderApis";
import { canonicalServiceKey } from "../constants/services";
import { formatCustomerId } from "../services/helpers";
import BottomNav from "../components/BottomNav";

const formatMoney = (value) =>
  "₹" + (Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isSuccess = (status) => String(status || "").toLowerCase().includes("success");

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

  // Native opens the server receipt/invoice PDFs in the browser.
  const openDoc = (url) => window.open(url, "_blank", "noopener,noreferrer");

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

        {/* Receipt / Invoice — native shows these only for successful orders */}
        {ok && v.orderNumber && (
          <div className="grid grid-cols-2 gap-4 mt-5">
            <button
              onClick={() => openDoc(getReceiptUrl(v.orderNumber))}
              className="flex flex-col items-center gap-2 bg-white rounded-2xl shadow-sm border border-gray-100 py-5 hover:shadow-md active:scale-[0.98] transition-all"
            >
              <span className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                <ReceiptRefundIcon className="w-6 h-6 text-indigo-600" />
              </span>
              <span className="text-sm font-semibold text-indigo-700">Receipt</span>
            </button>
            <button
              onClick={() => openDoc(getInvoiceUrl(v.orderNumber))}
              className="flex flex-col items-center gap-2 bg-white rounded-2xl shadow-sm border border-gray-100 py-5 hover:shadow-md active:scale-[0.98] transition-all"
            >
              <span className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                <DocumentArrowDownIcon className="w-6 h-6 text-indigo-600" />
              </span>
              <span className="text-sm font-semibold text-indigo-700">Invoice</span>
            </button>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
