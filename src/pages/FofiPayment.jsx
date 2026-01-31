import { useEffect, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate, useLocation } from "react-router-dom";
import { formatToDecimals } from "../services/helpers";
import { Button, Loader, Alert } from "@/components/ui";
import { generateFofiOrder } from "../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails, getWalBal } from "../services/generalApis";

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

  // Payment details - use paymentDetails object if available, fallback to direct fields
  const [paymentDetails, setPaymentDetails] = useState(
    paymentData?.paymentDetails || {
      "Plan Name": paymentData?.planName || "N/A",
      "Plan Rate": paymentData?.planRate || 0,
      "CGST": paymentData?.cgst || 0,
      "SGST": paymentData?.sgst || 0,
      "Other Charges": paymentData?.otherCharges || 0,
      "Balance Amount": paymentData?.balanceAmount || 0,
      "Total Amount": paymentData?.totalAmount || 0
    }
  );

  // More details (share info) - use moreDetails object if available
  const [moreDetails, setMoreDetails] = useState(
    paymentData?.moreDetails || {
      "Operator Share": paymentData?.operatorShare || 0,
      "BBNL Share": 0,
      "Software Charges": 0,
      "TDS": 0,
      "Amount Deductable": paymentData?.amountDeductable || 0
    }
  );

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
    console.log('🟢 paymentData.paymentDetails:', paymentData.paymentDetails);
    console.log('🟢 paymentData.moreDetails:', paymentData.moreDetails);

    // Update states with payment data
    if (paymentData.walletBalance !== undefined) {
      setWalletBalance(paymentData.walletBalance);
    }

    // Set payment details if provided
    if (paymentData.paymentDetails) {
      console.log('🟢 Setting paymentDetails:', paymentData.paymentDetails);
      setPaymentDetails(paymentData.paymentDetails);
    }

    // Set more details if provided
    if (paymentData.moreDetails) {
      console.log('🟢 Setting moreDetails:', paymentData.moreDetails);
      setMoreDetails(paymentData.moreDetails);
    }

    // Fetch wallet balance from API
    fetchWalletBalance();

    setLoading(false);
  }, [paymentData, navigate]);

  // Fetch wallet balance from API
  const fetchWalletBalance = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const loginuname = user?.username || paymentData?.loginuname;
      
      if (!loginuname) {
        console.warn('⚠️ No username found for wallet balance');
        return;
      }

      const payload = {
        loginuname: loginuname,
        servicekey: 'fofi' // FoFi service key
      };
      
      console.log('🔵 Fetching wallet balance for:', loginuname);
      const data = await getWalBal(payload);
      
      if (data?.status?.err_code === 0) {
        const balance = data?.body?.wallet_balance || 0;
        console.log('🟢 Wallet balance fetched:', balance);
        setWalletBalance(balance);
      } else {
        console.warn('⚠️ Failed to fetch wallet balance:', data?.status?.err_msg);
      }
    } catch (err) {
      console.error('❌ Error fetching wallet balance:', err);
    }
  };

  // Handle proceed to pay
  const handleProceedToPay = async () => {
    setSubmitting(true);
    
    try {
      console.log('🔵 Processing FoFi Payment...');
      console.log('🔵 Payment Data:', paymentData);
      
      const user = JSON.parse(localStorage.getItem('user'));
      const loginuname = user?.username || paymentData?.loginuname || 'superadmin';
      
      // Use transaction ID from payment info API if available, otherwise generate new
      const transactionId = paymentData?.transactionid || generateTransactionId();
      
      // Get the amount to be paid - use Total Amount (total_amt from API)
      // Priority: totalAmount > paymentDetails["Total Amount"] > operatorShare
      const paidAmount = paymentData?.totalAmount || 
                         paymentDetails?.["Total Amount"] || 
                         paymentData?.operatorShare || 
                         0;
      
      console.log('🔵 Paid Amount:', paidAmount);
      console.log('🔵 Transaction ID:', transactionId);
      
      // Build the order payload matching the exact API structure
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
        paytype: paymentData?.paytype || "upgrade",
        planid: String(paymentData?.planid || ""),
        priceid: String(paymentData?.priceid || "99"),
        servid: String(paymentData?.servid || "3"),
        transactionid: transactionId,
        txnstatus: "success",
        userid: paymentData?.userid || "",
        username: loginuname,
        voipnumber: ""
      };

      console.log('🔵 [STEP 1] Calling generateorder API...');
      console.log('🔵 Order Payload:', JSON.stringify(orderPayload, null, 2));
      
      // STEP 1: Call generateorder API (ServiceApis/cabletv/generateorder)
      const orderResponse = await generateFofiOrder(orderPayload);
      console.log('🟢 Generate Order Response:', orderResponse);
      
      // Check if order generation was successful
      if (orderResponse?.status?.err_code !== 0 && orderResponse?.error !== 0) {
        throw new Error(orderResponse?.status?.err_msg || orderResponse?.result || 'Failed to generate order');
      }
      
      // STEP 2: Call cblCustDet API (GeneralApi/cblCustDet)
      console.log('🔵 [STEP 2] Calling cblCustDet API...');
      const cableDetailsResponse = await getCableCustomerDetails(paymentData?.userid);
      console.log('🟢 Cable Customer Details Response:', cableDetailsResponse);
      
      // STEP 3: Call primaryCustdet API (cabletvapis/primaryCustdet)
      console.log('🔵 [STEP 3] Calling primaryCustdet API...');
      const primaryDetailsResponse = await getPrimaryCustomerDetails(paymentData?.userid);
      console.log('🟢 Primary Customer Details Response:', primaryDetailsResponse);
      
      // All APIs succeeded
      console.log('✅ All payment APIs completed successfully');

      // Save payment to localStorage for immediate display in PaymentHistory
      // (since the API may not immediately reflect the new payment)
      try {
        const now = new Date();
        const paymentRecord = {
          cid: paymentData?.userid || paymentData?.customer?.customer_id,
          name: paymentData?.customer?.name || '',
          mobile: paymentData?.customer?.mobile || '',
          total_amt: paidAmount,
          paid_amt: paidAmount,
          payment_date: `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
          pymt_mode: 'offline',
          pymt_type: paymentData?.paytype || 'upgrade',
          plan_name: paymentDetails?.["Plan Name"] || paymentData?.planName || 'FoFi Plan',
          plan_rate: paymentDetails?.["Plan Rate"] || paymentData?.planRate || paidAmount,
          subtaxes: [
            { key: 'CGST', perc: 9, value: paymentDetails?.["CGST"] || 0 },
            { key: 'SGST', perc: 9, value: paymentDetails?.["SGST"] || 0 }
          ],
          discount: 0,
          other_charges: paymentDetails?.["Other Charges"] || 0,
          subtotal: paidAmount,
          balance_amt: 0,
          orderid: transactionId,
          timestamp: Date.now()
        };

        // Get existing payments from localStorage
        const existingPaymentsJson = localStorage.getItem('fofi_recent_payments');
        const existingPayments = existingPaymentsJson ? JSON.parse(existingPaymentsJson) : [];

        // Add new payment at the beginning
        existingPayments.unshift(paymentRecord);

        // Keep only last 10 payments and those less than 24 hours old
        const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
        const filteredPayments = existingPayments
          .filter(p => p.timestamp > cutoffTime)
          .slice(0, 10);

        localStorage.setItem('fofi_recent_payments', JSON.stringify(filteredPayments));
        console.log('✅ Payment saved to localStorage for immediate display');
      } catch (storageErr) {
        console.warn('⚠️ Failed to save payment to localStorage:', storageErr);
      }

      setAlertConfig({
        type: 'success',
        title: 'Payment Successful!',
        message: 'Your FoFi SmartBox plan has been upgraded successfully.'
      });
      setAlertOpen(true);

      // Navigate back to FoFi SmartBox page after success to show updated plan
      // Pass customer data and a refresh flag
      setTimeout(() => {
        const customerId = paymentData?.customer?.customer_id || paymentData?.userid;
        navigate(`/customer/${customerId}/service/fofi-smart-box`, {
          state: {
            customer: paymentData?.customer,
            refreshData: true,  // Flag to force refresh plan details
            paymentSuccess: true  // Indicate payment was successful
          }
        });
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

  // Show fullScreen loader while loading
  if (loading) {
    return (
      <Loader fullScreen showHeader headerTitle="Review" text="Loading payment details..." />
    );
  }

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
        <div className="space-y-3">
          {/* Payment Details Heading */}
          <div className="text-center">
            <h3 className="text-base font-medium text-indigo-600 mb-1">Payment Details</h3>
            <p className="text-sm font-semibold text-purple-600">
              Wallet Balance : ₹{formatToDecimals(walletBalance)}
            </p>
          </div>

          {/* Payment Details Card with Purple Left Border */}
          <div className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border-l-4 border-purple-600">
            <div className="px-4 py-3">
              {paymentDetails && Object.entries(paymentDetails).map(([key, value], index) => (
                <div
                  key={key}
                  className="flex items-start py-1.5"
                >
                  <span className={`text-sm w-36 flex-shrink-0 ${key === 'Total Amount' ? 'text-purple-600 font-semibold' : 'text-gray-600'}`}>
                    {key}
                  </span>
                  <span className="text-sm text-gray-600 mx-2">:</span>
                  <span className={`text-sm ${key === 'Total Amount'
                    ? 'text-purple-600 font-semibold'
                    : 'text-gray-800'
                    }`}>
                    {key === "Plan Name" ? value : `₹${formatToDecimals(value)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* More Details Card with Purple Left Border */}
            <div className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border-l-4 border-purple-600">
              <div className="px-4 py-3">
                <h3 className="text-sm font-medium text-purple-600 mb-2">More Details</h3>
                {moreDetails && Object.entries(moreDetails).map(([key, value], index) => (
                  <div
                    key={key}
                    className="flex items-start py-1.5"
                  >
                    <span className={`text-sm w-36 flex-shrink-0 ${key === 'Amount Deductable' ? 'text-purple-600 font-semibold' : 'text-gray-600'}`}>
                      {key}
                    </span>
                    <span className="text-sm text-gray-600 mx-2">:</span>
                    <span className={`text-sm ${key === 'Amount Deductable'
                      ? 'text-purple-600 font-semibold'
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
              className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold text-sm py-3 px-16 rounded-full shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider transition-all duration-200"
            >
              {submitting ? 'Processing...' : 'PROCEED TO PAY'}
            </button>
          </div>
        </div>
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
