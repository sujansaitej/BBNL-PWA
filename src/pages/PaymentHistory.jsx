import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { getOrderHistoryFor, mapOrderView } from "../services/orderApis";
import { canonicalServiceKey, filterOrdersByService } from "../constants/services";
import { formatCustomerId } from "../services/helpers";
import { getUser } from "../services/safeStorage";
import BottomNav from "../components/BottomNav";
import { Loader } from "@/components/ui";

// Parse "DD-MM-YYYY HH:MM:SS" → Date (for newest-first sort).
const parsePaymentDate = (dateStr) => {
  if (!dateStr) return new Date(0);
  const parts = dateStr.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (parts) {
    const [, day, month, year, hour, min, sec] = parts;
    return new Date(year, month - 1, day, hour, min, sec);
  }
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
    order?.orderid, order?.order_id, order?.orderno, order?.order_no,
    order?.txn_id, order?.txnid, order?.transactionid, order?.transaction_id,
    order?.paymentid, order?.payment_id, order?.receiptid, order?.receipt_id,
    order?.invoiceid, order?.invoice_id
  );
  return stableId ? `stable:${stableId}` : "";
};

const formatMoney = (value) => {
  const n = Number(value) || 0;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const isSuccess = (status) => String(status || "").toLowerCase().includes("success");

// One label:value line inside an order card. `strong`/`mono`/`cap` tweak the value style.
function Field({ label, children, strong, mono, cap }) {
  const valueClass = mono
    ? "font-semibold text-gray-800 tabular-nums"
    : strong
      ? "font-semibold text-gray-800"
      : "text-gray-700";
  return (
    <div className="flex text-sm">
      <span className="w-24 shrink-0 text-gray-500">{label}</span>
      <span className={`truncate ${valueClass} ${cap ? "capitalize" : ""}`}>: {children}</span>
    </div>
  );
}

export default function PaymentHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const customerData = location.state?.customer;
  const cableDetails = location.state?.cableDetails;
  const serviceType = canonicalServiceKey(location.state?.serviceType); // 'fofi' | 'internet' | 'cabletv' | undefined
  const fofiboxid = location.state?.fofiboxid;
  const cableboxid = location.state?.cableboxid;

  const [orderHistory, setOrderHistory] = useState(null);
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

        let allOrders = [];

        // Native fetches the FoFi/Cable order list from ordersList alone and
        // renders one row per result — no local copy is merged in. (A prior
        // localStorage prepend created a phantom duplicate row per payment
        // because its id — the SERV- transactionid — never matched the API
        // row's ordernumber, so dedup couldn't collapse them.)
        try {
          // ordersList MUST be queried with the SAME id the order was CREATED
          // under, or it returns zero rows. Native keys cable order history on
          // the cable account's own userid (LinkCableAccounts_Fragment →
          // MyOrderHistory). In the PWA, cable orders are created under
          // customer_id (IPTVService.generateCableTvOrder, userid=customer_id),
          // but FoFi orders are created under username (FoFiSmartBox). Sending
          // username for cable is why Cable TV showed "No orders found" while
          // FoFi worked on this same screen — so pick per service.
          const userid = serviceType === "cabletv"
            ? (customerData?.customer_id || customerData?.username || cid)
            : (customerData?.username || customerData?.customer_id || cid);
          const apiCtx = { apiopid, cid, userid, username: user?.username };
          const custPayData = await getOrderHistoryFor(serviceType, apiCtx);
          if (custPayData?.body && Array.isArray(custPayData.body)) {
            allOrders = [...allOrders, ...custPayData.body];
          }
        } catch (apiErr) {
          console.error("[PaymentHistory] order history API error:", apiErr.message);
        }

        // Service filter (central registry). Unclassified legacy rows kept
        // only under Internet to avoid cross-service leaks.
        if (serviceType) {
          allOrders = filterOrdersByService(allOrders, serviceType, null, {
            unclassifiedServiceKey: "internet",
          });
        }

        // Dedupe only when a stable identifier exists.
        const uniqueOrders = [];
        const seen = new Set();
        for (const order of allOrders) {
          const key = getStableOrderKey(order);
          if (!key || !seen.has(key)) {
            if (key) seen.add(key);
            uniqueOrders.push(order);
          }
        }

        uniqueOrders.sort((a, b) => parsePaymentDate(b.payment_date || b.orderdate) - parsePaymentDate(a.payment_date || a.orderdate));

        if (uniqueOrders.length === 0) {
          setError("No order history found for this customer");
          setOrderHistory({ body: [] });
        } else {
          setOrderHistory({ body: uniqueOrders, status: { err_code: 0 } });
        }
      } catch (err) {
        console.error("[PaymentHistory] Failed to fetch order history:", err);
        setError("Failed to fetch order history. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    if (customerData) fetchOrderHistory();
  }, [customerData, cableDetails, serviceType, fofiboxid, cableboxid]);

  const orders = orderHistory?.body || [];

  const openDetail = (order) => {
    navigate("/payment-history/order", {
      state: { order, serviceType, customer: customerData },
    });
  };

  const Header = () => (
    <header
      className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
    >
      <button onClick={() => navigate(-1)} className="p-1 mr-3" aria-label="Go back">
        <ArrowLeftIcon className="h-6 w-6 text-white" />
      </button>
      <h1 className="text-lg font-medium text-white">Order History</h1>
    </header>
  );

  if (!customerData) {
    return (
      <div className="min-h-dvh flex flex-col bg-gray-50">
        <Header />
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
    <div className="min-h-dvh flex flex-col bg-gray-50">
      <Header />

      {/* Customer banner — Name + User Id (native "Customer OverView" header) */}
      <div className="bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center overflow-hidden shrink-0">
            <UserIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex text-white text-sm">
              <span className="w-16 text-white/70">Name</span>
              <span className="font-semibold truncate">: {customerData.name || "Customer"}</span>
            </div>
            <div className="flex text-white text-sm mt-0.5">
              <span className="w-16 text-white/70">User Id</span>
              <span className="font-semibold truncate">: {formatCustomerId(customerData.customer_id)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 pb-1">
        <p className="text-center text-sm font-semibold text-gray-600 tracking-wide">Order List</p>
      </div>

      <div className="flex-1 px-4 py-3 pb-24">
        {loading ? (
          <Loader size="lg" color="indigo" text="Loading order history..." className="py-10" />
        ) : orders.length > 0 ? (
          <div className="space-y-3">
            {orders.map((order, idx) => {
              const v = mapOrderView(order);
              const ok = isSuccess(v.status);
              return (
                <button
                  key={v.orderNumber || idx}
                  onClick={() => openDetail(order)}
                  className="w-full text-left bg-white rounded-2xl shadow-sm hover:shadow-md active:scale-[0.99] transition-all border border-gray-100 flex items-stretch overflow-hidden"
                >
                  <div className="flex-1 p-4 space-y-1.5 min-w-0">
                    {serviceType === "internet" ? (
                      <>
                        {/* Internet TV has no order number — native shows the
                            customer + plan card (Name/Customer Id/Mobile/Amount/
                            Payment date/Payment mode/Plan). */}
                        <Field label="Name">{v.customerName || customerData.name || "—"}</Field>
                        <Field label="Customer Id">{formatCustomerId(v.customerId || customerData.customer_id)}</Field>
                        <Field label="Mobile">{v.mobile || "—"}</Field>
                        <Field label="Amount" mono>{formatMoney(v.totalAmount)}</Field>
                        <Field label="Payment date">{v.orderDate || "—"}</Field>
                        <Field label="Payment mode" cap>{v.paymentMode || "—"}</Field>
                        <Field label="Plan">{v.planName || "—"}</Field>
                      </>
                    ) : (
                      <>
                        <Field label="Order Id" strong>{v.orderNumber || "—"}</Field>
                        <Field label="Date">{v.orderDate || "—"}</Field>
                        <Field label="Amount" mono>{formatMoney(v.totalAmount)}</Field>
                      </>
                    )}
                    <span
                      className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide ${
                        ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {String(v.status).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center pr-3 pl-1 text-indigo-400">
                    <ChevronRightIcon className="w-6 h-6" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg p-6 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <DocumentTextIcon className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-gray-800 font-semibold mb-2">No Orders</h3>
            <p className="text-gray-500 text-sm">{error || "No order history found."}</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
