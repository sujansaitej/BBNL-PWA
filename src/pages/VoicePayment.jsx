/**
 * VoicePayment — the Voice Call ("voicecall") payment review + submit screen.
 *
 * Port of Android's EmployeeCommonPaymentInfoFragment for the voicecall
 * service key (crmapp-new-master, `employee` flavour). That one fragment
 * serves fofi / voicecall / internet; only the non-internet half applies here
 * (`serviceKey.equals("internet")` takes a completely different endpoint).
 *
 *   initViews()        :139-162  wallet first, then paymentinfo
 *   requestServer()    :177-191  service/paymentinfo/voicecall
 *   requestFinished()  :206-247  the rows this screen renders
 *   onViewClicked()    :400-417  the two gates before submit
 *   generateOrderRequest() :487-513  the order payload
 *
 * THE TWO GATES, VERBATIM FROM NATIVE (:403-413):
 *   1. totalAmount must be non-null, non-"" and non-"0"  → else "No Amount to Pay"
 *   2. walletbalance >= amountdeductable                  → else "Wallet Low
 *      Balance, Load Wallet And Try Again"
 * Note the gate is on the DEDUCTABLE (what leaves the operator's wallet), while
 * `paidamount` on the order is the full customer total. Those are different
 * numbers and mixing them up is the classic bug on this screen — see
 * services/fofiPaymentBreakdown.js.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { Alert } from "@/components/ui";
import BottomNav from "../components/BottomNav";
import { formatToDecimals } from "../services/helpers";
import { getWalBal } from "../services/generalApis";
import { getVoicePaymentInfo, generateVoiceOrder, VOICE_SERVICE_KEY, VOICE_APP_TYPE } from "../services/voiceApis";
import { killFofiTxn } from "../services/fofiApis";
import { buildFofiBreakdown } from "../services/fofiPaymentBreakdown";
import { invalidateSubscriptionCaches } from "../services/subscriptionCache";
import { getUser } from "../services/safeStorage";

// Matches FofiPayment: after this long on "Processing…", reassure the operator
// rather than let them assume the app has hung and tap again.
const PROCESSING_SLOW_HINT_MS = 12000;

export default function VoicePayment() {
  const navigate = useNavigate();
  const location = useLocation();
  const ctx = location.state;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [processingSlow, setProcessingSlow] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const [walletBalance, setWalletBalance] = useState(null); // null → still loading
  const [breakdown, setBreakdown] = useState(null);
  const [transactionId, setTransactionId] = useState("");

  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ type: "success", title: "", message: "" });
  const alertActionRef = useRef(null);

  const submitInFlightRef = useRef(false);

  const loginuname = getUser()?.username || "";

  // Which of native's two payment screens is this standing in for?
  //   'renewal' → EmployeeCommonPaymentInfoFragment   (Pay Bill)
  //   'upgrade' → RegistrationPaymentOverviewActivity (plan list, isupgrade)
  // They quote from the same endpoint but differ on the order's `paytype`.
  const isUpgrade = ctx?.mode === "upgrade";

  // The paymentinfo request body, assembled exactly once from nav state so the
  // pre-pay refresh below and the order payload cannot drift apart.
  const infoRequest = {
    fofi_box_id: ctx?.fofi_box_id || "",
    planid: String(ctx?.planid || ""),
    priceid: String(ctx?.priceid || ""),
    servapptype: VOICE_APP_TYPE,
    servid: String(ctx?.servid || ""),
    userid: ctx?.userid || "",
    username: loginuname,
    voipnumber: ctx?.voipnumber || "",
  };

  useEffect(() => {
    if (!ctx) {
      navigate(-1);
      return;
    }

    // The operator's username is load-bearing on BOTH calls — the backend
    // binds the reserved transactionid to it. Sending "" quotes a transaction
    // nobody can pay, and the failure surfaces later as an opaque
    // "Invalid transaction id". Fail here, where the cause is still legible.
    if (!loginuname) {
      setLoadError("Your session has expired. Please sign in again before taking a payment.");
      setLoading(false);
      return;
    }
    if (!infoRequest.servid) {
      setLoadError("Voice service is not provisioned for this operator.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    // Native fires the wallet call first and the quote second, and never
    // blocks one on the other.
    getWalBal({ loginuname, servicekey: VOICE_SERVICE_KEY })
      .then((data) => {
        if (cancelled) return;
        if (data?.status?.err_code === 0) setWalletBalance(Number(data?.body?.wallet_balance ?? 0));
      })
      .catch((err) => console.error("Voice: wallet balance failed", err));

    // VoiceService quotes BEFORE navigating here (so a backend rejection lands
    // on the button the operator pressed, not two screens later) and hands the
    // result forward. Reuse it rather than reserving a second transaction just
    // to render the same numbers. The pre-pay re-quote below still runs.
    if (ctx.quote?.status?.err_code === 0 && ctx.quote?.body?.transactionid) {
      setBreakdown(buildFofiBreakdown(ctx.quote.body, { fallbackPlanName: ctx?.planName || "" }));
      setTransactionId(String(ctx.quote.body.transactionid));
      setLoading(false);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const resp = await getVoicePaymentInfo(infoRequest);
        if (cancelled) return;
        if (resp?.status?.err_code !== 0) {
          // Native puts err_msg into the errorMsg TextView and hides the
          // whole payment layout — no submit button at all.
          setLoadError(resp?.status?.err_msg || "Could not load the payment details.");
          return;
        }
        setBreakdown(buildFofiBreakdown(resp.body, { fallbackPlanName: ctx?.planName || "" }));
        setTransactionId(String(resp?.body?.transactionid || ""));
      } catch (err) {
        if (cancelled) return;
        if (String(err?.message || "").includes("navigated away")) return;
        console.error("Voice: paymentinfo failed", err);
        setLoadError("Could not load the payment details. Please go back and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBackToOverview = ({ paid = false } = {}) => {
    const customerId = ctx?.customerId || ctx?.customer?.customer_id || ctx?.userid;
    navigate(`/customer/${customerId}/service/voice`, {
      replace: true,
      state: {
        customer: ctx?.customer,
        services: ctx?.services || [],
        refreshData: paid,
        paymentSuccess: paid,
      },
    });
  };

  const showAlert = (config, onDismiss) => {
    alertActionRef.current = onDismiss || null;
    setAlertConfig(config);
    setAlertOpen(true);
  };

  const closeAlert = () => {
    setAlertOpen(false);
    const action = alertActionRef.current;
    alertActionRef.current = null;
    if (action) action();
  };

  const handleProceedToPay = async () => {
    if (submitInFlightRef.current || submitting) return;

    const totalAmount = breakdown?.totalAmount ?? 0;
    const amountDeductable = breakdown?.amountDeductable ?? 0;

    // Gate 1 — native: totalAmount != null && != "" && != "0"
    if (!totalAmount) {
      showAlert({ type: "warning", title: "No Amount to Pay", message: "This plan has nothing due right now." });
      return;
    }
    // Gate 2 — native: walletbalance >= amountdeductable
    if (walletBalance === null || walletBalance < amountDeductable) {
      showAlert({
        type: "error",
        title: "Wallet Low Balance",
        message: "Load Wallet And Try Again.",
      });
      return;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);
    setProcessingSlow(false);
    const slowHintTimer = setTimeout(() => setProcessingSlow(true), PROCESSING_SLOW_HINT_MS);

    const stopProcessing = ({ keepDisabled = false } = {}) => {
      clearTimeout(slowHintTimer);
      setProcessingSlow(false);
      if (!keepDisabled) {
        setSubmitting(false);
        submitInFlightRef.current = false;
      }
    };

    let txnId = transactionId;
    let paidAmount = totalAmount;
    let orderGenerated = false;

    try {
      // Re-quote immediately before paying. Native does not do this, but the
      // PWA has to: the operator can sit on this screen for minutes and the
      // reserved transaction expires, which surfaces as "Invalid transaction
      // id" at the worst possible moment. Same hardening as FofiPayment.
      try {
        const fresh = await getVoicePaymentInfo(infoRequest);
        if (fresh?.status?.err_code !== 0) {
          throw new Error(fresh?.status?.err_msg || "Could not refresh the payment details.");
        }
        const freshTxn = String(fresh?.body?.transactionid || "");
        if (!freshTxn) throw new Error("Payment service did not issue a transaction id.");

        const freshBreakdown = buildFofiBreakdown(fresh.body, { fallbackPlanName: ctx?.planName || "" });
        setBreakdown(freshBreakdown);
        paidAmount = freshBreakdown.totalAmount || totalAmount;

        // Each paymentinfo call RESERVES a pending transaction. The mount call
        // made one and this refresh made another; leaving the first alive is
        // what produced duplicate orders on the FoFi path. Skip when the
        // backend handed back the SAME id (one reservation — killing it would
        // void the id we are about to pay with). Best-effort.
        if (txnId && txnId !== freshTxn) {
          try {
            await killFofiTxn({
              userid: infoRequest.userid,
              username: loginuname,
              servid: infoRequest.servid,
              transactionid: txnId,
            });
          } catch (killErr) {
            console.warn("Voice: could not kill stale transaction (continuing):", killErr?.message);
          }
        }
        txnId = freshTxn;
        setTransactionId(freshTxn);
      } catch (refreshErr) {
        // Nothing was charged — a clean failure the operator can retry.
        throw Object.assign(new Error(refreshErr?.message || "Could not get a valid transaction id."), { cleanFailure: true });
      }

      const orderResponse = await generateVoiceOrder({
        userid: infoRequest.userid,
        username: loginuname,
        servid: infoRequest.servid,
        // Native: setPaidamount(totalAmount) — the FULL customer total, never
        // the wallet deductible. The split is settled server-side.
        paidamount: paidAmount,
        paymentmode: "offline",
        gateway: "",
        gatewaytxnid: "",
        banktxnid: "",
        bankname: "",
        orderedbytype: VOICE_APP_TYPE,
        transactionid: txnId,
        payresponse: "",
        txnstatus: "success",
        fofiboxid: infoRequest.fofi_box_id,
        planid: infoRequest.planid,
        priceid: infoRequest.priceid,
        voipnumber: infoRequest.voipnumber,
        // The one field that differs between native's two callers.
        //   "Pay Bill"  → EmployeeCommonPaymentInfoFragment  → key ABSENT
        //   plan list   → RegistrationPaymentOverviewActivity → "upgrade"
        // `undefined` keeps it off the wire; see generateVoiceOrder().
        paytype: isUpgrade ? "upgrade" : undefined,
      });

      if (orderResponse?.status?.err_code !== 0) {
        const orderErr = orderResponse?.status?.err_msg || "Failed to generate order";

        // Native, RegistrationPaymentOverviewActivity:398-400:
        //     if (err_msg.contains("invalid")) closePreviousTransaction(txn);
        // A rejection naming the transaction ("Invalid transaction id") means
        // the reservation is unusable but still OPEN server-side. Nothing
        // else releases it — native's onBackPressed (:145-151) deliberately
        // does not, and this screen re-quotes rather than reusing the id — so
        // without this the row is stranded until something reaps it.
        // Substring match on "invalid" is native's own test, kept verbatim
        // because the backend's exact wording varies by rejection.
        if (orderErr.toLowerCase().includes("invalid")) {
          try {
            await killFofiTxn({
              userid: infoRequest.userid,
              username: loginuname,
              servid: infoRequest.servid,
              transactionid: txnId,
            });
          } catch (killErr) {
            // Best-effort, exactly as native treats it: requestFailed()
            // (:565-569) suppresses the toast for this request tag alone.
            console.warn("Voice: could not close the rejected transaction:", killErr?.message);
          }
        }

        throw Object.assign(new Error(orderErr), { cleanFailure: true });
      }
      orderGenerated = true;

      // The plan/expiry the overview will re-read has just moved.
      try { invalidateSubscriptionCaches({ userid: infoRequest.userid }); } catch (_) {}

      stopProcessing({ keepDisabled: true });
      showAlert(
        {
          type: "success",
          title: "Payment Success!",
          message: orderResponse?.status?.err_msg || "The voice plan payment was completed.",
        },
        () => goBackToOverview({ paid: true })
      );
    } catch (err) {
      console.error("Voice: payment error", err);

      if (orderGenerated) {
        // Only a post-payment step failed; the money moved. Never show
        // "Failed" here — that invites a double charge.
        stopProcessing({ keepDisabled: true });
        showAlert(
          { type: "success", title: "Payment Success!", message: "The payment was accepted. Refreshing the customer's plan." },
          () => goBackToOverview({ paid: true })
        );
        return;
      }

      if (err?.cleanFailure) {
        stopProcessing();
        showAlert({ type: "error", title: "Payment Failed!", message: err.message || "Please try again." });
        return;
      }

      // Ambiguous (network drop / timeout): the order MAY have reached the
      // backend, so we must not present a retry-friendly "Failed".
      stopProcessing({ keepDisabled: true });
      showAlert(
        {
          type: "warning",
          title: "Payment Status Unconfirmed",
          message: "The network dropped before we could confirm this payment. Check the customer's order history in Netmon before charging again.",
        },
        () => goBackToOverview({ paid: true })
      );
    }
  };

  const rows = breakdown ? [
    ["Plan Name", breakdown.planName, true],
    ["Plan Rate", breakdown.planRate],
    ["CGST", breakdown.cgst],
    ["SGST", breakdown.sgst],
    ["Other Charges", breakdown.otherCharges],
    ["Balance Amount", breakdown.balanceAmount],
  ] : [];

  const canSubmit = !!breakdown && !loadError && !submitting;

  return (
    <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
      <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
        <button onClick={() => navigate(-1)} className="p-1 mr-3" disabled={submitting}>
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">Payment</h1>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-28">
        {/* Wallet */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-300">Wallet Balance</span>
          <span className="text-base font-semibold text-indigo-600">
            {walletBalance === null
              ? <span className="opacity-50 animate-pulse">…</span>
              : `₹${formatToDecimals(walletBalance)}`}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-14">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-gray-500 dark:text-gray-400 text-sm">Loading payment details...</span>
          </div>
        ) : loadError ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 space-y-4">
            <p className="text-center text-red-500 text-sm">{loadError}</p>
            <button
              onClick={() => navigate(-1)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg text-sm"
            >
              Go Back
            </button>
          </div>
        ) : (
          <>
            {/* Payment details */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 space-y-3">
              <h3 className="text-indigo-600 font-semibold text-base">Payment Details</h3>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              {rows.map(([label, value, isText]) => (
                <div key={label} className="flex text-sm">
                  <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">{label}</span>
                  <span className="min-w-0 break-words text-gray-800 dark:text-gray-200">
                    : {isText ? value : `₹${formatToDecimals(value)}`}
                  </span>
                </div>
              ))}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3 flex text-base font-semibold">
                <span className="w-36 shrink-0 text-gray-700 dark:text-gray-200">Total Amount</span>
                <span className="text-indigo-600">: ₹{formatToDecimals(breakdown.totalAmount)}</span>
              </div>
            </div>

            {/* Share info — native's sharing_details_cv. For this service key it
                carries exactly two rows: Operator Share and Amount Deductable
                (EmployeeCommonPaymentInfoFragment:232-236). */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 space-y-3">
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="w-full flex items-center justify-between text-indigo-600 font-semibold text-base"
              >
                More Details
                <span className={`transition-transform ${showMore ? "rotate-180" : ""}`}>▾</span>
              </button>
              {showMore && (
                <>
                  <div className="border-t border-gray-100 dark:border-gray-700" />
                  <div className="flex text-sm">
                    <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Operator Share</span>
                    <span className="text-gray-800 dark:text-gray-200">: ₹{formatToDecimals(breakdown.operatorShare)}</span>
                  </div>
                  <div className="flex text-sm">
                    <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Amount Deductable</span>
                    <span className="text-gray-800 dark:text-gray-200">: ₹{formatToDecimals(breakdown.amountDeductable)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 px-1 space-y-1 pb-1">
              <div>VOIP Number : {infoRequest.voipnumber || "-"}</div>
              {infoRequest.fofi_box_id && <div>FoFi Box ID : {infoRequest.fofi_box_id}</div>}
            </div>

            {/* Submit sits INLINE in the content, not in a sticky footer:
                BottomNav is `fixed bottom-0 z-50` app-wide, so a sticky bar
                would be covered by it. The peer payment screens (FofiPayment)
                place the button inline for the same reason. */}
            <div className="pt-1">
              {processingSlow && (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">
                  This is taking longer than usual — please don't close the app.
                </p>
              )}
              <button
                onClick={handleProceedToPay}
                disabled={!canSubmit}
                className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg text-sm shadow-md"
              >
                {submitting ? "Processing…" : "PROCEED TO PAY"}
              </button>
            </div>
          </>
        )}
      </div>

      <Alert
        isOpen={alertOpen}
        onClose={closeAlert}
        type={alertConfig.type}
        title={alertConfig.title}
        message={alertConfig.message}
        autoClose={false}
      />
      <BottomNav />
    </div>
  );
}
