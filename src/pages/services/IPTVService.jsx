import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { loadKycWithRetry } from "../../utils/kycRetry";
import { isExpiredDate, parseBackendDate } from "../../utils/dateParse";
import BottomNav from "../../components/BottomNav";
import { ServiceSelectionModal, Loader, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import {
    getCustKYCPreview,
    getMyPlanDetails,
    getUserAssignedItems,
    getCableCustomerDetails,
    getPrimaryCustomerDetails,
    getCustomerRegistrationStatus,
    getIptvLastSubscribedInfo,
    getPkgCategories,
    getPackagesList,
    getChannelsList,
    getPkgChannelsList,
    getWalBal,
    getPaymentInfo,
    getPlanExtensionPeriods,
    getCableTvPaymentDetails,
    generateCableTvOrder,
} from "../../services/generalApis";
import { payNow } from "../../services/registrationApis";
import { refreshServiceController } from "../../services/navigationController";
import { proxyImageUrl } from "../../services/iptvImage";
import { formatCustomerId } from "../../services/helpers";
import { lsGet, lsSet, lsRemove, lsGetStale } from "../../services/lsCache";
import { canonicalServiceKey } from "../../constants/services";
import { getUser } from "../../services/safeStorage";
import { extractBoxIdFromAssigned } from "../../utils/boxId";

const getPackageId = (pkg, fallback = "") => String(pkg?.pkgid ?? pkg?.packageid ?? pkg?.id ?? fallback);
const getPackageCode = (pkg) => String(pkg?.pkgcode ?? pkg?.pkgid ?? pkg?.packageid ?? "");
const getChannelId = (channel, fallback = "") => String(channel?.chid ?? channel?.lcochid ?? channel?.channelid ?? channel?.id ?? fallback);
const toStringArray = (value) => {
    if (Array.isArray(value)) {
        return value.flatMap((item) => {
            if (item && typeof item === "object") {
                return [
                    item.pkgid,
                    item.packageid,
                    item.id,
                    item.pkgcode,
                    item.packagecode,
                    item.pkg_code,
                    item.package_code,
                ];
            }
            return [item];
        }).filter((item) => item !== undefined && item !== null && item !== "").map(String);
    }
    if (value === undefined || value === null || value === "") return [];
    return [String(value)];
};

// Live API response shape (verified 2026-05-02):
//   body.periods    = [{label:"30 Days", period:30}, …]
//   body.days_range = {min:1, max:86}
// Older code looked for body.result / body-as-array → always
// returned [] → period selector never rendered → operator clicked
// Pay with cblextenperiod="" → backend "Please choose some days".
function getPeriodsArray(response) {
    const body = response?.body;
    const periods = body?.periods || body?.result || (Array.isArray(body) ? body : []);
    return Array.isArray(periods) ? periods : [];
}

function getPeriodValue(period) {
    return String(period?.period ?? period?.id ?? period?.periodid ?? period?.value ?? period ?? "");
}

function getDaysRange(response) {
    const r = response?.body?.days_range;
    return {
        min: Number(r?.min) > 0 ? Number(r.min) : 1,
        max: Number(r?.max) > 0 ? Number(r.max) : 365,
    };
}

function parsePositiveInteger(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(String(value).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
}

function getRemainingDaysFromSubscription(...sources) {
    const remainingKeys = [
        "remainingdays",
        "remaining_days",
        "remain_days",
        "remaindays",
        "remdays",
        "validitydays",
        "validity_days",
        "noofdays",
        "no_of_days",
    ];
    for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        for (const key of remainingKeys) {
            const direct = parsePositiveInteger(source[key]);
            if (direct !== null) return direct;
        }
    }

    for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        const expiry = source.expirydate || source.expiry_date || source.expdate;
        const expiryTime = parseBackendDate(expiry);
        if (expiryTime == null) continue;
        const remaining = Math.floor((expiryTime - Date.now()) / (24 * 60 * 60 * 1000));
        return remaining > 0 ? remaining : 1;
    }
    return null;
}

function pickCableSubscribedService(planDetails) {
    const cableServices = (planDetails?.body?.subscribed_services || []).filter(
        s => canonicalServiceKey(s?.servicekey) === 'cabletv'
    );

    if (cableServices.length <= 1) return cableServices[0];

    return cableServices.reduce((best, cur) => {
        const bestT = parseBackendDate(best?.expirydate);
        const curT = parseBackendDate(cur?.expirydate);
        if (curT == null) return best;
        if (bestT == null) return cur;
        return curT > bestT ? cur : best;
    });
}

function makeCheckoutKey({ userid, fofiBoxId, period, pkgIds, pkgCodes, chIds }) {
    return JSON.stringify({
        userid: userid || "",
        fofiBoxId: fofiBoxId || "",
        period: String(period || ""),
        pkgIds: [...pkgIds].map(String).sort(),
        pkgCodes: [...pkgCodes].map(String).sort(),
        chIds: [...chIds].map(String).sort(),
    });
}

function extractWalletBalanceValue(walletResponse) {
    const candidates = [
        walletResponse?.body?.wallet_balance,
        walletResponse?.body?.balance,
        walletResponse?.body?.avlbal,
        walletResponse?.body?.wallet?.wallet_balance,
        walletResponse?.body?.wallet?.balance,
        walletResponse?.body?.wallet?.avlbal,
        walletResponse?.result?.wallet_balance,
        walletResponse?.result?.balance,
        walletResponse?.result?.avlbal,
        walletResponse?.result?.wallet?.wallet_balance,
        walletResponse?.result?.wallet?.balance,
        walletResponse?.result?.wallet?.avlbal,
        walletResponse?.wallet_balance,
        walletResponse?.balance,
        walletResponse?.avlbal,
    ];
    return candidates.find((value) => value !== undefined && value !== null && value !== "");
}

function parseWalletBalanceAmount(walletResponse) {
    const value = extractWalletBalanceValue(walletResponse);
    if (value === undefined) return null;
    const amount = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(amount) ? amount : null;
}

function formatWalletBalance(walletResponse) {
    const amount = parseWalletBalanceAmount(walletResponse);
    if (amount !== null) return amount.toFixed(2);
    const value = extractWalletBalanceValue(walletResponse);
    return value !== undefined ? String(value) : "0.00";
}

function withWalletBalanceAmount(walletResponse, amount) {
    const nextAmount = Math.max(0, Number(amount) || 0).toFixed(2);
    return {
        ...(walletResponse || {}),
        body: {
            ...(walletResponse?.body || {}),
            wallet_balance: nextAmount,
            balance: nextAmount,
        },
    };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function IPTVService() {
    const location = useLocation();
    const navigate = useNavigate();
    const { customerId: urlCustomerId } = useParams();
    const toast = useToast();
    const user = getUser();
    const logUname = user?.username || 'superadmin';

    const readSessionJSON = (key, fallback = null) => {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? (JSON.parse(raw) ?? fallback) : fallback;
        } catch (_) {
            return fallback;
        }
    };

    // customerData is normally passed via location.state when the
    // operator navigates from the customer list. But location.state
    // disappears on every:
    //   • hard refresh of /customer/<id>/service/iptv
    //   • popstate to a stripped history entry (Android back stack)
    //   • PWA cold-restore after a low-memory tab kill
    //   • deep-link / push-notification open
    // The previous implementation showed "No customer data available.
    // Please select a customer from the customer list." in all those
    // cases, which forced operators to walk all the way back to the
    // customer list and re-pick. To recover transparently, we mirror
    // location.state.customer to sessionStorage keyed by the URL's
    // customerId. The next render — same browser session — reads the
    // sessionStorage entry as a fallback. Persist + read happens in
    // useMemo so it's available synchronously on the first render
    // (no flash of the empty state).
    const SESSION_KEY = `iptv_cust_${urlCustomerId || ''}`;
    const CHECKOUT_SESSION_KEY = `iptv_checkout_${urlCustomerId || ''}`;
    const restoredCheckout = useMemo(() => {
        const saved = readSessionJSON(CHECKOUT_SESSION_KEY, null);
        if (!saved || saved.customerId !== urlCustomerId || saved.view !== 'checkout') return null;
        const pkgIds = Array.isArray(saved.selectedPackages) ? saved.selectedPackages : [];
        const chIds = Array.isArray(saved.selectedChannels) ? saved.selectedChannels : [];
        return (pkgIds.length > 0 || chIds.length > 0) ? saved : null;
    }, [CHECKOUT_SESSION_KEY, urlCustomerId]);
    const customerData = useMemo(() => {
        const fromState = location.state?.customer;
        if (fromState) return fromState;
        const parsed = readSessionJSON(SESSION_KEY, null);
        return (parsed && (parsed.customer_id || parsed.username)) ? parsed : null;
    }, [location.state, SESSION_KEY]);
    const userid = customerData?.customer_id;

    // Mirror customerData to sessionStorage every time we receive
    // fresh state. The fallback read above relies on this being kept
    // up to date so a hard refresh / popstate / PWA restore can
    // recover seamlessly.
    useEffect(() => {
        const fresh = location.state?.customer;
        if (!fresh || !urlCustomerId) return;
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(fresh)); } catch (_) {}
    }, [location.state, SESSION_KEY, urlCustomerId]);

    const shouldShowModal = location.state?.showServiceModal || false;
    const servicesFromState = location.state?.services || [];
    const historyIptvView = typeof window !== "undefined" ? window.history.state?.iptvView : "";
    const historyIptvDepth = Number(typeof window !== "undefined" ? window.history.state?.iptvDepth : 0) || 0;
    const initialIptvView = historyIptvView || restoredCheckout?.view || 'overview';
    const initialIptvDepth = initialIptvView === 'overview' ? 0 : (historyIptvDepth || 1);

    // State management
    const [showServiceModal, setShowServiceModal] = useState(shouldShowModal);
    const [view, setView] = useState(initialIptvView); // 'overview', 'packages', 'channels', 'checkout'
    const [selectedPackages, setSelectedPackages] = useState(
        Array.isArray(restoredCheckout?.selectedPackages) ? restoredCheckout.selectedPackages.map(String) : []
    );
    const [uploadLoading, setUploadLoading] = useState(false);

    // ── Hardware-back navigation across sub-views ───────────────────
    // Each sub-view transition (overview → packages → checkout, or
    // overview → channels) pushes a history entry tagged with the
    // target view name AND the depth at that entry. The phone back
    // button then steps backwards one view at a time:
    //
    //   checkout → back → channels → back → packages → back → overview
    //
    // Why store depth in history state (not just a counter ref)?
    // The user can navigate freely with the phone back/forward
    // buttons or jump out of the IPTV page entirely and come back
    // via the back stack. A counter ref drifts out of sync the
    // moment that happens. Reading depth straight off the history
    // entry we land on keeps popToOverview correct regardless of
    // the path the user took.
    //
    // The depth=2 hardcode here previously assumed checkout sat
    // on top of one push (packages OR channels), but the real flow
    // is packages → channels → checkout (depth 3). After a paid
    // order it left the user staring at the packages view with
    // cleared state — that's the "No packages available in this
    // category" empty screen ops kept hitting.
    //
    // In-app back buttons (the chevrons in each sub-view header)
    // call window.history.back() instead of setView() directly,
    // so they route through the same popstate handler and history
    // stays in sync with the displayed view.
    const subviewDepthRef = useRef(initialIptvDepth);
    const enterSubView = (newView) => {
        if (view === newView) return;
        try {
            const newDepth = subviewDepthRef.current + 1;
            // CRITICAL: spread the existing history state when
            // pushing. React Router stores location.state inside
            // window.history.state under its own keys (`usr`,
            // `key`, `idx`); a bare pushState({ iptvView }) replaces
            // those keys and on popstate React Router thinks
            // location.state is empty — operators saw "No customer
            // data available" and a TypeError on customerData.name
            // crash. Spreading preserves React Router's bookkeeping
            // alongside our marker.
            window.history.pushState(
                { ...(window.history.state || {}), iptvView: newView, iptvDepth: newDepth },
                ''
            );
            subviewDepthRef.current = newDepth;
        } catch (_) {}
        setView(newView);
    };
    useEffect(() => {
        const onPopState = (e) => {
            // Read the iptvView marker AND depth from the entry we
            // landed on. Missing marker means we popped past all our
            // entries — back to the route's natural state, i.e.
            // overview, depth 0.
            const target = e.state?.iptvView || 'overview';
            const depth = e.state?.iptvDepth || 0;
            subviewDepthRef.current = depth;
            setView(target);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);
    useEffect(() => {
        if (initialIptvView === 'overview' || historyIptvView) return;
        try {
            window.history.replaceState(
                { ...(window.history.state || {}), iptvView: initialIptvView, iptvDepth: initialIptvDepth },
                ''
            );
        } catch (_) {}
        // Only normalize the initial restored entry once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Pop all sub-view history entries down to overview. Used by
    // programmatic returns (error recovery, post-order success) so
    // that pressing phone-back afterwards doesn't try to walk the
    // user back through the stale checkout / packages entries. The
    // depth comes from the live ref (synced with each pushState /
    // popstate), so it's correct regardless of which path the user
    // took to reach the current view.
    const popToOverview = () => {
        const depth = subviewDepthRef.current;
        if (depth > 0) {
            try {
                subviewDepthRef.current = 0;
                window.history.go(-depth);
                return;
            } catch (_) {}
        }
        setView('overview');
    };

    // ── SWR hydration ───────────────────────────────────────────────
    // Read every cache the overview depends on SYNCHRONOUSLY before
    // useState runs, so initial render paints from cache instead of
    // showing the "Loading service details…" spinner. We mirror the
    // FoFiSmartBox SWR pattern. Background revalidation in the data-
    // fetch effect updates state if the API has fresher data.
    //
    // CRITICAL: only skip the spinner when we have a cached value
    // that the plan-section renderer can actually use to decide what
    // to show (the plan card, "not opted", or "temporarily
    // unavailable"). Skipping the spinner with only a cached boxId
    // — but no plan and no definitive cblCustDet — flashed the "not
    // opted" / "temporarily unavailable" message at operators while
    // the real plan-details fetch was still in flight. The spinner
    // is the correct UI for that loading window.
    //
    // TTLs intentionally exceed the helpers' fresh-cache TTLs — the
    // helpers re-fetch when stale, but we still hydrate from a stale
    // entry so the user gets an instant paint. Background refresh
    // catches the operator up to fresh state within ~1 RTT.
    const _BOX_TTL = 365 * 24 * 60 * 60 * 1000;       // 1 year — box ID rarely changes
    const _STALE_TTL = 60 * 60 * 1000;                // 1h — show stale, revalidate
    const _cachedBoxId = userid ? lsGet(`cabletv_boxid_${userid}`, _BOX_TTL) : '';
    const _cachedCblCust = userid ? lsGetStale(`cblcust_${userid}`, _STALE_TTL) : null;
    const _cachedPlan = (_cachedBoxId && userid)
        ? lsGetStale(`plandets_cabletv_${userid}_${_cachedBoxId}`, _STALE_TTL) : null;
    const _cachedFofiPlan = (_cachedBoxId && userid)
        ? lsGetStale(`plandets_fofi_${userid}_${_cachedBoxId}`, _STALE_TTL) : null;
    const _cachedLastSub = (_cachedBoxId && userid)
        ? lsGetStale(`iptvLastSub_${userid}_${_cachedBoxId}`, _STALE_TTL) : null;
    const _cachedWallet = logUname ? lsGetStale(`walbal_${logUname}_cabletv`, _STALE_TTL) : null;
    // Plan-section is renderable from cache when we have either:
    //   1. Cached plan details with a real subscribed_services entry
    //      (we can render the plan card instantly), OR
    //   2. Cached cblCustDet that says no cabletv platform
    //      (definitive "not opted" — no need to wait for plan).
    // Otherwise the plan section is genuinely loading and the
    // operator should see a spinner, not a misleading message.
    const _cachedSubscribedService = pickCableSubscribedService(_cachedPlan?.data);
    const _cachedHasPlan = !!_cachedSubscribedService;
    const _cachedPlanLooksExpired = _cachedHasPlan && isExpiredDate(_cachedSubscribedService?.expirydate);
    const _cachedPlanDataForRender = _cachedPlanLooksExpired ? null : _cachedPlan?.data;
    const _cachedCblCustBody = _cachedCblCust?.data?.body;
    const _cachedDefinitelyNotOpted = !!_cachedCblCustBody
        && !_cachedCblCustBody?.multplatforms?.cabletv;
    const _hasCachedPlanRender = (!!_cachedPlanDataForRender && _cachedHasPlan) || _cachedDefinitelyNotOpted;

    // API states — overview
    const [planDetails, setPlanDetails] = useState(_cachedPlanDataForRender || null);
    const [fofiPlanDetails, setFofiPlanDetails] = useState(_cachedFofiPlan?.data || null);
    const [assignedItems, setAssignedItems] = useState(null);
    const [lastSubscribedInfo, setLastSubscribedInfo] = useState(_cachedLastSub?.data || null);
    const [fofiBoxId, setFofiBoxId] = useState(_cachedBoxId || "");
    const [hasFofiBox, setHasFofiBox] = useState(!!_cachedBoxId); // Whether user actually has a FoFi box
    // cblCustDet response — used as a fallback signal for "does this
    // customer have cabletv?" when getUserAssignedItems and
    // getMyPlanDetails come back empty (e.g. backend data sync gap).
    // Reading body.multplatforms.cabletv lets us detect cabletv
    // subscription even when the box ID isn't surfaced by the items
    // endpoint, so we don't show a misleading "not opted" screen.
    const [cblCustomerDetails, setCblCustomerDetails] = useState(_cachedCblCust?.data || null);
    // Two-stage loading so the FoFi Box ID + customer-record signals
    // can paint as soon as Phase 1 settles, while only the Plan Details
    // card waits on Phase 2 (getMyPlanDetails refire). Operators on
    // patchy 5G were staring at "Loading service details…" for 4-16 s
    // because the full section was gated on Phase 2 even when Phase 1
    // already had everything needed to render the FoFi Box ID and pick
    // the not-opted vs unavailable branch.
    //
    //   loading            — page-level. True until Phase 1 (assigned
    //                        items + cblCustDet) settles. Gates FoFi Box
    //                        ID + the whole plan section's outer wrapper.
    //   planSectionLoading — card-level. True until Phase 2 (plan
    //                        details) settles. Gates ONLY the Plan
    //                        Details card content; the page is already
    //                        usable while it spins.
    const [loading, setLoading] = useState(!_cachedBoxId && !_cachedDefinitelyNotOpted);
    const [planSectionLoading, setPlanSectionLoading] = useState(!_hasCachedPlanRender);
    const [error, setError] = useState("");

    // API states — packages view
    const [packageCategories, setPackageCategories] = useState([]);
    const [packagesByCategory, setPackagesByCategory] = useState({});
    const [restoredCheckoutPackages, setRestoredCheckoutPackages] = useState(
        Array.isArray(restoredCheckout?.selectedPackageItems) ? restoredCheckout.selectedPackageItems : []
    );
    const [activeTab, setActiveTab] = useState("");
    const [packagesLoading, setPackagesLoading] = useState(false);
    const packagesLoadInFlightRef = useRef(false);
    // Channels-view search (single flat list — no categories).
    const [packagesSearchTerm, setPackagesSearchTerm] = useState("");
    // Packages-view search — keyed by category tab name. Each tab
    // (LCO / MSO / Broadcaster / Foundation) holds its own search
    // string so switching tabs doesn't carry over what was typed in
    // the previous tab. Operators reported the cross-tab persistence
    // as confusing — typing "new" in LCO and tapping MSO would still
    // filter the MSO list by "new". Per-tab state matches the native
    // app's behaviour exactly.
    const [packagesSearchByCategory, setPackagesSearchByCategory] = useState({});
    const [detailPkg, setDetailPkg] = useState(null);
    const [detailChannels, setDetailChannels] = useState([]);
    const [detailChannelsLoading, setDetailChannelsLoading] = useState(false);

    // API states — alacarte channels view
    const [alacarteChannels, setAlacarteChannels] = useState([]);
    const [selectedChannels, setSelectedChannels] = useState(
        Array.isArray(restoredCheckout?.selectedChannels) ? restoredCheckout.selectedChannels.map(String) : []
    );
    const [channelsLoading, setChannelsLoading] = useState(false);

    // Checkout states
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [walletBalance, setWalletBalance] = useState(_cachedWallet?.data || null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [walletUsingCachedFallback, setWalletUsingCachedFallback] = useState(!!_cachedWallet?.data && !_cachedWallet?.fresh);
    const [paymentInfo, setPaymentInfo] = useState(null);
    const [extensionPeriods, setExtensionPeriods] = useState([]);
    // Default to "30" so handleProceedToPay never sends an empty
    // cblextenperiod. The backend rejects empty with "Please choose
    // some days" — a confusing error since the user CAN'T choose
    // anything until extensionPeriods loads. 30 days is the standard
    // monthly billing cycle and matches what every cable plan offers.
    const [selectedPeriod, setSelectedPeriod] = useState(String(restoredCheckout?.selectedPeriod || "30"));
    const [daysRange, setDaysRange] = useState({ min: 1, max: 365 });
    const [customDaysInput, setCustomDaysInput] = useState("");
    const [finalPaymentInfo, setFinalPaymentInfo] = useState(restoredCheckout?.finalPaymentInfo || null);
    const [payLoading, setPayLoading] = useState(false);
    const payInFlightRef = useRef(false);
    const [checkoutPreview, setCheckoutPreview] = useState(restoredCheckout?.checkoutPreview || null);
    const checkoutPreviewSeqRef = useRef(0);
    const checkoutAliveRef = useRef(true);
    const paymentDetailsInFlightRef = useRef(new Map());
    const manualCalcInFlightKeyRef = useRef("");
    const lastManualCalcToastRef = useRef({ key: "", ts: 0 });
    const [successOrder, setSuccessOrder] = useState(null);

    useEffect(() => {
        checkoutAliveRef.current = true;
        return () => {
            checkoutAliveRef.current = false;
            checkoutPreviewSeqRef.current += 1;
            paymentDetailsInFlightRef.current.clear();
            manualCalcInFlightKeyRef.current = "";
            lastManualCalcToastRef.current = { key: "", ts: 0 };
        };
    }, []);

    // ── Fetch Cable TV data — single parallel batch ──
    //
    // Trimmed for speed (PWA was slower than the native app
    // because we were doing two sequential phases with two unused
    // calls):
    //
    //   • Removed customerRegistrationStatus — fetched but never read.
    //   • iptvLastSubscribedinfo: the helper in generalApis.js fires
    //     BOTH variants (with and without validity_status:"active") in
    //     parallel and unions the channelid / packageid arrays.
    //     Verified live across multiple users — behaviour of the
    //     param is user-state-dependent: for cgreen2 the active
    //     variant returns 172 ch + 3 packages while default returns
    //     56 ch + 0; for adarsh01test it's the OPPOSITE (active=0,
    //     default=113 ch + 4 pkgs). Single-variant calls silently
    //     lose subscription data for half the user base. The merged
    //     call costs one extra parallel request but guarantees every
    //     subscribed package / channel is reflected for every user.
    //   • Removed getUserAssignedItems("cabletv") — only ever a
    //     fallback, but fofi servkey is authoritative for the box ID
    //     and we now cache the box ID locally for subsequent visits.
    //
    // Box ID source priority for Phase-2 parallelization:
    //   1. lsCache (cabletv_boxid_${userid}) from a previous visit
    //   2. assignedFofiResult (fresh fetch, primary source)
    //
    // When the cached box ID is present we fire getMyPlanDetails
    // and getIptvLastSubscribedInfo in the SAME Promise.all as the
    // assigned-items + customer-details calls. That collapses the
    // wait from 2 RTTs to 1 RTT — same network as the native app
    // experiences.
    useEffect(() => {
        let cancelled = false;
        refreshServiceController();

        async function fetchData() {
            // Spinner only on truly cold starts (no cache hit). When we
            // hydrated from cache the page is already painted — flipping
            // loading to true would cause a useless flash from data-back-
            // to-spinner-back-to-data on every revisit.
            if (!_cachedBoxId && !_cachedDefinitelyNotOpted) setLoading(true);
            if (!_hasCachedPlanRender || _cachedPlanLooksExpired) setPlanSectionLoading(true);
            setError("");

            const navCancelled = (r) => r.status === "rejected" && r.reason?.message?.includes('navigated away');

            // Use cached box ID (1y TTL) to fire plan/lastSub calls
            // in the same Promise.all. If the cached ID is wrong
            // we'll retry below with the fresh one.
            const cachedBoxIdEntry = lsGet(`cabletv_boxid_${userid}`, 365 * 24 * 60 * 60 * 1000);
            const cachedBoxId = cachedBoxIdEntry || '';
            console.log('🟣 [IPTV] cached boxId:', cachedBoxId || '(none)');

            // Fire the cached-box-ID plan calls as standalone promises so
            // they can PAINT as soon as they land. getMyPlanDetails answers
            // in well under a second while the getUserAssignedItems batch
            // takes 6-8s server-side (measured 2026-07-09); leaving the
            // plan result buried in the same allSettled made the plan card
            // spin for the whole assigned-items wait even on a warm cache.
            // If the freshly-resolved box ID disagrees with the cache, the
            // reconciliation below refires and the card self-corrects.
            const planPromiseMaybe = cachedBoxId
                ? getMyPlanDetails({ servicekey: "cabletv", userid, fofiboxid: cachedBoxId, voipnumber: "" }, true)
                : Promise.resolve(null);
            const lastSubPromiseMaybe = cachedBoxId
                ? getIptvLastSubscribedInfo({ userid, itemid: cachedBoxId })
                : Promise.resolve(null);
            const fofiPlanPromiseMaybe = cachedBoxId
                ? getMyPlanDetails({ servicekey: "fofi", userid, fofiboxid: cachedBoxId, voipnumber: "" }, true)
                : Promise.resolve(null);
            if (cachedBoxId) {
                planPromiseMaybe.then(d => {
                    if (cancelled || !d) return;
                    setPlanDetails(d);
                    setPlanSectionLoading(false);
                }).catch(() => {});
                lastSubPromiseMaybe.then(d => { if (!cancelled && d) setLastSubscribedInfo(d); }).catch(() => {});
                fofiPlanPromiseMaybe.then(d => { if (!cancelled && d) setFofiPlanDetails(d); }).catch(() => {});
            }

            const [
                assignedFofiResult,
                assignedMultiResult,
                assignedVoipResult,
                assignedInternetResult,
                cblCustResult,
                priCustResult,
                planResultMaybe,
                lastSubResultMaybe,
                fofiPlanResultMaybe,
            ] = await Promise.allSettled([
                getUserAssignedItems("fofi", userid),
                // multi/voip/internet are fallback sources for the box ID:
                // some user accounts on certain backends have their FoFi
                // box exposed outside servkey="fofi". Fire them in the
                // first batch so fallback discovery does not cost a second RTT.
                getUserAssignedItems("multi", userid).catch(() => null),
                getUserAssignedItems("voip", userid).catch(() => null),
                getUserAssignedItems("internet", userid).catch(() => null),
                getCableCustomerDetails(userid),
                Promise.resolve(null),
                planPromiseMaybe,
                lastSubPromiseMaybe,
                fofiPlanPromiseMaybe,
            ]);

            if (cancelled) return;
            if (navCancelled(assignedFofiResult) || navCancelled(cblCustResult) || navCancelled(priCustResult)) return;
            getPrimaryCustomerDetails(userid).catch(() => null);

            // Box ID resolution — scan ALL servkey responses (fofi, multi, voip, internet)
            // and pick the first BBNL-/FOFI-/TV-shaped product_name we find. Different
            // user-state classifications on the backend put the same box under different
            // servkeys; trying all means we don't silently miss the box ID.
            // Box-ID extraction is shared with prefetch.js via
            // utils/boxId.js so the prefetch warm-up and this page resolve
            // the SAME box and never cache conflicting values.
            const extractBoxId = (result) => {
                if (result?.status !== "fulfilled" || !result.value) return "";
                return extractBoxIdFromAssigned(result.value, userid);
            };

            let boxId = extractBoxId(assignedFofiResult) ||
                extractBoxId(assignedMultiResult) ||
                extractBoxId(assignedVoipResult) ||
                extractBoxId(assignedInternetResult);

            // Persist cblCustDet response so the renderer can fall
            // back to body.multplatforms.cabletv when getMyPlanDetails
            // can't run (no box ID resolved). Without this the page
            // shows a misleading "Selected Customer have not opted"
            // banner for customers who DO have cabletv per the
            // customer record but whose box wasn't returned by the
            // items endpoint due to a backend data sync gap.
            if (cblCustResult.status === "fulfilled" && cblCustResult.value) {
                setCblCustomerDetails(cblCustResult.value);
            }

            // Diagnostic log — when the operator hits "not opted" on a
            // customer who actually has cabletv per cblCustDet, this
            // log makes it obvious in DevTools which API gap is
            // responsible (so we can pursue the right backend / DNS /
            // env-config fix instead of guessing at code).
            const _cblBody = cblCustResult.status === "fulfilled" ? (cblCustResult.value?.body || {}) : {};
            const _hasCabletvPerRecord = !!_cblBody?.multplatforms?.cabletv;
            console.log('🟣 [IPTV] box-id resolution:', {
                fofi: extractBoxId(assignedFofiResult) || '(empty)',
                multi: extractBoxId(assignedMultiResult) || '(empty)',
                voip: extractBoxId(assignedVoipResult) || '(empty)',
                internet: extractBoxId(assignedInternetResult) || '(empty)',
                resolved: boxId || '(none)',
                cabletvPerCblCustDet: _hasCabletvPerRecord,
            });
            if (!boxId && _hasCabletvPerRecord) {
                console.warn('⚠️ [IPTV] customer has cabletv per cblCustDet but no box ID found via getUserAssignedItems — likely a backend data sync gap (this PWA env vs the data the mobile sees).');
            }

            if (!cancelled) {
                // Don't fall back to `userid` for the Box ID display —
                // showing the username in the FoFi Box ID slot is
                // misleading. Empty string here means "no box" and the
                // FoFi Box ID card is hidden by the renderer.
                //
                // SWR safety: when both servkey calls fail (network blip,
                // upstream hiccup), boxId comes back empty even though
                // the customer still has a box. If we hydrated from
                // cache, keep that value rather than flipping the UI
                // to "no box opted" — the next refresh will reconcile.
                const bothRejected = assignedFofiResult.status === "rejected"
                    && assignedMultiResult.status === "rejected";
                if (boxId) {
                    setFofiBoxId(boxId);
                    setHasFofiBox(true);
                    try { lsSet(`cabletv_boxid_${userid}`, boxId); } catch (_) {}
                } else if (!bothRejected) {
                    // Authoritative empty (at least one call succeeded
                    // with no box).
                    setFofiBoxId("");
                    setHasFofiBox(false);
                }
            }

            // Phase 1 has settled — the page-level spinner can drop
            // NOW. The FoFi Box ID is rendered as soon as we have it,
            // and the Plan Details card spins independently via
            // planSectionLoading until Phase 2 returns. Operators no
            // longer stare at the full-page spinner for the entire
            // Phase-1 + Phase-2 wait (which was 4-16s on patchy 5G).
            setLoading(false);

            // Plan-section loading: only resolves when plan-details
            // settles (success OR failure). The card's content area
            // shows a small spinner until then; the rest of the page
            // is already usable.
            const cachedMatches = cachedBoxId && cachedBoxId === boxId;
            if (cachedMatches && planResultMaybe.status === "fulfilled" && planResultMaybe.value) {
                setPlanDetails(planResultMaybe.value);
                setPlanSectionLoading(false);
            } else if (boxId) {
                // Refire with the right box ID. planSectionLoading flips
                // after the fetch settles either way — only at that point
                // can the renderer correctly choose between the plan
                // card and the "temporarily unavailable" / "not
                // opted" branches.
                getMyPlanDetails({ servicekey: "cabletv", userid, fofiboxid: boxId, voipnumber: "" }, true)
                    .then(d => { if (!cancelled && d) setPlanDetails(d); })
                    .catch(err => console.error("Error fetching plan details:", err))
                    .finally(() => { if (!cancelled) setPlanSectionLoading(false); });
            } else {
                // No box ID resolved AND we're not waiting on a refire
                // — the plan section can render its final state from
                // whatever we have (cblCustDet drives the "not opted"
                // vs "temporarily unavailable" decision).
                setPlanSectionLoading(false);
            }
            if (cachedMatches && fofiPlanResultMaybe.status === "fulfilled" && fofiPlanResultMaybe.value) {
                setFofiPlanDetails(fofiPlanResultMaybe.value);
            } else if (boxId) {
                getMyPlanDetails({ servicekey: "fofi", userid, fofiboxid: boxId, voipnumber: "" }, true)
                    .then(d => { if (!cancelled && d) setFofiPlanDetails(d); })
                    .catch(() => {});
            } else {
                setFofiPlanDetails(null);
            }
            if (cachedMatches && lastSubResultMaybe.status === "fulfilled" && lastSubResultMaybe.value) {
                setLastSubscribedInfo(lastSubResultMaybe.value);
            } else if (boxId) {
                getIptvLastSubscribedInfo({ userid, itemid: boxId })
                    .then(d => { if (!cancelled && d) setLastSubscribedInfo(d); })
                    .catch(() => {});
            }

            // Check if all API calls failed - set error state for UI display
            const allServkeyFailed = assignedFofiResult.status === 'rejected' &&
                                    assignedMultiResult.status === 'rejected' &&
                                    assignedVoipResult.status === 'rejected' &&
                                    assignedInternetResult.status === 'rejected';
            const allFailed = allServkeyFailed &&
                             cblCustResult.status === 'rejected' &&
                             priCustResult.status === 'rejected';

            if (allFailed) {
                setError('Failed to load Cable TV data. Please check your connection and try again.');
                console.error('❌ [IPTV] All API calls failed - service data unavailable');
            } else if (allServkeyFailed) {
                setError('Unable to retrieve box information. Please try again.');
                console.warn('⚠️ [IPTV] All servkey calls failed - box ID unavailable');
            }

            // No hard error gate — even when getUserAssignedItems
            // fails (timeout, transient network blip, abort), we
            // can still render the User Details card from
            // customerData and the "not opted" message below. A
            // full-page "Failed to load Cable TV data" message
            // makes the page unusable when a single call hiccups
            // and prevented operators from completing other
            // actions on the same page (Order History, Upload
            // Document, switching service via the filter). Failures
            // now just log to the console so QA can audit; the UI
            // gracefully degrades.
            if (assignedFofiResult.status === "rejected") {
                console.warn('⚠️ [IPTV] getUserAssignedItems failed:', assignedFofiResult.reason?.message);
            }

            // The previous build prefetched packages here so a later
            // "Select Packages" click would feel instant. That cost
            // 5 extra HTTP calls (1 pkgCategories + 4 packagesList)
            // on every overview load, even when the operator never
            // opened packages — saturating slow mobile connections
            // and visibly slowing the overview itself. Removed: the
            // prefetch now happens only on actual Select Packages
            // click via handleSelectPackages → loadPackages.
        }

        if (userid) fetchData();
        return () => { cancelled = true; };
    }, [userid]);

    // Safety net for empty sub-views.
    //
    // Whenever the active view becomes packages/channels but the
    // backing data isn't loaded, kick off the fetch. This catches
    // every path the user can take to land on a sub-view, including
    // forward-button history navigation, PWA restore from a stale
    // tab, and the post-payment / error-recovery returns where state
    // is intentionally cleared. handleSelectPackages /
    // handleSelectChannels still fire the fetch eagerly for snappy
    // UX; the in-flight guards inside loadPackages /
    // loadAlacarteChannels make the duplicate-call from this effect
    // a no-op in that case.
    useEffect(() => {
        if (view === 'packages' && packageCategories.length === 0 && !packagesLoading) {
            loadPackages();
        } else if (view === 'channels' && alacarteChannels.length === 0 && !channelsLoading) {
            loadAlacarteChannels();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    // Extract plan data from API response.
    //
    // QA (04 Jun 2026 — IPTV 6.x): the page showed "Renew Plan" for
    // customers who DID have an active subscription, blocking the
    // package/channel checks. Root cause: when the backend returns more
    // than one `cabletv` entry in subscribed_services (a stale/expired
    // record alongside the current active one), a plain `.find()` picks
    // whichever comes first — often the expired record — and the whole
    // page treats the customer as expired. We instead pick the entry
    // with the FURTHEST-FUTURE expiry (the active/most-recent
    // subscription). With a single entry this is identical to the old
    // behaviour; entries with no parseable expiry sort last.
    const subscribedService = pickCableSubscribedService(planDetails);
    const looksLikeFofiSmartService = (s) =>
        canonicalServiceKey(s?.servicekey) === 'fofi'
        || /\bfofi\b|smart\s*box|smartbox|fofibox|\bfta\b|\bcabletv\b|\biptv\b/i.test(
            `${s?.serv_name || ''} ${s?.title || ''} ${s?.planname || ''} ${s?.plan_name || ''}`
        );
    const fofiSubscribedService = fofiPlanDetails?.body?.subscribed_services?.find(looksLikeFofiSmartService);
    const isFofiSmartServicePaid = !!fofiSubscribedService;
    const planName = subscribedService?.planname || 'N/A';
    const expiryDate = subscribedService?.expirydate || 'N/A';
    const serviceName = subscribedService?.title || 'Cable TV';
    const planImgUrl = subscribedService?.imgurl || '';
    // Expired users cannot pick packages or channels. isExpiredDate
    // handles DD-MM-YYYY / DD-MM-YYYY HH:mm:ss am/pm and ISO — earlier
    // versions used `new Date()` which returned NaN on DD-MM-YYYY
    // and silently treated every expired customer as active.
    const isCableTvExpired = isExpiredDate(expiryDate);
    const remainingSubscriptionDays = !isCableTvExpired
        ? getRemainingDaysFromSubscription(subscribedService, lastSubscribedInfo?.body)
        : null;
    const isExistingSubscriberCheckout = !isCableTvExpired && remainingSubscriptionDays !== null;
    const effectiveCheckoutPeriod = isExistingSubscriberCheckout
        ? String(remainingSubscriptionDays)
        : String(selectedPeriod || "30");

    const buildCheckoutParts = (periodOverride = "") => {
        const selectedPackageIds = new Set(selectedPackages.map(String));
        const packageSource = Object.values(packagesByCategory).flat();
        const restoredSource = restoredCheckoutPackages.filter((pkg) =>
            selectedPackageIds.has(getPackageId(pkg))
        );
        const selectedPkgsSource = packageSource.length > 0 ? packageSource : restoredSource;
        const selectedPkgs = selectedPkgsSource
            .filter(pkg => {
                if (!pkg || typeof pkg !== "object") return false;
                return selectedPackageIds.has(getPackageId(pkg)) && !isPackageSubscribed(pkg);
            });
        const pkgIds = selectedPkgs.map(pkg => getPackageId(pkg)).filter(Boolean);
        const pkgCodes = selectedPkgs.map(getPackageCode).filter(Boolean);
        const chIds = selectedChannels.map(String).filter(Boolean);
        const period = String(periodOverride || effectiveCheckoutPeriod || "30");

        return {
            selectedPkgs,
            pkgIds,
            pkgCodes,
            chIds,
            period,
            key: makeCheckoutKey({ userid, fofiBoxId, period, pkgIds, pkgCodes, chIds }),
        };
    };

    const getSubscribedPackageSets = (subscriptionInfo = lastSubscribedInfo) => {
        const body = subscriptionInfo?.body || {};
        const packageIds = new Set([
            ...toStringArray(body.packageid),
            ...toStringArray(body.packageids),
            ...toStringArray(body.package_id),
            ...toStringArray(body.package_ids),
            ...toStringArray(body.pkgid),
            ...toStringArray(body.pkgids),
            ...toStringArray(body.pkg_id),
            ...toStringArray(body.pkg_ids),
            ...toStringArray(body.packages),
            ...toStringArray(body.subscribed_packages),
            ...toStringArray(body.package_list),
        ]);
        const packageCodes = new Set([
            ...toStringArray(body.pkgcode),
            ...toStringArray(body.pkgcodes),
            ...toStringArray(body.pkg_code),
            ...toStringArray(body.pkg_codes),
            ...toStringArray(body.packagecode),
            ...toStringArray(body.packagecodes),
            ...toStringArray(body.package_code),
            ...toStringArray(body.package_codes),
            ...toStringArray(body.packages),
            ...toStringArray(body.subscribed_packages),
            ...toStringArray(body.package_list),
        ]);
        return { packageIds, packageCodes };
    };

    const isPackageSubscribed = (pkg, subscriptionInfo = lastSubscribedInfo) => {
        if (pkg?.issubscribed === "yes" || pkg?.issubscribed === true) return true;
        const pkgId = getPackageId(pkg);
        const pkgCode = getPackageCode(pkg);
        const { packageIds, packageCodes } = getSubscribedPackageSets(subscriptionInfo);
        return (
            (pkgId && packageIds.has(String(pkgId))) ||
            (pkgCode && (packageIds.has(String(pkgCode)) || packageCodes.has(String(pkgCode))))
        );
    };

    const isNavigationCancel = (err) => /cancelled|navigated away/i.test(err?.message || "");

    const retryPackageRequest = async (fn) => {
        try {
            return await fn();
        } catch (err) {
            if (isNavigationCancel(err)) throw err;
            await sleep(650);
            return fn();
        }
    };

    useEffect(() => {
        if (!lastSubscribedInfo?.body) return;
        setPackagesByCategory((prev) => {
            let changed = false;
            const next = {};
            Object.entries(prev).forEach(([catName, pkgs]) => {
                next[catName] = Array.isArray(pkgs)
                    ? pkgs.map((pkg) => {
                        if (!pkg || typeof pkg !== "object" || pkg.issubscribed === "yes" || pkg.issubscribed === true) {
                            return pkg;
                        }
                        if (!isPackageSubscribed(pkg, lastSubscribedInfo)) return pkg;
                        changed = true;
                        return { ...pkg, issubscribed: "yes" };
                    })
                    : pkgs;
            });
            return changed ? next : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSubscribedInfo]);

    useEffect(() => {
        if (!urlCustomerId) return;
        if (view !== 'checkout') {
            try { sessionStorage.removeItem(CHECKOUT_SESSION_KEY); } catch (_) {}
            return;
        }

        const parts = buildCheckoutParts();
        if (parts.pkgIds.length === 0 && parts.chIds.length === 0) return;

        const selectedPackageItems = parts.selectedPkgs.length > 0
            ? parts.selectedPkgs
            : restoredCheckoutPackages;
        try {
            sessionStorage.setItem(CHECKOUT_SESSION_KEY, JSON.stringify({
                customerId: urlCustomerId,
                view: 'checkout',
                selectedPackages: selectedPackages.map(String),
                selectedChannels: selectedChannels.map(String),
                selectedPeriod: isExistingSubscriberCheckout ? "" : parts.period,
                selectedPackageItems,
                checkoutPreview,
                finalPaymentInfo,
                updatedAt: Date.now(),
            }));
        } catch (_) {}
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        view,
        selectedPackages,
        selectedChannels,
        selectedPeriod,
        packagesByCategory,
        checkoutPreview,
        finalPaymentInfo,
        CHECKOUT_SESSION_KEY,
        urlCustomerId,
    ]);

    // Single transient-failure retry. paymentinfo/cabletv has been
    // observed to fail intermittently on patchy mobile networks
    // (5G handoff, TCP RST mid-request, occasional 5xx) — operators
    // saw "Failed to load checkout details" and had to back out and
    // re-enter to recover. One retry with a short backoff catches
    // the bulk of those without making the happy path slower.
    //
    // Navigation cancels are NOT retried: the operator left the page,
    // re-firing would saturate the connection pool for the next page.
    const requestCablePaymentDetails = async (parts) => {
        const requestKey = parts?.key || makeCheckoutKey({
            userid,
            fofiBoxId,
            period: parts?.period,
            pkgIds: parts?.pkgIds || [],
            pkgCodes: parts?.pkgCodes || [],
            chIds: parts?.chIds || [],
        });
        const inFlight = paymentDetailsInFlightRef.current.get(requestKey);
        if (inFlight) return inFlight;

        const params = {
            cblextenperiod: parts.period,
            channelid: parts.chIds,
            fofi_box_id: fofiBoxId,
            lcochid: parts.chIds,
            packageid: parts.pkgIds,
            pkgcode: parts.pkgCodes,
            planid: "",
            priceid: "",
            servapptype: "crmapp",
            servid: "1",
            userid,
            username: logUname,
            voipnumber: "",
        };

        const promise = (async () => {
            let lastErr;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    return await getCableTvPaymentDetails(params);
                } catch (err) {
                    lastErr = err;
                    if (/cancelled|navigated away/i.test(err?.message || '')) throw err;
                    if (attempt === 0) await new Promise(r => setTimeout(r, 700));
                }
            }
            throw lastErr;
        })().finally(() => {
            if (paymentDetailsInFlightRef.current.get(requestKey) === promise) {
                paymentDetailsInFlightRef.current.delete(requestKey);
            }
        });

        paymentDetailsInFlightRef.current.set(requestKey, promise);
        return promise;
    };
    // ── Load packages — matches client flow on "Select Packages" click ──
    // 1. pkgCategories + iptvLastSubscribedinfo (parallel; lastSub
    //    only refetched if not already in state)
    // 2. packagesList for each category with subscribed packageids
    //    passed in as input (the API marks them issubscribed:"yes" only
    //    when we tell it which ones are subscribed)
    async function loadPackages() {
        const categoryNames = (cats = packageCategories) => (Array.isArray(cats) ? cats : [])
            .map(cat => (cat && typeof cat === 'object') ? (cat.name || cat.title || cat.category || '') : String(cat || ''))
            .filter(Boolean);
        const hasLoadedEveryCategory = packageCategories.length > 0 &&
            categoryNames().every((name) => Array.isArray(packagesByCategory[name]));
        if (hasLoadedEveryCategory) return; // already loaded, including real empty categories
        if (packagesLoadInFlightRef.current) return;
        packagesLoadInFlightRef.current = true;
        setPackagesLoading(true);
        try {
            // Fetch pkgCategories + iptvLastSubscribedinfo together.
            // The latter is what makes the "Subscribed" green ribbons
            // work — without its body.packageid array we have nothing
            // to pass to packagesList, so every package comes back
            // issubscribed:"no" and the ribbon never shows. The
            // overview-mount useEffect already fires this call, but
            // operators can land on the packages view before that
            // promise resolves (fast click, popstate, deep link), or
            // with a stale value, so we re-fire here unless we already
            // have a populated lastSubscribedInfo response.
            const [catResult, lastSubResult] = await Promise.allSettled([
                retryPackageRequest(() => getPkgCategories({ username: logUname, userid })),
                fofiBoxId
                    ? getIptvLastSubscribedInfo({ userid, itemid: fofiBoxId }, true)
                    : Promise.resolve(lastSubscribedInfo),
            ]);

            let catResponse = catResult.status === "fulfilled" ? catResult.value : null;
            if (!catResponse) {
                const staleCats = lsGetStale(`pkgcats_${logUname}_${userid}`, 24 * 60 * 60 * 1000);
                catResponse = staleCats?.data || null;
            }

            // Parse categories from response body
            let categories = [];
            const catBody = catResponse?.body;
            if (Array.isArray(catBody)) {
                // body is directly an array of category objects
                categories = catBody.filter(c => c && typeof c === 'object');
            } else if (catBody?.categories && Array.isArray(catBody.categories)) {
                categories = catBody.categories;
            }
            if (categories.length === 0 && packageCategories.length > 0) {
                categories = packageCategories;
            }
            setPackageCategories(categories);

            if (categories.length > 0) {
                const firstTab = categories[0]?.name || categories[0]?.title || categories[0]?.category || "";
                setActiveTab(firstTab);
            }

            // Use whichever lastSubscribedInfo we have — freshly
            // fetched if we just got it, otherwise the cached state.
            const lastSubFresh = lastSubResult.status === "fulfilled" ? lastSubResult.value : null;
            const lastSubEffective = lastSubFresh || lastSubscribedInfo;
            if (lastSubFresh && lastSubFresh !== lastSubscribedInfo) {
                setLastSubscribedInfo(lastSubFresh);
            }
            const lastSubBody = lastSubEffective?.body;
            const { packageIds: subscribedPkgIdSet, packageCodes: subscribedPkgCodeSet } = getSubscribedPackageSets(lastSubEffective);
            const subscribedPkgIds = Array.from(subscribedPkgIdSet);
            console.log("📦 [loadPackages] subscribed package IDs/codes:", subscribedPkgIds, Array.from(subscribedPkgCodeSet));

            // Step 2: packagesList per category — STREAMED.
            //
            // Previous implementation awaited Promise.all on every
            // category. The spinner stayed up until the slowest of
            // the 4 calls finished, even though the operator only
            // looks at one tab at a time. Trace from a 3G test
            // showed the operator waited ~3 s on this view alone.
            //
            // New behaviour:
            //   - Drop the page spinner as soon as the FIRST category
            //     to resolve has data → perceived load = 1 RTT.
            //   - Each remaining category streams in independently
            //     and updates packagesByCategory[catName] when it
            //     arrives → other tabs become populated in the
            //     background while the operator is interacting.
            //   - Categories that fail are skipped silently (the tab
            //     stays empty, matching the "no packages available"
            //     state); we don't fail the whole view.
            const subForCall = Array.isArray(subscribedPkgIds) ? subscribedPkgIds : [];
            const subHash = subForCall.length > 0 ? subForCall.map(String).sort().join(",") : "";
            const parsePackagesBody = (resp) => {
                const bodyData = resp?.body;
                if (Array.isArray(bodyData)) return bodyData;
                if (bodyData && typeof bodyData === 'object') {
                    const arr = bodyData.result || bodyData.packages || bodyData.data || [];
                    return Array.isArray(arr) ? arr : [];
                }
                return [];
            };

            let firstResolved = false;
            await new Promise((doneAll) => {
                let pending = categories.length;
                if (pending === 0) {
                    setPackagesLoading(false);
                    doneAll();
                    return;
                }
                categories.forEach((cat) => {
                    const catId = cat.id || cat.categoryid || cat.category_id;
                    const catName = cat.name || cat.title || cat.category || `Category`;
                    retryPackageRequest(() => getPackagesList({
                            category: catId,
                            packageid: subForCall,
                            userid,
                            username: logUname,
                        }))
                    .catch((err) => {
                        if (isNavigationCancel(err)) throw err;
                        const stalePackages = lsGetStale(`pkglist_${userid}_${String(catId)}_${subHash}`, 24 * 60 * 60 * 1000);
                        if (stalePackages?.data) return stalePackages.data;
                        throw err;
                    }).then(resp => {
                        const pkgArray = parsePackagesBody(resp).map((pkg) => {
                            const subscribed = isPackageSubscribed(pkg, lastSubEffective);
                            return subscribed ? { ...pkg, issubscribed: "yes" } : pkg;
                        });
                        // Append/overwrite this category's slot in
                        // the map without disturbing the others.
                        setPackagesByCategory(prev => ({ ...prev, [catName]: pkgArray }));
                        // Drop the global spinner the moment the FIRST
                        // category arrives. Operator can interact with
                        // it while other tabs continue loading.
                        if (!firstResolved) {
                            firstResolved = true;
                            setPackagesLoading(false);
                        }
                    }).catch(() => {
                        setPackagesByCategory(prev => ({ ...prev, [catName]: [] }));
                        if (!firstResolved) {
                            firstResolved = true;
                            setPackagesLoading(false);
                        }
                    }).finally(() => {
                        pending -= 1;
                        if (pending === 0) doneAll();
                    });
                });
            });
        } catch (err) {
            console.error("Error loading packages:", err);
            toast.add("Failed to load packages. Please try again.", { type: "error" });
            popToOverview(); // recover from error — pop history + view
        } finally {
            packagesLoadInFlightRef.current = false;
            setPackagesLoading(false);
        }
    }

    // Peer service switch — replace: true so toggling between peer
    // service views via the picker doesn't stack history entries.
    const handleServiceSelect = (service) => {
        if (service) {
            const sName = (service.name || '').toLowerCase();
            if (sName.includes('voice') || sName.includes('calling')) {
                navigate(`/customer/${customerData.customer_id}/service/voice`, {
                    replace: true,
                    state: { customer: customerData, services: servicesFromState }
                });
            } else if (sName.includes('internet')) {
                navigate(`/customer/${customerData.customer_id}/service/internet`, {
                    replace: true,
                    state: { customer: customerData, services: servicesFromState }
                });
            } else if (sName.includes('fofi') || sName.includes('smart box')) {
                navigate(`/customer/${customerData.customer_id}/service/fofi-smart-box`, {
                    replace: true,
                    state: { customer: customerData, services: servicesFromState }
                });
            } else if (sName.includes('cable') || sName.includes('iptv') || sName.includes('tv')) {
                setShowServiceModal(false);
            } else {
                setShowServiceModal(false);
            }
        }
    };

    const handleOrderHistory = () => {
        navigate('/payment-history', {
            state: {
                customer: customerData,
                serviceType: 'cabletv',
                // Box id scopes the dedicated cabletv/orderhistory (servid=1)
                // fetch so older Cable TV records are returned and shown.
                cableboxid: fofiBoxId || '',
            },
        });
    };

    // Guard + auto-retry on backend operator-sync errors
    // (see src/utils/kycRetry.js).
    const uploadRequestInFlightRef = useRef(false);
    const handleUploadDocument = async () => {
        if (uploadRequestInFlightRef.current) return;
        uploadRequestInFlightRef.current = true;
        setUploadLoading(true);
        try {
            const cid = customerData?.customer_id;
            const response = await loadKycWithRetry({ cid, reqtype: 'update' });
            if (response?.status?.err_code === 0) {
                navigate('/upload-documents', {
                    state: { customer: customerData, kycData: response.body }
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

    // Open package detail modal and fetch ONLY the channels allocated
    // to this package.
    //
    // The right endpoint is ServiceApis/pkgChannelsList — channelsList
    // silently ignores its packageid parameter and returns the global
    // catalog, which is why the modal had been showing every channel
    // instead of just the 6 in the package. pkgChannelsList requires
    // BOTH packageid and pkgcode (verified against the staging server).
    //
    // pkgChannelsList returns: chid, chtitle, chlogo, chmrp, ptype, chtype.
    // It does NOT return language / broadcaster / genres — for those
    // we fire channelsList in parallel with the same chids and merge
    // by chid. channelsList's response order puts the matching channels
    // first, so we filter to the requested set client-side and pull
    // language / genres / broadcaster off the matching rows.
    //
    // Falls back to displaying just the pkgChannelsList rows when the
    // enrichment call fails or times out — basic info (name, price,
    // SD/HD, logo) is enough to identify the channel.
    async function handleOpenDetail(pkg) {
        setDetailPkg(pkg);
        setDetailChannels([]);
        setDetailChannelsLoading(true);
        let baseChannels = [];
        try {
            const pkgId = String(pkg.pkgid || pkg.packageid || "");
            const pkgCode = String(pkg.pkgcode || pkgId);

            const pkgResult = await getPkgChannelsList({
                packageid: pkgId,
                pkgcode: pkgCode,
                userid,
                username: logUname,
            });

            const pkgRows = pkgResult?.body?.result || [];
            baseChannels = Array.isArray(pkgRows) ? pkgRows : [];
            console.log("📺 pkgChannelsList for pkg", pkgId, "→", baseChannels.length, "channels");
        } catch (err) {
            console.error("Error fetching package channels:", err);
        }

        // Commit the basic list and drop the spinner BEFORE running
        // enrichment so the modal shows the channel rows right away.
        // Enrichment then upgrades language / genres / broadcaster
        // silently in place. (Previously the spinner stayed up until
        // both calls finished, and an early return on the empty case
        // never cleared the loading flag at all — a stuck spinner.)
        setDetailChannels(baseChannels);
        setDetailChannelsLoading(false);

        if (baseChannels.length === 0) return;

        try {
            const wantedIds = new Set(baseChannels.map(c => String(c.chid)));
            const enrichResult = await getChannelsList({
                channelid: Array.from(wantedIds),
                userid,
                username: logUname,
            });
            const enrichRows = enrichResult?.body?.result || enrichResult?.body || [];
            const enrichArr = Array.isArray(enrichRows) ? enrichRows : [];
            const enrichById = new Map();
            for (const r of enrichArr) {
                const id = String(r.chid || r.lcochid || r.channelid || "");
                if (id && wantedIds.has(id)) enrichById.set(id, r);
            }

            const merged = baseChannels.map(b => {
                const id = String(b.chid);
                const enrich = enrichById.get(id);
                if (!enrich) return b;
                // Prefer authoritative fields from pkgChannelsList
                // (price / type / logo for THIS package context),
                // overlay descriptive fields from channelsList.
                return {
                    ...enrich,
                    ...b,
                    language: b.language || enrich.language || '',
                    genres: b.genres || enrich.genres || '',
                    broadcaster: b.broadcaster || enrich.broadcaster || '',
                };
            });
            setDetailChannels(merged);
        } catch (enrichErr) {
            console.warn("Channel enrichment failed (showing basic info only):", enrichErr?.message);
        }
    }

    // Handle Checkout — collect selected packages/channels and fetch payment info
    async function refreshCableWalletBalance({ optimisticDebit = 0, showLoading = true } = {}) {
        const debitAmount = Number(optimisticDebit) || 0;
        const beforeRefreshAmount = parseWalletBalanceAmount(walletBalance);
        let expectedAmount = null;

        if (showLoading) {
            setWalletLoading(true);
            setWalletError("");
        }

        if (debitAmount > 0 && beforeRefreshAmount !== null) {
            expectedAmount = Math.max(0, beforeRefreshAmount - debitAmount);
            setWalletBalance((previous) => {
                const previousAmount = parseWalletBalanceAmount(previous);
                const baseAmount = previousAmount !== null ? previousAmount : beforeRefreshAmount;
                return withWalletBalanceAmount(previous, baseAmount - debitAmount);
            });
        }

        const applyFreshWallet = (data) => {
            if (data) {
                setWalletBalance(data);
                setWalletUsingCachedFallback(false);
                setWalletError("");
            }
            return parseWalletBalanceAmount(data);
        };

        try {
            const fresh = await getWalBal({ loginuname: logUname, servicekey: "cabletv" }, true);
            const freshAmount = applyFreshWallet(fresh);

            if (expectedAmount === null || freshAmount === null || freshAmount <= expectedAmount + 0.01) {
                return fresh;
            }

            for (const delay of [1200, 2500]) {
                await sleep(delay);
                const retry = await getWalBal({ loginuname: logUname, servicekey: "cabletv" }, true);
                const retryAmount = applyFreshWallet(retry);
                if (retryAmount === null || retryAmount <= expectedAmount + 0.01) {
                    return retry;
                }
            }

            return fresh;
        } catch (err) {
            const cached = lsGetStale(`walbal_${logUname}_cabletv`, 24 * 60 * 60 * 1000);
            if (cached?.data) {
                setWalletBalance(cached.data);
                setWalletUsingCachedFallback(true);
                setWalletError("Could not refresh wallet. Showing cached balance.");
                return cached.data;
            }
            setWalletError("Wallet balance unavailable. Pull down or reopen checkout to retry.");
            throw err;
        } finally {
            if (showLoading) setWalletLoading(false);
        }
    }

    function getOperatorShareFromPaymentBody(paymentBody = {}) {
        return parseFloat(
            paymentBody.oprtrshare ??
            paymentBody.optrshare ??
            paymentBody.amount_deductable ??
            paymentBody.amountdeductable ??
            paymentBody.final_split_data?.OPERATOR?.amount ??
            0
        ) || 0;
    }

    function subscriptionContainsSelection(subscriptionInfo, pkgIds = [], chIds = []) {
        const body = subscriptionInfo?.body || {};
        const toSet = (value) => new Set((Array.isArray(value) ? value : []).map(String));
        const packageSet = new Set([
            ...toSet(body.packageid),
            ...toSet(body.packageids),
            ...toSet(body.package_id),
            ...toSet(body.package_ids),
        ]);
        const channelSet = new Set([
            ...toSet(body.channelid),
            ...toSet(body.channelids),
            ...toSet(body.channel_id),
            ...toSet(body.channel_ids),
        ]);

        return (
            pkgIds.some((id) => packageSet.has(String(id))) ||
            chIds.some((id) => channelSet.has(String(id)))
        );
    }

    async function reconcileCablePaymentOutcome({ pkgIds, chIds, operatorShare, walletBeforePay }) {
        const [subscriptionResult, walletResult] = await Promise.allSettled([
            fofiBoxId
                ? getIptvLastSubscribedInfo({ userid, itemid: fofiBoxId }, true)
                : Promise.resolve(null),
            getWalBal({ loginuname: logUname, servicekey: "cabletv" }, true),
        ]);

        const freshSubscription = subscriptionResult.status === "fulfilled" ? subscriptionResult.value : null;
        const freshWallet = walletResult.status === "fulfilled" ? walletResult.value : null;
        if (freshSubscription) setLastSubscribedInfo(freshSubscription);
        if (freshWallet) setWalletBalance(freshWallet);

        const subscriptionConfirmed = subscriptionContainsSelection(freshSubscription, pkgIds, chIds);
        const walletAfterPay = parseWalletBalanceAmount(freshWallet);
        const expectedDebit = Number(operatorShare) || 0;
        const walletDeducted =
            walletBeforePay !== null &&
            walletAfterPay !== null &&
            walletAfterPay < walletBeforePay - 0.01 &&
            (expectedDebit <= 0 || walletBeforePay - walletAfterPay >= Math.min(expectedDebit, 1) - 0.01);

        return {
            accepted: subscriptionConfirmed || walletDeducted,
            subscriptionConfirmed,
            walletDeducted,
            freshSubscription,
        };
    }

    function completeCableOrderSuccess({
        result,
        freshTxnId,
        effectivePaidAmount,
        numericPaid,
        operatorShare,
        walletDebitConfirmed,
        skipOptimisticDebit = false,
        periodForPay,
        pkgIds,
        chIds,
        freshSubscription,
    }) {
        setSuccessOrder({
            orderId: result?.body?.orderid || result?.body?.order_id || result?.body?.id || "",
            txnId: freshTxnId || result?.body?.transactionid || result?.body?.txnid || "",
            paidAmount: parseFloat(effectivePaidAmount) || numericPaid,
            walletDebited: walletDebitConfirmed ? operatorShare : 0,
            period: periodForPay,
            packagesCount: pkgIds.length,
            channelsCount: chIds.length,
            customerName: customerData?.customer_name || customerData?.cust_name || customerData?.username || "",
            placedAt: new Date(),
        });

        try {
            lsRemove(`plandets_cabletv_${userid}_${fofiBoxId}`);
            lsRemove(`plandets_cabletv_${userid}_`);
            lsRemove(`plandets_fofi_${userid}_${fofiBoxId}`);
            lsRemove(`plandets_fofi_${userid}_`);
            lsRemove(`iptvLastSub_${userid}_${fofiBoxId}`);
            lsRemove(`uai_fofi_${userid}`);
            lsRemove(`uai_cabletv_${userid}`);
            lsRemove(`cblcust_${userid}`);
            lsRemove(`pricust_${userid}`);
            lsRemove(`walbal_${logUname}_cabletv`);
        } catch (_) { /* cache clear is best-effort */ }

        refreshCableWalletBalance({
            optimisticDebit: walletDebitConfirmed && !skipOptimisticDebit ? operatorShare : 0,
        }).catch(() => {});

        if (freshSubscription) {
            setLastSubscribedInfo(freshSubscription);
        } else if (fofiBoxId) {
            getIptvLastSubscribedInfo({ userid, itemid: fofiBoxId }, true)
                .then(d => { if (d) setLastSubscribedInfo(d); })
                .catch(() => {});
        }

        setSelectedPackages([]);
        setSelectedChannels([]);
        setRestoredCheckoutPackages([]);
        setAlacarteChannels([]);
        setPackageCategories([]);
        setPackagesByCategory({});
        setCheckoutPreview(null);
        try { sessionStorage.removeItem(CHECKOUT_SESSION_KEY); } catch (_) {}
    }

    async function handleCheckout() {
        const initialParts = buildCheckoutParts();

        if (initialParts.pkgIds.length === 0 && initialParts.chIds.length === 0) {
            toast.add("Please select at least one package or channel", { type: "warning" });
            return;
        }

        const cachedPreview = checkoutPreview?.key === initialParts.key ? checkoutPreview : null;
        setRestoredCheckoutPackages(initialParts.selectedPkgs);
        enterSubView('checkout');
        setCheckoutLoading(!cachedPreview?.paymentInfo);
        if (cachedPreview?.paymentInfo) {
            setFinalPaymentInfo(cachedPreview.paymentInfo);
            if (cachedPreview.period && selectedPeriod !== cachedPreview.period) {
                setSelectedPeriod(cachedPreview.period);
            }
        } else {
            setFinalPaymentInfo(null);
        }

        // Streamed checkout. Three independent network calls, only
        // ONE blocks the UI:
        //
        //   • paymentinfo/cabletv  ~2.0 s  ← gate; spinner drops the
        //                                    moment this settles
        //   • myWallet             ~1.2 s  ← background, .then()
        //   • planExtensionPeriods ~2.4 s  ← background, cached 60 min,
        //                                    re-prices silently if
        //                                    its first period differs
        //                                    from what we initially
        //                                    priced for
        //
        // try/finally guarantees the spinner drops on BOTH success
        // and failure of paymentinfo — earlier code only dropped it
        // inside `if (payResultEarly)`, leaving operators staring at
        // "Loading checkout details…" forever when the API errored.
        const paymentDetailsPromise = cachedPreview?.paymentInfo
            ? Promise.resolve(cachedPreview.paymentInfo)
            : requestCablePaymentDetails(initialParts);

        const walletPromise = refreshCableWalletBalance().catch(() => {});

        const customerRefreshPromise = Promise.allSettled([
            getCableCustomerDetails(userid, true).catch(() => null),
            getPrimaryCustomerDetails(userid, true).catch(() => null),
        ]).catch(() => {});

        const extensionPeriodsPromise = isExistingSubscriberCheckout
            ? Promise.resolve()
            : getPlanExtensionPeriods({ userid, servkey: "cabletv", itemid: fofiBoxId }).then(async (periodsResp) => {
                if (periodsResp?.status?.err_code !== 0) return;
                setDaysRange(getDaysRange(periodsResp));
                const periodsArr = getPeriodsArray(periodsResp);
                if (!periodsArr.length) return;
                setExtensionPeriods(periodsArr);
                const periodValues = periodsArr.map(getPeriodValue);
                const keepCurrent = periodValues.includes(selectedPeriod);
                const targetPeriod = keepCurrent ? selectedPeriod : periodValues[0];
                if (!targetPeriod) return;
                setSelectedPeriod(targetPeriod);
                if (targetPeriod === initialParts.period) return;
                const pricedParts = buildCheckoutParts(targetPeriod);
                const cachedHit = checkoutPreview?.key === pricedParts.key && checkoutPreview?.paymentInfo;
                const payResult = cachedHit
                    ? checkoutPreview.paymentInfo
                    : await requestCablePaymentDetails(pricedParts).catch(() => null);
                if (payResult) {
                    setFinalPaymentInfo(payResult);
                    setCheckoutPreview({ key: pricedParts.key, paymentInfo: payResult, period: pricedParts.period });
                }
            })
            .catch(err => console.warn("planExtensionPeriods failed:", err?.message));

        try {
            const payResultEarly = await paymentDetailsPromise;
            if (payResultEarly) {
                setFinalPaymentInfo(payResultEarly);
                setCheckoutPreview({ key: initialParts.key, paymentInfo: payResultEarly, period: initialParts.period });
            } else {
                toast.add("Could not load payment details. Please try again.", { type: "error" });
            }
        } catch (e) {
            console.warn("paymentinfo/cabletv failed:", e?.message);
            toast.add("Failed to load checkout details. Please try again.", { type: "error" });
        } finally {
            // Spinner drops here on every path — success, error,
            // empty response. Operator never sees a forever-spinner.
            setCheckoutLoading(false);
        }
        void walletPromise;
        void customerRefreshPromise;
        void extensionPeriodsPromise;
    }

    // Fetch final payment details after selecting extension period
    async function handleFetchFinalPayment(period) {
        const parts = buildCheckoutParts(period);
        if (manualCalcInFlightKeyRef.current === parts.key) return;

        setSelectedPeriod(period);
        manualCalcInFlightKeyRef.current = parts.key;
        try {
            const cachedPreview = checkoutPreview?.key === parts.key ? checkoutPreview : null;
            const result = cachedPreview?.paymentInfo || await requestCablePaymentDetails(parts);

            if (!checkoutAliveRef.current || manualCalcInFlightKeyRef.current !== parts.key) return;
            setFinalPaymentInfo(result);
            setCheckoutPreview({ key: parts.key, paymentInfo: result, period: parts.period });
            lastManualCalcToastRef.current = { key: "", ts: 0 };
        } catch (err) {
            console.error("Error fetching final payment:", err);
            if (!checkoutAliveRef.current || manualCalcInFlightKeyRef.current !== parts.key) return;
            const now = Date.now();
            const lastToast = lastManualCalcToastRef.current;
            if (lastToast.key !== parts.key || now - lastToast.ts > 5000) {
                toast.add("Failed to calculate payment. Please try again.", { type: "error" });
                lastManualCalcToastRef.current = { key: parts.key, ts: now };
            }
        } finally {
            if (manualCalcInFlightKeyRef.current === parts.key) {
                manualCalcInFlightKeyRef.current = "";
            }
        }
    }

    // Proceed to Pay — generate order via cabletv/generateorder
    async function handleProceedToPay() {
        // Hard guard: backend's generateorder rejects empty
        // cblextenperiod with "Please choose some days". Default
        // state is "30" but defend against the user manually
        // clearing the custom input then tapping Pay.
        const periodForPay = String(effectiveCheckoutPeriod || selectedPeriod || "").trim() || "30";
        const { pkgIds, pkgCodes, chIds } = buildCheckoutParts(periodForPay);

        // Get paid amount and transaction ID from service/paymentinfo/cabletv response
        const initialPaymentBody = finalPaymentInfo?.body || {};
        const initialPaidAmount = initialPaymentBody.total_amt || initialPaymentBody.paidamount || initialPaymentBody.grandtotal || "0";
        const txnId = initialPaymentBody.transactionid || initialPaymentBody.txnid || "";

        // Short-circuit when there's nothing to charge (e.g. an
        // operator picked only FTA channels). Calling the backend
        // with paidamount=0 returns "Wallet failed due to some
        // problem" — a confusing message that operators reported.
        // The friendly message tells them why the action didn't
        // proceed so they can pick a paid package or just close.
        const numericPaid = parseFloat(initialPaidAmount) || 0;
        if (numericPaid <= 0) {
            toast.add("No Amount To Pay!", { type: "info" });
            return;
        }

        if (payInFlightRef.current || payLoading) {
            return;
        }
        payInFlightRef.current = true;
        setPayLoading(true);
        const walletBeforePay = parseWalletBalanceAmount(walletBalance);
        let effectivePaymentInfo = finalPaymentInfo;
        let effectivePaymentBody = initialPaymentBody;
        let effectivePaidAmount = initialPaidAmount;
        let freshTxnId = txnId;
        let operatorShare = 0;
        try {
            // STEP 0 — Refresh paymentinfo/cabletv for a FRESH transactionid.
            // The cached transaction ID from initial load may be expired or
            // invalidated by backend. This is cheap insurance against
            // "Invalid transaction id" errors (same pattern as FofiPayment.jsx).
            try {
                const freshPaymentInfo = await requestCablePaymentDetails({
                    period: periodForPay,
                    chIds,
                    pkgIds,
                    pkgCodes,
                });
                if (freshPaymentInfo?.body?.transactionid) {
                    effectivePaymentInfo = freshPaymentInfo;
                    effectivePaymentBody = freshPaymentInfo.body || {};
                    effectivePaidAmount = effectivePaymentBody.total_amt || effectivePaymentBody.paidamount || effectivePaymentBody.grandtotal || effectivePaidAmount;
                    freshTxnId = freshPaymentInfo.body.transactionid;
                    setFinalPaymentInfo(freshPaymentInfo);
                    console.log('✅ [IPTV] Fresh transactionid received:', freshTxnId, '(was:', txnId, ')');
                }
            } catch (refreshErr) {
                console.warn('⚠️ [IPTV] Could not refresh payment info, using cached txnId:', refreshErr?.message);
                // Continue with cached txnId - generateorder might still accept it
            }
            operatorShare = getOperatorShareFromPaymentBody(effectivePaymentBody || effectivePaymentInfo?.body || {});

            // generateorder must reflect the same selection that the
            // paymentinfo/cabletv call priced — sending [] for
            // channelid/lcochid here while the price was computed for
            // alacarte channels causes the backend to register the
            // order against an empty selection (operator pays but
            // channels never go live).
            const result = await generateCableTvOrder({
                bankname: "",
                banktxnid: "",
                cblextenperiod: periodForPay,
                channelid: chIds,
                fofiboxid: fofiBoxId,
                gateway: "",
                gatewaytxnid: "",
                lcochid: chIds,
                orderedbytype: "crmapp",
                packageid: pkgIds,
                paidamount: String(effectivePaidAmount),
                paymentmode: "offline",
                payresponse: "",
                pkgcode: pkgCodes,
                planid: "",
                priceid: "",
                servid: "1",
                transactionid: freshTxnId,
                txnstatus: "success",
                userid,
                username: logUname,
                voipnumber: "",
            });

            if (result?.status?.err_code === 0) {
                // STEP 2 — Debit the operator wallet via savePaymentApi.
                //
                // cabletv/generateorder REGISTERS the order on the
                // backend but does NOT move money out of the operator
                // wallet (verified live: same bug FoFi had). Without
                // this second call the operator sees "Order placed
                // successfully" but their wallet balance never
                // decreases — the user-reported "wallet amount not
                // reflected" issue.
                //
                // The amount to debit is the operator share
                // (`oprtrshare` in the paymentinfo/cabletv response,
                // or equivalently `final_split_data.OPERATOR.amount`),
                // NOT the total bill. Verified live for cgreen2 with
                // Custom Package: total ₹24.78, oprtrshare ₹4.96 —
                // only ₹4.96 should leave the operator's wallet.
                //
                // Wrapped in try/catch so a wallet-debit failure
                // doesn't roll back the order (it's already registered
                // server-side; re-running just the debit is safer than
                // attempting to undo a successful generateorder).
                let walletDebitConfirmed = false;

                if (operatorShare > 0) {
                    try {
                        const opUser = getUser();
                        const apiopid = customerData?.op_id || opUser?.op_id || "";
                        const loginuname = opUser?.username || "superadmin";
                        const payNowPayload = {
                            apiopid,
                            apiuserid: userid,
                            applicationname: import.meta.env.VITE_API_APP_KEY_TYPE || "crmapp",
                            paymode: "cash",
                            noofmonth: Math.max(1, Math.round(parseInt(periodForPay, 10) / 30)),
                            cashpaid: operatorShare,
                            transstatus: "success",
                            renewstatus: "success",
                            usagecompleted: 0,
                            services_app: 1, // 1 = cable TV (FoFi uses 3, internet uses 1)
                            paydoneby: loginuname,
                            payreceivedby: loginuname,
                            receivedremark: "cash",
                        };
                        console.log("🔴 [STEP 2] cable TV savePaymentApi — debiting wallet by", operatorShare, payNowPayload);
                        const payNowResp = await payNow(payNowPayload);
                        const debitOk =
                            payNowResp?.error === 0 ||
                            payNowResp?.status?.err_code === 0 ||
                            !!(payNowResp?.receipt_link || payNowResp?.invoice_link || payNowResp?.body?.receipt_link || payNowResp?.body?.invoice_link);
                        if (!debitOk) {
                            console.warn("⚠️ [STEP 2] Wallet debit reported failure:", payNowResp?.result || payNowResp?.status?.err_msg);
                        } else {
                            walletDebitConfirmed = true;
                            console.log("✅ [STEP 2] Wallet debited:", operatorShare);
                        }
                    } catch (debitErr) {
                        console.error("❌ [STEP 2] savePaymentApi error (wallet may not have debited):", debitErr);
                    }
                } else {
                    console.log("ℹ️ [STEP 2] Wallet debit skipped — operator share ≤ 0 (likely FTA-only / free package)");
                }

                // Snapshot the order details NOW — popToOverview()
                // and the setSelectedPackages([])/setSelectedChannels([])
                // calls below clear this state, so the modal would
                // render empty if we read these refs at render time.
                completeCableOrderSuccess({
                    result,
                    freshTxnId,
                    effectivePaidAmount,
                    numericPaid,
                    operatorShare,
                    walletDebitConfirmed,
                    periodForPay,
                    pkgIds,
                    chIds,
                });

                // Invalidate every localStorage cache that holds
                // data the order just changed. Without this the
                // overview shows the OLD plan / OLD subscription
                // state for up to 5-10 minutes (cache TTLs), even
                // though the backend has already accepted the order.
                // Operators reported "the package isn't showing as
                // subscribed after I bought it" — that's this gap.
                

                // Refetch subscription state so the next view of
                // the packages / channels grids correctly shows the
                // new "Subscribed" flags. Fire-and-forget — popToOverview
                // doesn't need to wait for it; the safety-net useEffect
                // on view change will pick up the fresh value.
                

                // Reset and go back to overview. Also clear alacarte
                // channel state so the next visit doesn't carry over
                // the just-purchased selection into a fresh checkout.
                
                // NOTE: popToOverview() is NOT called here — we show the
                // success modal on the checkout page first. The modal's
                // OK button will handle navigation back to overview.
            } else {
                const reconciliation = await reconcileCablePaymentOutcome({
                    pkgIds,
                    chIds,
                    operatorShare,
                    walletBeforePay,
                });
                if (reconciliation.accepted) {
                    console.warn("IPTV generateorder reported failure, but refreshed backend state confirms acceptance", {
                        errCode: result?.status?.err_code,
                        errMsg: result?.status?.err_msg,
                        subscriptionConfirmed: reconciliation.subscriptionConfirmed,
                        walletDeducted: reconciliation.walletDeducted,
                    });
                    completeCableOrderSuccess({
                        result,
                        freshTxnId,
                        effectivePaidAmount,
                        numericPaid,
                        operatorShare,
                        walletDebitConfirmed: reconciliation.walletDeducted,
                        skipOptimisticDebit: true,
                        periodForPay,
                        pkgIds,
                        chIds,
                        freshSubscription: reconciliation.freshSubscription,
                    });
                    return;
                }

                // Translate the backend's confusing "Wallet failed
                // due to some problem" message to a friendlier one
                // when it almost certainly means "amount was 0".
                const rawMsg = result?.status?.err_msg || "";
                const isZeroAmountMisreport =
                    /wallet\s+failed\s+due\s+to\s+some\s+problem/i.test(rawMsg) &&
                    numericPaid <= 0;
                toast.add(
                    isZeroAmountMisreport ? "No Amount To Pay!" : (rawMsg || "Failed to place order. Please try again."),
                    { type: isZeroAmountMisreport ? "info" : "error" }
                );
            }
        } catch (err) {
            console.error("Error generating order:", err);
            const reconciliation = await reconcileCablePaymentOutcome({
                pkgIds,
                chIds,
                operatorShare,
                walletBeforePay,
            }).catch((reconcileErr) => {
                console.warn("Unable to reconcile failed IPTV payment outcome:", reconcileErr?.message);
                return null;
            });
            if (reconciliation?.accepted) {
                console.warn("IPTV payment call failed locally, but refreshed backend state confirms acceptance", {
                    subscriptionConfirmed: reconciliation.subscriptionConfirmed,
                    walletDeducted: reconciliation.walletDeducted,
                });
                completeCableOrderSuccess({
                    result: null,
                    freshTxnId,
                    effectivePaidAmount,
                    numericPaid,
                    operatorShare,
                    walletDebitConfirmed: reconciliation.walletDeducted,
                    skipOptimisticDebit: true,
                    periodForPay,
                    pkgIds,
                    chIds,
                    freshSubscription: reconciliation.freshSubscription,
                });
                return;
            }
            toast.add("Failed to place order. Please try again.", { type: "error" });
        } finally {
            payInFlightRef.current = false;
            setPayLoading(false);
        }
    }

    const handleSelectPackages = () => {
        // Reset selections from previous visit
        setSelectedPackages([]);
        setRestoredCheckoutPackages([]);
        setDetailPkg(null);
        setDetailChannels([]);
        setPackagesSearchTerm('');
        setPackagesSearchByCategory({});
        enterSubView('packages');
        loadPackages();
    };

    const handleSelectChannels = () => {
        // Reset selections and load alacarte channels
        setSelectedChannels([]);
        setRestoredCheckoutPackages([]);
        setPackagesSearchTerm('');
        enterSubView('channels');
        loadAlacarteChannels();
    };

    // Load alacarte channels for "Select Channels" view.
    //
    // channelsList with alacarte:"yes" returns every available channel,
    // but verified against the live API: it does NOT populate
    // issubscribed:"yes" on the rows. The only authoritative source for
    // which channels the customer is subscribed to is
    // iptvLastSubscribedinfo.body.channelid — same situation as
    // packages, so we follow the same pattern: fetch lastSubscribedInfo
    // here if state hasn't received it yet (operator landed on this
    // view via popstate / fast click before the overview's mount-time
    // fetch resolved). Without this the green "Subscribed" ribbon was
    // missing on all channels for users who hit the channels view too
    // quickly.
    async function loadAlacarteChannels() {
        if (alacarteChannels.length > 0) { setChannelsLoading(false); return; }
        setChannelsLoading(true);
        try {
            const needLastSub = !lastSubscribedInfo?.body && !!fofiBoxId;
            const [chResult, lastSubResult] = await Promise.allSettled([
                getChannelsList({
                    channelid: [],
                    userid,
                    username: logUname,
                    alacarte: "yes",
                }),
                needLastSub
                    ? getIptvLastSubscribedInfo({ userid, itemid: fofiBoxId })
                    : Promise.resolve(lastSubscribedInfo),
            ]);

            const result = chResult.status === "fulfilled" ? chResult.value : null;
            let channels = result?.body?.result || result?.body || [];
            if (!Array.isArray(channels)) channels = [];

            const lastSubFresh = lastSubResult.status === "fulfilled" ? lastSubResult.value : null;
            if (lastSubFresh && lastSubFresh !== lastSubscribedInfo) {
                setLastSubscribedInfo(lastSubFresh);
            }

            console.log('🟣 [Channels] loaded', channels.length, 'channels; subscribed channel IDs:',
                ((lastSubFresh || lastSubscribedInfo)?.body?.channelid || []).length);
            setAlacarteChannels(channels);
        } catch (err) {
            console.error('Error loading alacarte channels:', err);
        }
        setChannelsLoading(false);
    }

    // CRITICAL TOP-LEVEL GUARD — must run BEFORE any view-specific
    useEffect(() => {
        if (!["channels", "checkout"].includes(view) || !userid || !fofiBoxId) return;
        const parts = buildCheckoutParts();
        if (parts.pkgIds.length === 0 && parts.chIds.length === 0) {
            setCheckoutPreview(null);
            return;
        }
        if (checkoutPreview?.key === parts.key && checkoutPreview?.paymentInfo) return;

        const seq = checkoutPreviewSeqRef.current + 1;
        checkoutPreviewSeqRef.current = seq;
        const timer = setTimeout(() => {
            const pkgCodesForInfo = parts.pkgCodes.length > 0 ? parts.pkgCodes : parts.pkgIds;
            getPaymentInfo({
                channelid: parts.chIds,
                lcochid: parts.chIds,
                packageid: parts.pkgIds,
                pkgcode: pkgCodesForInfo,
                servapptype: "crmapp",
                servid: "1",
                userid,
                username: logUname,
            }).catch(() => {});

            requestCablePaymentDetails(parts)
                .then((paymentInfo) => {
                    if (!checkoutAliveRef.current || checkoutPreviewSeqRef.current !== seq) return;
                    setCheckoutPreview({ key: parts.key, paymentInfo, period: parts.period });
                    if (view === "checkout") {
                        setFinalPaymentInfo(paymentInfo);
                    }
                })
                .catch(() => {});
        }, 120);

        return () => {
            clearTimeout(timer);
            if (checkoutPreviewSeqRef.current === seq) {
                checkoutPreviewSeqRef.current += 1;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, selectedPackages, selectedChannels, packagesByCategory, selectedPeriod, userid, fofiBoxId, effectiveCheckoutPeriod]);

    // ── Success Modal Component ──
    const SuccessOrderModal = () => {
        if (!successOrder) return null;
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] px-4" onClick={() => setSuccessOrder(null)}>
                <div
                    className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="bg-gradient-to-br from-emerald-500 to-green-600 px-6 pt-7 pb-6 flex flex-col items-center">
                        <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center ring-4 ring-white/30">
                            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h3 className="mt-3 text-lg font-bold text-white">Order Placed Successfully!</h3>
                        <p className="text-white/90 text-xs mt-1">Cable TV subscription confirmed</p>
                    </div>

                    <div className="px-6 py-5 space-y-3">
                        {successOrder.customerName && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Customer</span>
                                <span className="font-medium text-gray-800 truncate ml-2">{successOrder.customerName}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Amount Paid</span>
                            <span className="font-bold text-emerald-600">₹ {Number(successOrder.paidAmount).toFixed(2)}</span>
                        </div>
                        {successOrder.walletDebited > 0 && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Wallet Debited</span>
                                <span className="font-semibold text-indigo-600">₹ {Number(successOrder.walletDebited).toFixed(2)}</span>
                            </div>
                        )}
                        {(successOrder.packagesCount > 0 || successOrder.channelsCount > 0) && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Selection</span>
                                <span className="font-medium text-gray-800">
                                    {successOrder.packagesCount > 0 && `${successOrder.packagesCount} pkg${successOrder.packagesCount > 1 ? 's' : ''}`}
                                    {successOrder.packagesCount > 0 && successOrder.channelsCount > 0 && ' · '}
                                    {successOrder.channelsCount > 0 && `${successOrder.channelsCount} ch`}
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Period</span>
                            <span className="font-medium text-gray-800">{successOrder.period} days</span>
                        </div>
                        {successOrder.orderId && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Order ID</span>
                                <span className="font-mono text-xs text-gray-700 truncate ml-2">{successOrder.orderId}</span>
                            </div>
                        )}
                    </div>

                    <div className="px-6 pb-5">
                        <button
                            onClick={() => {
                                setSuccessOrder(null);
                                popToOverview();
                            }}
                            className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold py-3 rounded-lg shadow-md transition-all"
                        >
                            OK
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // CRITICAL TOP-LEVEL GUARD: must run before any view-specific render.

    // Sub-views (checkout / packages / channels) read
    // customerData.name without optional-chaining; if state is
    // missing for any reason (popstate landed on a stripped entry,
    // PWA restored after tab kill, deep-link refresh) those reads
    // crash the React tree and the operator gets the
    // "Something went wrong / Cannot read properties of undefined
    // (reading 'name')" error boundary. Showing the friendly
    // empty-state here is the recovery path.
    if (!customerData) {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                </header>
                <div className="flex-1 px-3 py-4">
                    <div className="text-center text-gray-500 py-10">
                        No customer data available. Please select a customer from the customer list.
                    </div>
                </div>
                <BottomNav />
            </div>
        );
    }

    // ── Checkout View ──
    if (view === 'checkout') {
        const walBal = formatWalletBalance(walletBalance);
        const hasWalletAmount = parseWalletBalanceAmount(walletBalance) !== null;
        const walletLabel = walletLoading && !hasWalletAmount
            ? "Loading..."
            : hasWalletAmount
                ? `₹ ${walBal}`
                : "Unavailable";
        const walletHelper = walletLoading && hasWalletAmount
            ? "Refreshing..."
            : walletError || (walletUsingCachedFallback ? "Showing cached balance" : "");
        const pay = finalPaymentInfo?.body || {};
        const contents = Array.isArray(pay.contents) ? pay.contents : [];
        const displayContents = contents.filter((c) => !/^\s*Channels\s*:/i.test(String(c?.title || '')));
        const taxDetails = Array.isArray(pay.tax_details) ? pay.tax_details : [];

        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <SuccessOrderModal />
                {/* Header */}

                <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-4" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <div className="flex items-center gap-3 mb-3">
                        {/* Pop the checkout entry — both this in-app
                            chevron and the phone hardware back end up
                            in the same popstate handler, keeping
                            history and view in sync. */}
                        <button onClick={() => window.history.back()} className="p-1">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                        </button>
                        <h1 className="text-lg font-medium">Checkout</h1>
                    </div>
                    <div className="bg-white/10 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                            <span className="text-white/80 text-sm block">Wallet Balance</span>
                            {walletHelper && (
                                <span className="text-white/70 text-[11px] leading-tight block mt-0.5">{walletHelper}</span>
                            )}
                        </div>
                        <span className="text-white font-bold text-lg text-right">{walletLabel}</span>
                    </div>
                    <div className="bg-white/10 rounded-lg px-4 py-2 mt-2 flex items-center justify-between">
                        <span className="text-white/80 text-sm">Operator Share</span>
                        <span className="text-white font-bold text-lg">₹ {Number(pay.oprtrshare || pay.optrshare || pay.operator_share || pay.oprtr_share || 0).toFixed(2)}</span>
                    </div>
                </div>

                <div className="flex-1 px-4 py-4 space-y-4 pb-28 overflow-y-auto">
                    {checkoutLoading ? (
                        <Loader text="Loading checkout details..." />
                    ) : (
                        <>
                            {/* Selected Packages */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                    <h3 className="text-indigo-600 font-semibold text-sm">Selected Packages</h3>
                                </div>
                                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                                    {(Object.values(packagesByCategory).flat().length > 0
                                        ? Object.values(packagesByCategory).flat()
                                        : restoredCheckoutPackages
                                    )
                                        .filter(pkg => selectedPackages.includes(getPackageId(pkg)) && !isPackageSubscribed(pkg))
                                        .map((pkg, i) => (
                                            <div key={pkg.pkgid || i} className="flex items-center justify-between px-4 py-3 text-sm">
                                                <span className="text-gray-700 dark:text-gray-300">{pkg.pkgname || pkg.packagename}</span>
                                                <span className="font-medium text-gray-800 dark:text-gray-100">₹ {Number(pkg.pkgprice || 0).toFixed(2)}</span>
                                            </div>
                                        ))
                                    }
                                </div>
                            </div>

                            {/* Price Breakdown from service/paymentinfo/cabletv */}
                            {pay.total_amt !== undefined && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                        <h3 className="text-indigo-600 font-semibold text-sm">Price Summary</h3>
                                    </div>
                                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2 text-sm">
                                        {/* Content breakdown */}
                                        {displayContents.map((c, i) => (
                                            <div key={i} className="flex justify-between">
                                                <span className="text-gray-500 dark:text-gray-400">{c.title} ({c.quantity})</span>
                                                <span className="text-gray-800 dark:text-gray-100">₹ {Number(c.price || 0).toFixed(2)}</span>
                                            </div>
                                        ))}

                                        {/* NCF */}
                                        {pay.ncf_display === "yes" && (
                                            <div className="flex justify-between">
                                                <span className="text-gray-500 dark:text-gray-400">NCF</span>
                                                <span className="text-gray-800 dark:text-gray-100">₹ {Number(pay.ncf || 0).toFixed(2)}</span>
                                            </div>
                                        )}

                                        {/* Tax details */}
                                        {taxDetails.map((t, i) => (
                                            <div key={i} className="flex justify-between text-gray-500 dark:text-gray-400">
                                                <span>{t.title} ({t.percent})</span>
                                                <span>₹ {Number(t.amt || 0).toFixed(2)}</span>
                                            </div>
                                        ))}

                                        {/* Discount */}
                                        {pay.discount_amt > 0 && (
                                            <div className="flex justify-between text-green-600">
                                                <span>{pay.discount_lbl || 'Discount'}</span>
                                                <span>- ₹ {Number(pay.discount_amt).toFixed(2)}</span>
                                            </div>
                                        )}

                                        {/* Grand Total */}
                                        <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
                                            <span className="text-gray-800 dark:text-gray-100 font-bold">Total Amount</span>
                                            <span className="font-bold text-indigo-600 dark:text-indigo-400 text-base">₹ {Number(pay.total_amt || 0).toFixed(2)}</span>
                                        </div>

                                    </div>
                                </div>
                            )}

                            {/* No of subscription days — shows the period
                                from API payment info so operator can verify
                                before paying. */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                    <h3 className="text-indigo-600 font-semibold text-sm">No of subscription days</h3>
                                </div>
                                {isExistingSubscriberCheckout ? (
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="px-3 py-2.5 rounded-lg text-xs font-semibold border bg-indigo-600 text-white border-indigo-600 shadow-sm text-center">
                                            {remainingSubscriptionDays} Days
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2">
                                        {(extensionPeriods.length > 0
                                            ? extensionPeriods
                                            : [{period:30,label:"30 Days"},{period:90,label:"90 Days"},{period:180,label:"180 Days"},{period:365,label:"365 Days"}]
                                        ).map((period, i) => {
                                            const periodVal = getPeriodValue(period);
                                            const periodLabel = period?.label || period?.name || period?.title || `${periodVal} days`;
                                            const isSelected = String(selectedPeriod) === String(periodVal);
                                            return (
                                                <button
                                                    key={`${periodVal}-${i}`}
                                                    onClick={() => { setCustomDaysInput(""); handleFetchFinalPayment(periodVal); }}
                                                    className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                                                        isSelected
                                                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'
                                                    }`}
                                                >
                                                    {periodLabel}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Pay Button */}
                <div className="fixed bottom-16 left-0 right-0 p-3 bg-white border-t">
                    <button
                        onClick={handleProceedToPay}
                        disabled={checkoutLoading || payLoading || !finalPaymentInfo?.body?.transactionid}
                        className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-3 rounded-lg text-sm shadow-md hover:shadow-lg transition-shadow duration-200 disabled:opacity-50"
                    >
                        {payLoading ? 'Processing...' : `Pay ₹ ${Number(pay.total_amt || 0).toFixed(2)}`}
                    </button>
                </div>

                <BottomNav />
            </div>
        );
    }

    // ── Alacarte Channels View ──
    if (view === 'channels') {
        // Subscribed channel IDs come from iptvLastSubscribedinfo
        // (loaded during overview fetch). We use them to render the
        // "Subscribed" green ribbon on already-subscribed channels —
        // matches the native CRM's grid view exactly.
        const subscribedChannelIds = new Set(
            (lastSubscribedInfo?.body?.channelid || []).map(String)
        );

        const isChannelSubscribed = (ch, idx) => {
            const chId = getChannelId(ch, String(idx));
            return subscribedChannelIds.has(String(chId)) || ch.issubscribed === 'yes' || ch.issubscribed === true;
        };

        const searchedChannels = packagesSearchTerm
            ? alacarteChannels.filter(ch => {
                const name = (ch.chtitle || ch.chnlname || ch.channelname || ch.name || ch.title || '').toLowerCase();
                return name.includes(packagesSearchTerm.toLowerCase());
            })
            : alacarteChannels;

        // Subscribed channels float to the top, unsubscribed sink to the
        // bottom. Stable sort preserves the API's original order within
        // each group.
        const filteredChannels = searchedChannels
            .map((ch, idx) => ({ ch, idx, sub: isChannelSubscribed(ch, idx) }))
            .sort((a, b) => (a.sub === b.sub ? 0 : a.sub ? -1 : 1))
            .map(x => x.ch);

        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <SuccessOrderModal />
                {/* Teal/Indigo header — matches native screenshot */}

                <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <div className="flex items-center gap-3 mb-4">
                        <button onClick={() => { setPackagesSearchTerm(''); window.history.back(); }} className="p-1">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                        </button>
                        <h1 className="text-lg font-medium">Customer OverView</h1>
                    </div>

                    {/* User info card */}
                    <div className="bg-indigo-500/40 rounded-lg p-3 flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-white rounded flex items-center justify-center flex-shrink-0">
                            <svg className="w-7 h-7 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
                            </svg>
                        </div>
                        <div className="text-white text-sm space-y-0.5">
                            <div className="flex gap-2"><span className="font-medium">Name</span><span>: {customerData.name}</span></div>
                            <div className="flex gap-2"><span className="font-medium">User Id</span><span>: {formatCustomerId(customerData.customer_id)}</span></div>
                        </div>
                    </div>

                    {/* "Create Own Package" sub-header — matches reference */}
                    <div className="border-t border-white/30 pt-2 text-center text-sm font-medium">
                        Create Own Package
                    </div>
                </div>

                {/* Search bar */}
                <div className="px-4 py-3 bg-white dark:bg-gray-800">
                    <div className="relative">
                        <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search.."
                            value={packagesSearchTerm}
                            onChange={(e) => setPackagesSearchTerm(e.target.value)}
                            className="w-full bg-white text-gray-800 border border-gray-300 rounded-md pl-10 pr-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>
                </div>

                {/* Channel grid (3 columns) */}
                <div className="flex-1 px-3 pt-2 pb-36 overflow-y-auto bg-white dark:bg-gray-900">
                    {channelsLoading ? (
                        <div className="flex items-center justify-center py-10">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
                            <span className="ml-3 text-gray-500 text-sm">Loading channels...</span>
                        </div>
                    ) : filteredChannels.length === 0 ? (
                        <div className="text-center text-gray-500 py-10">
                            {packagesSearchTerm ? 'No channels match your search' : 'No channels available'}
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            {filteredChannels.map((ch, idx) => {
                                const chId = getChannelId(ch, String(idx));
                                const chName = ch.chtitle || ch.chnlname || ch.channelname || ch.name || ch.title || `Channel ${idx + 1}`;
                                const chPrice = ch.chmrp || ch.agentprice || ch.chnlprice || ch.price || ch.channelprice || ch.rate || 0;
                                const chLogo = ch.chlogo || ch.logourl || ch.logo || ch.image || '';
                                const hasLogo = chLogo && !chLogo.includes('chnlnoimage');
                                // Subscribed if iptvLastSubscribedinfo says so OR if the
                                // channel's own row carries the flag. The IDs from
                                // iptvLastSubscribedinfo cover both alacarte
                                // subscriptions AND channels coming bundled with a
                                // subscribed package (verified live for testatvu1:
                                // 1 subscribed package → 113 subscribed channel IDs),
                                // which is what makes channels under a subscribed
                                // package show the green flag here.
                                const isSubscribed = subscribedChannelIds.has(String(chId)) || ch.issubscribed === 'yes' || ch.issubscribed === true;
                                const isSelected = selectedChannels.includes(chId);
                                // Display label like the native UI: "&TV-575".
                                const displayName = `${chName}-${chId}`;

                                return (
                                    <button
                                        key={chId}
                                        type="button"
                                        onClick={() => {
                                            // Subscribed channels can't be re-toggled
                                            if (isSubscribed) return;
                                            if (isSelected) {
                                                setSelectedChannels(prev => prev.filter(id => id !== chId));
                                            } else {
                                                setSelectedChannels(prev => prev.includes(chId) ? prev : [...prev, chId]);
                                            }
                                        }}
                                        className={`bg-gray-50 dark:bg-gray-800 rounded-lg overflow-hidden border ${isSelected ? 'border-indigo-600 ring-2 ring-indigo-300' : 'border-gray-200 dark:border-gray-700'} ${isSubscribed ? 'cursor-default' : 'cursor-pointer hover:border-indigo-400'} text-left min-h-[152px]`}
                                    >
                                        {/* Logo / placeholder */}
                                        <div className="relative aspect-square w-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden p-1.5">
                                            {hasLogo ? (
                                                <img
                                                    src={proxyImageUrl(chLogo)}
                                                    alt={chName}
                                                    className="w-full h-full object-contain"
                                                    loading="lazy"
                                                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                />
                                            ) : null}
                                            <div className={`flex-col items-center justify-center text-gray-400 text-[10px] ${hasLogo ? 'hidden' : 'flex'}`}>
                                                <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                                NO IMAGE<br/>FOUND
                                            </div>
                                        </div>

                                        {/* Status flag — subscribed/selected only.
                                            Native UI shows a green flag with a chevron
                                            tail for "Subscribed" (anchored bottom-left
                                            of the logo area, no full-width band) and
                                            nothing for available channels. Selected
                                            uses the same shape in indigo so the
                                            selection state reads at a glance. */}
                                        {isSubscribed ? (
                                            <div className="mt-1 ml-1 inline-flex items-stretch">
                                                <span className="bg-green-500 text-white text-[10px] font-semibold px-2 py-0.5 leading-none flex items-center">
                                                    Subscribed
                                                </span>
                                                <span aria-hidden="true" className="w-0 h-0 border-y-[10px] border-y-transparent border-l-[8px] border-l-green-500" />
                                            </div>
                                        ) : isSelected ? (
                                            <div className="mt-1 ml-1 inline-flex items-stretch">
                                                <span className="bg-indigo-600 text-white text-[10px] font-semibold px-2 py-0.5 leading-none flex items-center">
                                                    Selected
                                                </span>
                                                <span aria-hidden="true" className="w-0 h-0 border-y-[10px] border-y-transparent border-l-[8px] border-l-indigo-600" />
                                            </div>
                                        ) : null}

                                        {/* Name + price */}
                                        <div className="p-2 text-center">
                                            <p className="text-[11px] text-gray-700 dark:text-gray-200 truncate font-medium" title={displayName}>{displayName}</p>
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{(parseFloat(chPrice) || 0).toFixed(2)}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer — Packages(N) / Channels(N) summary + Checkout */}
                <div className="fixed bottom-16 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg z-30 px-3 pt-3 pb-3 space-y-2">
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setPackagesSearchTerm('');
                                enterSubView('packages');
                                loadPackages();
                            }}
                            className="flex-1 border border-indigo-500 text-indigo-600 dark:text-indigo-400 text-sm font-medium py-2 rounded-md text-center"
                        >
                            Packages({selectedPackages.length})
                        </button>
                        <div className="flex-1 border border-orange-400 text-orange-500 text-sm font-medium py-2 rounded-md text-center">
                            Channels({selectedChannels.length})
                        </div>
                    </div>
                    <button
                        onClick={handleCheckout}
                        disabled={selectedPackages.length === 0 && selectedChannels.length === 0}
                        className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:from-gray-300 disabled:to-gray-400 text-white font-semibold py-3 rounded-lg text-sm shadow-md disabled:cursor-not-allowed"
                    >
                        Checkout
                    </button>
                </div>
                <BottomNav />
            </div>
        );
    }

    // ── Packages View ──
    if (view === 'packages') {
        const tabNames = (Array.isArray(packageCategories) ? packageCategories : [])
            .map(cat => (cat && typeof cat === 'object') ? (cat.name || cat.title || cat.category || '') : String(cat || ''));
        const rawPackages = packagesByCategory[activeTab];
        const currentPackages = Array.isArray(rawPackages) ? rawPackages : [];

        // Per-category search term — each tab keeps its own search
        // string in packagesSearchByCategory keyed by activeTab. When
        // the user switches tabs, the active search swaps to that
        // tab's saved value (or empty if they never typed anything
        // in that tab). Typing only updates the entry for the
        // current tab.
        const activeSearch = packagesSearchByCategory[activeTab] || '';

        // Filter packages by search term.
        //
        // Bug fix: the previous filter looked at `pkg.name ||
        // pkg.packagename || pkg.title` — but the live packagesList
        // API never sets any of those. The actual field is `pkgname`
        // (verified against the staging response). The display logic
        // below correctly uses `pkgname` first; only the search
        // filter was missing it, so the .includes() check was
        // always testing against an empty string and every package
        // was filtered out as soon as anything was typed.
        const validPackages = currentPackages.filter(pkg => pkg && typeof pkg === 'object');
        const filteredPackages = activeSearch
            ? validPackages.filter(pkg => {
                const q = activeSearch.toLowerCase();
                const name = String(pkg.pkgname || pkg.packagename || pkg.name || pkg.title || '').toLowerCase();
                // Include the display suffix `(channelCount)` so a
                // user searching "30" matches "New LCO Pack(30)" —
                // matches what they actually see on screen.
                const channelCount = String(pkg.totchnls || '');
                const haystack = channelCount ? `${name}(${channelCount})` : name;
                return haystack.includes(q);
            })
            : validPackages;

        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <SuccessOrderModal />
                {/* Blue Gradient Header */}

                <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <div className="flex items-center gap-3 mb-4">
                        {/* In-app chevron pops the packages-view entry;
                            popstate handler restores 'overview' (or
                            stays on overview if user came from there
                            and pushed only one level). */}
                        <button onClick={() => { setPackagesSearchTerm(''); setPackagesSearchByCategory({}); setDetailPkg(null); window.history.back(); }} className="p-1">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                        </button>
                        <h1 className="text-lg font-medium">Customer OverView</h1>
                    </div>

                    {/* User Info Card */}
                    <div className="bg-indigo-500 rounded-lg p-3 flex items-center gap-3">
                        <div className="w-14 h-14 bg-white rounded flex items-center justify-center flex-shrink-0">
                            <svg className="w-8 h-8 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
                                <rect x="5" y="7" width="14" height="2" />
                                <rect x="5" y="10" width="14" height="2" />
                            </svg>
                        </div>
                        <div className="text-white text-sm space-y-0.5">
                            <div className="flex gap-2">
                                <span className="font-medium">Name</span>
                                <span>: {customerData.name}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="font-medium">User Id</span>
                                <span>: {formatCustomerId(customerData.customer_id)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Dynamic Tabs from pkgCategories API */}
                <div className="bg-gradient-to-r from-indigo-600 to-blue-600 shadow-md">
                    <div className="flex overflow-x-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                        {packagesLoading ? (
                            <div className="flex-1 text-center py-3 text-white/70 text-xs">Loading categories...</div>
                        ) : tabNames.map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-shrink-0 px-4 py-3 text-[10px] leading-tight font-bold transition-colors text-white ${activeTab === tab ? 'border-b-4 border-white' : 'border-b-4 border-transparent opacity-70'}`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 px-4 py-4 space-y-3 pb-36 bg-white dark:bg-gray-900 overflow-y-auto">
                    {/* Search */}
                    <div className="relative">
                        <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search.."
                            value={activeSearch}
                            onChange={(e) => setPackagesSearchByCategory(prev => ({ ...prev, [activeTab]: e.target.value }))}
                            className="w-full bg-white dark:bg-gray-800 text-gray-800 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md pl-10 pr-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    {/* Package List */}
                    {packagesLoading ? (
                        <Loader text="Loading packages..." />
                    ) : filteredPackages.length === 0 ? (
                        <div className="text-center text-gray-500 py-10">
                            {activeSearch ? 'No packages match your search' : 'No packages available in this category'}
                        </div>
                    ) : (
                        // QA spec: LCO and MSO categories allow only ONE package at a time;
                        // Broadcaster stays multi-select. Selection-mode is detected per-render
                        // via the activeTab name — backend doesn't expose a per-category mode
                        // flag, so we regex /lco|mso/i against the tab label.
                        <div className="space-y-3">
                            {filteredPackages.map((pkg, idx) => {
                                const pkgId = getPackageId(pkg, `pkg-${idx}`);
                                const pkgName = pkg.pkgname || pkg.packagename || pkg.name || 'Package';
                                const pkgPrice = pkg.pkgprice || pkg.price || pkg.amount || 0;
                                const isSubscribed = isPackageSubscribed(pkg);
                                const totalChannels = pkg.totchnls || '';
                                const isSingleSelectCategory = /\b(lco|mso)\b/i.test(String(activeTab || ''));

                                // Display name as "BBNL ALL SOUTH(2)" — matches the
                                // native UI where channel count is part of the title.
                                const displayName = totalChannels ? `${pkgName}(${totalChannels})` : pkgName;

                                return (
                                    <div key={pkgId} className="bg-white dark:bg-gray-800 rounded-lg p-3 flex items-center gap-3 border border-gray-200 dark:border-gray-700">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0"
                                            checked={isSubscribed || selectedPackages.includes(pkgId)}
                                            disabled={isSubscribed}
                                            onChange={(e) => {
                                                if (isSubscribed) return; // already subscribed — don't toggle
                                                if (e.target.checked) {
                                                    if (isSingleSelectCategory) {
                                                        // Replace any existing selection from
                                                        // the SAME category with this one.
                                                        // Selections in other categories
                                                        // (e.g. Broadcaster) are preserved.
                                                        const sameCategoryIds = (packagesByCategory[activeTab] || [])
                                                            .map(p => getPackageId(p))
                                                            .filter(Boolean);
                                                        setSelectedPackages(prev => [
                                                            ...prev.filter(id => !sameCategoryIds.includes(id)),
                                                            pkgId,
                                                        ]);
                                                    } else {
                                                        setSelectedPackages(prev => prev.includes(pkgId) ? prev : [...prev, pkgId]);
                                                    }
                                                } else {
                                                    setSelectedPackages(prev => prev.filter(id => id !== pkgId));
                                                }
                                            }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-gray-800 dark:text-gray-100 text-sm font-medium leading-tight break-words">{displayName}</h4>
                                            {/* Subscribed flag ribbon — matches the native
                                                UI (green flag with white "Subscribed" label
                                                and a chevron tail). Renders below the
                                                name when applicable. The tiny grey-text
                                                version that was here before was easy to
                                                miss on a quick glance, which is why
                                                operators kept asking "is this user
                                                subscribed?" even when they were. */}
                                            {isSubscribed && (
                                                <div className="mt-1 inline-flex items-stretch">
                                                    <span className="bg-green-500 text-white text-[10px] font-semibold px-2 py-0.5 leading-none flex items-center">
                                                        Subscribed
                                                    </span>
                                                    <span
                                                        aria-hidden="true"
                                                        className="w-0 h-0 border-y-[10px] border-y-transparent border-l-[8px] border-l-green-500"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-1">₹ {Number(pkgPrice).toFixed(2)}</p>
                                            <button onClick={() => handleOpenDetail(pkg)} className="text-xs text-orange-500 font-semibold inline-flex items-center gap-0.5">
                                                Details
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Package Detail Modal */}
                <Modal isOpen={!!detailPkg} onClose={() => { setDetailPkg(null); setDetailChannels([]); }} title={detailPkg?.pkgname || detailPkg?.packagename || 'Package Details'}>
                    {detailPkg && (
                        <div className="p-5 space-y-4">
                            {/* Package Info */}
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Package ID</span>
                                    <span className="font-medium text-gray-800">{detailPkg.pkgid || detailPkg.packageid}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Package Code</span>
                                    <span className="font-medium text-gray-800">{detailPkg.pkgcode || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Price</span>
                                    <span className="font-semibold text-indigo-600">₹ {Number(detailPkg.pkgprice || detailPkg.price || 0).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Total Channels</span>
                                    <span className="font-medium text-gray-800">{detailPkg.totchnls || '0'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Channel Price</span>
                                    <span className="font-medium text-gray-800">₹ {Number(detailPkg.totchnlprice || 0).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Status</span>
                                    <span className={`font-semibold ${isPackageSubscribed(detailPkg) ? 'text-green-600' : 'text-orange-500'}`}>
                                        {isPackageSubscribed(detailPkg) ? 'Subscribed' : 'Not Subscribed'}
                                    </span>
                                </div>
                                {detailPkg.expirydate && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Expiry Date</span>
                                        <span className="font-medium text-gray-800">{detailPkg.expirydate}</span>
                                    </div>
                                )}
                                {detailPkg.plandate && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Plan Date</span>
                                        <span className="font-medium text-gray-800">{detailPkg.plandate}</span>
                                    </div>
                                )}
                            </div>

                            {/* Channels Section */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                    <h4 className="text-indigo-600 font-semibold text-sm">Channels ({detailPkg.totchnls || detailChannels.length || 0})</h4>
                                </div>
                                {detailChannelsLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                                        <span className="ml-2 text-xs text-gray-400">Loading channels...</span>
                                    </div>
                                ) : detailChannels.length > 0 ? (
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                        {detailChannels.map((ch, i) => {
                                            const chName = ch.chtitle || ch.chnlname || ch.channelname || ch.name || 'Channel';
                                            const chPrice = ch.chmrp || ch.agentprice || ch.chnlprice || '';
                                            const chType = ch.chtype || '';
                                            const chLang = ch.language || '';
                                            const hasLogo = ch.chlogo && !ch.chlogo.includes("chnlnoimage");
                                            const logoSrc = hasLogo ? proxyImageUrl(ch.chlogo) : null;
                                            return (
                                                <div key={ch.chid || ch.lcochid || ch.channelid || i} className="flex items-center gap-2 py-1.5 px-2 bg-gray-50 rounded-lg text-xs">
                                                    {logoSrc ? (
                                                        <img
                                                            src={logoSrc}
                                                            alt={chName}
                                                            className="w-7 h-7 rounded object-contain bg-white border border-gray-100 flex-shrink-0"
                                                            loading="lazy"
                                                            onError={(e) => { e.target.onerror = null; e.target.src = ''; e.target.className = 'hidden'; }}
                                                        />
                                                    ) : (
                                                        <span className="w-7 h-7 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                                                            {chName.charAt(0).toUpperCase()}
                                                        </span>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-gray-700 block truncate">{chName}</span>
                                                        {(chLang || chType) && (
                                                            <span className="text-[9px] text-gray-400">{chLang}{chType ? ` · ${chType.toUpperCase()}` : ''}</span>
                                                        )}
                                                    </div>
                                                    {chPrice && <span className="text-gray-500 font-medium flex-shrink-0">₹{chPrice}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                                        <p className="text-xs text-gray-400">
                                            {detailPkg.totchnls ? `This package includes ${detailPkg.totchnls} channels` : 'Channel details not available'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </Modal>

                {/* Footer — Continue → Channels view (so the operator
                    can also pick à la carte channels alongside the
                    selected packages before going to checkout). The
                    actual Checkout button lives at the bottom of the
                    Channels view. This matches the native flow:
                    Packages → Continue → Channels → Checkout. */}
                <div className="fixed bottom-16 left-0 right-0 p-3 bg-white dark:bg-gray-900 border-t dark:border-gray-700">
                    <button
                        onClick={() => {
                            setPackagesSearchTerm('');
                            setPackagesSearchByCategory({});
                            enterSubView('channels');
                            loadAlacarteChannels();
                        }}
                        className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-3 rounded-lg text-sm shadow-md hover:shadow-lg transition-shadow duration-200"
                    >
                        Continue
                    </button>
                </div>

                <BottomNav />
            </div>
        );
    }

    // (Top-level !customerData guard moved above the view-specific
    // renders earlier in this component — see the CRITICAL comment.)

    // ── Overview View ──
    return (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            <ServiceSelectionModal
                isOpen={showServiceModal}
                onClose={() => setShowServiceModal(false)}
                onSelectService={handleServiceSelect}
                customer={customerData}
                services={servicesFromState}
                currentServiceKey="iptv"
            />

            {/* Blue Gradient Header */}
            <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                <button onClick={() => navigate('/customers')} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>
                <h1 className="text-lg font-medium text-white">Customer OverView</h1>
            </header>

            <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
                <>
                {/* User Details — renders instantly from customerData
                    (always present from navigation state). No need to
                    wait for cblCustDet/primaryCustdet. Even if the
                    backend fails entirely, this card stays visible
                    so the operator can still tap Upload Document /
                    Order History / switch service via the filter. */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                        <h3 className="text-indigo-600 dark:text-indigo-400 font-semibold text-lg">User Details</h3>
                    </div>
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

                {/* Action Buttons */}
                <div className="flex gap-3">
                    <button
                        onClick={handleUploadDocument}
                        disabled={uploadLoading}
                        className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg text-sm transition-shadow duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {uploadLoading ? 'Loading...' : 'Upload Document'}
                    </button>
                    <button
                        className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg text-sm transition-shadow duration-200 shadow-md hover:shadow-lg"
                        onClick={handleOrderHistory}
                    >
                        Order History
                    </button>
                </div>

                {/* Filter Badge */}
                <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 -mx-4">
                    <div className="flex items-center gap-2">
                        <span className="text-base text-indigo-600 dark:text-indigo-400 font-semibold">Filtered by :</span>
                        <span className="bg-indigo-600 text-white text-sm font-medium px-4 py-1.5 rounded-md">
                            Cable TV
                        </span>
                    </div>
                    <button
                        onClick={() => setShowServiceModal(true)}
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                    </button>
                </div>

                {/* FoFi Box ID + Plan Details — render inline
                    spinner while initial fetch is in flight. The
                    rest of the page (header, user details, action
                    buttons, filter) is already on screen. */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-10">
                        <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin"></div>
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-3">Loading service details…</p>
                    </div>
                ) : (
                <>
                {/* FoFi Box ID — only render when the customer
                    actually has a FoFi box. Showing a placeholder
                    here when hasFofiBox is false confused operators
                    into thinking the customer had a box (the not-
                    opted message appears below it). */}
                {hasFofiBox && fofiBoxId ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <h3 className="text-indigo-600 dark:text-indigo-400 font-semibold text-lg">FoFi Box ID</h3>
                        </div>
                        <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded flex justify-between items-center">
                            <p className="text-indigo-600 dark:text-indigo-400 font-medium text-base">{fofiBoxId}</p>
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                ) : null}

                {/* Plan Details / Not Opted.
                    Three distinct cases the renderer must distinguish:
                      1. subscribedService present → render the full
                         plan card (existing path).
                      2. subscribedService missing AND cblCustDet says
                         multplatforms.cabletv is set → the customer
                         IS on cabletv per the customer record, but the
                         plan-details lookup couldn't run (usually
                         because the box ID isn't surfaced by the
                         current backend's getUserAssignedItems). Show
                         a clearer "data unavailable, click to retry"
                         message rather than the misleading "not
                         opted" banner — operators kept thinking the
                         customer wasn't subscribed when they were.
                      3. Genuinely not subscribed → original "not
                         opted" banner.
                      4. Phase 2 still in flight (planSectionLoading) →
                         small card-level spinner. Without this, the
                         renderer would briefly flash the "not opted"
                         branch in the gap between Phase 1 ending and
                         the plan refire resolving. */}
                {error ? (
                    // Error state - API calls failed
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-xl py-10 px-4 flex flex-col items-center">
                        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
                            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="text-red-600 dark:text-red-400 text-center text-sm mb-2">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 text-sm font-medium underline"
                        >
                            Retry
                        </button>
                    </div>
                ) : planSectionLoading ? (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl py-8 px-4 flex flex-col items-center">
                        <div className="w-7 h-7 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin"></div>
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-3">Loading plan details…</p>
                    </div>
                ) : !subscribedService || planName === 'N/A' ? (
                    (() => {
                        const cblBody = cblCustomerDetails?.body || {};
                        const hasCableTvPerRecord = !!(cblBody?.multplatforms?.cabletv);
                        const trulyNotOpted = !hasCableTvPerRecord;
                        return (
                            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl py-10 px-4 flex flex-col items-center">
                                <p className="text-gray-600 dark:text-gray-400 text-base text-center font-medium leading-snug">
                                    {trulyNotOpted ? (
                                        <>Selected Customer have not opted<br />for this Service</>
                                    ) : (
                                        <>Cable TV plan details are temporarily unavailable.<br />
                                            <span className="text-xs font-normal opacity-80">Customer is on Cable TV per record (platform: {cblBody.multplatforms.cabletv}). The plan-details endpoint couldn't load — try again or contact support.</span>
                                        </>
                                    )}
                                </p>
                                {/* Always render an action button so the
                                    operator never lands on a dead-end
                                    "not opted" / "unavailable" screen.
                                    Truly-not-opted → SUBSCRIBE bridges
                                    to FoFi Smart Box (the real opt-in
                                    entry point — Cable TV requires a
                                    FoFi box). Otherwise → REFRESH. */}
                                {trulyNotOpted ? (
                                    <button
                                        onClick={() => navigate(`/customer/${customerData.customer_id}/service/fofi-smart-box`, {
                                            state: { customer: customerData, services: servicesFromState }
                                        })}
                                        className="mt-6 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-10 rounded-full text-sm shadow-md"
                                    >
                                        SUBSCRIBE
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="mt-6 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold py-3 px-10 rounded-full text-sm shadow-md"
                                    >
                                        REFRESH
                                    </button>
                                )}
                            </div>
                        );
                    })()
                ) : (
                    /* Customer has an active plan */
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <h3 className="text-indigo-600 dark:text-indigo-400 font-semibold text-lg">Plan Details</h3>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
                            <div className="flex items-start gap-3">
                                {/* Service Icon */}
                                <div className="flex-shrink-0 w-12 h-12">
                                    {planImgUrl ? (
                                        <img src={planImgUrl} alt={serviceName} className="w-12 h-12 rounded object-contain" />
                                    ) : (
                                        <svg className="w-12 h-12" viewBox="0 0 100 100">
                                            <rect x="10" y="20" width="80" height="50" rx="5" fill="#333" />
                                            <rect x="18" y="27" width="64" height="36" rx="3" fill="#6EC6FF" />
                                            <rect x="75" y="50" width="8" height="8" rx="2" fill="#FF5252" />
                                            <rect x="85" y="50" width="8" height="8" rx="2" fill="#FFD600" />
                                            <rect x="10" y="20" width="80" height="4" fill="#555" />
                                        </svg>
                                    )}
                                </div>

                                {/* Plan Info from API */}
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

                            {/* Action Buttons.
                                Active plan: Select Packages + Select Channels.
                                Expired plan: Renew Plan — bridges to the FoFi
                                Smart Box upgrade flow which IS the renewal
                                path for cable TV (cable + FoFi share the
                                generateorder endpoint with paytype=renewal).
                                Without this, operators landed on a dead-end
                                overview with no way to take action — they had
                                to manually navigate back to the customer list
                                and re-enter via FoFi Smart Box. */}
                            {!isCableTvExpired ? (
                                <div className="flex gap-3 mt-4">
                                    <button
                                        onClick={handleSelectPackages}
                                        className="flex-1 bg-purple-400 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors text-sm"
                                    >
                                        Select Packages
                                    </button>
                                    <button
                                        onClick={handleSelectChannels}
                                        className="flex-1 bg-purple-400 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors text-sm"
                                    >
                                        Select Channels
                                    </button>
                                </div>
                            ) : (
                                <div className="mt-4 space-y-2">
                                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                                        {isFofiSmartServicePaid
                                            ? `Plan expired on ${expiryDate}. Renew below to enable Select Packages / Channels.`
                                            : `Plan expired on ${expiryDate}. Complete FoFi Smart Service payment to enable renewal.`}
                                    </p>
                                    {isFofiSmartServicePaid && (
                                        <button
                                            onClick={() => navigate(`/customer/${customerData.customer_id}/service/fofi-smart-box`, {
                                                state: { customer: customerData, services: servicesFromState }
                                            })}
                                            className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold py-3 px-4 rounded-lg shadow-md text-sm"
                                        >
                                            Renew Plan
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                </>
                )}
                </>
            </div>

            {/* Order Placed Success — replaces the old toast.add
                "Order placed successfully!" with a proper modal that
                shows the operator the amount paid, txn ID, wallet
                debit, and selection summary. Operator must acknowledge
                with the OK button — prevents the "did the order
                actually go through?" double-tap problem with toasts. */}
            {successOrder && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] px-4" onClick={() => setSuccessOrder(null)}>
                    <div
                        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-gradient-to-br from-emerald-500 to-green-600 px-6 pt-7 pb-6 flex flex-col items-center">
                            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center ring-4 ring-white/30">
                                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="mt-3 text-lg font-bold text-white">Order Placed Successfully!</h3>
                            <p className="text-white/90 text-xs mt-1">Cable TV subscription confirmed</p>
                        </div>

                        <div className="px-6 py-5 space-y-3">
                            {successOrder.customerName && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Customer</span>
                                    <span className="font-medium text-gray-800 truncate ml-2">{successOrder.customerName}</span>
                                </div>
                            )}
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Amount Paid</span>
                                <span className="font-bold text-emerald-600">₹ {Number(successOrder.paidAmount).toFixed(2)}</span>
                            </div>
                            {successOrder.walletDebited > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Wallet Debited</span>
                                    <span className="font-semibold text-indigo-600">₹ {Number(successOrder.walletDebited).toFixed(2)}</span>
                                </div>
                            )}
                            {(successOrder.packagesCount > 0 || successOrder.channelsCount > 0) && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Selection</span>
                                    <span className="font-medium text-gray-800">
                                        {successOrder.packagesCount > 0 && `${successOrder.packagesCount} pkg${successOrder.packagesCount > 1 ? 's' : ''}`}
                                        {successOrder.packagesCount > 0 && successOrder.channelsCount > 0 && ' · '}
                                        {successOrder.channelsCount > 0 && `${successOrder.channelsCount} ch`}
                                    </span>
                                </div>
                            )}
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Period</span>
                                <span className="font-medium text-gray-800">{successOrder.period} days</span>
                            </div>
                            {successOrder.orderId && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Order ID</span>
                                    <span className="font-mono text-xs text-gray-700 truncate ml-2">{successOrder.orderId}</span>
                                </div>
                            )}
                        </div>

                        <div className="px-6 pb-5">
                            <button
                                onClick={() => {
                                    setSuccessOrder(null);
                                    popToOverview();
                                }}
                                className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold py-3 rounded-lg shadow-md transition-all"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <BottomNav />
        </div>
    );
}
