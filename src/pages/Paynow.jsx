import { useEffect, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate, useLocation } from "react-router-dom";
import { formatToDecimals } from "../services/helpers";
import { getWalBal } from "../services/generalApis";
import { getPayDets, payNow } from "../services/registrationApis";
import { Button, Loader, Badge } from "@/components/ui";

export default function Subscribe() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [intWB, setIntWB] = useState(0);

  const [paydet, setPaydet] = useState({});
  const [sharedet, setSharedet] = useState({});

  const user = JSON.parse(localStorage.getItem('user'));
  const logUname = user?.username;
  const op_id = user?.op_id;
  
  // Check if coming from customer overview (location.state) or registration flow (localStorage)
  const paymentData = location.state;
  const regData = paymentData ? null : JSON.parse(localStorage.getItem('registrationData'));
  
  // Use payment data from navigation state or registration data
  const userid = paymentData?.userid || regData?.username;
  const servicekey = paymentData?.servicekey || 'internet';
  const customer_op_id = paymentData?.op_id || op_id;

  const payDetsInp = { 
    apiopid: customer_op_id, 
    apiuserid: userid, 
    apptype: import.meta.env.VITE_API_APP_KEY_TYPE, 
    othamt: regData?.othercharges || 0, 
    othreason: regData?.otherchargesremarks || '' 
  };

  const [payNowInp, setPayNowInp] = useState({ 
    apiopid: customer_op_id, 
    apiuserid: userid, 
    applicationname: import.meta.env.VITE_API_APP_KEY_TYPE, 
    paymode: "cash", 
    transstatus: "success", 
    renewstatus: "success", 
    usagecompleted: 0, 
    services_app: 1, 
    paydoneby: logUname, 
    payreceivedby: logUname, 
    receivedremark: "cash" 
  });

  useEffect(() => {
    if (userid) {
      getPayDet(payDetsInp);
      // Fetch wallet balance if coming from customer overview
      if (paymentData && logUname) {
        getWalBalance();
      }
    }
  }, [userid]);

  async function getWalBalance() {
    try {
      const payload = { 
        loginuname: logUname,
        servicekey: servicekey 
      };
      const data = await getWalBal(payload);
      if (data?.status?.err_code === 0) {
        setIntWB(data?.body?.wallet_balance || 0);
      } else {
        console.error("Failed to fetch wallet balance:", data?.status?.err_msg || "Unknown error");
      }
    } catch (err) {
      console.error("Error fetching wallet balance:", err);
    }
  }

  async function getPayDet(params) {
    setLoading(true);
    try {
      console.log("🔵 getPayDet request params:", params);
      const data = await getPayDets(params);
      console.log("🟢 getPayDet API response:", data);
      console.log("🟢 Result data:", data?.result);
      console.log("🟢 planrates_android:", data?.result?.planrates_android);
      console.log("🟢 planrates:", data?.result?.planrates);
      
      // Check for different possible data structures
      const planRates = data?.result?.planrates_android || data?.result?.planrates || [];
      const hasPlanRates = Array.isArray(planRates) && planRates.length > 0;
      
      console.log("🟢 Using planRates:", planRates);
      console.log("🟢 hasPlanRates:", hasPlanRates);
      
      // Process result if it exists
      if (data?.result) {
        // Set wallet balance
        setIntWB(data?.result?.wallet?.avlbal || 0);
        
        if (hasPlanRates) {
          let det = planRates[0];
          console.log("🟢 Plan details (det):", det);
          
          setPaydet({
            "Plan Name": data?.result?.planname || det?.planname || "N/A",
            "Plan Rate": det?.planrate || det?.rate || 0,
            "CGST": det?.taxdetails?.subtaxes?.CGST?.value || det?.cgst || 0,
            "SGST": det?.taxdetails?.subtaxes?.SGST?.value || det?.sgst || 0,
            "Other Charges": data?.result?.othcharge?.amt || det?.othcharge || 0,
            "Balance Amount": det?.shareinfo?.balamt || det?.balamt || 0,
            "Total Amount": det?.total || det?.totalamt || 0
          });
          setSharedet({
            "Operator Share": det?.shareinfo?.optrshare || det?.optrshare || 0,
            "BBNL Share": det?.shareinfo?.bbnlshare || det?.bbnlshare || 0,
            "Software Charges": det?.shareinfo?.softcharge || det?.softcharge || 0,
            "TDS": det?.shareinfo?.tds || det?.tds || 0,
            "Amount Deductable": det?.shareinfo?.totbbnlshare || det?.totbbnlshare || 0
          });
          payNowInp.cashpaid = det?.shareinfo?.totbbnlshare || det?.totbbnlshare || det?.total || 0;
          payNowInp.noofmonth = parseInt(det?.shareinfo?.month || det?.month) || 1;
          setPayNowInp({...payNowInp});
          console.log("✅ Payment details loaded successfully");
        } else {
          // No plan rates array, try to use direct result fields
          console.log("⚠️ No planrates array found, checking direct result fields");
          console.log("🟢 All result keys:", Object.keys(data?.result));
          
          // Set basic details from result
          setPaydet({
            "Plan Name": data?.result?.planname || "N/A",
            "Plan Rate": data?.result?.planrate || 0,
            "CGST": data?.result?.cgst || 0,
            "SGST": data?.result?.sgst || 0,
            "Other Charges": data?.result?.othcharge?.amt || 0,
            "Balance Amount": data?.result?.balamt || 0,
            "Total Amount": data?.result?.total || data?.result?.totalamt || 0
          });
        }
      } else {
        console.error("❌ No result in API response");
      }
    } catch (err) {
      console.error("❌ Error getting payment details:", err);
    } finally {
      setLoading(false);
    }
  }
  

  const paynow = async (payNowInp) => {
    // setErrors((p) => ({ ...p, onumacid: null }));
    // if (!form.onumacid) {
    //     setErrors((p) => ({ ...p, onumacid: "Enter ONU MAC" }));
    //     return;
    // }
    // console.log(payNowInp);
    setSubmitting(true);
    try {
      const data = await payNow(payNowInp);
      // console.log(data);
      if (data?.error === 0) {
        localStorage.setItem('registrationData', '');
        localStorage.setItem('groups', '');
        localStorage.setItem('selectedPlan', '');
        localStorage.setItem('filerefid', '');
        alert("Payment successful and service activated.");
        navigate('/');
        // window.location.href = '/';
      } else {
        alert("Payment failed: " + (data?.result || "Unknown error"));
      }
    } catch (err) {
        // setErrors((p) => ({ ...p, onumacid: "Invalid ONU MAC" }));
        console.error("Error getting payment details:", err);
    } finally {
      setSubmitting(false);
    }
  };
    
  return (
    <Layout hideHeader={true} hideBottomNav={true}>
      {/* Teal Header Bar */}
      <div className="bg-[#1abc9c] text-white px-4 py-4 flex items-center shadow-md">
        <button onClick={() => navigate(-1)} className="mr-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-medium">Payment</h1>
      </div>

      <div className="bg-gray-50 min-h-screen px-4 py-4">
      {loading ? (
        <Loader size={10} color="teal" text="Loading payment details..." className="py-10" />
      ) : (
        <div className="space-y-4">
            {/* Payment Details Heading */}
            <div className="text-center">
              <h3 className="text-lg font-medium text-[#1abc9c] mb-2">Payment details</h3>
              <p className="text-base font-semibold text-[#ff6b35]">
                Wallet Balance : Rs {formatToDecimals(intWB)}
              </p>
            </div>

            {/* Payment Details Card with Teal Left Border */}
            <div className="bg-white rounded-md shadow-sm border-l-4 border-[#1abc9c]">
              <div className="px-4 py-3">
                {paydet && Object.entries(paydet).map(([key, value], index) => (
                  <div 
                    key={key} 
                    className="flex items-center py-2"
                  >
                    <span className={`text-sm w-36 flex-shrink-0 ${key === 'Total Amount' ? 'text-orange-500 font-semibold' : 'text-gray-700'}`}>
                      {key}
                    </span>
                    <span className="text-sm text-gray-700 mx-2">:</span>
                    <span className={`text-sm ${
                      key === 'Total Amount' 
                        ? 'text-orange-500 font-semibold' 
                        : 'text-gray-900'
                    }`}>
                      {key === "Plan Name" ? value : `₹${formatToDecimals(value)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* More Details Card with Teal Left Border */}
            <div className="bg-white rounded-md shadow-sm border-l-4 border-[#1abc9c]">
              <div className="px-4 py-3">
                <h3 className="text-base font-medium text-[#ff6b35] mb-2">More Details</h3>
                {sharedet && Object.entries(sharedet).map(([key, value], index) => (
                  <div 
                    key={key} 
                    className="flex items-center py-2"
                  >
                    <span className={`text-sm w-36 flex-shrink-0 ${key === 'Amount Deductable' ? 'text-orange-500 font-semibold' : 'text-gray-700'}`}>
                      {key}
                    </span>
                    <span className="text-sm text-gray-700 mx-2">:</span>
                    <span className={`text-sm ${
                      key === 'Amount Deductable' 
                        ? 'text-orange-500 font-semibold' 
                        : 'text-gray-900'
                    }`}>
                      ₹{parseFloat(value).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Proceed to Pay Button */}
            <div className="pt-4 flex justify-center">
              <button
                onClick={() => paynow(payNowInp)} 
                disabled={submitting}
                className="bg-[#ff6b35] hover:bg-[#e55a2b] text-white font-semibold text-base py-3 px-12 rounded-md shadow-md disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
              >
                {submitting ? 'Processing...' : 'PROCEED TO PAY'}
              </button>
            </div>
        </div>
        )}
      </div>
    </Layout>
  );
}
