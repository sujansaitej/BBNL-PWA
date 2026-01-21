import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, MagnifyingGlassIcon, PrinterIcon } from "@heroicons/react/24/outline";
import { getOrderHistory } from "../services/orderApis";
import BottomNav from "../components/BottomNav";

export default function PaymentHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const customerData = location.state?.customer;
  const cableDetails = location.state?.cableDetails;

  const [orderHistory, setOrderHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function fetchOrderHistory() {
      setLoading(true);
      setError("");
      try {
        const apiopid = cableDetails?.body?.op_id || customerData?.op_id;
        const cid = customerData?.customer_id;
        console.log("🔵 Fetching order history for:", { apiopid, cid });
        const data = await getOrderHistory({ apiopid, cid });
        console.log("🟢 Order history response:", data);

        // Check if body is null or if error code indicates failure
        if (!data.body || data.body === null) {
          const errorMsg = data.status?.err_msg || "No payment history found for this customer";
          console.log("⚠️ No data in response:", errorMsg);
          setError(errorMsg);
          setOrderHistory({ body: [] }); // Set empty array to show "No payment history found" message
        } else if (data.status?.err_code !== 0 && data.status?.err_code !== '0') {
          // Check for error code
          const errorMsg = data.status?.err_msg || "Failed to fetch payment history";
          console.log("⚠️ API returned error:", errorMsg);
          setError(errorMsg);
          setOrderHistory({ body: [] });
        } else {
          setOrderHistory(data);
        }
      } catch (err) {
        console.error("❌ Failed to fetch order history:", err);
        setError("Failed to fetch order history. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    if (customerData) {
      fetchOrderHistory();
    }
  }, [customerData, cableDetails]);

  // Filter orders based on search query
  const filteredOrders = orderHistory?.body?.filter(order => {
    const searchLower = searchQuery.toLowerCase();
    return (
      order.name?.toLowerCase().includes(searchLower) ||
      order.cid?.toLowerCase().includes(searchLower) ||
      order.mobile?.toLowerCase().includes(searchLower)
    );
  }) || [];

  const handlePrint = (order) => {
    // Implement print functionality
    window.print();
  };

  if (!customerData) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-teal-400 to-cyan-300">
        <header
          className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg"
        >
          <button onClick={() => navigate(-1)} className="p-1 mr-3">
            <ArrowLeftIcon className="h-6 w-6 text-white" />
          </button>
          <h1 className="text-lg font-medium text-white">Payment History</h1>
        </header>
        <div className="flex-1 px-3 py-4">
          <div className="text-center text-white py-10 bg-white/20 rounded-xl backdrop-blur-sm">
            No customer data available.
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-gradient-to-b from-teal-400 to-cyan-300">

      {/* Bottom Wave Decoration - Exact match to screenshot */}
      <div className="fixed bottom-0 left-0 right-0 z-0 pointer-events-none">
        <svg viewBox="0 0 400 200" className="w-full" preserveAspectRatio="none" style={{ height: '60vh' }}>
          {/* Main wave shape */}
          <path
            d="M0,100 Q100,50 200,100 T400,100 L400,200 L0,200 Z"
            fill="#f5f5f0"
            opacity="1"
          />
          {/* Top curve accent */}
          <path
            d="M0,90 Q100,40 200,90 T400,90"
            fill="none"
            stroke="#e0e0d8"
            strokeWidth="1"
            opacity="0.5"
          />
        </svg>
      </div>

      {/* Teal Header - Exact match to screenshot */}
      <header
        className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg"
      >
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">Payment History</h1>
      </header>

      <div className="relative z-10 flex-1 max-w-md mx-auto w-full px-4 py-4 pb-24">
        {/* Search Bar - Exact match to screenshot */}
        <div className="relative mb-4">
          <input
            type="text"
            placeholder={customerData.customer_id || "Search..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 pr-12 rounded-lg bg-white border-0 focus:outline-none focus:ring-2 focus:ring-teal-300 shadow-sm text-gray-700 placeholder-gray-400 text-sm"
          />
          <button className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <MagnifyingGlassIcon className="w-5 h-5 text-teal-500" />
          </button>
        </div>

        {/* Payment History Cards - Exact match to screenshot */}
        {loading ? (
          <div className="text-center py-10 text-white bg-white/20 rounded-xl backdrop-blur-sm">
            Loading payment history...
          </div>
        ) : error ? (
          <div className="text-center py-10 bg-white rounded-xl shadow-md">
            <div className="text-orange-500 font-medium mb-2">⚠️ {error}</div>
            <p className="text-gray-500 text-sm">This customer may not have any payment records yet.</p>
          </div>
        ) : filteredOrders.length > 0 ? (
          filteredOrders.map((order, idx) => (
            <div
              key={order.orderid || idx}
              className="bg-white rounded-xl shadow-md p-4 mb-4 relative"
            >
              {/* Print Button - Top Right */}
              <button
                onClick={() => handlePrint(order)}
                className="absolute right-4 top-4"
              >
                <PrinterIcon className="w-7 h-7 text-teal-500" />
              </button>

              {/* Payment Details - Exact layout from screenshot */}
              <div className="space-y-1 pr-12 text-sm">
                {/* Name */}
                <div className="flex">
                  <span className="text-gray-600 w-32 flex-shrink-0">Name</span>
                  <span className="text-gray-600 mr-2">:</span>
                  <span className="text-gray-800">{order.name || customerData.name || "N/A"}</span>
                </div>

                {/* Customer Id - Single line format: (count)cid [op_id] */}
                <div className="flex">
                  <span className="text-gray-600 w-32 flex-shrink-0">Customer Id</span>
                  <span className="text-gray-600 mr-2">:</span>
                  <span className="text-gray-800">
                    <span className="text-teal-500">({order.count || "1"})</span>
                    {order.cid || customerData.customer_id}{" "}
                    <span className="text-gray-500">[{order.op_id || cableDetails?.body?.op_id || "N/A"}]</span>
                  </span>
                </div>

                {/* Mobile */}
                <div className="flex">
                  <span className="text-gray-600 w-32 flex-shrink-0">Mobile</span>
                  <span className="text-gray-600 mr-2">:</span>
                  <span className="text-gray-800">{order.mobile || customerData.mobile || "N/A"}</span>
                </div>

                {/* Amount */}
                <div className="flex">
                  <span className="text-gray-600 w-32 flex-shrink-0">Amount</span>
                  <span className="text-gray-600 mr-2">:</span>
                  <span className="text-gray-800">₹{order.total_amt || order.paid_amt || "0"}</span>
                </div>

                {/* Payment mode */}
                <div className="flex">
                  <span className="text-gray-600 w-32 flex-shrink-0">Payment mode</span>
                  <span className="text-gray-600 mr-2">:</span>
                  <span className="text-gray-800">{order.pymt_mode || "N/A"}</span>
                </div>

                {/* Payment date */}
                <div className="flex">
                  <span className="text-gray-600 w-32 flex-shrink-0">Payment date</span>
                  <span className="text-gray-600 mr-2">:</span>
                  <span className="text-gray-800">{order.payment_date || "N/A"}</span>
                </div>

                {/* Plan */}
                <div className="flex">
                  <span className="text-gray-600 w-32 flex-shrink-0">Plan</span>
                  <span className="text-gray-600 mr-2">:</span>
                  <span className="text-gray-800">{order.plan_name || "N/A"}</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-10 bg-white rounded-xl shadow-md text-gray-500">
            No payment history found{searchQuery ? ` for "${searchQuery}"` : ""}.
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
