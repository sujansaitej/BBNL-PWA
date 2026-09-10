import { useEffect, useRef, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate, useLocation } from "react-router-dom";
import { formatToDecimals } from "../services/helpers";
import { getWalBal } from "../services/generalApis";
import { getPayDets, payNow } from "../services/registrationApis";
import { buildInternetBreakdown, amount as toAmount } from "../services/internetPaymentBreakdown";
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
  // True once the dedicated wallet endpoint has answered. makepayment echoes a
  // balance too and the two calls race; the dedicated one wins because that is
  // the figure native gates the payment on.
  const walletFromApiRef = useRef(false);

  // Alert state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ type: 'success', title: '', message: '' });

  // null = wallet balance not known yet. Kept distinct from 0 so the
  // low-balance gate below cannot block a payment just because the balance
  // lookup failed.
  const [intWB, setIntWB] = useState(null);

  const [paydet, setPaydet] = useState({});
  const [sharedet, setSharedet] = useState({});
  // Set when makepayment came back without a usable 1-month breakdown. The
  // screen then shows the backend's reason instead of a fabricated bill.
  const [breakdownError, setBreakdownError] = useState("");
  // result.ispending — native surfaces a notice for anything but "no".
  const [isPending, setIsPending] = useState(false);

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

  // apiopid, per leg. Native splits this and the PWA did not:
  //
  //   renewal / upgrade  RegistrationPaymentOverviewActivity.java:212-214 and
  //                      EmployeeCommonPaymentInfoFragment.java:151,387 both
  //                      read PREFS_KEY_OPID — the op_id stored at LOGIN
  //                      (LoginActivity.java:146), i.e. the operator running
  //                      the app.
  //   registration       RegistrationPaymentOverviewActivity.java:219 reads the
  //                      op_id captured on the new-customer form.
  //
  // The PWA sent the CUSTOMER's op_id (from the customer list) on both legs.
  // For a franchisee paying their own customer the two are identical, which is
  // why this went unnoticed; they diverge for superadmin and any cross-operator
  // context, and apiopid is what the backend computes the share split from.
  // The customer op_id stays as a fallback so an operator whose session is
  // missing op_id is no worse off than before.
  const payOpId = regData
    ? (regData?.op_id || op_id || "")
    : (op_id || customer_op_id || "");

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
    apiopid: payOpId,
    apptype: import.meta.env.VITE_API_APP_KEY_TYPE,
    apiuserid: userid,
    // Registration leg only — matches native's !isinternetUpgrade branch.
    ...(regData
      ? {
        othamt: regData?.othercharges || "",
        othreason: regData?.otherchargesremarks || "",
      }
      : {}),
  };

  const [payNowInp, setPayNowInp] = useState({
    // Same split as payDetsInp — native's generateInternetOrder sends the
    // logged-in operator's op_id on the renewal leg
    // (EmployeeCommonPaymentInfoFragment.java:446) and the registration form's
    // on the registration leg (RegistrationPaymentOverviewActivity.java:273).
    apiopid: payOpId,
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

  // Every figure on this screen now comes from one place —
  // services/internetPaymentBreakdown.js — which is a field-for-field port of
  // what the Android app reads out of apis/makepayment. The ~400 lines of
  // tax/total/balance/deductable derivation that used to live here diverged
  // from the app on live data (wrong Plan Rate field, recomputed GST,
  // recomputed Total, wrong Deductable formula) and, worse, silently rendered
  // a fabricated all-zero bill when the response had no 1-month entry. Please
  // do not re-inline any of it: the module is pure and covered by
  // internetPaymentBreakdown.test.js, which pins each row against both the QA
  // screenshot and the captured production response.

  // Native sends othamt/othreason on the REGISTRATION leg only, read from
  // the new-customer model (RegistrationPaymentOverviewActivity.java:217-218
  // for makepayment, :274-275 for savePaymentApi). The renewal/upgrade leg
  // omits both. `regData` is non-null only in the registration flow, which
  // mirrors native's !isinternetUpgrade branch exactly.
  const nativeOtherCharges = () =>
    regData
      ? { othamt: regData?.othercharges || "", othreason: regData?.otherchargesremarks || "" }
      : {};

  // Display-only snapshot of what the operator is looking at when they tap
  // PROCEED TO PAY. Nothing here reaches the wire — the payload is native's —
  // but it's logged next to the request so a mismatch between screen and
  // backend is diagnosable from one log line.
  const deriveInternetSettlement = (details = {}, shares = {}) => ({
    totalAmount: toAmount(details?.["Total Amount"]),
    balanceAmount: toAmount(details?.["Balance Amount"]),
    amountDeductable: toAmount(shares?.["Amount Deductable"]),
  });

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
        // Authoritative: native gates the payment on this endpoint's value,
        // not on the balance echoed inside the makepayment response. The two
        // calls race, so mark it and stop getPayDet from overwriting it.
        walletFromApiRef.current = true;
        setIntWB(toAmount(data?.body?.wallet_balance));
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
      const data = await getPayDets(params);
      const breakdown = buildInternetBreakdown(data);

      // makepayment carries the operator's balance; getWalBalance() overwrites
      // it from the dedicated endpoint when there is a customer context. That
      // is the same pair of calls native makes on this screen
      // (requestServerForWallet + requestServerForInternet).
      if (breakdown.walletBalance !== null && !walletFromApiRef.current) {
        setIntWB(breakdown.walletBalance);
      }

      if (!breakdown.ok) {
        // No usable 1-month breakdown. This used to fall through to a screen
        // seeded from navigation state — plan rate from the previous page and
        // zeros everywhere else — which reads as a real bill and left PROCEED
        // TO PAY armed with that number as cashpaid, under-billing the
        // customer. Native hides the payment UI and shows result.message[0]
        // instead (EmployeeCommonPaymentInfoFragment.java:303-308); so do we.
        console.error("❌ makepayment returned no usable breakdown", {
          endpoint: "apis/makepayment",
          request: params,
          message: breakdown.message,
          resultShape:
            data?.result && typeof data.result === "object"
              ? Object.keys(data.result)
              : typeof data?.result,
        });
        setBreakdownError(breakdown.message);
        setIsPending(false);
        setPaydet({});
        setSharedet({});
        setPayNowInp((prev) => ({ ...prev, cashpaid: 0, noofmonth: 1 }));
        return;
      }

      setBreakdownError("");
      setIsPending(breakdown.isPending);
      setPaydet({
        "Plan Name": breakdown.planName,
        "Plan Rate": breakdown.planRate,
        "CGST": breakdown.cgst,
        "SGST": breakdown.sgst,
        "Other Charges": breakdown.otherCharges,
        "Balance Amount": breakdown.balanceAmount,
        "Total Amount": breakdown.totalAmount,
      });
      setSharedet({
        "Operator Share": breakdown.operatorShare,
        "ISP Share": breakdown.ispShare,
        "Software Charges": breakdown.softwareCharges,
        "TDS": breakdown.tds,
        "Amount Deductable": breakdown.amountDeductable,
      });
      // cashpaid is the customer's FULL bill, not the wallet debit — the split
      // is settled server-side (see internetPaymentBreakdown.js).
      setPayNowInp((prev) => ({ ...prev, cashpaid: breakdown.cashpaid, noofmonth: 1 }));
      console.log(
        "✅ Payment details loaded — total:", breakdown.totalAmount,
        "deductable:", breakdown.amountDeductable,
        "cashpaid:", breakdown.cashpaid
      );
    } catch (err) {
      console.error("❌ Error getting payment details:", err);
      setBreakdownError(
        err?.message || "Could not load payment details. Please check your network and try again."
      );
      setIsPending(false);
      setPaydet({});
      setSharedet({});
      setPayNowInp((prev) => ({ ...prev, cashpaid: 0, noofmonth: 1 }));
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
    // ── Native's pre-pay gate ────────────────────────────────────────
    // EmployeeCommonPaymentInfoFragment.onViewClicked() :403-413 refuses to
    // submit unless there is a real bill AND the wallet covers the deductable.
    // The PWA had neither check, so an operator with an empty wallet reached
    // savePaymentApi and got a raw backend rejection instead of a clear
    // "load your wallet" message.
    const bill = deriveInternetSettlement(paydet, sharedet);

    if (breakdownError || !(bill.totalAmount > 0)) {
      setAlertConfig({
        type: 'warning',
        title: 'No Amount to Pay',
        message: breakdownError
          || 'This plan has no payable amount right now. Please go back and reload the customer, then try again.',
      });
      setAlertOpen(true);
      return;
    }

    // intWB is null only while the balance is genuinely unknown (both lookups
    // failed) — don't block a legitimate payment on a failed balance read.
    if (intWB !== null && intWB < bill.amountDeductable) {
      setAlertConfig({
        type: 'warning',
        title: 'Wallet Low Balance',
        message: `This payment deducts ₹${formatToDecimals(bill.amountDeductable)} from your wallet, which currently holds ₹${formatToDecimals(intWB)}. Load your wallet and try again.`,
      });
      setAlertOpen(true);
      return;
    }

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
      const settlement = deriveInternetSettlement(paydet, sharedet);
      const forcedNoofMonth = 1;
      // Byte-for-byte native parity: cashpaid carries the backend's own
      // customer total (planrates["1"].total) and `paidamount` is not part of
      // this endpoint's native contract at all — neither native internet
      // path sends it. Anything we derive here is display-only.
      const nativeTotal = payNowInp.cashpaid;

      console.log("🔴 savePaymentApi REQUEST:", JSON.stringify({
        endpoint: "apis/savePaymentApi",
        authMode: import.meta.env.VITE_API_APP_USER_TYPE || "employee",
        payload: {
          ...payNowInp,
          ...nativeOtherCharges(),
          cashpaid: nativeTotal,
          paydoneby: freshPayDoneBy,
          payreceivedby: freshPayDoneBy,
          noofmonth: forcedNoofMonth,
        },
        displayOnly: {
          totalAmount: settlement.totalAmount,
          balanceAmount: settlement.balanceAmount,
          amountDeductable: settlement.amountDeductable,
          walletBalance: intWB,
        },
      }, null, 2));
      const data = await payNow({
        ...payNowInp,
        ...nativeOtherCharges(),
        cashpaid: nativeTotal,
        omitPaidAmount: true,
        paydoneby: freshPayDoneBy,
        payreceivedby: freshPayDoneBy,
        noofmonth: forcedNoofMonth,
      });
      console.log("🔴 savePaymentApi RESPONSE:", JSON.stringify(data, null, 2));

      if (!(data?.error === 0 || data?.status?.err_code === 0)) {
        console.error("❌ [STEP 1] savePaymentApi failed", {
          endpoint: "apis/savePaymentApi",
          request: {
            apiuserid: userid,
            apiopid: payOpId,
            cashpaid: nativeTotal,
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
        // Optimistic: reflect the wallet debit that just happened so the
        // header doesn't still show the pre-payment balance for the 5s before
        // we navigate. Previously this set the wallet to ₹0.00 outright, which
        // told the operator their whole wallet had been emptied.
        setIntWB(prev =>
          prev === null ? prev : Math.max(0, Math.round((prev - settlement.amountDeductable) * 100) / 100)
        );
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
        {/* No pb-safe here: this sits inside <Layout>, whose <main> already
            pays the bottom inset. Both would double it. */}
        <div className="bg-gray-50 dark:bg-gray-900 min-h-dvh flex flex-col items-center justify-center px-4">
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

      <div className="bg-gray-50 dark:bg-gray-900 min-h-dvh px-4 py-4">
        {loading ? (
          <Loader size={10} color="teal" text="Loading payment details..." className="py-10" />
        ) : breakdownError ? (
          /* The backend returned no billable 1-month breakdown. Showing a
             zero-filled card here (what this screen used to do) looks like a
             real bill and invites the operator to charge the wrong amount, so
             the reason is surfaced and paying is not offered at all. Both
             actions are live — never leave the operator on a dead end. */
          <div className="space-y-3">
            <div className="text-center">
              <h3 className="text-base font-medium text-teal-500 mb-1">Payment details</h3>
              {intWB !== null && (
                <p className="text-sm font-semibold text-indigo-600">
                  Wallet Balance : ₹{formatToDecimals(intWB)}
                </p>
              )}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border-l-4 border-red-500">
              <div className="px-4 py-4">
                <h4 className="text-sm font-semibold text-red-600 mb-1">
                  Payment details unavailable
                </h4>
                <p className="text-sm text-gray-700 dark:text-gray-300">{breakdownError}</p>
              </div>
            </div>
            <div className="pt-4 flex flex-col items-center gap-3">
              <button
                onClick={() => getPayDet(payDetsInp)}
                className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold text-sm py-3 px-16 rounded-lg shadow-lg uppercase tracking-wider"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate(-1)}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                Go Back
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Payment Details Heading */}
            <div className="text-center">
              <h3 className="text-base font-medium text-teal-500 mb-1">Payment details</h3>
              <p className="text-sm font-semibold text-indigo-600">
                Wallet Balance : ₹{formatToDecimals(intWB ?? 0)}
              </p>
            </div>

            {/* Pending-payment notice — native shows this whenever
                result.ispending is anything but "no"
                (EmployeeCommonPaymentInfoFragment.java:298). */}
            {isPending && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <p className="text-xs text-amber-700">
                  This customer has a payment still pending on the backend. Verify in Order History before collecting again.
                </p>
              </div>
            )}

            {/* Payment Details Card with Indigo Left Border */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border-l-4 border-indigo-600">
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
                      : 'text-gray-800 dark:text-gray-100'
                      }`}>
                      {key === "Plan Name" ? value : `₹${formatToDecimals(value)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* More Details Card with Indigo Left Border */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border-l-4 border-indigo-600">
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
                      : 'text-gray-800 dark:text-gray-100'
                      }`}>
                      ₹{formatToDecimals(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Proceed to Pay Button */}
            <div className="pt-6 flex flex-col items-center">
              <button
                onClick={() => paynow(payNowInp)}
                disabled={submitting || !(toAmount(paydet?.["Total Amount"]) > 0)}
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
