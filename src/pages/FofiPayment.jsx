import { useEffect, useRef, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate, useLocation } from "react-router-dom";
import { formatToDecimals } from "../services/helpers";
import { Loader, Alert } from "@/components/ui";
import { generateFofiOrder, getFofiPaymentInfo, killFofiTxn, linkFoFiBox, upgradeRegistration } from "../services/fofiApis";
import { getWalBal, getMyPlanDetails, getUserAssignedItems } from "../services/generalApis";
import { getFofiOrderHistory } from "../services/orderApis";
import { getUser } from "../services/safeStorage";
import { lsRemove } from "../services/lsCache";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// After the operator taps PROCEED TO PAY the screen shows "Processing…".
// The submit API calls are each timeout-bounded (≤60s), but the post-payment
// service-activation poll used to run ~35s in the foreground and the failure
// reconciliation another ~35s, so the operator could sit on "Processing…" for
// over a minute. We now (a) treat the generateorder result as the payment
// outcome and navigate immediately, (b) run activation verification in the
// background, and (c) bound the failure reconciliation below.
const RECONCILE_TIMEOUT_MS = 15000;   // ceiling for the post-failure reconcile
const PROCESSING_SLOW_HINT_MS = 12000; // after this, tell the operator it's still working

// Resolve `promise`, but never wait longer than `ms` — fall back to `fallback`.
// Used so a slow/hung reconciliation can't keep the screen on "Processing…".
const withTimeout = (promise, ms, fallback) => Promise.race([
  Promise.resolve(promise),
  new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
]);

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseFoFiCurrency(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function compactFoFiPlanName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isFoFiFtaOnlyPlan(planName) {
  return compactFoFiPlanName(planName).includes('ftaonly');
}

function isFoFiDhamakaOfferPlan(planName) {
  const compact = compactFoFiPlanName(planName);
  return compact.includes('dhamakaoffer') || compact.includes('dhamaka');
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

function resolveFoFiAmountDeductable(paymentBody, { fallback = 0, planName = '' } = {}) {
  const resolvedPlanName = String(
    paymentBody?.planname ??
    paymentBody?.plan_name ??
    paymentBody?.serv_name ??
    planName ??
    ''
  ).trim();

  if (isFoFiFtaOnlyPlan(resolvedPlanName)) return 0;

  const explicitAmount = parseFoFiCurrency(
    paymentBody?.deduction?.totalamount ??
    paymentBody?.amount_deductable ??
    paymentBody?.amountdeductable ??
    paymentBody?.fofi_wallet_deduction ??
    paymentBody?.wallet_deduction
  );
  if (explicitAmount !== null && explicitAmount > 0) return explicitAmount;

  const fofiShare = parseFoFiCurrency(paymentBody?.fofishare);
  if (fofiShare !== null && fofiShare > 0) return fofiShare;

  const fofiSplit = parseFoFiCurrency(
    paymentBody?.final_split_data?.FOFI?.amount ??
    paymentBody?.final_split_data?.fofi?.amount
  );
  if (fofiSplit !== null && fofiSplit > 0) return fofiSplit;

  if (isFoFiDhamakaOfferPlan(resolvedPlanName)) return 35.40;

  const totalAmount = parseFoFiCurrency(
    paymentBody?.total_amt ??
    paymentBody?.totalamount ??
    paymentBody?.grandtotal ??
    paymentBody?.paidamount
  );
  if (totalAmount !== null && totalAmount > 0) return totalAmount;

  const fallbackAmount = parseFoFiCurrency(fallback);
  if (fallbackAmount !== null) return fallbackAmount;

  return explicitAmount !== null ? explicitAmount : 0;
}

function getFoFiOrderRows(response) {
  const body = response?.body;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.orders)) return body.orders;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function orderField(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function orderLooksSuccessful(row) {
  const searchable = normalizeText([
    orderField(row, ["txn_status", "txnstatus", "transaction_status", "transactionstatus", "txnstatus_lbl"]),
    orderField(row, ["renewal_status", "renewalstatus", "renewstatus", "status", "order_status"]),
    orderField(row, ["payment_status", "paymentstatus", "paystatus"]),
  ].join(" "));
  return /\bsuccess\b|\bactive\b|\bactivated\b|\bapproved\b|\bpaid\b/.test(searchable);
}

function orderMatchesAttempt(row, { transactionId, paidAmount, planName }) {
  const txn = normalizeText(transactionId);
  const rowTxn = [
    orderField(row, ["transactionid", "transaction_id", "txnid", "txn_id"]),
    orderField(row, ["orderid", "order_id", "orderno", "order_no"]),
  ].map(normalizeText).filter(Boolean);
  if (txn && rowTxn.includes(txn)) return true;

  const expectedAmount = Number(paidAmount);
  const rowAmount = Number(String(orderField(row, ["paidamount", "paid_amount", "paid_amt", "total_amt", "amount"])).replace(/,/g, ""));
  if (Number.isFinite(expectedAmount) && expectedAmount > 0 && Number.isFinite(rowAmount) && Math.abs(rowAmount - expectedAmount) < 0.01) {
    return true;
  }

  const expectedPlan = normalizeText(planName);
  const rowPlan = normalizeText(orderField(row, ["planname", "plan_name", "serv_name", "service_name"]));
  return !!expectedPlan && !!rowPlan && rowPlan === expectedPlan;
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
  // Shows a "taking longer than usual" caption under the spinner so the
  // operator isn't left wondering whether the app froze on a slow network.
  const [processingSlow, setProcessingSlow] = useState(false);
  const submitInFlightRef = useRef(false);

  // Alert state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ type: 'success', title: '', message: '' });

  // Payment data from navigation state
  const paymentData = location.state;

  // Wallet balance
  // null until confirmed by backend — prevents showing ₹0 during API flight
  const [walletBalance, setWalletBalance] = useState(paymentData?.walletBalance ?? null);

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
        const balance = data?.body?.wallet_balance ?? 0;
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

  const navigateToFoFiOverview = ({ walletDeduction = 0, isNewRegistration = paymentData?.paytype === 'new_registration', paymentSuccessOrderId = '' } = {}) => {
    const customerId = paymentData?.customer?.customer_id || paymentData?.userid;
    navigate(`/customer/${customerId}/service/fofi-smart-box`, {
      replace: true,
      state: {
        customer: paymentData?.customer,
        refreshData: true,
        paymentSuccess: true,
        paymentSuccessOrderId,
        isNewRegistration,
        optimisticPlan: paymentData?.planName || paymentDetails?.["Plan Name"] || null,
        optimisticFofiBoxId: paymentData?.fofiboxid || '',
        optimisticDeduction: walletDeduction,
        _t: Date.now(),
      }
    });
  };

  // Save the just-made payment to localStorage so Payment History can show it
  // immediately (the API may not reflect it for a few seconds).
  const persistRecentFoFiPayment = (paidAmount, transactionId) => {
    try {
      const now = new Date();
      const recentOtherCharges = parseFoFiCurrency(paymentDetails?.["Other Charges"]) || 0;
      const recentBalanceAmount = parseFoFiCurrency(paymentDetails?.["Balance Amount"]) || 0;
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
        other_charges: recentOtherCharges,
        subtotal: paidAmount,
        balance_amt: recentBalanceAmount,
        orderid: transactionId,
        timestamp: Date.now()
      };
      const existingPaymentsJson = localStorage.getItem('fofi_recent_payments');
      const existingPayments = existingPaymentsJson ? JSON.parse(existingPaymentsJson) : [];
      existingPayments.unshift(paymentRecord);
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
      const filteredPayments = existingPayments
        .filter(p => p.timestamp > cutoffTime)
        .slice(0, 10);
      localStorage.setItem('fofi_recent_payments', JSON.stringify(filteredPayments));
    } catch (storageErr) {
      console.warn('⚠️ Failed to save payment to localStorage:', storageErr);
    }
  };

  // Verify service activation + refresh customer details WITHOUT blocking the
  // operator on the Processing screen. The destination FoFi overview already
  // polls for plan/expiry propagation and shows the optimistic plan meanwhile,
  // so this runs fire-and-forget after we've navigated to success.
  const confirmFoFiActivationInBackground = ({ userid, fofiboxid, planid, planName }) => {
    // Fire-and-forget activation confirmation. (Previously also warmed the
    // customer-detail cache via the unauthenticated primaryCustdet/cblCustDet
    // endpoints — removed; results were discarded and the calls exposed PII
    // without auth. The overview reconciles real state from authenticated calls.)
    Promise.allSettled([
      confirmFoFiServiceActivation({ userid, fofiboxid, planid, planName }),
    ]).catch(() => { /* best-effort; overview reconciles the real state */ });
  };

  // Decide what really happened when the generateorder request threw an
  // ambiguous error (network drop / timeout) — the payment MIGHT have reached
  // the backend. Evidence comes from the order history (the payment truth),
  // which resolves within its own 15s timeout, so this never runs the long
  // foreground activation poll. Returns a status; it does NOT navigate (the
  // caller owns navigation so success/verification handling stays in one place).
  const reconcileFoFiPaymentOutcome = async ({ transactionId, paidAmount }) => {
    const userid = paymentData?.userid || "";
    const fofiboxid = paymentData?.fofiboxid || "";
    const planName = paymentData?.planName || paymentDetails?.["Plan Name"] || "";

    const orderHistory = await getFofiOrderHistory({ userid, fofiboxid }).catch(() => null);
    const matchingSuccessOrder = getFoFiOrderRows(orderHistory).find((row) =>
      orderLooksSuccessful(row) && orderMatchesAttempt(row, { transactionId, paidAmount, planName })
    );

    // A matching successful order means the payment went through.
    if (matchingSuccessOrder) return { status: "accepted" };

    // No matching order found. We still can't be sure the request didn't
    // reach the backend (the history may simply lag), so the caller treats
    // this as a verification state — never a plain "Failed" that invites a
    // double charge.
    return { status: "unconfirmed" };
  };

  const runPendingFoFiActivation = async () => {
    const pending = paymentData?.pendingActivation;
    if (!pending?.type || !pending?.payload) return null;

    const response = pending.type === "link"
      ? await linkFoFiBox(pending.payload)
      : await upgradeRegistration(pending.payload);

    if (response?.status?.err_code !== 0) {
      throw new Error(response?.status?.err_msg || 'FoFi activation failed after payment/order success.');
    }
    return response;
  };

  // Handle proceed to pay
  const handleProceedToPay = async () => {
    // Duplicate-submit guard: ignore taps while a submit is in flight.
    if (submitInFlightRef.current || submitting) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setProcessingSlow(false);

    // Slow-network hint: after a few seconds of waiting, show a reassuring
    // "taking longer than usual" caption. It NEVER re-enables the button
    // (that would risk a double charge) — it only tells the operator the app
    // is still working so they don't tap again or kill the app.
    const slowHintTimer = setTimeout(() => setProcessingSlow(true), PROCESSING_SLOW_HINT_MS);
    const stopProcessing = ({ keepDisabled = false } = {}) => {
      clearTimeout(slowHintTimer);
      setProcessingSlow(false);
      // keepDisabled — for success/verification we keep the button disabled so
      // a completed (or possibly-completed) payment can't be submitted twice.
      if (!keepDisabled) {
        setSubmitting(false);
        submitInFlightRef.current = false;
      }
    };

    let transactionId = paymentData?.transactionid || "";
    let paidAmount = 0;
    let walletDeduction = 0;
    // Once the order is generated the payment HAS happened. From here on we
    // never show a plain "Failed" (which would invite a double charge) — we
    // move to success or, at worst, a verification state.
    let orderGenerated = false;

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
      let refreshedAmountDeductable = parseFloat(
        paymentData?.amountDeductable ??
        moreDetails?.["Amount Deductable"] ??
        0
      ) || 0;
      // Native sends paidamount = the FULL total_amt from paymentinfo (never the
      // wallet deductible, never 0). Track the fresh total for the order below.
      let refreshedTotal = parseFloat(
        paymentData?.totalAmount ??
        paymentDetails?.["Total Amount"] ??
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
        refreshedAmountDeductable = resolveFoFiAmountDeductable(refreshResp?.body, {
          fallback: refreshedAmountDeductable,
          planName: paymentData?.planName || paymentDetails?.["Plan Name"] || '',
        });
        // Fresh full total (native's generateorder paidamount) from paymentinfo.
        refreshedTotal = parseFloat(refreshResp?.body?.total_amt) || refreshedTotal;
        console.log('✅ Fresh transactionid received:', transactionId, '(state had:', paymentData?.transactionid, ')');

        // Kill the transaction FoFiSmartBox already reserved. paymentinfo/fofi
        // RESERVES a pending txn every call; FoFiSmartBox made one to build the
        // summary and this refresh made another. Native reserves only ONCE, so
        // leaving the first alive is what created the duplicate order ~3s apart
        // (only in the PWA). Skip when the backend returned the SAME id (sticky
        // ids — one reservation, nothing orphaned; killing it would void the id
        // we're about to pay with). Best-effort: a failed kill must not block pay.
        const staleTxn = paymentData?.transactionid || '';
        if (staleTxn && staleTxn !== transactionId) {
          try {
            await killFofiTxn({
              userid: paymentData?.userid || '',
              username: loginuname,
              servid: String(paymentData?.servid || '3'),
              transactionid: staleTxn,
            });
            console.log('🧹 Killed stale FoFiSmartBox transaction:', staleTxn);
          } catch (killErr) {
            console.warn('⚠️ Could not kill stale transaction (continuing):', killErr?.message);
          }
        }
      } catch (refreshErr) {
        // No order was attempted yet, so nothing could have been charged —
        // this is a clean failure the operator can safely retry.
        throw Object.assign(
          new Error(refreshErr?.message || 'Could not get a valid transaction id. Please go back and try again.'),
          { cleanFailure: true }
        );
      }

      // Total Amount stays visible as the customer bill. The order
      // paidamount must match the CRM deductible shown to the operator.
      const totalAmount = paymentData?.totalAmount ??
                          paymentDetails?.["Total Amount"] ??
                          0;

      // FoFi wallet deduction must come from paymentinfo/fofi only.
      // Do not fall back to oprtrshare: the base pack can return
      // deduction.totalamount = "0.00" while oprtrshare is non-zero.
      walletDeduction = refreshedAmountDeductable;
      // Native parity: generateorder.paidamount is ALWAYS the full total_amt
      // from paymentinfo, for EVERY plan — never the wallet deductible. Verified
      // across all three native employee paths:
      //   RegistrationPaymentOverviewActivity.java:287/372  setPaidamount(total_amt)
      //   CablePaymentInfoFragment.java:986                 setPaidamount(total_amt)
      //   AtomPaymentFragment.java:352/648 (ATV)            setPaidamount(billAmount=total)
      // Sending the deductible here recorded the order (and the receipt) at the
      // undercharged wallet-share amount instead of the customer bill — the same
      // class of bug already fixed for internet's cashpaid. walletDeduction stays
      // the operator wallet debit, used for display + the overview only.
      paidAmount = refreshedTotal;

      console.log('🔵 Total Amount (review):', totalAmount);
      console.log('🔵 Paid Amount (paidamount = total_amt):', paidAmount);
      console.log('🔵 Wallet Deduction (display only):', walletDeduction);
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

      // generateorder is the ONLY call that creates the subscription and attaches
      // the plan — native runs it for EVERY plan and never special-cases a free/FTA
      // one. For a free/FTA plan the wallet deductible is ~0, but native still sends
      // paidamount = the FULL total_amt (the server ignores a 0-amount order and
      // never attaches the plan). The prior code skipped generateorder when the
      // deductible was 0 and ran a dead no-op (pendingActivation is never set), so
      // "Payment Success" showed but the FTA plan was never attached.
      // paidamount is the full total_amt for every plan (native parity, see above),
      // so no free/FTA special-case is needed — the server still gets a non-zero
      // order for FTA plans because total_amt already carries the real bill.
      const orderResponse = await generateFofiOrder({ ...orderPayload, paidamount: Number(paidAmount) });
      if (orderResponse?.status?.err_code !== 0 && orderResponse?.error !== 0) {
        // The backend explicitly rejected the order, so nothing was charged —
        // a clean failure the operator can safely retry.
        const errMsg = orderResponse?.status?.err_msg || orderResponse?.result || 'Failed to generate order';
        throw Object.assign(new Error(errMsg), { cleanFailure: true });
      }
      // Payment is now done. Any later step that throws must NOT turn this into a
      // "Failed" (would risk a double charge).
      orderGenerated = true;
      console.log('FoFi order generated.', { paidamount: Number(paidAmount), amountDeductable: walletDeduction });
      // Activation (link / upgrade registration), if any was deferred.
      try {
        await runPendingFoFiActivation();
      } catch (activationErr) {
        console.warn('FoFi activation step failed after order success (continuing):', activationErr?.message);
      }
      persistRecentFoFiPayment(paidAmount, transactionId);

      // SUCCESS — leave the Processing screen immediately. The activation
      // verification poll and customer-detail refresh run in the BACKGROUND
      // (the FoFi overview polls for plan/expiry propagation and shows the
      // optimistic plan meanwhile), so the operator is never held on
      // "Processing…" for the 35s confirmation window. Keep the button
      // disabled — we're navigating away and the payment is complete.
      stopProcessing({ keepDisabled: true });
      confirmFoFiActivationInBackground({
        userid: paymentData?.userid || "",
        fofiboxid: paymentData?.fofiboxid || "",
        planid: paymentData?.planid || "",
        planName: paymentData?.planName || paymentDetails?.["Plan Name"] || "",
      });
      // No success Alert here — the FoFi SmartBox page shows its own
      // "Plan Upgraded" / "Registration Successful" popup on arrival
      // (driven by location.state.paymentSuccess).
      navigateToFoFiOverview({
        walletDeduction,
        isNewRegistration: paymentData?.paytype === 'new_registration',
        paymentSuccessOrderId: transactionId,
      });
      return;

    } catch (err) {
      console.error('❌ Payment Error:', err);

      // The payment already went through; only a post-payment step failed.
      // Move to success — the overview reconciles the real state, and leaving
      // the screen also makes an accidental re-pay impossible.
      if (orderGenerated) {
        persistRecentFoFiPayment(paidAmount, transactionId);
        stopProcessing({ keepDisabled: true });
        confirmFoFiActivationInBackground({
          userid: paymentData?.userid || "",
          fofiboxid: paymentData?.fofiboxid || "",
          planid: paymentData?.planid || "",
          planName: paymentData?.planName || paymentDetails?.["Plan Name"] || "",
        });
        navigateToFoFiOverview({
          walletDeduction,
          isNewRegistration: paymentData?.paytype === 'new_registration',
          paymentSuccessOrderId: transactionId,
        });
        return;
      }

      // A clean, pre-payment failure (bad txn id, explicit order rejection):
      // nothing was charged → show Failure and allow a retry.
      if (err?.cleanFailure) {
        setAlertConfig({
          type: 'error',
          title: 'Payment Failed',
          message: err.message || 'An unknown error occurred. Please try again.',
        });
        setAlertOpen(true);
        stopProcessing();
        return;
      }

      // Ambiguous failure (network drop / timeout): the order MIGHT have
      // reached the backend. Reconcile against the order history, bounded so
      // the screen can't hang on "Processing…".
      const reconciliation = await withTimeout(
        reconcileFoFiPaymentOutcome({ transactionId, paidAmount }),
        RECONCILE_TIMEOUT_MS,
        { status: 'unconfirmed' }
      ).catch((reconcileErr) => {
        console.warn('FoFi payment reconciliation failed:', reconcileErr?.message);
        return { status: 'unconfirmed' };
      });

      if (reconciliation?.status === 'accepted') {
        // Order history confirms the payment — treat as success.
        persistRecentFoFiPayment(paidAmount, transactionId);
        stopProcessing({ keepDisabled: true });
        confirmFoFiActivationInBackground({
          userid: paymentData?.userid || "",
          fofiboxid: paymentData?.fofiboxid || "",
          planid: paymentData?.planid || "",
          planName: paymentData?.planName || paymentDetails?.["Plan Name"] || "",
        });
        navigateToFoFiOverview({
          walletDeduction,
          isNewRegistration: paymentData?.paytype === 'new_registration',
          paymentSuccessOrderId: transactionId,
        });
        return;
      }

      // Could not confirm either way → VERIFICATION state. Do NOT offer a
      // retry on this screen (the payment may have succeeded) — guide the
      // operator to verify, and keep the button disabled to prevent a double
      // charge. They can use Back to return and re-check.
      setAlertConfig({
        type: 'warning',
        title: 'Payment Needs Verification',
        message: 'We could not confirm the payment result in time. If the wallet was debited, do NOT pay again — verify this customer in Netmon or the service page. Otherwise, go back and try again.',
      });
      setAlertOpen(true);
      stopProcessing({ keepDisabled: true });
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
              Wallet Balance : {walletBalance === null ? <span className="opacity-50 animate-pulse">…</span> : `₹${formatToDecimals(walletBalance)}`}
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
          <div className="pt-6 flex flex-col items-center">
            <button
              onClick={handleProceedToPay}
              disabled={submitting}
              className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold text-sm py-3 px-16 rounded-full shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider transition-shadow duration-200"
            >
              {submitting ? 'Processing…' : 'PROCEED TO PAY'}
            </button>
            {/* Slow-network reassurance — shown only while processing is
                taking longer than usual, so the operator doesn't tap again or
                close the app mid-payment. */}
            {submitting && processingSlow && (
              <p className="mt-3 text-xs text-gray-500 text-center max-w-xs">
                Still processing — this is taking longer than usual. Please don&rsquo;t pay again or close the app; we&rsquo;ll confirm the result shortly.
              </p>
            )}
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
