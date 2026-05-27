import { useEffect, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate, useLocation } from "react-router-dom";
import { formatToDecimals } from "../services/helpers";
import { Loader, Alert } from "@/components/ui";
import { generateFofiOrder, getFofiPaymentInfo } from "../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails, getWalBal, getMyPlanDetails, getUserAssignedItems } from "../services/generalApis";
import { getUser } from "../services/safeStorage";
import { lsRemove } from "../services/lsCache";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getAssignedFoFiItems(response) {
  const body = response?.body || {};
  const buckets = ["fofi", "multi", "voip", "internet"];
  return buckets.flatMap((bucket) => {
    const rows = Array.isArray(body?.[bucket]) ? body[bucket] : [];
    return rows;
  });
}

function responseHasFoFiBox(response, boxId) {
  const targetBox = normalizeText(boxId);
  if (!targetBox) return false;
  return getAssignedFoFiItems(response).some((item) => {
    const candidates = [
      item?.fofiboxid,
      item?.fofi_box_id,
      item?.boxid,
      item?.box_id,
      item?.stbid,
      item?.stb_id,
      item?.device_id,
      item?.itemid,
      item?.product_name,
    ].map(normalizeText);
    return candidates.includes(targetBox);
  });
}

function getFoFiSubscribedService(planResponse) {
  const services = planResponse?.body?.subscribed_services || [];
  if (!Array.isArray(services)) return null;
  return services.find((service) => {
    const serviceKey = normalizeText(service?.servicekey);
    const searchable = normalizeText(`${service?.serv_name || ""} ${service?.title || ""} ${service?.planname || ""} ${service?.plan_name || ""}`);
    return serviceKey === "fofi" || /\bfofi\b|smart\s*box|smartbox|fofibox|\bfta\b|\bcabletv\b|\biptv\b/.test(searchable);
  }) || null;
}

function planLooksActivated(planResponse, expectedPlanId, expectedPlanName) {
  const service = getFoFiSubscribedService(planResponse);
  if (!service) return false;

  const expectedId = normalizeText(expectedPlanId);
  const expectedName = normalizeText(expectedPlanName);
  const backendIds = [
    service?.planid,
    service?.srvid,
    service?.servid,
    service?.internet_planid,
    service?.ottplanid,
  ].map(normalizeText).filter(Boolean);
  const backendName = normalizeText(service?.planname || service?.plan_name);
  const hasExpiry = !!(service?.expirydate || service?.expiry_date || service?.expdate);

  if (expectedId && backendIds.includes(expectedId)) return true;
  if (expectedName && backendName && backendName === expectedName) return true;
  return hasExpiry && (backendName || backendIds.length > 0);
}

function resolveFoFiAmountDeductable(paymentBody, fallback = 0) {
  const deductionRaw = paymentBody?.deduction?.totalamount;
  if (deductionRaw !== undefined && deductionRaw !== null && deductionRaw !== '') {
    const deductionAmount = parseFloat(deductionRaw);
    if (Number.isFinite(deductionAmount)) return deductionAmount;
  }

  const explicitAmount = parseFloat(
    paymentBody?.amount_deductable ??
    paymentBody?.amountdeductable ??
    paymentBody?.fofi_wallet_deduction ??
    paymentBody?.wallet_deduction
  );
  if (Number.isFinite(explicitAmount)) return explicitAmount;

  const fofiShare = parseFloat(paymentBody?.fofishare);
  if (Number.isFinite(fofiShare) && fofiShare > 0) return fofiShare;

  const fofiSplit = parseFloat(
    paymentBody?.final_split_data?.FOFI?.amount ??
    paymentBody?.final_split_data?.fofi?.amount
  );
  if (Number.isFinite(fofiSplit) && fofiSplit > 0) return fofiSplit;

  const fallbackAmount = parseFloat(fallback);
  return Number.isFinite(fallbackAmount) ? fallbackAmount : 0;
}

// Backend-issued transactionid only. Local format-matching strings
// (SERV-DDMM-3-XXXXXXX) are rejected by generateorder with "Invalid
// transaction id" because they don't exist in the server's pending-
// transaction ledger. The format is just for display; the value must
// come from a paymentinfo/fofi call. Helper kept removed deliberately
// to prevent any "fall back to a fresh fake one" temptation.

export default function FofiPayment() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
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
      const user = getUser();
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

  const confirmFoFiServiceActivation = async ({ userid, fofiboxid, planid, planName }) => {
    if (!userid || !fofiboxid) {
      throw new Error('Payment recorded, but FoFi service confirmation is missing customer or box details. Please verify in Netmon before retrying.');
    }

    const delays = [0, 2000, 5000, 10000, 18000];
    let lastAssigned = null;
    let lastPlan = null;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt] > 0) await sleep(delays[attempt]);

      try {
        lsRemove(`uai_fofi_${userid}`);
        lsRemove(`uai_multi_${userid}`);
        lsRemove(`uai_voip_${userid}`);
        lsRemove(`uai_internet_${userid}`);
        lsRemove(`plandets_fofi_${userid}_${fofiboxid}`);
        lsRemove(`plandets_fofi_${userid}_`);
        lsRemove(`orderhist_${userid}_fofi`);
        lsRemove(`orderhist_${userid}_all`);
      } catch (_) { /* best-effort cache invalidation */ }

      const [assignedFofiResp, assignedMultiResp, assignedVoipResp, assignedInternetResp, planResp] = await Promise.all([
        getUserAssignedItems('fofi', userid, true).catch(() => null),
        getUserAssignedItems('multi', userid, true).catch(() => null),
        getUserAssignedItems('voip', userid, true).catch(() => null),
        getUserAssignedItems('internet', userid, true).catch(() => null),
        getMyPlanDetails({ servicekey: 'fofi', userid, fofiboxid, voipnumber: '' }, true).catch(() => null),
      ]);
      const assignedResp = {
        body: {
          fofi: assignedFofiResp?.body?.fofi || assignedFofiResp?.body || [],
          multi: assignedMultiResp?.body?.multi || assignedMultiResp?.body || [],
          voip: assignedVoipResp?.body?.voip || assignedVoipResp?.body || [],
          internet: assignedInternetResp?.body?.internet || assignedInternetResp?.body || [],
        },
      };
      lastAssigned = assignedResp;
      lastPlan = planResp;

      const boxConfirmed = responseHasFoFiBox(assignedResp, fofiboxid);
      const planConfirmed = planLooksActivated(planResp, planid, planName);
      if (boxConfirmed && planConfirmed) {
        return { assignedResp, planResp };
      }
    }

    const planMessage = lastPlan?.status?.err_msg || lastPlan?.result || '';
    const assignedMessage = lastAssigned?.status?.err_msg || lastAssigned?.result || '';
    throw new Error(
      `Payment/order was accepted, but FoFi service activation was not confirmed yet${planMessage || assignedMessage ? `: ${planMessage || assignedMessage}` : ''}. Please verify this customer in Netmon before retrying payment.`
    );
  };

  // Handle proceed to pay
  const handleProceedToPay = async () => {
    setSubmitting(true);
    
    try {
      console.log('🔵 Processing FoFi Payment...');
      console.log('🔵 Payment Data:', paymentData);
      
      const user = getUser();
      const loginuname = user?.username || paymentData?.loginuname || 'superadmin';

      // ALWAYS re-fetch paymentinfo/fofi right before pay to get a
      // current, plan-correct transactionid. Reasons "trust state"
      // failed in production:
      //   • Sticky txn ids — backend reuses the same id for repeat
      //     calls in the same operator session, so stale state from
      //     a previous plan attempt leaks into the next plan's pay.
      //   • Operator hesitation — sitting on this screen long enough
      //     for the backend to expire the original id.
      //   • Bypass aborts (FTA misclassification) leaving an unused
      //     id in state that the next attempt picks up.
      // Cost is one extra ~1-2s call. Cheap insurance against
      // "Invalid transaction id" / silent wallet skips.
      let transactionId;
      let refreshedAmountDeductable = parseFloat(
        paymentData?.amountDeductable ??
        moreDetails?.["Amount Deductable"] ??
        0
      ) || 0;
      try {
        console.log('🟡 Refreshing paymentinfo/fofi for a fresh transactionid…');
        const refreshResp = await getFofiPaymentInfo({
          fofi_box_id: paymentData?.fofiboxid || '',
          planid: String(paymentData?.planid || ''),
          priceid: String(paymentData?.priceid || '99'),
          servapptype: 'crmapp',
          servid: String(paymentData?.servid || '3'),
          userid: paymentData?.userid || '',
          // System caller — must match what FoFiSmartBox sent.
          // Backend team (May 2026): use logged-in operator username
          // instead of hardcoded "superadmin"
          username: loginuname,
          voipnumber: '',
        });
        if (refreshResp?.status?.err_code !== 0) {
          throw new Error(refreshResp?.status?.err_msg || 'Could not refresh payment details. Please go back and try again.');
        }
        transactionId = refreshResp?.body?.transactionid;
        if (!transactionId) {
          throw new Error('Payment service did not issue a transaction id. Please go back and try again.');
        }
        refreshedAmountDeductable = resolveFoFiAmountDeductable(refreshResp?.body, refreshedAmountDeductable);
        console.log('✅ Fresh transactionid received:', transactionId, '(state had:', paymentData?.transactionid, ')');
      } catch (refreshErr) {
        throw new Error(refreshErr?.message || 'Could not get a valid transaction id. Please go back and try again.');
      }

      // paidamount = full customer bill — matches the IPTV cable flow
      // that uses the same generateorder endpoint, and the server's
      // < 100 guard is on the total bill, not the operator share.
      const totalAmount = paymentData?.totalAmount ??
                          paymentDetails?.["Total Amount"] ??
                          0;
      const paidAmount = totalAmount;

      // FoFi wallet deduction must come from paymentinfo/fofi only.
      // Do not fall back to oprtrshare: the base pack can return
      // deduction.totalamount = "0.00" while oprtrshare is non-zero.
      const walletDeduction = refreshedAmountDeductable;

      console.log('🔵 Paid Amount (paidamount):', paidAmount);
      console.log('🔵 Wallet Deduction (cashpaid):', walletDeduction);
      console.log('🔵 Transaction ID:', transactionId);

      // Build the order payload matching the exact API structure
      const orderPayload = {
        bankname: "",
        banktxnid: "",
        fofiboxid: paymentData?.fofiboxid || "",
        gateway: "",
        gatewaytxnid: "",
        orderedbytype: "crmapp",
        paidamount: Number(paidAmount),  // Backend expects numeric type, not string
        // Mobile-app trace (verified May 2026) sends paymentmode
        // "offline" and paytype "upgrade" — these are correct.
        // Earlier probes that suggested otherwise were running
        // against a customer (cgreen2) whose active subscription
        // state apparently rejects every paytype/paymentmode
        // combo; the real bug was the username field — see below.
        paymentmode: "offline",
        payresponse: "",
        paytype: "upgrade",
        planid: String(paymentData?.planid || ""),
        priceid: String(paymentData?.priceid || "99"),
        servid: String(paymentData?.servid || "3"),
        transactionid: transactionId,
        txnstatus: "success",
        userid: paymentData?.userid || "",
        // System caller — must match the username used in
        // paymentinfo above so the backend recognizes the txn id.
        // Backend team (May 2026): use logged-in operator username.
        // Operator identity is represented by the paymentinfo/generateorder username.
        username: loginuname,
        voipnumber: ""
      };

      console.log('🔴 [STEP 1] generateorder REQUEST payload:', JSON.stringify(orderPayload, null, 2));
      console.log('🔴 paidamount =', orderPayload.paidamount, '| orderedbytype =', orderPayload.orderedbytype);
      console.log('🔴 walletBalance (display, pre-deduction) =', walletBalance);

      // Free / nothing-to-charge plans — skip generateFofiOrder and
      // jump to success only when there is literally no money to
      // move. The previous "plan name contains FTA" rule was wrong:
      // "FOFI-Box + FTA ONLY" cost ₹153.40 with oprtrshare ₹153.40
      // and the bypass silently skipped both generateorder AND the
      // wallet debit, producing the "Plan Upgraded" popup with no
      // actual upgrade and no wallet debit.
      //
      // Truth source: the customer total + the operator share.
      // If BOTH are zero, nothing to register, nothing to debit,
      // safe to bypass. Otherwise we MUST run generateorder + the
      // wallet debit — even on plans with "FTA" in the name.
      const numericTotalAmount = parseFloat(totalAmount) || 0;
      const isFreeUpgrade = numericTotalAmount <= 0 && walletDeduction <= 0;
      if (isFreeUpgrade) {
        console.log('✅ Free upgrade — nothing to charge, skipping generateorder', {
          totalAmount: numericTotalAmount,
          walletDeduction,
        });

        // Still fetch customer details in background so the service page shows updated info
        Promise.allSettled([
          getCableCustomerDetails(paymentData?.userid),
          getPrimaryCustomerDetails(paymentData?.userid),
        ]).catch(() => {});

        // No success Alert here — see comment in the paid path below.
        // FoFi SmartBox shows its "Plan Upgraded" / "Registration
        // Successful" popup on arrival from location.state.paymentSuccess.
        setTimeout(() => {
          const customerId = paymentData?.customer?.customer_id || paymentData?.userid;
          // replace: true — remove the /fofi-payment entry from history so
          // back from the post-payment FoFi page doesn't land on the
          // already-completed payment screen.
          navigate(`/customer/${customerId}/service/fofi-smart-box`, {
            replace: true,
            state: {
              customer: paymentData?.customer,
              refreshData: true,
              paymentSuccess: true,
              isNewRegistration: paymentData?.paytype === 'new_registration',
              optimisticPlan: paymentData?.planName || paymentDetails?.["Plan Name"] || null,
              optimisticFofiBoxId: paymentData?.fofiboxid || '',
              _t: Date.now(),
            }
          });
        }, 600);

        return;
      }

      // STEP 1: Generate the order (registers the new plan / order
      // record on the cable/FoFi side). This call returns success
      // even when the wallet hasn't actually moved — see STEP 2.
      const orderResponse = await generateFofiOrder(orderPayload);

      if (orderResponse?.status?.err_code !== 0 && orderResponse?.error !== 0) {
        const errMsg = orderResponse?.status?.err_msg || orderResponse?.result || 'Failed to generate order';
        throw new Error(errMsg);
      }

      // Do not call the Internet savePaymentApi from FoFi payment.
      // FoFi uses paymentinfo/fofi + cabletv/generateorder. Calling
      // the Internet debit API here can debit the Internet wallet even
      // when the FoFi paymentinfo deductible is 0.00.
      console.log('FoFi order generated; Internet savePaymentApi skipped.', {
        amountDeductable: walletDeduction,
      });
      await confirmFoFiServiceActivation({
        userid: paymentData?.userid || "",
        fofiboxid: paymentData?.fofiboxid || "",
        planid: paymentData?.planid || "",
        planName: paymentData?.planName || paymentDetails?.["Plan Name"] || "",
      });

      // STEP 3: Refresh customer details in PARALLEL so the next page sees fresh data.
      await Promise.allSettled([
        getCableCustomerDetails(paymentData?.userid),
        getPrimaryCustomerDetails(paymentData?.userid),
      ]);
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

      // No success Alert here — the FoFi SmartBox page shows its own
      // "Plan Upgraded" modal popup once we navigate (driven by
      // location.state.paymentSuccess). Showing both produced the
      // "popup coming again and again" feedback in production: the
      // operator saw "Payment Successful!" briefly, then ~2s later
      // "Plan Upgraded", which felt like the system flagging the same
      // event twice. Keeping only the destination popup is also
      // honest — that one stays open until the user taps OK and gives
      // the plan-detail refetch time to land.

      // Navigate back to FoFi SmartBox page after success to show updated plan.
      // replace: true — the /fofi-payment entry is now obsolete; removing it
      // from history keeps the back stack clean so the user doesn't land on
      // the completed payment page when pressing back.
      //
      // optimisticPlan / optimisticDeduction — the new plan name and the
      // amount that was just deducted. FoFiSmartBox uses these to update
      // the Current Plan card and the wallet balance immediately, instead
      // of waiting on the staged backend refetches (which can take 12+
      // seconds to propagate). The next backend response will overwrite
      // these once it lands.
      //
      // 600ms delay (was 2000ms) — just enough time for the operator to
      // perceive the click registered (button changed to "Processing...")
      // before the next page paints. The destination page's popup is
      // the actual success acknowledgement.
      setTimeout(() => {
        const customerId = paymentData?.customer?.customer_id || paymentData?.userid;
        const isNewRegistration = paymentData?.paytype === 'new_registration';
        navigate(`/customer/${customerId}/service/fofi-smart-box`, {
          replace: true,
          state: {
            customer: paymentData?.customer,
            refreshData: true,
            paymentSuccess: true,
            isNewRegistration: isNewRegistration,
            optimisticPlan: paymentData?.planName || paymentDetails?.["Plan Name"] || null,
            optimisticFofiBoxId: paymentData?.fofiboxid || '',
            optimisticDeduction: walletDeduction,
            _t: Date.now(),
          }
        });
      }, 600);
      
    } catch (err) {
      console.error('❌ Payment Error:', err);
      setAlertConfig({
        type: 'error',
        title: 'Payment Failed',
        message: err.message || 'An unknown error occurred. Please try again.'
      });
      setAlertOpen(true);
      // Re-enable the button only on error so the user can retry. On
      // success we deliberately leave submitting=true: the 2-second
      // pre-navigation window was previously a re-click footgun where
      // a frustrated operator (wallet not debited) could click again
      // and double-charge once the wallet debit started working.
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
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-3 flex items-center shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
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
              className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold text-sm py-3 px-16 rounded-full shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider transition-shadow duration-200"
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
