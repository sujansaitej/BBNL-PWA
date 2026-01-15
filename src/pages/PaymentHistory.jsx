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
      order.userid?.toLowerCase().includes(searchLower) ||
      order.customer_id?.toLowerCase().includes(searchLower) ||
      order.mobile?.toLowerCase().includes(searchLower)
    );
  }) || [];

  const handlePrint = (order) => {
    // Implement print functionality
    window.print();
  };

  if (!customerData) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-teal-500">
          <button onClick={() => navigate(-1)} className="p-1 mr-3">
            <ArrowLeftIcon className="h-6 w-6 text-white" />
          </button>
          <h1 className="text-lg font-medium text-white">Payment History</h1>
        </header>
        <div className="flex-1 px-3 py-4">
          <div className="text-center text-gray-500 py-10">
            No customer data available.
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Teal Header */}
      <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-teal-500">
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">Payment History</h1>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder={customerData.customer_id || "Search..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 pr-12 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-teal-500"
          />
          <button className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <MagnifyingGlassIcon className="w-6 h-6 text-teal-500" />
          </button>
        </div>

        {/* Payment History Cards */}
        {loading ? (
          <div className="text-center py-10 text-gray-500">Loading payment history...</div>
        ) : error ? (
          <div className="text-center py-10">
            <div className="text-orange-500 font-medium mb-2">⚠️ {error}</div>
            <p className="text-gray-500 text-sm">This customer may not have any payment records yet.</p>
          </div>
        ) : filteredOrders.length > 0 ? (
          <div className="space-y-4">
            {filteredOrders.map((order, idx) => (
              <div key={order.orderid || idx} className="bg-white rounded-lg shadow-md p-4 relative">
                {/* Print Button */}
                <button
                  onClick={() => handlePrint(order)}
                  className="absolute top-4 right-4 bg-teal-500 hover:bg-teal-600 p-2 rounded-md transition-colors"
                >
                  <PrinterIcon className="w-5 h-5 text-white" />
                </button>

                {/* Payment Details */}
                <div className="space-y-2 text-sm pr-12">
                  <div className="flex">
                    <span className="w-36 text-gray-600 font-medium">Name</span>
                    <span className="text-gray-600">:</span>
                    <span className="ml-2 text-gray-800">{order.name || customerData.name || "N/A"}</span>
                  </div>
                  <div className="flex">
                    <span className="w-36 text-gray-600 font-medium">Customer Id</span>
                    <span className="text-gray-600">:</span>
                    <span className="ml-2 text-gray-800">
                      ({order.count || "1"}){order.userid || order.customer_id || customerData.customer_id} [{order.op_id || cableDetails?.body?.op_id || "N/A"}]
                    </span>
                  </div>
                  <div className="flex">
                    <span className="w-36 text-gray-600 font-medium">Mobile</span>
                    <span className="text-gray-600">:</span>
                    <span className="ml-2 text-gray-800">{order.mobile || customerData.mobile || "N/A"}</span>
                  </div>
                  <div className="flex">
                    <span className="w-36 text-gray-600 font-medium">Amount</span>
                    <span className="text-gray-600">:</span>
                    <span className="ml-2 text-gray-800">₹{order.amount || order.amt || order.cashpaid || "0"}</span>
                  </div>
                  <div className="flex">
                    <span className="w-36 text-gray-600 font-medium">Payment mode</span>
                    <span className="text-gray-600">:</span>
                    <span className="ml-2 text-gray-800">{order.paymode || order.payment_mode || "N/A"}</span>
                  </div>
                  <div className="flex">
                    <span className="w-36 text-gray-600 font-medium">Payment date</span>
                    <span className="text-gray-600">:</span>
                    <span className="ml-2 text-gray-800">{order.paydate || order.payment_date || order.createdate || "N/A"}</span>
                  </div>
                  <div className="flex">
                    <span className="w-36 text-gray-600 font-medium">Plan</span>
                    <span className="text-gray-600">:</span>
                    <span className="ml-2 text-gray-800">{order.planname || order.plan || "N/A"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-gray-500">
            No payment history found{searchQuery ? ` for "${searchQuery}"` : ""}.
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
