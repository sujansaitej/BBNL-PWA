import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, FunnelIcon } from "@heroicons/react/24/outline";
import ServiceSelectionModal from "../../components/ui/ServiceSelectionModal";
import BottomNav from "../../components/BottomNav";
import {
  getUserAssignedItems,
  getMyPlanDetails,
  getCustKYCPreview
} from "../../services/generalApis";
import { canonicalServiceKey } from "../../constants/services";
import { loadKycWithRetry } from "../../utils/kycRetry";
import { lsGetStale, lsRemove } from "../../services/lsCache";
import { refreshServiceController } from "../../services/navigationController";
import { prioritizeCustomerService } from "../../services/prefetch";
import { getUser } from "../../services/safeStorage";
import { formatCustomerId } from "../../services/helpers";
import { useToast } from "@/components/ui/Toast";

const OVERVIEW_TTL = 10 * 60 * 1000; // 10 min

export default function InternetService() {
  const { customerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [showServiceModal, setShowServiceModal] = useState(false);

  // Use actual customer data from API (passed from customer list)
  const customerData = location.state?.customer;
  const servicesFromState = location.state?.services || [];
  const userid = customerData?.customer_id || customerId;
  // Refresh flags from a successful payment return — when true, we
  // wipe the cached plan/assigned-items entries before hydrating so
  // the operator sees the new plan name + expiry instead of the
  // pre-payment values.
  const refreshData = location.state?.refreshData;
  const paymentSuccess = location.state?.paymentSuccess;

  // Try to hydrate from cache synchronously for instant render — but
  // skip the cache entirely when we just landed back from a successful
  // payment, otherwise the operator briefly sees the OLD plan / OLD
  // expiry until the background refetch lands.
  const _useCacheForRender = !refreshData;
  const _cachedAI = (_useCacheForRender && userid) ? lsGetStale(`uai_internet_${userid}`, OVERVIEW_TTL) : null;
  const _cachedPlan = (_useCacheForRender && userid) ? lsGetStale(`plandets_internet_${userid}_`, OVERVIEW_TTL) : null;
  const _hasCachedPlan = !!(_cachedAI || _cachedPlan);

  // API states — initialize from cache if available (instant render)
  const [assignedItems, setAssignedItems] = useState(_cachedAI?.data || null);
  const [planDetails, setPlanDetails] = useState(_cachedPlan?.data || null);
  const [planLoading, setPlanLoading] = useState(!_hasCachedPlan); // Only for plan section
  const [renewalStatusReady, setRenewalStatusReady] = useState(false);
  const [error, setError] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const lastRenewalCheckRef = useRef(0);

  useEffect(() => {
    // Cancel any in-flight requests from a previous service page
    refreshServiceController();

    // Post-payment cache invalidation — wipe every cached entry that
    // could surface stale plan name / expiry / assigned-items info,
    // then force the fetch below to bypass cache. This is what makes
    // the new plan + new expiry appear automatically on the
    // Customer OverView immediately after a successful payment.
    if (refreshData && userid) {
      try {
        lsRemove(`uai_internet_${userid}`);
        lsRemove(`plandets_internet_${userid}_`);
      } catch (_) {}
    }

    async function fetchOverview() {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const navCancelled = (r) => r.status === "rejected" && r.reason?.message?.includes('navigated away');

      // Only show loading for plan/internet sections, not the whole page
      setRenewalStatusReady(false);
      if (!_hasCachedPlan) {
        setPlanLoading(true);
        setError("");
      }
      // Pass skipCache=true after a payment so we don't accidentally
      // serve the pre-payment cache that getUserAssignedItems /
      // getMyPlanDetails populated on the previous overview visit.
      const skipCache = !!refreshData;
      const skipPlanCache = !!refreshData;

      // CONNECTION-ORDER MATTERS: the browser opens a limited number of
      // sockets per origin, and whichever fetch() is *called first* grabs a
      // connection first. getMyPlanDetails gates the visible "Current Plan"
      // section and is the fastest of the overview calls, so it MUST be
      // initiated before the slower, non-critical linked-detail (cable +
      // primary) and assigned-items calls — otherwise the plan section queues
      // behind ~3 slower requests and the operator stares at "Loading plan
      // details…" for their combined latency (the reported slowness).
      const planPromise = getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }, skipPlanCache);

      // Paint-fast path: render the plan section the moment plan
      // details land. getUserAssignedItems is slower server-side and
      // only feeds the Internet ID line, which falls back to the
      // customer id until it arrives. Waiting on both in one
      // allSettled made the operator stare at "Loading plan details…"
      // for the full assigned-items latency. Errors are ignored here —
      // the settled-results block below owns retry + error state.
      planPromise.then((plan) => {
        setPlanDetails(plan);
        setRenewalStatusReady(true);
        setError("");
        setPlanLoading(false);
      }).catch(() => {});

      // Non-critical calls initiated AFTER the plan call so they don't
      // steal its connection: assigned-items (Internet ID line only) and
      // the linked-device details (cable + primary, their own section).
      const aiPromise = getUserAssignedItems("internet", userid, skipCache);
      aiPromise.then((ai) => setAssignedItems(ai)).catch(() => {});

      let [aiResult, planResult] = await Promise.allSettled([aiPromise, planPromise]);

      if (navCancelled(aiResult) || navCancelled(planResult)) return;

      // One quick retry for transient dual-failure on weak networks.
      if (aiResult.status === "rejected" && planResult.status === "rejected") {
        await sleep(500);
        [aiResult, planResult] = await Promise.allSettled([
          getUserAssignedItems("internet", userid, true),
          getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }, true),
        ]);
        if (navCancelled(aiResult) || navCancelled(planResult)) return;
      }

      if (aiResult.status === "fulfilled") setAssignedItems(aiResult.value);
      else console.error("Error fetching assigned items:", aiResult.reason);

      if (planResult.status === "fulfilled") {
        setPlanDetails(planResult.value);
        setRenewalStatusReady(true);
      } else {
        console.error("Error fetching plan details:", planResult.reason);
        // Ensure ready is true so we don't stay in a permanent loading state 
        // if the API fails, but the button will remain disabled due to missing data.
        setRenewalStatusReady(true);
      }

      const hasUsableFallback = !!(assignedItems || planDetails || _hasCachedPlan);
      if (aiResult.status === "rejected" && planResult.status === "rejected" && !hasUsableFallback) {
        setError("Failed to load customer overview data.");
      } else {
        setError("");
      }
      setPlanLoading(false);
    }
    if (userid) fetchOverview();

    // Warm the Internet-side caches in the background — most importantly
    // the specialInternetPlans list that the "Link FOFI BOX" flow reads,
    // so tapping it opens with plans already loaded even when this page
    // was reached by deep link (bypassing the ServiceSelectionModal's
    // prefetch). Runs in prefetch background mode, so route changes
    // don't abort it; dedup guards make it a no-op when already warm.
    try {
      prioritizeCustomerService(userid, getUser()?.username || 'superadmin', 'internet');
    } catch (_) { /* prefetch is best-effort */ }

    // Strip the refreshData / paymentSuccess flags from the history
    // entry after we've consumed them. Otherwise a page-refresh on
    // this route would re-fire the cache wipe + fetch on every
    // reload until the operator navigated away.
    if (refreshData || paymentSuccess) {
      try {
        const cleaned = {
          ...(window.history.state || {}),
          usr: { ...((window.history.state && window.history.state.usr) || {}), refreshData: false, paymentSuccess: false },
        };
        window.history.replaceState(cleaned, document.title, window.location.pathname + window.location.search);
      } catch (_) { /* defensive */ }
    }
  }, [userid, refreshData, paymentSuccess]);

  // Handle service selection — peer service switch.
  // replace: true so flipping between Internet/IPTV/Voice/FoFi via the
  // picker doesn't stack entries in history. Back should return to the
  // customer services list, not walk through every peer service visited.
  const handleServiceSelect = (service) => {
    setShowServiceModal(false);
    if (!service) return;

    const serviceId = (service.id || '').toLowerCase();
    const serviceName = (service.name || '').toLowerCase();

    if (serviceId === 'iptv' || serviceName.includes('cable') || serviceName.includes('iptv')) {
      navigate(`/customer/${customerId}/service/iptv`, {
        replace: true,
        state: { customer: customerData, services: servicesFromState }
      });
    } else if (serviceId === 'voice' || serviceName.includes('voice')) {
      navigate(`/customer/${customerId}/service/voice`, {
        replace: true,
        state: { customer: customerData, services: servicesFromState }
      });
    } else if (serviceId === 'fofi' || serviceName.includes('fofi') || serviceName.includes('fo-fi') || serviceName.includes('smart box')) {
      navigate(`/customer/${customerId}/service/fofi-smart-box`, {
        replace: true,
        state: { customer: customerData, services: servicesFromState }
      });
    }
  };

  // Synthesized from the authenticated selected-customer (from customersList)
  // so downstream nav-state / child-prop consumers keep the same shape without
  // the unauthenticated cabletvapis/GeneralApi PII calls (the Android app also
  // never calls those). Only body.op_id is read downstream (PaymentHistory /
  // Paynow), each of which additionally falls back to customerData/user op_id.
  // ponytail: minimal shape — extend only if a consumer ever reads more.
  const cableDetails = customerData ? { body: { op_id: customerData.op_id } } : null;

  // Extract data from API responses
  const internetId = assignedItems?.body?.internet?.[0]?.product_name || userid;
  const internetService = planDetails?.body?.subscribed_services?.find(s => canonicalServiceKey(s?.servicekey) === 'internet');
  const planName = internetService?.planname || 'N/A';
  const expiryDate = internetService?.expirydate || 'N/A';
  const serviceName = internetService?.title || 'internet';
  const renewalStatus = String(planDetails?.body?.other_service_renewal?.btn_status || '').toLowerCase();
  const isRenewalDisabled = !renewalStatusReady || renewalStatus !== 'enable';

  // Handle payment button click

  const handlePayBill = async () => {
    const op_id = customerData?.op_id;
    let latestPlan = planDetails;

    try {
      const fresh = await getMyPlanDetails({ servicekey: "internet", userid, fofiboxid: "", voipnumber: "" }, true);
      if (fresh?.status?.err_code === 0) {
        latestPlan = fresh;
        setPlanDetails(fresh);
      }
    } catch (err) {
      console.error("Error verifying renewal status:", err);
      toast.add('Unable to verify payment status. Please try again.', { type: 'error' });
      return;
    }

    const latestStatus = String(latestPlan?.body?.other_service_renewal?.btn_status || '').toLowerCase();
    if (latestStatus === 'disable') {
      const errMsg = latestPlan?.body?.other_service_renewal?.err_msg || 'Operator is disabled.';
      toast.add(errMsg, { type: 'error' });
      return;
    }

    navigate('/payment', {
      state: {
        customer: customerData,
        servicekey: 'internet',
        userid: userid,
        op_id: op_id,
        planDetails: latestPlan,
        cableDetails: cableDetails
      }
    });
  };

  // Handle Link FOFI BOX button click.
  // Navigate straight into the FoFi Smart Box page's link flow
  // (view='link-fofi') via fromInternet=true, which loads the
  // Internet-origin IPTV/Combo plans list — the same services list the
  // operator gets when tapping "Link FoFi Box" inside FoFi Smart Box.
  // (Previously this opened the peer-service switcher modal by mistake.)
  const handleLinkFofiBox = () => {
    navigate(`/customer/${customerId}/service/fofi-smart-box`, {
      state: {
        customer: customerData,
        services: servicesFromState,
        fromInternet: true,
        internetId,
      }
    });
  };

  // Handle Order History button click — only Internet bills.
  const handleOrderHistory = () => {
    navigate('/payment-history', {
      state: {
        customer: customerData,
        cableDetails: cableDetails,
        serviceType: 'internet',
      }
    });
  };

  // Guard so a second click while the first KYC fetch is still in
  // flight (button state lag, double-tap, React StrictMode rerun) does
  // not trigger two toasts / two retry loops.
  const uploadRequestInFlightRef = useRef(false);

  // Handle Upload Document button click. Retries the KYC preview on
  // backend operator-sync errors so a freshly-created customer
  // doesn't dead-end on the first click (see src/utils/kycRetry.js).
  const handleUploadDocument = async () => {
    if (uploadRequestInFlightRef.current) return;
    uploadRequestInFlightRef.current = true;
    setUploadLoading(true);
    try {
      const cid = customerData?.customer_id || userid;
      const response = await loadKycWithRetry({ cid, reqtype: 'update' });

      if (response?.status?.err_code === 0) {
        navigate('/upload-documents', {
          state: { customer: customerData, kycData: response.body },
        });
      } else {
        toast.add('Failed to load documents: ' + (response?.status?.err_msg || 'Unknown error'), { type: 'error' });
      }
    } catch (err) {
      console.error('Error loading document preview:', err);
      toast.add('Failed to load documents. Please try again.', { type: 'error' });
    } finally {
      setUploadLoading(false);
      uploadRequestInFlightRef.current = false;
    }
  };

  if (!customerData) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
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
      <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">Customer OverView</h1>
      </header>
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
        {/* User Details — renders instantly from customerData (no API needed) */}
        <div className="space-y-3">
          <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
            User Details
          </h3>
          <div className="space-y-1 text-sm">
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Username</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {formatCustomerId(customerData.customer_id)}</span>
            </div>
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Customer Name</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {customerData.name}</span>
            </div>
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Ph Number</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {customerData.mobile}</span>
            </div>
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Email Id</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {customerData.email}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons — renders instantly */}
        <div className="flex gap-3">
          <button
            onClick={handleUploadDocument}
            disabled={uploadLoading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-[background-color,box-shadow] duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadLoading ? 'Loading...' : 'Upload Document'}
          </button>
          <button
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-[background-color,box-shadow] duration-200 shadow-md hover:shadow-lg"
            onClick={handleOrderHistory}
          >
            Order History
          </button>
        </div>

        {/* Filter Badge — renders instantly */}
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

        {/* Internet ID & Plan Details — inline loading only for this section */}
        {planLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-gray-500 dark:text-gray-400 text-sm">Loading plan details...</span>
          </div>
        ) : error ? (
          <div className="text-center py-10 text-red-500">{error}</div>
        ) : (
          <>
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
                <div className="flex items-start gap-3">
                  {/* Globe Icon */}
                  <div className="flex-shrink-0">
                    <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" className="text-gray-700" />
                      <ellipse cx="12" cy="12" rx="4" ry="10" className="text-gray-700" />
                      <path d="M2 12h20" className="text-gray-700" />
                      <path d="M4 7h16" className="text-gray-700" />
                      <path d="M4 17h16" className="text-gray-700" />
                    </svg>
                  </div>

                  {/* Plan Info */}
                  <div className="flex-1 min-w-0 space-y-2 text-sm">
                    <div className="flex">
                      <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Service Name</span>
                      <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {serviceName}</span>
                    </div>
                    <div className="flex">
                      <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Plan Name</span>
                      <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {planName}</span>
                    </div>
                    <div className="flex">
                      <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Expiry Date</span>
                      <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {expiryDate}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 mt-4">
                  <button
                    onClick={handlePayBill}
                    disabled={isRenewalDisabled}
                    className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-shadow duration-200 text-sm shadow-md hover:shadow-lg"
                  >
                    PAY BILL
                  </button>
                  <button
                    onClick={handleLinkFofiBox}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-shadow duration-200 text-sm shadow-md hover:shadow-lg"
                  >
                    Link FOFI BOX
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <ServiceSelectionModal
        isOpen={showServiceModal}
        onClose={() => setShowServiceModal(false)}
        onSelectService={handleServiceSelect}
        customer={customerData}
        services={servicesFromState}
        currentServiceKey="internet"
        cableDetails={cableDetails}
      />
      <BottomNav />
    </div>
  );
}
