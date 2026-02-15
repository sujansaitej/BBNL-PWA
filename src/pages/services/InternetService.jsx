import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, FunnelIcon } from "@heroicons/react/24/outline";
import ServiceSelectionModal from "../../components/ui/ServiceSelectionModal";
import { Loader } from "@/components/ui";
import BottomNav from "../../components/BottomNav";
import {
  getUserAssignedItems,
  getCableCustomerDetails,
  getPrimaryCustomerDetails,
  getMyPlanDetails,
  getCustKYCPreview
} from "../../services/generalApis";
import { formatCustomerId } from "../../services/helpers";

export default function InternetService() {
  const { customerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [showServiceModal, setShowServiceModal] = useState(false);

  // Use actual customer data from API (passed from customer list)
  const customerData = location.state?.customer;
  const userid = customerData?.customer_id || customerId;

  // API states
  const [assignedItems, setAssignedItems] = useState(null);
  const [cableDetails, setCableDetails] = useState(null);
  const [primaryDetails, setPrimaryDetails] = useState(null);
  const [planDetails, setPlanDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);

  useEffect(() => {
    async function fetchOverview() {
      setLoading(true);
      setError("");
      let hasAnyData = false;

      // Fetch each API independently so partial failures don't block everything
      const calls = [
        { fn: () => getUserAssignedItems("internet", userid), set: setAssignedItems, label: "assigned items" },
        { fn: () => getCableCustomerDetails(userid), set: setCableDetails, label: "cable details" },
        { fn: () => getPrimaryCustomerDetails(userid), set: setPrimaryDetails, label: "primary details" },
        { fn: () => getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }), set: setPlanDetails, label: "plan details" },
      ];

      await Promise.all(
        calls.map(async ({ fn, set, label }) => {
          try {
            const data = await fn();
            set(data);
            hasAnyData = true;
          } catch (err) {
            console.error(`Error fetching ${label}:`, err);
          }
        })
      );

      if (!hasAnyData) {
        setError("Failed to load customer overview data.");
      }
      setLoading(false);
    }
    if (userid) fetchOverview();
  }, [userid]);

  // Handle service selection
  const handleServiceSelect = (service) => {
    setShowServiceModal(false);

    const serviceId = service.id || service;

    if (serviceId === 'iptv') {
      navigate(`/customer/${customerId}/service/iptv`, {
        state: { customer: customerData }
      });
    } else if (serviceId === 'voice') {
      navigate(`/customer/${customerId}/service/voice`, {
        state: { customer: customerData }
      });
    } else if (serviceId === 'fofi') {
      navigate(`/customer/${customerId}/service/fofi-smart-box`, {
        state: { customer: customerData }
      });
    }
  };

  // Extract data from API responses
  const internetId = assignedItems?.body?.internet?.[0]?.product_name || userid;
  const internetService = planDetails?.body?.subscribed_services?.find(s => s.servicekey === 'internet');
  const planName = internetService?.planname || 'N/A';
  const expiryDate = internetService?.expirydate || 'N/A';
  const serviceName = internetService?.title || 'internet';

  // Handle payment button click
  const handlePayBill = () => {
    const op_id = cableDetails?.body?.op_id || customerData?.op_id;

    // Navigate to payment page with payment data
    navigate('/payment', {
      state: {
        customer: customerData,
        servicekey: 'internet',
        userid: userid,
        op_id: op_id,
        planDetails: planDetails,
        cableDetails: cableDetails
      }
    });
  };

  // Handle Link FOFI BOX button click
  const handleLinkFofiBox = () => {
    // Navigate to FoFi Smart Box page with customer data
    navigate(`/customer/${customerId}/service/fofi-smart-box`, {
      state: {
        customer: customerData,
        fromInternet: true,
        internetId: internetId,
        planDetails: planDetails
      }
    });
  };

  // Handle Order History button click
  const handleOrderHistory = () => {
    navigate('/payment-history', {
      state: {
        customer: customerData,
        cableDetails: cableDetails
      }
    });
  };

  // Handle Upload Document button click
  const handleUploadDocument = async () => {
    setUploadLoading(true);
    try {
      const cid = customerData?.customer_id || userid;
      const response = await getCustKYCPreview({ cid, reqtype: 'update' });

      if (response?.status?.err_code === 0) {
        // Navigate to upload documents page with the fetched data
        navigate('/upload-documents', {
          state: {
            customer: customerData,
            kycData: response.body
          }
        });
      } else {
        alert('Failed to load documents: ' + (response?.status?.err_msg || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error loading document preview:', err);
      alert('Failed to load documents. Please try again.');
    } finally {
      setUploadLoading(false);
    }
  };

  if (!customerData) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
          <button onClick={() => navigate(-1)} className="p-1 mr-3">
            <ArrowLeftIcon className="h-6 w-6 text-white" />
          </button>
          <h1 className="text-lg font-medium text-white">Customer OverView</h1>
        </header>
        <div className="flex-1 px-3 py-4">
          <div className="text-center text-gray-500 dark:text-gray-400 py-10">
            No customer data available. Please select a customer from the customer list.
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Teal Header */}
      <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">Customer OverView</h1>
      </header>
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
        {loading ? (
          <Loader fullScreen showHeader headerTitle="Customer OverView" text="Loading customer overview..." />
        ) : error ? (
          <div className="text-center py-10 text-red-500">{error}</div>
        ) : (
          <>
            {/* User Details */}
            <div className="space-y-3">
              <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                User Details
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex">
                  <span className="w-36 text-gray-600 dark:text-gray-400">Username</span>
                  <span className="text-gray-600 dark:text-gray-400">: {formatCustomerId(customerData.customer_id)}</span>
                </div>
                <div className="flex">
                  <span className="w-36 text-gray-600 dark:text-gray-400">Customer Name</span>
                  <span className="text-gray-600 dark:text-gray-400">: {customerData.name}</span>
                </div>
                <div className="flex">
                  <span className="w-36 text-gray-600 dark:text-gray-400">Ph Number</span>
                  <span className="text-gray-600 dark:text-gray-400">: {customerData.mobile}</span>
                </div>
                <div className="flex">
                  <span className="w-36 text-gray-600 dark:text-gray-400">Email Id</span>
                  <span className="text-gray-600 dark:text-gray-400">: {customerData.email}</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleUploadDocument}
                disabled={uploadLoading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadLoading ? 'Loading...' : 'Upload Document'}
              </button>
              <button
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-all duration-200 shadow-md hover:shadow-lg"
                onClick={handleOrderHistory}
              >
                Order History
              </button>
            </div>

            {/* Filter Badge */}
            <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 -mx-4">
              <div className="flex items-center gap-2">
                <span className="text-base text-indigo-600 font-semibold">Filtered by :</span>
                <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-md">
                  Internet
                </span>
              </div>
              <button
                onClick={() => setShowServiceModal(true)}
                className="text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                <FunnelIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Internet ID */}
            <div className="space-y-3">
              <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                Internet ID
              </h3>
              <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700">
                <p className="text-indigo-600 font-semibold text-base">{internetId}</p>
              </div>
            </div>

            {/* Plan Details */}
            <div className="space-y-3">
              <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                Current Plan
              </h3>
              <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 dark:border-gray-700">
                <div className="flex items-start gap-4">
                  {/* Globe Icon - Clean outlined style */}
                  <div className="flex-shrink-0">
                    <svg className="w-16 h-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {/* Outer circle */}
                      <circle cx="12" cy="12" r="10" className="text-gray-700" />
                      {/* Vertical ellipse (meridian) */}
                      <ellipse cx="12" cy="12" rx="4" ry="10" className="text-gray-700" />
                      {/* Horizontal lines (parallels) */}
                      <path d="M2 12h20" className="text-gray-700" />
                      <path d="M4 7h16" className="text-gray-700" />
                      <path d="M4 17h16" className="text-gray-700" />
                    </svg>
                  </div>

                  {/* Plan Info */}
                  <div className="flex-1 space-y-2 text-sm">
                    <div className="flex">
                      <span className="w-28 text-gray-700 dark:text-gray-300">Service Name</span>
                      <span className="text-gray-700 dark:text-gray-300">:   {serviceName}</span>
                    </div>
                    <div className="flex">
                      <span className="w-28 text-gray-700 dark:text-gray-300">Plan Name</span>
                      <span className="text-gray-700 dark:text-gray-300">:   {planName}</span>
                    </div>
                    <div className="flex items-start">
                      <span className="w-28 text-gray-700 dark:text-gray-300">Expiry Date</span>
                      <span className="text-gray-700 dark:text-gray-300">:</span>
                      <span className="flex flex-col ml-2 text-gray-700 dark:text-gray-300">
                        <span>{expiryDate}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 mt-4">
                  <button
                    onClick={handlePayBill}
                    disabled={!planDetails?.body?.other_service_renewal?.btn_status || planDetails?.body?.other_service_renewal?.btn_status === 'disable'}
                    className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 text-sm shadow-md hover:shadow-lg"
                  >
                    PAY BILL
                  </button>
                  <button
                    onClick={handleLinkFofiBox}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 text-sm shadow-md hover:shadow-lg"
                  >
                    Link FOFI BOX
                  </button>
                </div>
              </div>
            </div>

            {/* Removed Plan Upgrade and API banners as requested */}
          </>
        )}
      </div>
      <ServiceSelectionModal
        isOpen={showServiceModal}
        onClose={() => setShowServiceModal(false)}
        onSelectService={handleServiceSelect}
      />
      <BottomNav />
    </div>
  );
}