import { useEffect, useRef, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate, useLocation } from "react-router-dom";
import { formatToDecimals } from "../services/helpers";
import { getWalBal } from "../services/generalApis";
import { getPayDets, payNow } from "../services/registrationApis";
import { Button, Loader, Badge, Alert } from "@/components/ui";
import { getUser, safeGetJSON } from "../services/safeStorage";

export default function Subscribe() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  // Flips true after 12s of submitting so the operator gets a clear
  // "still working, don't close" hint. The netmon prod backend takes
  // 20–35s for the paymentinfo + savePaymentApi round-trip.
  const [longRunning, setLongRunning] = useState(false);
  // Set when a previous Proceed-to-Pay timed out client-side. The
  // backend may have STILL processed the debit — re-clicking blindly
  // can double-charge. We force one explicit acknowledgement before
  // letting the next attempt through. Restored from sessionStorage so
  // a page refresh between attempts doesn't erase the warning.
  const pendingTimeoutRef = useRef(false);
  const activePaymentRef = useRef(false);

  // Alert state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ type: 'success', title: '', message: '' });

  const [intWB, setIntWB] = useState(0);

  const [paydet, setPaydet] = useState({});
  const [sharedet, setSharedet] = useState({});

  const user = getUser();
  const logUname = user?.username;
  const op_id = user?.op_id;

  // Check if coming from customer overview (location.state) or registration flow (localStorage)
  const paymentData = location.state;
  const regData = paymentData ? null : safeGetJSON('registrationData', null);

  // Persist payment context so a page refresh doesn't lose it
  if (paymentData?.userid) {
    try { sessionStorage.setItem('paymentContext', JSON.stringify(paymentData)); } catch (_) {}
  }
  let savedPayment = null;
  if (!paymentData) {
    try { savedPayment = JSON.parse(sessionStorage.getItem('paymentContext')) || null; } catch (_) {}
  }

  // Use payment data from navigation state, sessionStorage fallback, or registration data
  const userid = paymentData?.userid || savedPayment?.userid || regData?.username;
  const servicekey = paymentData?.servicekey || savedPayment?.servicekey || 'internet';
  const customer_op_id = paymentData?.op_id || savedPayment?.op_id || op_id;
  
  // Payment attribution must follow the logged-in operator.
  // Do not fall back to a hardcoded actor.
  const payDoneBy = logUname || "";

  // Internet payment payloads:
  //   - payDetsInp → apis/makepayment (fetch plan rates / display)
  //   - payNowInp  → apis/savePaymentApi (persist payment record).
  //                   The full set of fields is required by the
  //                   backend contract for the actual debit step.
  // The 'cashpaid' / 'noofmonth' values are populated from the
  // makepayment response below — see getPayDet().
  const payDetsInp = {
    apiopid: customer_op_id,
    apptype: import.meta.env.VITE_API_APP_KEY_TYPE,
    apiuserid: userid,
  };

  const [payNowInp, setPayNowInp] = useState({
    apiopid: customer_op_id,
    apiuserid: userid,
    applicationname: import.meta.env.VITE_API_APP_KEY_TYPE || "crmapp",
    paymode: "cash",
    transstatus: "success",
    renewstatus: "success",
    usagecompleted: 0,
    services_app: 1,
    paydoneby: payDoneBy,
    payreceivedby: payDoneBy,
    receivedremark: "cash",
    cashpaid: 0,
    noofmonth: 1,
  });

  const toAmount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const roundCurrency = (value) => Math.round(toAmount(value) * 100) / 100;

  const deriveInternetSettlement = (details = {}) => {
    const totalAmount = roundCurrency(details?.["Total Amount"]);
    const balanceAmount = roundCurrency(details?.["Balance Amount"]);
    const planRate = roundCurrency(details?.["Plan Rate"]);
    const cgst = roundCurrency(details?.["CGST"]);
    const sgst = roundCurrency(details?.["SGST"]);
    const otherCharges = roundCurrency(details?.["Other Charges"]);
    const computedRenewalAmount = roundCurrency(planRate + cgst + sgst + otherCharges);
    const renewalAmount = roundCurrency(
      computedRenewalAmount > 0
        ? computedRenewalAmount
        : Math.max(0, totalAmount - Math.min(balanceAmount, totalAmount))
    );

    return {
      totalAmount,
      balanceAmount,
      renewalAmount: renewalAmount > 0 ? renewalAmount : totalAmount,
    };
  };

  const getMonthOnePlan = (raw) => {
    if (!raw) return null;
    if (Array.isArray(raw?.planrates_android)) {
      return raw.planrates_android.find((p) => Number(p?.month) === 1) || null;
    }
    if (raw?.planrates?.["1"]) {
      return raw.planrates["1"];
    }
    if (raw?.planrates && typeof raw.planrates === "object") {
      const entries = Object.entries(raw.planrates).map(([monthKey, val]) => ({
        ...(val || {}),
        month: Number((val && val.month) ?? monthKey),
      }));
      return entries.find((p) => Number(p?.month) === 1) || null;
    }
    return null;
  };

  const buildStrictInternetRenewal = (raw, fallback = {}) => {
    const monthOnePlan = getMonthOnePlan(raw);
    const det = monthOnePlan || raw || {};
    const explicitMonthOne = Boolean(monthOnePlan);

    const planRate = toAmount(
      det?.planrate ??
      det?.rate ??
      fallback.planRate
    );
    const cgst = toAmount(
      det?.taxdetails?.subtaxes?.CGST?.value ??
      raw?.cgst ??
      det?.cgst ??
      fallback.cgst
    );
    const sgst = toAmount(
      det?.taxdetails?.subtaxes?.SGST?.value ??
      raw?.sgst ??
      det?.sgst ??
      fallback.sgst
    );
    const otherCharges = toAmount(
      raw?.othcharge?.amt ??
      det?.othcharge?.amt ??
      fallback.otherCharges
    );
    const computedTotal = roundCurrency(planRate + cgst + sgst + otherCharges);
    const candidateTotal = toAmount(
      explicitMonthOne
        ? (det?.total ?? det?.totalamt)
        : 0
    );
    const totalAmount = roundCurrency(
      candidateTotal > 0 && candidateTotal <= computedTotal + 0.01
        ? candidateTotal
        : (computedTotal || fallback.totalAmount)
    );

    const candidateOperatorDebit = toAmount(
      explicitMonthOne
        ? (det?.shareinfo?.totbbnlshare ?? det?.totbbnlshare)
        : 0
    );
    const operatorDebit = roundCurrency(
      candidateOperatorDebit > 0
        ? candidateOperatorDebit
        : (
          fallback.operatorDebit ??
          raw?.shareinfo?.totbbnlshare ??
          raw?.totbbnlshare ??
          totalAmount
        )
    );

    return {
      planName: raw?.planname || det?.planname || fallback.planName || "N/A",
      planRate,
      cgst,
      sgst,
      otherCharges,
      balanceAmount: toAmount(
        raw?.balamt ??
        det?.shareinfo?.balamt ??
        det?.balamt ??
        fallback.balanceAmount
      ),
      totalAmount,
      operatorShare: toAmount(
        raw?.optrshare ??
        det?.shareinfo?.optrshare ??
        det?.optrshare ??
        fallback.operatorShare
      ),
      bbnlShare: toAmount(
        raw?.bbnlshare ??
        det?.shareinfo?.bbnlshare ??
        det?.bbnlshare ??
        fallback.bbnlShare
      ),
      softwareCharges: toAmount(
        raw?.softcharge ??
        det?.shareinfo?.softcharge ??
        det?.softcharge ??
        fallback.softwareCharges
      ),
      tds: toAmount(
        raw?.tds ??
        det?.shareinfo?.tds ??
        det?.tds ??
        fallback.tds
      ),
      operatorDebit,
    };
  };

  const applyInternetPaymentBreakdown = (raw) => {
    const strict = buildStrictInternetRenewal(raw, {
      planName: paydet?.["Plan Name"],
      planRate: paydet?.["Plan Rate"],
      cgst: paydet?.["CGST"],
      sgst: paydet?.["SGST"],
      otherCharges: paydet?.["Other Charges"],
      totalAmount: paydet?.["Total Amount"],
      balanceAmount: paydet?.["Balance Amount"],
      operatorShare: sharedet?.["Operator Share"],
      bbnlShare: sharedet?.["BBNL Share"],
      softwareCharges: sharedet?.["Software Charges"],
      tds: sharedet?.["TDS"],
      operatorDebit: payNowInp?.cashpaid,
    });

    setPaydet(prev => ({
      ...prev,
      "Plan Name": strict.planName,
      "Plan Rate": strict.planRate,
      "CGST": strict.cgst,
      "SGST": strict.sgst,
      "Other Charges": strict.otherCharges,
      "Balance Amount": strict.balanceAmount,
      "Total Amount": strict.totalAmount,
    }));

    setSharedet(prev => ({
      ...prev,
      "Operator Share": strict.operatorShare,
      "BBNL Share": strict.bbnlShare,
      "Software Charges": strict.softwareCharges,
      "TDS": strict.tds,
      "Amount Deductable": strict.operatorDebit,
    }));

    setPayNowInp(prev => ({
      ...prev,
      cashpaid: strict.operatorDebit,
      noofmonth: 1,
    }));

    return {
      totalAmount: strict.totalAmount,
      balanceAmount: strict.balanceAmount,
      operatorDebit: strict.operatorDebit,
    };
  };

  useEffect(() => {
    if (userid) {
      getPayDet(payDetsInp);
      // Fetch wallet balance if coming from customer overview (or restored from session)
      if ((paymentData || savedPayment) && logUname) {
        getWalBalance();
      }
    }
  }, [userid]);

  // Restore pending-timeout flag across refreshes. Window: 5 minutes —
  // long enough that an operator who refreshed mid-spinner still gets
  // the warning; short enough that an unrelated next-day session
  // doesn't inherit a stale warning.
  useEffect(() => {
    try {
      const ts = parseInt(sessionStorage.getItem('paymentTimeoutAt') || '0', 10);
      if (ts && (Date.now() - ts) < 5 * 60 * 1000) {
        pendingTimeoutRef.current = true;
      } else if (ts) {
        sessionStorage.removeItem('paymentTimeoutAt');
      }
    } catch (_) {}
  }, []);

  const getPaymentLockKey = () => {
    if (!userid || !customer_op_id) return null;
    return `internetPaymentLock_${userid}_${customer_op_id}`;
  };

  const clearPaymentLock = () => {
    const lockKey = getPaymentLockKey();
    if (!lockKey) return;
    try { sessionStorage.removeItem(lockKey); } catch (_) {}
  };

  // 12-second "still processing" hint. Cleared whenever submitting
  // flips back to false (success, error, or alert dismiss).
  useEffect(() => {
    if (!submitting) {
      setLongRunning(false);
      return;
    }
    const t = setTimeout(() => setLongRunning(true), 12000);
    return () => clearTimeout(t);
  }, [submitting]);

  async function getWalBalance() {
    try {
      const payload = {
        loginuname: payDoneBy,
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
      const rawPlanRates = (Array.isArray(data?.result?.planrates_android) && data.result.planrates_android.length > 0)
        ? data.result.planrates_android
        : data?.result?.planrates;
      const normalizedPlanRates = Array.isArray(rawPlanRates)
        ? rawPlanRates
        : (rawPlanRates && typeof rawPlanRates === 'object')
          ? Object.entries(rawPlanRates).map(([monthKey, val]) => ({
            ...(val || {}),
            month: Number((val && val.month) ?? monthKey)
          }))
          : [];
      const hasPlanRates = normalizedPlanRates.length > 0;

      console.log("🟢 Using planRates:", normalizedPlanRates);
      console.log("🟢 hasPlanRates:", hasPlanRates);

      // Process result if it exists
      if (data?.result) {
        // Set wallet balance
        setIntWB(data?.result?.wallet?.avlbal || 0);
        
        // Also store the passed planDetails from navigation state for fallback
        const passedPlanDetails = paymentData?.planDetails?.body || savedPayment?.planDetails?.body || {};
        const passedInternetService = passedPlanDetails?.subscribed_services?.find(s => s?.servicekey?.toLowerCase() === 'internet');
        const passedPlanName = passedInternetService?.planname || passedInternetService?.plan_name || passedPlanDetails?.planname || 'N/A';
        const passedPlanRate = parseFloat(passedInternetService?.planrate || passedInternetService?.serv_rates?.prices?.[0] || passedPlanDetails?.planrate || 0);

        // Last-resort seed: when arriving from the registration
        // flow the backend may not yet have propagated the plan
        // association — getPayDets returns a result with no
        // planrates and no direct fields. Without a fallback the
        // operator stares at a "Plan Name: N/A, Total: ₹0.00"
        // screen and the PROCEED TO PAY button does nothing
        // useful. The plan they picked is stored in localStorage
        // by Plans.jsx, so we use it as the displayed plan when
        // the API gives us nothing.
        const localPlan = !hasPlanRates && (!data?.result?.planname && !data?.result?.total) ? safeGetJSON('selectedPlan', null) : null;

        if (hasPlanRates) {
          // Pick the 1-month entry from the planrates array.
          // The API returns entries for months 1, 3, 6, 12 —
          // we MUST always pick the 1-month breakdown for standard renewals.
          let det = normalizedPlanRates.find(p => Number(p.month) === 1)
            || normalizedPlanRates.find(p => String(p.title || '').includes('1'))
            || normalizedPlanRates[0];
          
          console.log("🟢 Selected plan details (det):", det);

          // CRITICAL FIX: If the backend only returned multi-month plans, 
          // we still force noofmonth to 1, but we should log a warning.
          const noofmonth = 1; 

          // Ensure cashpaid is the amount for exactly 1 month.
          // If det.month is > 1, this amount might be wrong for 1 month!
          // But usually, 'totbbnlshare' in the 1-month entry is correct.
          const cashpaid = det?.shareinfo?.totbbnlshare ?? det?.totbbnlshare ?? det?.total ?? 0;

          if (det && Number(det.month) !== 1) {
            console.error("❌ CRITICAL: Backend did not return a 1-month plan rate. Selected month:", det.month);
            // We'll still proceed with noofmonth=1 but the operator should be aware.
          }

          // IMPORTANT: Use nullish coalescing (??) for ALL numeric fields.

          // The || operator treats 0 as falsy and falls through to wrong
          // fallback values. The API legitimately returns 0 for many fields
          // (CGST, SGST, TDS, Balance, etc.).
          //
          // Also: det.othcharge is an OBJECT { amt, reason }, not a number —
          // always read .amt from it.
          const strict = buildStrictInternetRenewal(data?.result, {
            planName: passedPlanName,
            planRate: passedPlanRate,
          });

          setPaydet({
            "Plan Name": strict.planName,
            "Plan Rate": strict.planRate,
            "CGST": strict.cgst,
            "SGST": strict.sgst,
            "Other Charges": strict.otherCharges,
            "Balance Amount": strict.balanceAmount,
            "Total Amount": strict.totalAmount,
          });

          // Amount Deductable = totbbnlshare (sum of bbnlshare + softcharge + tds + gst).
          // The API does NOT have a dedicated "amountdeductable" field —
          // totbbnlshare is the correct pre-computed deductable total.
          setSharedet({
            "Operator Share": strict.operatorShare,
            "BBNL Share": strict.bbnlShare,
            "Software Charges": strict.softwareCharges,
            "TDS": strict.tds,
            "Amount Deductable": strict.operatorDebit
          });
          setPayNowInp(prev => ({ ...prev, cashpaid: strict.operatorDebit, noofmonth }));
          console.log("✅ Payment details loaded — cashpaid:", strict.operatorDebit, "noofmonth:", noofmonth);
        } else {
          // No plan rates array, try to use direct result fields
          console.log("⚠️ No planrates array found, checking direct result fields");
          console.log("🟢 All result keys:", Object.keys(data?.result));

          // First fallback: planDetails passed from InternetService via navigation state
          const passedPlanDetails = paymentData?.planDetails?.body || savedPayment?.planDetails?.body || {};
          const passedInternetService = passedPlanDetails?.subscribed_services?.find(s => s?.servicekey?.toLowerCase() === 'internet');
          
          // Second fallback: seed from selectedPlan in localStorage if backend returned
          // nothing useful. selectedPlan came from Plans.jsx and has
          // serv_name + serv_rates.prices[0] populated.
          const localPlan = !hasPlanRates && (!data?.result?.planname && !data?.result?.total) ? safeGetJSON('selectedPlan', null) : null;

          const planRate = parseFloat(passedInternetService?.planrate || passedInternetService?.serv_rates?.prices?.[0] || localPlan?.serv_rates?.prices?.[0]) || 0;
          const planName = passedInternetService?.planname || passedInternetService?.plan_name || localPlan?.serv_name || '';

          const strict = buildStrictInternetRenewal(data?.result, {
            planName,
            planRate,
            totalAmount: passedInternetService?.total ?? planRate,
          });
          const cashpaid = strict.operatorDebit;
          // CRITICAL FIX: Always default to 1 month for standard renewals in fallback path too.
          const noofmonth = 1; // Force 1 month for all standard renewals

          // Set basic details from result, falling back to passed planDetails then localPlan
          setPaydet({
            "Plan Name": strict.planName,
            "Plan Rate": strict.planRate,
            "CGST": strict.cgst,
            "SGST": strict.sgst,
            "Other Charges": strict.otherCharges,
            "Balance Amount": strict.balanceAmount,
            "Total Amount": strict.totalAmount,
          });
          setPayNowInp(prev => ({ ...prev, cashpaid, noofmonth }));
          if (passedInternetService || localPlan) {
            console.warn("⚠️ Fallback payment details using passed planDetails or localStorage — backend hasn't propagated the plan association yet. cashpaid:", cashpaid, "noofmonth:", noofmonth, "planName:", planName);
          } else {
            console.log("⚠️ Fallback payment details from direct result fields — cashpaid:", cashpaid, "noofmonth:", noofmonth);
          }
        }
      } else {
        console.error("❌ No result in API response — checking passed planDetails or localStorage selectedPlan");
        // First fallback: use planDetails passed from InternetService via navigation state
        const passedPlanDetails = paymentData?.planDetails?.body || savedPayment?.planDetails?.body || {};
        const passedInternetService = passedPlanDetails?.subscribed_services?.find(s => s?.servicekey?.toLowerCase() === 'internet');
        
        if (passedInternetService) {
          const planRate = parseFloat(passedInternetService?.planrate || passedInternetService?.serv_rates?.prices?.[0] || 0);
          const planName = passedInternetService?.planname || passedInternetService?.plan_name || 'Internet Plan';
          setPaydet({
            "Plan Name": planName,
            "Plan Rate": planRate,
            "CGST": 0, "SGST": 0,
            "Other Charges": 0,
            "Balance Amount": 0,
            "Total Amount": planRate,
          });
          setPayNowInp(prev => ({ ...prev, cashpaid: planRate, noofmonth: 1 }));
          console.warn("⚠️ Using planDetails from navigation state — getPayDets returned no result. PROCEED TO PAY may still work if the backend has the plan associated.");
        } else {
          // Second fallback: seed display from localStorage selectedPlan
          const localPlan = safeGetJSON('selectedPlan', null);
          if (localPlan) {
            const planRate = parseFloat(localPlan?.serv_rates?.prices?.[0]) || 0;
            const planName = localPlan?.serv_name || 'N/A';
            setPaydet({
              "Plan Name": planName,
              "Plan Rate": planRate,
              "CGST": 0, "SGST": 0,
              "Other Charges": 0,
              "Balance Amount": 0,
              "Total Amount": planRate,
            });
            setPayNowInp(prev => ({ ...prev, cashpaid: planRate, noofmonth: 1 }));
            console.warn("⚠️ Seeded Paynow display from localStorage selectedPlan only — getPayDets returned no result. PROCEED TO PAY may still fail if the backend hasn't associated the plan yet.");
          }
        }
      }
    } catch (err) {
      console.error("❌ Error getting payment details:", err);
    } finally {
      setLoading(false);
    }
  }


  // Proceed to Pay — Internet renewals are highly sensitive to
  // duplicate success-status API calls. We only execute the renewal-
  // mutating savePaymentApi call in the live pay path to avoid a
  // doubled extension window from back-to-back backend mutations.
  //
  // After step 2 succeeds, the InternetService overview re-fetches
  // the customer's plan + expiry (cache invalidated and refreshData
  // flag passed via navigation state — InternetService picks it up
  // and runs its existing post-payment refresh path).
  // Translate cryptic backend / HTTP errors into operator-actionable
  // messages. Same mapping is used by Step 1 (paymentinfo) failures
  // AND the outer catch (network / 500 / etc.) so operators see
  // consistent guidance regardless of where the failure surfaced.
  const friendlyPaymentError = (raw) => {
    const s = String(raw || "");
    if (/not yet authorized/i.test(s)) {
      return "Payment service auth is not configured for this build. Contact admin / backend team to set the payment-tier credentials.";
    }
    if (/HTTP 5\d{2}/i.test(s)) {
      return "Payment service is temporarily unavailable (server error). Please try again in a moment, or contact support if it persists.";
    }
    if (/already deactivated/i.test(s)) {
      return "Payment account is deactivated. Please contact admin to reactivate before processing payments.";
    }
    if (/HTTP 4\d{2}/i.test(s)) {
      return "Payment request was rejected. Please verify the customer and amount, then try again.";
    }
    return s || "An unknown error occurred. Please try again.";
  };

  const paynow = async (payNowInp) => {
    // One-click guard after a previous timeout: the backend may have
    // already debited the customer even though the browser never got a
    // response. Force the operator to acknowledge before retrying so a
    // double-charge can't happen with one impatient extra tap.
    if (pendingTimeoutRef.current) {
      pendingTimeoutRef.current = false;
      try { sessionStorage.removeItem('paymentTimeoutAt'); } catch (_) {}
      setAlertConfig({
        type: 'warning',
        title: 'Verify Before Retrying',
        message: 'The previous attempt timed out before we got a server response. The payment may have already been processed. Please check Order History on the customer page first — if you do not see this payment there, click PROCEED TO PAY again.',
      });
      setAlertOpen(true);
      return;
    }

    if (activePaymentRef.current) {
      setAlertConfig({
        type: 'warning',
        title: 'Payment In Progress',
        message: 'This payment is already being processed. Please wait for the current attempt to finish before trying again.',
      });
      setAlertOpen(true);
      return;
    }

    const lockKey = getPaymentLockKey();
    if (lockKey) {
      try {
        const lockRaw = sessionStorage.getItem(lockKey);
        if (lockRaw) {
          const lockAt = parseInt(lockRaw, 10);
          if (Number.isFinite(lockAt) && (Date.now() - lockAt) < 5 * 60 * 1000) {
            setAlertConfig({
              type: 'warning',
              title: 'Previous Attempt Still Unresolved',
              message: 'A previous internet payment attempt for this customer is still unresolved. Please check Order History before starting another payment.',
            });
            setAlertOpen(true);
            return;
          }
          sessionStorage.removeItem(lockKey);
        }
      } catch (_) {}
    }

    setSubmitting(true);
    activePaymentRef.current = true;
    try {
      if (lockKey) {
        try { sessionStorage.setItem(lockKey, String(Date.now())); } catch (_) {}
      }

      // Defensive guard: every internet renewal must be exactly 1 month.
      // If the frontend state ever diverges from this, abort before
      // calling the payment APIs so the backend can't process multi-month.
      if (Number(payNowInp.noofmonth) !== 1) {
        console.error("❌ Payment aborted — noofmonth is not 1:", payNowInp.noofmonth);
        setAlertConfig({
          type: 'error',
          title: 'Configuration Error',
          message: 'Invalid month count detected. Please refresh the page and try again.',
        });
        setAlertOpen(true);
        return;
      }

      // Refresh operator username in case user session changed.
      const freshUser = getUser();
      const freshPayDoneBy = freshUser?.username || "";
      if (!freshPayDoneBy) {
        setAlertConfig({
          type: 'error',
          title: 'Operator Missing',
          message: 'Logged-in operator username is required to process this payment. Please log in again and retry.',
        });
        setAlertOpen(true);
        return;
      }
      const settlement = deriveInternetSettlement(paydet);
      const displayedTotal = settlement.totalAmount;
      const renewalPaidAmount = settlement.renewalAmount;
      const forcedNoofMonth = 1;

      // Native Internet flow shape:
      //   1. savePaymentApi with the 1-month renewal amount
      //   2. paymentinfo with that same renewal amount
      // Earlier PWA builds inverted that flow and also pushed the
      // settled total into savePaymentApi, which can make the backend
      // extend the expiry by multiple periods.
      console.log("🔴 savePaymentApi REQUEST:", JSON.stringify({
        endpoint: "apis/savePaymentApi",
        authMode: import.meta.env.VITE_API_APP_USER_TYPE || "employee",
        payload: {
          ...payNowInp,
          cashpaid: renewalPaidAmount,
          paydoneby: freshPayDoneBy,
          payreceivedby: freshPayDoneBy,
          noofmonth: forcedNoofMonth,
          omitPaidAmount: true,
          derivedSettlement: {
            totalAmount: displayedTotal,
            balanceAmount: settlement.balanceAmount,
            renewalPaidAmount,
          },
        },
      }, null, 2));
      const data = await payNow({ 
        ...payNowInp, 
        // savePaymentApi drives the renewal period on Internet.
        // Keep this strictly on the 1-month amount.
        cashpaid: renewalPaidAmount,
        paydoneby: freshPayDoneBy,
        payreceivedby: freshPayDoneBy,
        noofmonth: forcedNoofMonth,
        omitPaidAmount: true,
      });
      console.log("🔴 savePaymentApi RESPONSE:", JSON.stringify(data, null, 2));

      if (!(data?.error === 0 || data?.status?.err_code === 0)) {
        console.error("❌ [STEP 1] savePaymentApi failed", {
          endpoint: "apis/savePaymentApi",
          request: {
            apiuserid: userid,
            apiopid: customer_op_id,
            cashpaid: renewalPaidAmount,
            noofmonth: forcedNoofMonth,
          },
          response: data,
        });
        throw new Error(data?.status?.err_msg || data?.result || 'Payment could not be saved.');
      }

      // IMPORTANT: do not follow savePaymentApi with a second
      // success-status internet/paymentinfo call here. In production
      // this has been observed to extend expiry twice for one tap.
      // Keep the UI optimistic and let the overview refresh read the
      // backend's final state after navigation.
      setPaydet(prev => ({ ...prev, "Balance Amount": 0 }));


      if (data?.error === 0 || data?.status?.err_code === 0) {

        // A success means any prior timeout was a false alarm (or a
        // different attempt entirely) — clear the guard so it can't
        // surface on the next unrelated payment in this session.
        pendingTimeoutRef.current = false;
        clearPaymentLock();
        try { sessionStorage.removeItem('paymentTimeoutAt'); } catch (_) {}
        // Optimistic: zero balance display so the operator sees the
        // payment landed before InternetService re-fetches.
        setIntWB(0);
        setPaydet(prev => ({ ...prev, "Balance Amount": 0 }));
        setAlertConfig({
          type: 'success',
          title: 'Payment Successful!',
          message: 'Your payment has been processed successfully and the service has been activated.',
        });
        setAlertOpen(true);

        // 5-second window before navigation so a refresh during the
        // success state doesn't lose the payment context (BUG-004).
        setTimeout(() => {
          localStorage.setItem('registrationData', '');
          localStorage.setItem('groups', '');
          localStorage.setItem('selectedPlan', '');
          localStorage.setItem('filerefid', '');
          try { sessionStorage.removeItem('paymentContext'); } catch (_) {}

          // If the operator came from a customer's Internet Service
          // page, navigate back THERE with refreshData so the plan
          // name + expiry update on the overview without manual
          // reload. Otherwise (registration flow) fall back to home.
          const customer = paymentData?.customer || savedPayment?.customer;
          const customerId = customer?.customer_id || customer?.username;
          if (customerId && servicekey === 'internet') {
            navigate(`/customer/${customerId}/service/internet`, {
              replace: true,
              state: {
                customer,
                refreshData: true,
                paymentSuccess: true,
                _t: Date.now(),
              },
            });
          } else {
            navigate('/', { replace: true });
          }
        }, 5000);
      } else {
        console.error("❌ [STEP 2] savePaymentApi failed", {
          endpoint: "apis/savePaymentApi",
          authMode: import.meta.env.VITE_API_APP_USER_TYPE || "employee",
          status: data?.status?.err_code,
          error: data?.error,
          message: data?.result || data?.status?.err_msg || "An unknown error occurred. Please try again.",
        });
        setAlertConfig({
          type: 'error',
          title: 'Payment Failed',
          message: data?.result || data?.status?.err_msg || "An unknown error occurred. Please try again.",
        });
        setAlertOpen(true);
        clearPaymentLock();
      }
    } catch (err) {
      console.error("Error processing payment:", {
        endpoint: "internet/proceed-to-pay",
        message: err?.message || "An unknown error occurred. Please try again.",
        error: err,
      });
      // Mark a client-side timeout so the next click is guarded —
      // the server may have processed the payment even though the
      // response never reached us. Persist to sessionStorage so a
      // page refresh during the spinner doesn't lose the warning.
      const isTimeout = /timed out/i.test(err?.message || "");
      if (isTimeout) {
        pendingTimeoutRef.current = true;
        try { sessionStorage.setItem('paymentTimeoutAt', String(Date.now())); } catch (_) {}
      } else {
        clearPaymentLock();
      }
      setAlertConfig({
        type: 'error',
        title: 'Payment Failed',
        message: isTimeout
          ? 'Request timed out before we got a response. The server may have processed the payment — please verify in Order History before retrying.'
          : friendlyPaymentError(err?.message),
      });
      setAlertOpen(true);
    } finally {
      setSubmitting(false);
      activePaymentRef.current = false;
      if (!pendingTimeoutRef.current) {
        clearPaymentLock();
      }
    }
  };

  if (!userid) {
    return (
      <Layout hideHeader={true} hideBottomNav={true}>
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-3 flex items-center shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
          <button onClick={() => navigate(-1)} className="mr-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-medium">Payment</h1>
        </div>
        <div className="bg-gray-50 min-h-screen flex flex-col items-center justify-center px-4">
          <p className="text-gray-500 text-center mb-4">No payment data available. Please navigate here from a customer page.</p>
          <button
            onClick={() => navigate('/')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
          >
            Go Home
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout hideHeader={true} hideBottomNav={true}>
      {/* Blue Gradient Header - Exact match to dashboard */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-3 flex items-center shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
        <button onClick={() => navigate(-1)} className="mr-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-medium">Payment</h1>
      </div>

      <div className="bg-gray-50 min-h-screen px-4 py-4">
        {loading ? (
          <Loader size={10} color="teal" text="Loading payment details..." className="py-10" />
        ) : (
          <div className="space-y-3">
            {/* Payment Details Heading */}
            <div className="text-center">
              <h3 className="text-base font-medium text-teal-500 mb-1">Payment details</h3>
              <p className="text-sm font-semibold text-indigo-600">
                Wallet Balance : ₹{formatToDecimals(intWB)}
              </p>
            </div>

            {/* Payment Details Card with Indigo Left Border */}
            <div className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border-l-4 border-indigo-600">
              <div className="px-4 py-3">
                {paydet && Object.entries(paydet).map(([key, value], index) => (
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
                {sharedet && Object.entries(sharedet).map(([key, value], index) => (
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
                      ₹{parseFloat(value).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Proceed to Pay Button */}
            <div className="pt-6 flex flex-col items-center">
              <button
                onClick={() => paynow(payNowInp)}
                disabled={submitting}
                className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold text-sm py-3 px-16 rounded-lg shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider transition-shadow duration-200"
              >
                {submitting ? 'Processing...' : 'PROCEED TO PAY'}
              </button>
              {/* "Still working" hint after 12s. Payment endpoints
                  often run 20–35s on the netmon prod backend; without
                  this, the operator assumes the app is hung and may
                  refresh or click again. */}
              {submitting && longRunning && (
                <p className="mt-3 text-xs text-amber-600 text-center max-w-xs">
                  Still processing — please don't close or refresh this screen. The server is finalising the payment.
                </p>
              )}
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
