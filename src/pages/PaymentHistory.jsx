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

export default function PaymentHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const customerData = location.state?.customer;
  const cableDetails = location.state?.cableDetails;

  const [orderHistory, setOrderHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchOrderHistory() {
      setLoading(true);
      setError("");
      try {
        const apiopid = cableDetails?.body?.op_id || customerData?.op_id;
        const cid = customerData?.customer_id;
        console.log("Fetching order history for:", { apiopid, cid });
        const data = await getOrderHistory({ apiopid, cid });
        console.log("Order history response:", data);

        if (!data.body || data.body === null) {
          const errorMsg = data.status?.err_msg || "No payment history found for this customer";
          setError(errorMsg);
          setOrderHistory({ body: [] });
        } else if (data.status?.err_code !== 0 && data.status?.err_code !== '0') {
          const errorMsg = data.status?.err_msg || "Failed to fetch payment history";
          setError(errorMsg);
          setOrderHistory({ body: [] });
        } else {
          setOrderHistory(data);
        }
      } catch (err) {
        console.error("Failed to fetch order history:", err);
        setError("Failed to fetch order history. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    if (customerData) {
      fetchOrderHistory();
    }
  }, [customerData, cableDetails]);

  const orders = orderHistory?.body || [];

  const handlePrint = (order) => {
    window.print();
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
        <h1 className="text-lg font-medium text-white">Payment History</h1>
      </header>

      {/* Customer Info Banner */}
      <div className="bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <UserIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-white font-semibold text-base">
              {customerData.name || "Customer"}
            </h2>
            <p className="text-white/80 text-sm">
              ID: {formatCustomerId(customerData.customer_id)}
            </p>
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
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
            <p className="text-gray-500 font-medium">Loading payment history...</p>
          </div>
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
                    onClick={() => handlePrint(order)}
                    className="w-10 h-10 bg-indigo-100 hover:bg-indigo-200 rounded-xl flex items-center justify-center transition-colors"
                  >
                    <ArrowDownTrayIcon className="w-5 h-5 text-indigo-600" />
                  </button>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-3">
                  {/* Amount - Highlighted */}
                  <div className="flex items-center justify-between bg-green-50 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <BanknotesIcon className="w-5 h-5 text-green-600" />
                      <span className="text-gray-600 text-sm">Amount Paid</span>
                    </div>
                    <span className="text-xl font-bold text-green-600">
                      ₹{formatAmount(order.total_amt || order.paid_amt)}
                    </span>
                  </div>

                  {/* Details Grid */}
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

                    {/* Payment Date */}
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CalendarDaysIcon className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs text-gray-500">Date</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800">
                        {formatDate(order.payment_date)}
                      </p>
                    </div>
                  </div>

                  {/* Plan Info */}
                  <div className="bg-indigo-50 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <DocumentTextIcon className="w-3.5 h-3.5 text-indigo-500" />
                      <span className="text-xs text-indigo-600">Plan</span>
                    </div>
                    <p className="text-sm font-semibold text-indigo-700">
                      {order.plan_name || "N/A"}
                    </p>
                  </div>

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
