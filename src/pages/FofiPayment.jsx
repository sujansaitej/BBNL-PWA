import { useEffect, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate, useLocation } from "react-router-dom";
import { formatToDecimals } from "../services/helpers";
import { Button, Loader, Alert } from "@/components/ui";
import { generateFofiOrder } from "../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails } from "../services/generalApis";

// Generate unique transaction ID
function generateTransactionId() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
  return `SERV-${day}${month}-3-${random}`;
}

export default function FofiPayment() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Alert state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ type: 'success', title: '', message: '' });

  // Payment data from navigation state
  const paymentData = location.state;

  // Wallet balance
  const [walletBalance, setWalletBalance] = useState(paymentData?.walletBalance || 0);

  // Payment details
  const [paymentDetails, setPaymentDetails] = useState({
    "Plan Name": paymentData?.planName || "N/A",
    "Plan Rate": paymentData?.planRate || 0,
    "CGST": paymentData?.cgst || 0,
    "SGST": paymentData?.sgst || 0,
    "Other Charges": paymentData?.otherCharges || 0,
    "Balance Amount": paymentData?.balanceAmount || 0,
    "Total Amount": paymentData?.totalAmount || 0
  });

  // More details (share info)
  const [moreDetails, setMoreDetails] = useState({
    "Operator Share": paymentData?.operatorShare || 0,
    "Amount Deductable": paymentData?.amountDeductable || 0
  });

  // Additional data needed for payment
  const [paymentPayload, setPaymentPayload] = useState({
    userid: paymentData?.userid || '',
    fofiboxid: paymentData?.fofiboxid || '',
    planid: paymentData?.planid || '',
    priceid: paymentData?.priceid || '',
    servid: paymentData?.servid || '',
    loginuname: paymentData?.loginuname || '',
    noofmonth: paymentData?.noofmonth || 1,
    cashpaid: paymentData?.amountDeductable || 0
  });

  useEffect(() => {
    // If no payment data, redirect back
    if (!paymentData) {
      console.error('❌ No payment data found');
      navigate(-1);
      return;
    }

    console.log('🟢 FoFi Payment Page - Received data:', paymentData);

    // Update states with payment data
    if (paymentData.walletBalance !== undefined) {
      setWalletBalance(paymentData.walletBalance);
    }

    // Set payment details if provided
    if (paymentData.paymentDetails) {
      setPaymentDetails(paymentData.paymentDetails);
    }

    // Set more details if provided
    if (paymentData.moreDetails) {
      setMoreDetails(paymentData.moreDetails);
    }

    setLoading(false);
  }, [paymentData, navigate]);

  // Handle proceed to pay
  const handleProceedToPay = async () => {
    setSubmitting(true);
    
    try {
      console.log('🔵 Processing FoFi Payment...');
      
      const user = JSON.parse(localStorage.getItem('user'));
      const loginuname = user?.username || paymentData?.loginuname || 'superadmin';
      
      // Generate transaction ID
      const transactionId = generateTransactionId();
      
      // Get the amount to be paid (Amount Deductable)
      const paidAmount = paymentData?.amountDeductable || moreDetails["Amount Deductable"] || paymentDetails["Total Amount"] || 0;
      
      // Build the order payload
      const orderPayload = {
        bankname: "",
        banktxnid: "",
        fofiboxid: paymentData?.fofiboxid || "",
        gateway: "",
        gatewaytxnid: "",
        orderedbytype: "crmapp",
        paidamount: String(paidAmount),
        paymentmode: "offline",
        payresponse: "",
        paytype: "upgrade",
        planid: paymentData?.planid || "",
        priceid: paymentData?.priceid || "99",
        servid: paymentData?.servid || "3",
        transactionid: transactionId,
        txnstatus: "success",
        userid: paymentData?.userid || "",
        username: loginuname,
        voipnumber: ""
      };

      console.log('🔵 [STEP 1] Calling generateFofiOrder API...');
      console.log('🔵 Order Payload:', JSON.stringify(orderPayload, null, 2));
      
      // STEP 1: Call generateorder API
      const orderResponse = await generateFofiOrder(orderPayload);
      console.log('🟢 Generate Order Response:', orderResponse);
      
      // Check if order generation was successful
      if (orderResponse?.status?.err_code !== 0 && orderResponse?.error !== 0) {
        throw new Error(orderResponse?.status?.err_msg || orderResponse?.result || 'Failed to generate order');
      }
      
      // STEP 2: Call cblCustDet API
      console.log('🔵 [STEP 2] Calling cblCustDet API...');
      const cableDetailsResponse = await getCableCustomerDetails(paymentData?.userid);
      console.log('🟢 Cable Customer Details Response:', cableDetailsResponse);
      
      // STEP 3: Call primaryCustdet API
      console.log('🔵 [STEP 3] Calling primaryCustdet API...');
      const primaryDetailsResponse = await getPrimaryCustomerDetails(paymentData?.userid);
      console.log('🟢 Primary Customer Details Response:', primaryDetailsResponse);
      
      // All APIs succeeded
      console.log('✅ All payment APIs completed successfully');
      
      setAlertConfig({
        type: 'success',
        title: 'Payment Successful!',
        message: 'Your FoFi SmartBox has been activated successfully.'
      });
      setAlertOpen(true);
      
      // Navigate to customers page after success
      setTimeout(() => {
        navigate('/customers');
      }, 2000);
      
    } catch (err) {
      console.error('❌ Payment Error:', err);
      setAlertConfig({
        type: 'error',
        title: 'Payment Failed',
        message: err.message || 'An unknown error occurred. Please try again.'
      });
      setAlertOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout hideHeader={true} hideBottomNav={true}>
      {/* Blue Gradient Header - Matching existing UI */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-3 flex items-center shadow-lg">
        <button onClick={() => navigate(-1)} className="mr-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-medium">Review</h1>
      </div>

      <div className="bg-gray-50 min-h-screen px-4 py-4">
        {loading ? (
          <Loader size={10} color="teal" text="Loading payment details..." className="py-10" />
        ) : (
          <div className="space-y-3">
            {/* Payment Details Heading */}
            <div className="text-center">
              <h3 className="text-base font-medium text-teal-500 mb-1">Payment Details</h3>
              <p className="text-sm font-semibold text-indigo-600">
                Wallet Balance : ₹{formatToDecimals(walletBalance)}
              </p>
            </div>

            {/* Payment Details Card with Indigo Left Border */}
            <div className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border-l-4 border-indigo-600">
              <div className="px-4 py-3">
                {paymentDetails && Object.entries(paymentDetails).map(([key, value], index) => (
                  <div
                    key={key}
                    className="flex items-start py-1.5"
                  >
                    <span className={`text-sm w-36 flex-shrink-0 ${key === 'Total Amount' ? 'text-indigo-600 font-semibold' : 'text-gray-600'}`}>
                      {key}
                    </span>
                    <span className="text-sm text-gray-600 mx-2">:</span>
                    <span className={`text-sm ${key === 'Total Amount'
                      ? 'text-indigo-600 font-semibold'
                      : 'text-gray-800'
                      }`}>
                      {key === "Plan Name" ? value : `₹${formatToDecimals(value)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* More Details Card with Indigo Left Border */}
            <div className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border-l-4 border-indigo-600">
              <div className="px-4 py-3">
                <h3 className="text-sm font-medium text-indigo-600 mb-2">More Details</h3>
                {moreDetails && Object.entries(moreDetails).map(([key, value], index) => (
                  <div
                    key={key}
                    className="flex items-start py-1.5"
                  >
                    <span className={`text-sm w-36 flex-shrink-0 ${key === 'Amount Deductable' ? 'text-indigo-600 font-semibold' : 'text-gray-600'}`}>
                      {key}
                    </span>
                    <span className="text-sm text-gray-600 mx-2">:</span>
                    <span className={`text-sm ${key === 'Amount Deductable'
                      ? 'text-indigo-600 font-semibold'
                      : 'text-gray-800'
                      }`}>
                      ₹{formatToDecimals(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Proceed to Pay Button */}
            <div className="pt-6 flex justify-center">
              <button
                onClick={handleProceedToPay}
                disabled={submitting}
                className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold text-sm py-3 px-16 rounded-lg shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider transition-all duration-200"
              >
                {submitting ? 'Processing...' : 'PROCEED TO PAY'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Beautiful Alert Component */}
      <Alert
        isOpen={alertOpen}
        onClose={() => setAlertOpen(false)}
        type={alertConfig.type}
        title={alertConfig.title}
        message={alertConfig.message}
      />
    </Layout>
  );
}
