import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon, ExclamationCircleIcon, MagnifyingGlassIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { fofiPlans as mockFofiPlans } from "../../data";
import BottomNav from "../../components/BottomNav";
import { ServiceSelectionModal, Badge, Loader, Alert } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { canonicalServiceKey } from "../../constants/services";

// Lazy-load QRScanner — only downloaded when user triggers QR scanning
const QRScanner = lazy(() => import("../../components/QRScanner"));
import {
    getFoFiPlans,
    validateFoFiAsset,
    linkFoFiBox,
    fetchMACBySerial,
    registerFoFiDevice,
    getFoFiDeviceDetails,
    changeFoFiPlan,
    createFoFiPaymentOrder,
    verifyFoFiPayment,
    validateBeforeFofiBoxReg,
    getFofiUpgradePlans,
    upgradeRegistration,
    getFofiPaymentInfo,
} from "../../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails, getMyPlanDetails, getCustKYCPreview, getUserAssignedItems } from "../../services/generalApis";
import { lsRemove, lsGetStale } from "../../services/lsCache";
import { refreshServiceController } from "../../services/navigationController";
import { loadKycWithRetry } from "../../utils/kycRetry";
import { isExpiredDate } from "../../utils/dateParse";

// Cache key helpers
const _uid = (cd) => cd?.username || cd?.customer_id || '';
const OVERVIEW_TTL = 2 * 60 * 1000;

// Shared derivation of FoFi overview state from a getUserAssignedItems
// response. Used for both initial cache hydration (so first paint shows
// the right view, not 'not opted') and inside the fetch effect after a
// fresh API response. Keeps the box-ID picking logic in one place.
//
// CRITICAL: Some backends put the FoFi box under different servkey buckets
// (multi, voip, internet) depending on user classification. We scan ALL
// buckets to find the box, not just body.fofi.
const _BBNL_BOX_RE = /^(bbnl[-_]andbox[-_]|BBNL[-_]ANDBOX[-_])/i;
const _FOFI_BOX_RE = /\b(fofi|smart\s*box|smartbox|fofibox|fta|cabletv|iptv|stb|box)\b/i;

function extractBoxFromItem(item) {
    if (!item || typeof item !== 'object') return null;

    // Primary box ID fields
    const candidates = [
        item.fofiboxid, item.fofi_box_id, item.boxid, item.box_id,
        item.stbid, item.stb_id, item.device_id, item.itemid,
        item.product_name, item.boxId, item.fofiBoxId,
    ].map(v => (v == null ? '' : String(v).trim())).filter(Boolean);

    // Look for BBNL/FOFI formatted box IDs first
    let bbnlMatch = candidates.find(v => _BBNL_BOX_RE.test(v));
    if (bbnlMatch) return { boxId: bbnlMatch, source: 'bbnl-pattern', item };

    // Look for any box-like ID that mentions FoFi/SmartBox/IPTV
    let fofiMatch = candidates.find(v => _FOFI_BOX_RE.test(v) && v.length > 3);
    if (fofiMatch) return { boxId: fofiMatch, source: 'fofi-pattern', item };

    // Deep scan: check all string values in the item for BBNL pattern
    for (const [key, val] of Object.entries(item)) {
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (_BBNL_BOX_RE.test(trimmed)) {
                return { boxId: trimmed, source: `deep-scan:${key}`, item };
            }
        }
    }

    // Fallback: any non-username candidate
    const nonUsername = candidates.find(v => v !== item.username && v.length > 3);
    if (nonUsername) return { boxId: nonUsername, source: 'fallback', item };

    return null;
}

function deriveFofiOverviewFromAssigned(assignedItemsResponse) {
    const body = assignedItemsResponse?.body;

    // Scan ALL servkey buckets - box might be under fofi, multi, voip, or internet
    const buckets = ['fofi', 'multi', 'voip', 'internet'];
    let foundBox = null;
    let sourceBucket = null;

    for (const bucket of buckets) {
        const items = Array.isArray(body?.[bucket]) ? body[bucket] : [];
        for (const item of items) {
            const extracted = extractBoxFromItem(item);
            if (extracted) {
                foundBox = extracted;
                sourceBucket = bucket;
                break;
            }
        }
        if (foundBox) break;
    }

    if (!foundBox) {
        return { hasFofi: false, serviceDetails: null, fi: {}, boxId: '' };
    }

    const fi = foundBox.item;
    const boxId = foundBox.boxId;

    console.log(`🔍 [FoFi] Box found in bucket '${sourceBucket}':`, boxId, `(source: ${foundBox.source})`);

    const mac = fi.mac || fi.macid || fi.mac_addr || fi.macAddress || fi.mac_address || fi.fofimac || '';
    const serial = fi.fserialno || fi.serial_number || fi.serialno || fi.fofiserailnumber || '';

    return {
        hasFofi: true,
        fi,
        boxId,
        serviceDetails: {
            boxId,
            planName: 'Loading…',
            expiryDate: 'Loading…',
            macAddress: mac,
            serialNumber: serial,
            ottPlanId: null,
            status: fi.primarybox === 'yes' ? 'Active' : (fi.status || 'Active'),
            _rawFofiItem: fi,
        },
    };
}

function mergeFoFiAssignedResponses(results) {
    const merged = { body: {} };
    const bucketNames = ['fofi', 'multi', 'voip', 'internet'];
    results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value?.body) {
            const bucket = bucketNames[idx];
            merged.body[bucket] = result.value.body[bucket] || result.value.body;
        }
    });
    return merged;
}

function findFoFiSubscribedService(planResponse) {
    const subscribedServices = planResponse?.body?.subscribed_services || [];
    if (!Array.isArray(subscribedServices)) return null;
    return subscribedServices.find(s => canonicalServiceKey(s?.servicekey) === 'fofi'
        || /\bfofi\b|smart\s*box|smartbox|fofibox|\bfta\b|\bcabletv\b|\biptv\b/i.test(
            `${s?.serv_name || ''} ${s?.title || ''} ${s?.planname || ''} ${s?.plan_name || ''}`
        ));
}

const FOFI_MAC_RE = /[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}/;
const FOFI_BOX_ID_RE = /\b(bbnl[-_][A-Za-z0-9_-]+|BBNL[-_][A-Za-z0-9_-]+)\b/i;

function firstTrimmedValue(...values) {
    for (const value of values) {
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function isMeaningfulFoFiValue(value) {
    const text = firstTrimmedValue(value);
    if (!text) return false;
    const normalized = text.toLowerCase();
    return !['n/a', 'na', 'null', 'undefined', '-', '--'].includes(normalized)
        && !normalized.startsWith('loading');
}

function isConfirmedFofiServiceDetails(details) {
    if (!details) return false;
    const hasBox = isMeaningfulFoFiValue(details.boxId || details.fofiboxid || details.fofi_box_id);
    const hasPlanOrExpiry = isMeaningfulFoFiValue(details.planName)
        || isMeaningfulFoFiValue(details.expiryDate)
        || isMeaningfulFoFiValue(details.ottPlanId);
    return hasBox && hasPlanOrExpiry;
}

function isNoActiveFofiPlanResponse(response) {
    const message = String(response?.status?.err_msg || response?.message || '').toLowerCase();
    return response?.status?.err_code !== 0 && (
        message.includes('valid fofi box') ||
        message.includes('fofi box') ||
        message.includes('not subscribed') ||
        message.includes('not found') ||
        message.includes('no active')
    );
}

function getFoFiValidationBody(response) {
    const body = Array.isArray(response?.body) ? (response.body[0] || {}) : (response?.body || {});
    if (Array.isArray(body?.data)) return body.data[0] || {};
    if (body?.data && typeof body.data === 'object') return body.data;
    if (Array.isArray(body?.details)) return body.details[0] || {};
    if (body?.details && typeof body.details === 'object') return body.details;
    if (Array.isArray(body?.device)) return body.device[0] || {};
    if (body?.device && typeof body.device === 'object') return body.device;
    return body || {};
}

function extractFoFiMac(response, fallback = '') {
    const body = getFoFiValidationBody(response);
    const fromBody = firstTrimmedValue(
        body.mac_addr,
        body.macAddress,
        body.mac_address,
        body.mac,
        body.macid,
        body.fofimac
    );
    if (fromBody) return fromBody;

    const msg = String(response?.status?.err_msg || '');
    const match = msg.match(FOFI_MAC_RE);
    return firstTrimmedValue(match?.[0], fallback);
}

function extractFoFiBoxId(response, fallback = '') {
    const body = getFoFiValidationBody(response);
    const fromBody = firstTrimmedValue(
        body.boxid,
        body.box_id,
        body.fofiboxid,
        body.fofi_box_id,
        body.stbid,
        body.stb_id,
        body.device_id
    );
    if (fromBody) return fromBody;

    const msg = String(response?.status?.err_msg || '');
    const match = msg.match(FOFI_BOX_ID_RE);
    return firstTrimmedValue(match?.[1], fallback);
}

function classifyFoFiValidationMessage(message) {
    if (!message) return { kind: 'other', opid: '' };
    const raw = String(message).trim();
    const lower = raw.toLowerCase();
    const opMatch = raw.match(/not\s+belongs(?:\s+to)?(?:\s+op)?\s*\(?([A-Za-z0-9_-]+)\)?/i)
        || raw.match(/belongs\s+to\s*\(?([A-Za-z0-9_-]+)\)?/i);

    if (lower.includes('not belongs')) {
        return { kind: 'not-belongs', opid: opMatch?.[1] || '' };
    }
    if (lower.includes('device details not found') || lower.includes('device not found')) {
        return { kind: 'not-found', opid: opMatch?.[1] || '' };
    }
    if (
        lower.includes('already assigned') ||
        lower.includes('already registered') ||
        lower.includes('already in use') ||
        lower.includes('already linked')
    ) {
        return { kind: 'already-assigned', opid: opMatch?.[1] || '' };
    }
    return { kind: 'other', opid: opMatch?.[1] || '' };
}

function formatFoFiValidationError(response, { fallbackMac = '', fallbackBoxId = '' } = {}) {
    const rawMsg = String(response?.status?.err_msg || '').trim();
    const classification = classifyFoFiValidationMessage(rawMsg);

    if (classification.kind === 'not-belongs') {
        const mac = extractFoFiMac(response, fallbackMac);
        const opid = classification.opid || 'different OPID';
        return `${mac ? `(${mac}) ` : ''}device not belongs to (${opid})`;
    }

    if (classification.kind === 'already-assigned') {
        const box = extractFoFiBoxId(response, fallbackBoxId);
        return box
            ? `Fo-Fi device with box id (${box}) already assigned`
            : 'Fo-Fi device already assigned';
    }

    if (classification.kind === 'not-found') {
        return 'Device details not found. Please verify the Box ID and try again.';
    }

    return rawMsg;
}

function resolveFoFiPlanSelection(plan) {
    const servRates = plan?.serv_rates || {};
    const planid = firstTrimmedValue(
        plan?.planid,
        plan?.fofiplanid,
        plan?.fofi_planid,
        plan?.ottservplanid,
        plan?.ott_servplanid,
        plan?.ottplanid,
        plan?.ott_planid,
        plan?.ott_plan_id,
        servRates.planid,
        servRates.plan_id,
        servRates.fofiplanid,
        servRates.fofi_planid,
        servRates.ottservplanid,
        servRates.ott_servplanid,
        servRates.ottplanid,
        servRates.ott_planid,
        servRates.ott_plan_id,
        plan?.servid,
        plan?.srvid,
        plan?.id
    );
    const priceid = firstTrimmedValue(
        plan?.priceid,
        plan?.price_id,
        servRates.priceid,
        servRates.price_id,
        '99'
    );
    const rate = firstTrimmedValue(
        plan?.planrate,
        plan?.price,
        plan?.amount,
        plan?.rate,
        Array.isArray(servRates.prices) ? servRates.prices[0] : '',
        0
    );
    const servid = firstTrimmedValue(
        plan?.servid,
        plan?.serv_id,
        plan?.service_id,
        plan?.serviceid,
        servRates.servid,
        servRates.serv_id,
        servRates.service_id,
        servRates.serviceid,
        '3'
    );

    return { planid, priceid, planrate: rate, servid };
}

function normalizeStringArray(value) {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    return values
        .map(item => firstTrimmedValue(item))
        .filter(Boolean);
}

function resolveFoFiRegistrationFields(plan) {
    const services = normalizeStringArray(
        plan?.reg_serv_keys ||
        plan?.services ||
        plan?.servicekeys ||
        plan?.service_keys
    );
    const subscriptions = normalizeStringArray(plan?.subscriptions);
    const packages = normalizeStringArray(
        plan?.packages ||
        plan?.packageid ||
        plan?.package_id ||
        plan?.packageids
    );

    return {
        services: services.length > 0 ? services : ['ott'],
        ...(subscriptions.length > 0 ? { subscriptions } : {}),
        ...(packages.length > 0 ? { packages } : {}),
    };
}

function resolveFoFiAmountDeductable(paymentBody) {
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
    return Number.isFinite(fofiSplit) && fofiSplit > 0 ? fofiSplit : 0;
}

function FoFiSmartBox() {
    const location = useLocation();
    const navigate = useNavigate();
    const { customerId: routeCustomerId } = useParams();
    const toast = useToast();

    // Use actual customer data from API (passed from customer list).
    // Pin to a ref so transient location.state loss (e.g. after
    // window.history.back() pops the QR scanner entry) doesn't blank
    // the page or force the data-fetch effect to re-run and abort the
    // in-flight validateFoFiAsset request.
    const customerDataRef = useRef(null);
    if (location.state?.customer) customerDataRef.current = location.state.customer;
    // Prefer the ref over transient state — window.history.back() from the
    // QR scanner wipes location.state, but the ref survives.
    const customerData = customerDataRef.current || location.state?.customer;
    const servicesFromState = location.state?.services || [];
    const fromInternet = location.state?.fromInternet;
    const internetId = location.state?.internetId;
    const refreshData = location.state?.refreshData; // Flag to force refresh after payment
    const paymentSuccess = location.state?.paymentSuccess; // Flag to show success message
    const isNewRegistration = location.state?.isNewRegistration; // Flag to indicate new registration vs upgrade
    // Optimistic state passed from FofiPayment — applied on mount so the
    // Current Plan card and wallet update immediately, before the
    // backend's slow propagation lands.
    const optimisticPlan = location.state?.optimisticPlan;
    const optimisticFofiBoxId = location.state?.optimisticFofiBoxId;
    const optimisticDeduction = location.state?.optimisticDeduction;
    const successMessageFromState = isNewRegistration
        ? 'FoFi-Box Registration Successful! Plan has been activated.'
        : 'Plan upgraded successfully. Your new plan is now active.';

    // hasFofiService is determined from API state (hasFofiService), not mock data

    // ── SWR: hydrate from cache for instant render ──
    const _userid = _uid(customerData);
    const _cachedAI = _userid ? lsGetStale(`uai_fofi_${_userid}`, OVERVIEW_TTL) : null;
    const _cachedCD = _userid ? lsGetStale(`cblcust_${_userid}`, OVERVIEW_TTL) : null;
    const _cachedPD = _userid ? lsGetStale(`pricust_${_userid}`, OVERVIEW_TTL) : null;
    const _hasCached = !!(_cachedAI || _cachedCD || _cachedPD);
    // Derive overview from cached assigned-items so existing customers
    // don't flash the "not opted" view on first paint while the network
    // revalidation is still in flight.
    const _cachedOverview = _cachedAI?.data ? deriveFofiOverviewFromAssigned(_cachedAI.data) : null;

    // State management
    const [showServiceModal, setShowServiceModal] = useState(false);
    // View states: 'overview', 'link-fofi', 'upgrade-plans', 'subscription-confirm', 'device-validation', 'payment'
    // When coming from Internet Service "Link FoFi Box", go directly to Scan From TV screen
    const [view, setView] = useState(paymentSuccess ? 'overview' : (fromInternet ? 'link-fofi' : 'overview'));
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [isUpgradeLinkContinuation, setIsUpgradeLinkContinuation] = useState(false);
    const [deviceValidated, setDeviceValidated] = useState(false);
    const [showValidationSuccess, setShowValidationSuccess] = useState(false);
    const [validationMethod, setValidationMethod] = useState(null); // 'qr' or 'manual'
    const [serialNumber, setSerialNumber] = useState('');
    const [boxId, setBoxId] = useState('');
    const [macAddress, setMacAddress] = useState('');
    const [validationError, setValidationError] = useState('');
    // General error state for API/data loading failures
    const [error, setError] = useState('');
    // Ref attached to the validation-error banner so we can scroll it
    // into view the moment it appears. Without this the banner used
    // to render below the LINK FO-FI BOX button — operators on small
    // phones had to scroll down to discover why the link failed.
    const validationErrorRef = useRef(null);
    const [deviceInfo, setDeviceInfo] = useState(null);
    const [fofiPlans, setFofiPlans] = useState(mockFofiPlans); // Initialize with mock data
    const [isLoading, setIsLoading] = useState(false);
    const [isOverviewLoading, setIsOverviewLoading] = useState(!_hasCached); // Skip spinner if cache hit
    const [paymentOrderId, setPaymentOrderId] = useState(null);
    const [showQRScanner, setShowQRScanner] = useState(false);
    // Flag to prevent sub-view popstate listener from resetting view when
    // QR scanner pops its own history entry via history.back()
    const skipNextPopStateRef = useRef(false);
    const [customerDetails, setCustomerDetails] = useState(_cachedCD?.data || null);
    const [primaryCustomerDetails, setPrimaryCustomerDetails] = useState(_cachedPD?.data || null);
    const [customerInternetPlanId, setCustomerInternetPlanId] = useState(null);
    // FoFi service status - will be validated by API response
    // Hydrate from the cached assigned-items derivation so existing
    // customers render the correct view on first paint instead of
    // briefly flashing the "not opted" CTA before the network resolves.
    const [hasFofiService, setHasFofiService] = useState(_cachedOverview?.hasFofi ?? false);
    const [fofiServiceDetails, setFofiServiceDetails] = useState(_cachedOverview?.serviceDetails ?? null);
    const [fofiAssignedItems, setFofiAssignedItems] = useState(_cachedAI?.data || null); // FoFi assigned items from API
    // Raw planDetails response — needed for the PAY BILL button's
    // disabled state, which mirrors the Internet Service pattern of
    // gating on body.other_service_renewal.btn_status.
    const [fofiPlanDetailsRaw, setFofiPlanDetailsRaw] = useState(null);
    
    // Upgrade Plans state
    const [upgradePlans, setUpgradePlans] = useState([]);
    const [filteredUpgradePlans, setFilteredUpgradePlans] = useState([]);
    const [ottPlansMap, setOttPlansMap] = useState({}); // Map of plan names to OTT plan IDs
    const [upgradePlansLoading, setUpgradePlansLoading] = useState(false);
    const [upgradePlansError, setUpgradePlansError] = useState('');
    const [upgradeSearchTerm, setUpgradeSearchTerm] = useState('');
    const [showZeroPricePopup, setShowZeroPricePopup] = useState(false); // Popup for ₹0 plans
    
    // Toast/Snackbar for payment success
    const [showSuccessToast, setShowSuccessToast] = useState(!!paymentSuccess);
    const [successMessage, setSuccessMessage] = useState(paymentSuccess ? successMessageFromState : '');

    // ── Success Alert Helper ──
    const SuccessAlert = () => (
        <Alert
            isOpen={showSuccessToast}
            onClose={() => setShowSuccessToast(false)}
            type="success"
            title={isNewRegistration ? 'Registration Successful' : 'Plan Upgraded'}
            message={successMessage}
            autoClose={false}
        />
    );

    const loadFoFiLinkPlans = async (userid, logUname) => {
        const plansResponse = await getFofiUpgradePlans({
            logUname,
            moduletype: "upgradation",
            userid,
        });
        const linkPlans = plansResponse?.body?.fofi_plans || plansResponse?.body?.ott_plans || [];
        if (plansResponse?.status?.err_code === 0 && linkPlans.length > 0) {
            const mappedPlans = linkPlans.map((plan, idx) => ({
                ...plan,
                _source: 'fofi',
                _uniqueKey: `fofi_${plan.planid ?? plan.srvid ?? plan.servid ?? plan.id ?? idx}_${plan.planname || plan.serv_name || plan.plan_name || ''}`,
            }));
            setFofiPlans(mappedPlans);
            return mappedPlans;
        }
        setFofiPlans([]);
        return [];
    };

    // NOTE: When coming from Internet Service "Link FoFi Box" (fromInternet=true),
    // we intentionally do NOT push an extra history entry. The route entry for
    // /customer/:id/service/fofi-smart-box IS what back should pop — that takes
    // the user straight back to Internet Service. Pushing an extra entry would
    // make back pop that entry instead, triggering the sub-view popstate handler
    // which flips view to 'overview' and leaves the user stuck on the FoFi page.

    // Show success toast if coming back from successful payment.
    //
    // Anti-replay: a page refresh on this route preserves the
    // location.state we navigated in with, so the popup was firing
    // again on every refresh after a successful upgrade. We track
    // a window-key per upgrade (using the _t timestamp passed by
    // FofiPayment.jsx) and only show the popup once per key.
    // ALSO clear the location state right after — so a user who
    // navigates away and comes back via deep link doesn't see a
    // stale "Plan Upgraded" popup.
    const popupShownRef = useRef(new Set());
    useEffect(() => {
        if (!paymentSuccess) return;
        // Force the overview view so the success popup is visible
        // immediately after payment navigation (not only after back).
        if (view !== 'overview') {
            setView('overview');
            try { subViewDepthRef.current = 0; } catch (_) {}
        }
        const key = location.state?._t || 'no-key';
        if (popupShownRef.current.has(key)) return;
        popupShownRef.current.add(key);

        setSuccessMessage(successMessageFromState);
        setShowSuccessToast(true);

        // Strip the success flag from history state so a page refresh
        // doesn't re-trigger the popup. Keep the `customer` key (page
        // needs it) and the `_t` cache-buster.
        //
        // CRITICAL: React Router v6 stores location.state under
        // window.history.state.usr — overwriting window.history.state
        // directly with user-state fields (customer, paymentSuccess,…)
        // wipes Router's `usr` wrapper AND its `key` / `idx`
        // bookkeeping. After that, location.state becomes empty, the
        // back button to the previous overview entry lands in a
        // confused state, and the operator sees "No customer data
        // available" on a same-URL re-render. Spread the existing
        // window.history.state and update ONLY the `usr` slot.
        const cleaned = {
            ...(location.state || {}),
            paymentSuccess: false,
        };
        try {
            window.history.replaceState(
                { ...(window.history.state || {}), usr: cleaned },
                document.title,
                window.location.pathname + window.location.search
            );
        } catch (_) { /* defensive — replaceState can throw on iOS quota */ }
    }, [paymentSuccess, successMessageFromState, location.state, view]);

    // Optimistic plan-name update — apply once fofiServiceDetails has
    // been hydrated by the initial fetch (so we have boxId / expiryDate
    // / etc.), but before the staged refetches catch up to the new plan.
    // This is what makes the Current Plan card flip immediately instead
    // of staying on the old plan for 10+ seconds while the backend
    // propagates. Subsequent refetches will overwrite with the
    // authoritative server value.
    //
    // originalPlanRef — captures the plan name as the backend returned it
    // BEFORE we overwrite with the optimistic value. The staged refetch
    // effect uses this to recognise "backend is still echoing the old
    // plan" and leave the optimistic state in place instead of flipping
    // back, which is what produced the production "flapping" symptom.
    const optimisticAppliedRef = useRef(false);
    const originalPlanRef = useRef(null);
    useEffect(() => {
        if (!optimisticPlan) return;
        if (optimisticAppliedRef.current) return;
        if (!fofiServiceDetails) return; // Wait for hydration first
        if (fofiServiceDetails.planName === optimisticPlan) {
            optimisticAppliedRef.current = true;
            originalPlanRef.current = optimisticPlan;
            return;
        }
        // Snapshot the pre-optimistic plan name so the refetch can ignore
        // backend responses that still show this stale value.
        originalPlanRef.current = fofiServiceDetails.planName || null;
        optimisticAppliedRef.current = true;
        setFofiServiceDetails(prev => prev ? { ...prev, planName: optimisticPlan } : prev);
    }, [optimisticPlan, fofiServiceDetails]);

    useEffect(() => {
        if (!refreshData || !optimisticFofiBoxId || fofiServiceDetails) return;
        setHasFofiService(true);
        setFofiServiceDetails({
            boxId: optimisticFofiBoxId,
            planName: optimisticPlan || 'Loading...',
            expiryDate: 'Loading...',
            macAddress: '',
            serialNumber: '',
            ottPlanId: null,
            status: 'Active',
        });
    }, [refreshData, optimisticFofiBoxId, optimisticPlan, fofiServiceDetails]);

    // Scroll the validation error banner into view as soon as it
    // appears, then auto-dismiss after 5 seconds.
    //
    // Most rejections happen right after a click on the
    // bottom-of-page LINK FO-FI BOX button, so without the
    // scrollIntoView the banner sits below the fold and operators
    // wait for nothing. The auto-dismiss is product-requested —
    // operators don't want a stale error sitting on screen after
    // they've started another action; 5s is long enough to read a
    // single-line backend message.
    //
    // Effect re-runs on every validationError change, so each new
    // error gets its own fresh 5s timer; the cleanup clears the
    // previous timer so a quick second error doesn't get cut short.
    // Manual × dismiss still works — clearing the state cancels the
    // pending timer via the same cleanup.
    useEffect(() => {
        if (!validationError) return;
        const el = validationErrorRef.current;
        if (el) {
            requestAnimationFrame(() => {
                try {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (_) {
                    el.scrollIntoView();
                }
            });
        }
        const timer = setTimeout(() => setValidationError(''), 5000);
        return () => clearTimeout(timer);
    }, [validationError]);

    // =====================================================
    // FETCH ALL DATA ON COMPONENT MOUNT (OPTIMIZED)
    // Parallelizes independent APIs, then fetches plan details
    // =====================================================
    useEffect(() => {
        // Cancel any in-flight requests from the previous page (e.g. InternetService)
        // so FoFi's requests get full access to the browser connection pool
        refreshServiceController();

        const fetchAllData = async () => {
            if (!customerData) return;

            const userid = customerData?.username || customerData?.customer_id;
            const user = getUser();
            const logUname = user?.username || 'superadmin';
            const skipCache = !!refreshData; // Bypass cache after payment

            // Normal navigation can use freshly prefetched cache. Payment
            // returns still bypass cache so new plan/order state is not hidden
            // behind pre-payment assigned-items or plan details.
            const skipStatusCache = !!refreshData;

            // Invalidate caches if coming back from payment
            if (refreshData) {
                lsRemove(`uai_fofi_${userid}`);
                lsRemove(`uai_multi_${userid}`);
                lsRemove(`uai_voip_${userid}`);
                lsRemove(`uai_internet_${userid}`);
                lsRemove(`walbal_${logUname}_fofi`);
                // Order history will pick up the new transaction
                lsRemove(`orderhist_${userid}_fofi`);
                lsRemove(`orderhist_${userid}_all`);
            }

            // SWR: only show the spinner when there's nothing to render.
            // If lsGetStale already gave us a cached overview, render it
            // instantly and let the network revalidate in the background.
            // After payment, keep the hydrated overview on screen while
            // we revalidate FoFi status in the background.
            if (!_hasCached) setIsOverviewLoading(true);
            setIsLoading(true);

            try {
                // ──────────────────────────────────────────────────
                // FoFi Smart Box overview load — single parallel batch.
                //
                // We fire 4 calls in ONE Promise.all so total wait is
                // max-of-individual rather than sum-of-individual:
                //
                //   1. ServiceApis/getUserAssignedItems  (servkey=fofi)
                //   2. GeneralApi/cblCustDet              (refid=userid)
                //   3. cabletvapis/primaryCustdet         (userid=userid)
                //   4. ServiceApis/getMyPlanDetails       (fofi+empty boxid)
                //
                // The native trace shows a duplicate getUserAssignedItems
                // call at the end — we removed that since the data is
                // identical and only adds latency.
                //
                // getMyPlanDetails is fired without a Box ID — the
                // backend errors with "Please choose valid fofi box
                // id" when no box exists. That's fine: we treat the
                // error as "no plan" and proceed. When we DO get a
                // box ID, we re-fire getMyPlanDetails in the
                // background to enrich plan name / expiry. The
                // overview renders immediately on the first batch
                // so the operator sees the Box ID + customer details
                // without waiting for the plan call to land.
                // ──────────────────────────────────────────────────
                // Fetch data with proper error handling - don't silently swallow errors
                // CRITICAL: Try multiple servkey buckets in parallel - backends store boxes
                // under different keys (fofi, multi, voip, internet) depending on user type
                const [assignedFofiResult, assignedMultiResult, assignedVoipResult, assignedInternetResult, cableDetailsResult, primaryDetailsResult] = await Promise.allSettled([
                    getUserAssignedItems('fofi', userid, skipStatusCache),
                    getUserAssignedItems('multi', userid, skipStatusCache).catch(() => null),
                    getUserAssignedItems('voip', userid, skipStatusCache).catch(() => null),
                    getUserAssignedItems('internet', userid, skipStatusCache).catch(() => null),
                    getCableCustomerDetails(userid, skipCache),
                    getPrimaryCustomerDetails(userid, skipCache),
                ]);

                // Merge all servkey responses into a single body shape for deriveFofiOverviewFromAssigned
                const assignedItemsResponse = mergeFoFiAssignedResponses([
                    assignedFofiResult, assignedMultiResult, assignedVoipResult, assignedInternetResult
                ]);

                const cableDetailsResponse = cableDetailsResult.status === 'fulfilled' ? cableDetailsResult.value : null;
                const primaryDetailsResponse = primaryDetailsResult.status === 'fulfilled' ? primaryDetailsResult.value : null;

                // Log any failures for debugging
                if (assignedFofiResult.status === 'rejected') {
                    console.error('❌ [FoFi] getUserAssignedItems(fofi) failed:', assignedFofiResult.reason?.message);
                }
                if (assignedMultiResult.status === 'rejected') {
                    console.warn('⚠️ [FoFi] getUserAssignedItems(multi) failed:', assignedMultiResult.reason?.message);
                }
                if (cableDetailsResult.status === 'rejected') {
                    console.error('❌ [FoFi] getCableCustomerDetails failed:', cableDetailsResult.reason?.message);
                }
                if (primaryDetailsResult.status === 'rejected') {
                    console.error('❌ [FoFi] getPrimaryCustomerDetails failed:', primaryDetailsResult.reason?.message);
                }

                console.log('🟣 [FoFi] getUserAssignedItems(fofi) body:', assignedItemsResponse?.body);
                console.log('🟣 [FoFi] cblCustDet body:', cableDetailsResponse?.body);
                console.log('🟣 [FoFi] primaryCustdet body:', primaryDetailsResponse?.body);

                // Done with primary spinner — let the overview render.
                setIsLoading(false);

                // Customer & primary details — drive the User Details
                // section + downstream calls (op_id for billing, etc.).
                if (cableDetailsResponse) setCustomerDetails(cableDetailsResponse);
                if (primaryDetailsResponse) setPrimaryCustomerDetails(primaryDetailsResponse);

                // internetsrvid lives on primaryCustdet body — used
                // by renewal payloads to identify the linked internet
                // plan without a separate getMyPlanDetails(internet) call.
                const internetSrvId = primaryDetailsResponse?.body?.internetsrvid;
                if (internetSrvId) setCustomerInternetPlanId(String(internetSrvId));

                // Derive FoFi overview (hasFofi, boxId, serviceDetails)
                // from getUserAssignedItems. Same helper used for cache
                // hydration, so the post-fetch state shape exactly
                // matches what was rendered on first paint — no flicker.
                const derived = deriveFofiOverviewFromAssigned(assignedItemsResponse);
                const { hasFofi, boxId: boxIdFromAi } = derived;
                console.log('🔍 [FoFi] Box ID extraction — picked:', boxIdFromAi, 'hasFofi:', hasFofi);

                if (assignedItemsResponse) setFofiAssignedItems(assignedItemsResponse);

                if (hasFofi) {
                    // STEP 1: render the overview IMMEDIATELY with what
                    // we have from getUserAssignedItems. Plan name and
                    // expiry start as "Loading…" placeholders so the
                    // user knows they're coming. The overview is
                    // interactive instantly — no waiting on the plan
                    // call which adds 1+ RTT on slow networks.
                    // (On cache hits this is a no-op patch — the same
                    // shape was already in initial state.)
                    setHasFofiService(true);
                    setError(""); // Clear any previous errors
                    setFofiServiceDetails(prev => {
                        // Preserve any plan name/expiry already enriched
                        // from a prior render so we don't reset them to
                        // 'Loading…' on background revalidation.
                        if (prev && prev.boxId === derived.serviceDetails.boxId &&
                            prev.planName && prev.planName !== 'Loading…') {
                            return { ...prev, ...derived.serviceDetails, planName: prev.planName, expiryDate: prev.expiryDate, ottPlanId: prev.ottPlanId };
                        }
                        return derived.serviceDetails;
                    });

                    // STEP 2: enrich plan name + expiry in the
                    // background. Don't await — the overview is
                    // already on screen. When the call returns we
                    // patch fofiServiceDetails with the real values.
                    getMyPlanDetails(
                        { servicekey: 'fofi', userid, fofiboxid: boxIdFromAi, voipnumber: '' },
                        true
                    ).then(planResp => {
                        console.log('🟣 [FoFi] getMyPlanDetails(fofi) body:', planResp?.body);
                        const clearUnconfirmedFoFiService = () => {
                            setHasFofiService(false);
                            setFofiServiceDetails(null);
                            setFofiPlanDetailsRaw(planResp || null);
                            lsRemove(`uai_fofi_${userid}`);
                            if (boxIdFromAi) {
                                lsRemove(`plandets_fofi_${userid}_${boxIdFromAi}`);
                            }
                        };
                        if (planResp?.status?.err_code !== 0 || !planResp?.body) {
                            if (refreshData) {
                                setFofiPlanDetailsRaw(planResp || null);
                                return;
                            }
                            if (isNoActiveFofiPlanResponse(planResp)) {
                                clearUnconfirmedFoFiService();
                                return;
                            }
                            // Plan call failed — drop the loading
                            // placeholders so the operator doesn't
                            // stare at "Loading…" forever.
                            setFofiServiceDetails(prev => prev ? { ...prev, planName: 'N/A', expiryDate: 'N/A' } : prev);
                            return;
                        }
                        setFofiPlanDetailsRaw(planResp);
                        const fofiSvc = findFoFiSubscribedService(planResp);
                        const planName = firstTrimmedValue(fofiSvc?.planname, fofiSvc?.plan_name);
                        const expiryDate = firstTrimmedValue(fofiSvc?.expirydate, fofiSvc?.expiry_date);
                        const ottPlanIdFromPlan = fofiSvc?.internet_planid || fofiSvc?.srvid || fofiSvc?.planid || null;
                        if (!fofiSvc || (!isMeaningfulFoFiValue(planName) && !isMeaningfulFoFiValue(expiryDate) && !isMeaningfulFoFiValue(ottPlanIdFromPlan))) {
                            if (refreshData) return;
                            clearUnconfirmedFoFiService();
                            return;
                        }
                        setFofiServiceDetails(prev => prev ? {
                            ...prev,
                            planName: planName || 'N/A',
                            expiryDate: expiryDate || 'N/A',
                            ottPlanId: ottPlanIdFromPlan,
                            _rawFofiSvc: fofiSvc,
                        } : prev);
                    }).catch(e => {
                        if (e?.message?.includes('navigated away')) return;
                        console.warn('⚠️ [FoFi] getMyPlanDetails enrichment failed (non-fatal):', e?.message);
                        if (refreshData) return;
                        setFofiServiceDetails(prev => prev ? { ...prev, planName: 'N/A', expiryDate: 'N/A' } : prev);
                    });
                } else {
                    // Check if all API calls failed - if so, show error instead of "not opted"
                    const allServkeyFailed = assignedFofiResult.status === 'rejected' &&
                                            assignedMultiResult.status === 'rejected' &&
                                            assignedVoipResult.status === 'rejected' &&
                                            assignedInternetResult.status === 'rejected';
                    const allFailed = allServkeyFailed &&
                                     cableDetailsResult.status === 'rejected' &&
                                     primaryDetailsResult.status === 'rejected';

                    if (allFailed) {
                        setError('Failed to load service data. Please check your connection and try again.');
                        console.error('❌ [FoFi] All API calls failed - service data unavailable');
                    } else if (allServkeyFailed) {
                        // All servkey calls failed but customer details worked - partial failure
                        setError('Unable to check FoFi service status. Please try again.');
                        console.warn('⚠️ [FoFi] All servkey calls failed - partial data unavailable');
                    }

                    // NOTE: The deriveFofiOverviewFromAssigned function now scans ALL buckets
                    // (fofi, multi, voip, internet). If no box found anywhere, customer truly
                    // doesn't have FoFi service.
                    setHasFofiService(false);
                    setFofiServiceDetails(null);
                }
            } catch (error) {
                // Ignore errors from navigation cancellation (user navigated away)
                if (error?.message?.includes('navigated away')) return;
                console.error('❌ [FoFi SmartBox] Error fetching data:', error);
                setIsLoading(false);
            } finally {
                setIsOverviewLoading(false);
            }
        };

        fetchAllData();
        // Depend on the stable _userid string (pinned via customerDataRef) and
        // refreshData. If we depended on the customerData object, the QR scanner's
        // window.history.back() would re-derive location with a new/undefined
        // state, re-fire this effect, and refreshServiceController() would abort
        // the in-flight validateFoFiAsset with "Request cancelled — navigated away."
    }, [_userid, refreshData]);

    // Auto-hide device validation success message after 3 seconds
    useEffect(() => {
        if (showValidationSuccess) {
            const timer = setTimeout(() => {
                setShowValidationSuccess(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [showValidationSuccess]);

    // Lazy-load the LINK FO-FI BOX plan dropdown when the link-fofi
    // view is reached without going through handleUpgradeClick — e.g.
    // when entered directly from Internet Service via fromInternet=true,
    // or on page refresh while sitting on that view. handleUpgradeClick
    // already pre-loads these for the UPGRADE → link-fofi path, so we
    // only fetch when we still have the mock placeholder data.
    //
    // Source: registrationNecessities → body.fofi_plans (FoFi-box
    // compatible). We never use internet_plans here — those are a
    // different flow, different payment endpoint.
    useEffect(() => {
        if (view !== 'link-fofi') return;
        if (Array.isArray(fofiPlans) && fofiPlans !== mockFofiPlans && fofiPlans.length > 0) return;
        const userid = customerData?.username || customerData?.customer_id;
        if (!userid) return;
        const user = getUser();
        const logUname = user?.username || 'superadmin';
        let cancelled = false;
        loadFoFiLinkPlans(userid, logUname)
            .then(() => {
                if (cancelled) return;
            })
            .catch(() => {
                if (cancelled) return;
                setFofiPlans([]);
            });
        return () => { cancelled = true; };
    }, [view, fofiPlans, customerData]);

    // After a payment/upgrade, the backend can take several seconds to
    // propagate the new box + plan + expiry across the assigned-items
    // buckets and plan-details endpoint. Poll all FoFi-compatible
    // buckets, not only body.fofi, because first-time opt-in can expose
    // the box under multi/voip/internet before the fofi bucket catches up.
    useEffect(() => {
        if (!refreshData) return;
        if (!customerData) return;
        const userid = customerData?.username || customerData?.customer_id;
        if (!userid) return;

        // Capture the "old" expiry date and plan name so we can stop
        // refetching as soon as either visibly changes.
        const initialExpiry = fofiServiceDetails?.expiryDate || null;
        const initialPlanName = fofiServiceDetails?.planName || null;
        const delays = [2000, 6000, 12000, 20000, 30000];
        const timers = [];
        let stopped = false;

        const refetchOnce = async (attempt) => {
            if (stopped) return;
            const currentBoxId = fofiServiceDetails?.boxId || fofiServiceDetails?.fofiboxid || optimisticFofiBoxId || '';
            lsRemove(`uai_fofi_${userid}`);
            lsRemove(`uai_multi_${userid}`);
            lsRemove(`uai_voip_${userid}`);
            lsRemove(`uai_internet_${userid}`);
            if (currentBoxId) lsRemove(`plandets_fofi_${userid}_${currentBoxId}`);
            try {
                const assignedResults = await Promise.allSettled([
                    getUserAssignedItems('fofi', userid, true).catch(() => null),
                    getUserAssignedItems('multi', userid, true).catch(() => null),
                    getUserAssignedItems('voip', userid, true).catch(() => null),
                    getUserAssignedItems('internet', userid, true).catch(() => null),
                ]);
                if (stopped) return;

                const assignedItems = mergeFoFiAssignedResponses(assignedResults);
                const derived = deriveFofiOverviewFromAssigned(assignedItems);
                const fofiBoxId = derived.boxId || currentBoxId;
                if (assignedItems) setFofiAssignedItems(assignedItems);

                if (derived.hasFofi && derived.serviceDetails) {
                    setHasFofiService(true);
                    setFofiServiceDetails(prev => {
                        const keepPlanName = isMeaningfulFoFiValue(prev?.planName) ? prev.planName : derived.serviceDetails.planName;
                        const keepExpiryDate = isMeaningfulFoFiValue(prev?.expiryDate) ? prev.expiryDate : derived.serviceDetails.expiryDate;
                        return {
                            ...(prev || {}),
                            ...derived.serviceDetails,
                            planName: keepPlanName,
                            expiryDate: keepExpiryDate,
                            ottPlanId: prev?.ottPlanId || derived.serviceDetails.ottPlanId,
                        };
                    });
                }

                if (!fofiBoxId) return;
                lsRemove(`plandets_fofi_${userid}_${fofiBoxId}`);
                const planDetails = await getMyPlanDetails(
                    { servicekey: 'fofi', userid, fofiboxid: fofiBoxId, voipnumber: '' },
                    true
                ).catch(() => null);
                if (stopped) return;
                const fofiSvc = findFoFiSubscribedService(planDetails);
                const _fi = derived.fi || assignedItems?.body?.fofi?.[0] || {};
                const newExpiry =
                    fofiSvc?.expirydate || fofiSvc?.expiry_date || fofiSvc?.expdate ||
                    _fi?.expirydate || _fi?.expiry_date || _fi?.expdate || null;
                const newPlanName =
                    fofiSvc?.planname || fofiSvc?.plan_name || fofiSvc?.serv_name || fofiSvc?.title ||
                    _fi?.planname || null;

                if (planDetails) setFofiPlanDetailsRaw(planDetails);
                if (fofiSvc && (newExpiry || newPlanName)) {
                    // Anti-flap: if the backend response is still echoing
                    // the pre-optimistic plan name, don't overwrite the
                    // optimistic plan name back to the old value. We
                    // still update expiryDate (it's an independent field
                    // and can update earlier than planName). When the
                    // backend finally propagates and returns the new
                    // plan name, the next refetch will accept it and
                    // the early-stop will fire.
                    const optimisticActive = !!optimisticPlan && optimisticAppliedRef.current;
                    const backendStillShowingOld =
                        optimisticActive &&
                        newPlanName &&
                        originalPlanRef.current &&
                        newPlanName === originalPlanRef.current &&
                        newPlanName !== optimisticPlan;

                    setFofiServiceDetails(prev => {
                        if (!prev) return prev;
                        const nextPlanName = backendStillShowingOld
                            ? prev.planName // keep optimistic
                            : (newPlanName || prev.planName);
                        return {
                            ...prev,
                            planName: nextPlanName,
                            expiryDate: newExpiry || prev.expiryDate,
                            ottPlanId: fofiSvc?.internet_planid || fofiSvc?.srvid || fofiSvc?.planid || prev.ottPlanId,
                            _rawFofiSvc: fofiSvc,
                            _rawFofiItem: _fi,
                        };
                    });
                }
                // Stop early when the backend has clearly propagated:
                //   - expiry visibly changed, OR
                //   - plan name visibly changed (and not because the
                //     backend just echoed our pre-optimistic value).
                const expiryChanged = newExpiry && initialExpiry && newExpiry !== initialExpiry;
                const planChanged =
                    newPlanName &&
                    initialPlanName &&
                    newPlanName !== initialPlanName &&
                    newPlanName !== originalPlanRef.current;
                const detailsReady = fofiBoxId && (isMeaningfulFoFiValue(newPlanName) || isMeaningfulFoFiValue(newExpiry));
                if (detailsReady || expiryChanged || planChanged) {
                    stopped = true;
                    console.log(`[FoFi refetch] propagated on attempt ${attempt + 1} → plan=${newPlanName}, expiry=${newExpiry}`);
                }
            } catch (_) { /* best effort */ }
        };

        delays.forEach((d, i) => {
            timers.push(setTimeout(() => refetchOnce(i), d));
        });

        return () => {
            stopped = true;
            timers.forEach(clearTimeout);
        };
    }, [refreshData, customerData, fofiServiceDetails?.boxId, optimisticFofiBoxId]);

    // Service navigation handler — peer service switch.
    // replace: true because these are parallel service views of the same
    // customer, not nested screens. Pushing would pile up an entry each
    // time the user toggled between Internet/IPTV/Voice/FoFi via the
    // picker, and back would walk through all of them instead of
    // returning to the customer services list.
    const handleServiceSelect = (service) => {
        setShowServiceModal(false);
        if (!service) return;

        const serviceId = (service.id || '').toLowerCase();
        const svcName = (service.name || '').toLowerCase();

        if (serviceId === 'internet' || svcName.includes('internet')) {
            navigate(`/customer/${customerData.customer_id}/service/internet`, {
                replace: true,
                state: { customer: customerData, services: servicesFromState }
            });
        } else if (serviceId === 'iptv' || svcName.includes('cable') || svcName.includes('iptv')) {
            navigate(`/customer/${customerData.customer_id}/service/iptv`, {
                replace: true,
                state: { customer: customerData, services: servicesFromState }
            });
        } else if (serviceId === 'voice' || svcName.includes('voice')) {
            navigate(`/customer/${customerData.customer_id}/service/voice`, {
                replace: true,
                state: { customer: customerData, services: servicesFromState }
            });
        }
    };

    // Handle Order History button click
    const handleOrderHistory = () => {
        navigate('/payment-history', {
            state: {
                customer: customerData,
                cableDetails: customerDetails, // Pass cableDetails for op_id used in payment history API
                serviceType: 'fofi', // Indicate this is FoFi order history
                fofiboxid: fofiServiceDetails?.boxId || '' // Pass FoFi box ID for order history API
            }
        });
    };

    // Guard + auto-retry on backend operator-sync errors
    // (see src/utils/kycRetry.js).
    const uploadRequestInFlightRef = useRef(false);
    const handleUploadDocument = async () => {
        if (uploadRequestInFlightRef.current) return;
        uploadRequestInFlightRef.current = true;
        try {
            setIsLoading(true);
            const cid = customerData?.customer_id || customerData?.username;
            const response = await loadKycWithRetry({ cid, reqtype: 'update' });

            if (response?.status?.err_code === 0) {
                navigate('/upload-documents', {
                    state: {
                        customer: customerData,
                        kycData: response.body
                    }
                });
            } else {
                toast.add('Failed to load documents: ' + (response?.status?.err_msg || 'Unknown error'), { type: 'error' });
            }
        } catch (err) {
            console.error('Error loading document preview:', err);
            toast.add('Failed to load documents. Please try again.', { type: 'error' });
        } finally {
            setIsLoading(false);
            uploadRequestInFlightRef.current = false;
        }
    };

    // Treat FoFi service as expired when its expiry date parses to a
    // real date strictly before now. `isExpiredDate` handles the
    // backend's DD-MM-YYYY / DD-MM-YYYY HH:mm:ss am/pm formats as
    // well as ISO — `new Date()` alone returns NaN on DD-MM-YYYY,
    // which previously made every expired customer look active.
    const isFofiExpired = isExpiredDate(fofiServiceDetails?.expiryDate);
    const hasConfirmedFofiService = hasFofiService && isConfirmedFofiServiceDetails(fofiServiceDetails);
    const isCheckingFofiService = hasFofiService && !hasConfirmedFofiService && (
        String(fofiServiceDetails?.planName || '').toLowerCase().startsWith('loading') ||
        String(fofiServiceDetails?.expiryDate || '').toLowerCase().startsWith('loading')
    );

    // Pay Bill — mirrors the Internet Service Pay Bill payload exactly
    // (the working reference). servicekey=fofi tells Paynow.jsx which
    // service to load; planDetails/cableDetails are the raw API
    // responses Paynow uses for billing display. fofiboxid is FoFi-
    // specific extra and unused by Internet, but Paynow reads it from
    // state when servicekey='fofi'.
    const handlePayBill = () => {
        const userid = customerData?.username || customerData?.customer_id;
        const fofiBoxId =
            fofiServiceDetails?.fofiboxid ||
            fofiServiceDetails?.boxId ||
            fofiAssignedItems?.body?.fofi?.[0]?.fofiboxid ||
            '';
        // op_id resolution mirrors Internet: cableDetails.body.op_id
        // first, fallback to customerData.op_id.
        const op_id = customerDetails?.body?.op_id || customerData?.op_id || primaryCustomerDetails?.op_id || '';
        navigate('/payment', {
            state: {
                customer: customerData,
                servicekey: 'fofi',
                userid: userid,
                op_id: op_id,
                planDetails: fofiPlanDetailsRaw,
                cableDetails: customerDetails,
                fofiboxid: fofiBoxId,
            },
        });
    };

    // =====================================================
    // UPGRADE BUTTON HANDLER - Fetch upgrade plans and show services screen
    // BOTH existing and new users use registrationNecessities API for plans
    // =====================================================
    const handleUpgradeClick = async () => {
        const userid = customerData?.username || customerData?.customer_id;
        const user = getUser();
        const logUname = user?.username || 'superadmin';
        const isRetryableOperatorSyncError = (response) => {
            const msg = String(response?.status?.err_msg || '').toLowerCase();
            return msg.includes('operator is disabled') ||
                msg.includes('not a valid user to register') ||
                msg.includes('device not belongs op');
        };
        const validateNewUserUpgradeEligibility = async () => {
            let lastValidation = null;
            let lastCable = null;
            let lastPrimary = null;

            for (let attempt = 1; attempt <= 3; attempt += 1) {
                const [validateResponse, cableDetailsResponse, primaryDetailsResponse] = await Promise.all([
                    validateBeforeFofiBoxReg({ username: userid, loginuname: logUname }, { skipCache: true }),
                    getCableCustomerDetails(userid, true).catch(() => null),
                    getPrimaryCustomerDetails(userid, true).catch(() => null),
                ]);

                lastValidation = validateResponse;
                lastCable = cableDetailsResponse || lastCable;
                lastPrimary = primaryDetailsResponse || lastPrimary;

                if (validateResponse?.status?.err_code === 0) {
                    return { validateResponse, cableDetailsResponse: lastCable, primaryDetailsResponse: lastPrimary };
                }
                if (!isRetryableOperatorSyncError(validateResponse) || attempt === 3) {
                    return { validateResponse, cableDetailsResponse: lastCable, primaryDetailsResponse: lastPrimary };
                }
                await new Promise(resolve => setTimeout(resolve, 2500));
            }

            return { validateResponse: lastValidation, cableDetailsResponse: lastCable, primaryDetailsResponse: lastPrimary };
        };

        console.log('🔵 [UPGRADE] Starting upgrade flow...');
        console.log('🔵 [UPGRADE] User ID:', userid);
        console.log('🔵 [UPGRADE] Log Username:', logUname);
        console.log('🔵 [UPGRADE] hasFofiService:', hasFofiService);

        // ── NEW USER (NOT OPTED) — eligibility gate ──
        // Earlier this branch jumped straight to enterSubView('link-fofi'),
        // which is the SINGLE-page Box-ID + MAC + plan-dropdown flow
        // used when the operator arrives from the Internet service
        // (Internet → Link FoFi Box). Operator confirmed (May 2026)
        // that the FoFi Smart Box UPGRADE button must NOT use that
        // shortcut — it must take the operator to the SAME Services
        // plan-picker that existing users see (upgrade-plans view),
        // so they choose a plan FIRST, then link the box.
        //
        // What we keep from the old branch: validateBeforeFofiBoxReg
        // (eligibility check — the "Operator is disabled" message
        // comes from this call) and the customer-details refresh.
        // After validation passes we fall through to the shared
        // getFofiUpgradePlans path below — same API, same view.
        if (!hasConfirmedFofiService) {
            setUpgradePlansLoading(true);
            setUpgradePlansError('');
            try {
                console.log('🔵 [UPGRADE] Not-opted user — validating eligibility before showing plans…');
                const { validateResponse, cableDetailsResponse, primaryDetailsResponse } =
                    await validateNewUserUpgradeEligibility();

                if (validateResponse?.status?.err_code !== 0) {
                    const errorMsg = validateResponse?.status?.err_msg || 'Validation failed. Please try again.';
                    console.error('❌ [UPGRADE] Validation failed:', errorMsg);
                    setUpgradePlansError(errorMsg);
                    setUpgradePlansLoading(false);
                    return;
                }

                if (cableDetailsResponse) setCustomerDetails(cableDetailsResponse);
                if (primaryDetailsResponse) setPrimaryCustomerDetails(primaryDetailsResponse);

                // Reset any pre-selected plan / box state from a
                // prior visit so the link-fofi step (after plan
                // pick) starts clean.
                setSelectedPlan(null);
                setBoxId('');
                setMacAddress('');
                setSerialNumber('');
                setDeviceInfo(null);
                setDeviceValidated(false);
                setValidationError('');
                // Fall through to the shared upgrade-plans fetch
                // below — same flow as existing users from here on.
            } catch (error) {
                console.error('❌ [UPGRADE] Error validating new user:', error);
                setUpgradePlansError(error?.message || 'An error occurred. Please try again.');
                setUpgradePlansLoading(false);
                return;
            }
        }

        // ── EXISTING USER (UPGRADE) PATH — plan list + payment as before ──
        setUpgradePlansLoading(true);
        setUpgradePlansError('');
        setUpgradePlans([]);
        setFilteredUpgradePlans([]);
        setUpgradeSearchTerm('');
        setIsUpgradeLinkContinuation(false);

        try {
            // Fire plans fetch (existing users)
            const plansPromise = getFofiUpgradePlans({
                logUname: logUname,
                moduletype: "upgradation",
                userid: userid
            });

            // Existing users: plans fetch only
            console.log('🔵 [UPGRADE] Fetching plans...');
            const plansResponse = await plansPromise;
            console.log('🟢 [UPGRADE] registrationNecessities Response:', plansResponse);
            
            if (plansResponse?.status?.err_code === 0) {
                // Log the FULL response body to find planid field
                console.log('✅ [UPGRADE] Full response body:', JSON.stringify(plansResponse?.body, null, 2));
                console.log('✅ [UPGRADE] Response body keys:', Object.keys(plansResponse?.body || {}));
                
                // Check ALL plan arrays in response
                console.log('✅ [UPGRADE] === Checking all plan arrays ===');
                console.log('✅ [UPGRADE] ott_plans:', plansResponse?.body?.ott_plans);
                console.log('✅ [UPGRADE] internet_plans:', plansResponse?.body?.internet_plans?.length || 0, 'plans');
                console.log('✅ [UPGRADE] fofi_plans:', plansResponse?.body?.fofi_plans);
                console.log('✅ [UPGRADE] cable_plans:', plansResponse?.body?.cable_plans);
                console.log('✅ [UPGRADE] plans:', plansResponse?.body?.plans);
                
                // Check fofi_plans for OTT/FoFi plan IDs (planid like "55")
                // Build a map of FoFi plans by name for cross-referencing with internet_plans
                const fofiPlansArray = plansResponse?.body?.fofi_plans || plansResponse?.body?.ott_plans || [];
                console.log('✅ [UPGRADE] fofi_plans array:', fofiPlansArray);

                if (fofiPlansArray.length > 0) {
                    console.log('✅ [UPGRADE] FoFi Plans found! Count:', fofiPlansArray.length);
                    console.log('✅ [UPGRADE] First FoFi plan:', JSON.stringify(fofiPlansArray[0], null, 2));
                    console.log('✅ [UPGRADE] FoFi plan keys:', Object.keys(fofiPlansArray[0]));

                    // Create a map of plan names to FoFi/OTT plan IDs
                    // The fofi_plans should have the correct planid (like "55") that the payment API needs
                    const fofiMap = {};
                    fofiPlansArray.forEach(plan => {
                        const planName = plan.serv_name || plan.planname || plan.plan_name || plan.name || '';
                        // The FoFi plan ID could be in various fields - srvid, planid, servid, or id
                        const fofiPlanId = plan.srvid || plan.planid || plan.servid || plan.id || '';
                        console.log(`✅ [UPGRADE] FoFi plan: "${planName}" -> srvid:${plan.srvid}, planid:${plan.planid}, servid:${plan.servid}, id:${plan.id}`);
                        if (planName && fofiPlanId) {
                            fofiMap[planName.toLowerCase()] = String(fofiPlanId);
                            console.log(`✅ [UPGRADE] FoFi Map: "${planName}" -> ${fofiPlanId}`);
                        }
                    });
                    setOttPlansMap(fofiMap);
                    console.log('✅ [UPGRADE] FoFi Plans Map:', fofiMap);
                } else {
                    console.log('⚠️ [UPGRADE] No FoFi/OTT plans found in response');
                }

                // PLAN DISPLAY LOGIC:
                // - NEW USERS: Display ONLY fofi_plans (FoFi-box specific plans)
                // - EXISTING USERS: Display ALL plans from the API (all available plan arrays)
                let plans = [];
                let plansSource = 'none';

                if (hasConfirmedFofiService) {
                    // EXISTING USER - Show ALL FoFi/OTT compatible plans from the API
                    // Note: Only fofi_plans and ott_plans work with the paymentinfo/fofi API
                    // internet_plans and cable_plans use different payment flows
                    console.log('✅ [UPGRADE] Existing user - loading ALL FoFi/OTT plans');

                    // Collect all FoFi-compatible plan arrays with unique keys
                    const allPlans = [];
                    const seenPlanKeys = new Set(); // Track seen plans to avoid duplicates

                    // Helper to add plans with unique key and source tracking
                    const addPlansWithSource = (planArray, source) => {
                        planArray.forEach((plan, idx) => {
                            const planId = plan.planid || plan.servid || plan.srvid || plan.id || idx;
                            const planName = plan.planname || plan.serv_name || plan.plan_name || '';
                            const uniqueKey = `${source}_${planId}_${planName}`;

                            // Skip if we've already seen this plan (deduplicate)
                            if (!seenPlanKeys.has(uniqueKey)) {
                                seenPlanKeys.add(uniqueKey);
                                allPlans.push({
                                    ...plan,
                                    _source: source,
                                    _uniqueKey: uniqueKey
                                });
                            }
                        });
                    };

                    // Add fofi_plans (primary - contains correct planid for payment API)
                    if (fofiPlansArray.length > 0) {
                        addPlansWithSource(fofiPlansArray, 'fofi');
                        console.log('✅ [UPGRADE] Added fofi_plans:', fofiPlansArray.length);
                    }

                    // Add ott_plans (if different from fofi_plans - also compatible with FoFi payment API)
                    const ottPlans = plansResponse?.body?.ott_plans || [];
                    if (ottPlans.length > 0 && ottPlans !== fofiPlansArray) {
                        addPlansWithSource(ottPlans, 'ott');
                        console.log('✅ [UPGRADE] Added ott_plans:', ottPlans.length);
                    }

                    // Note: internet_plans and cable_plans are NOT added as they use different payment APIs
                    // If needed in future, they should use their respective payment endpoints

                    plans = allPlans;
                    plansSource = 'fofi_ott_plans (existing user)';
                    console.log('✅ [UPGRADE] Total FoFi/OTT plans for existing user (after dedup):', plans.length);
                } else {
                    // NEW USER - Show ONLY fofi_plans (FoFi-box specific plans)
                    console.log('✅ [UPGRADE] New user - loading only FoFi-box plans');
                    if (fofiPlansArray.length > 0) {
                        plans = fofiPlansArray.map((plan, idx) => ({
                            ...plan,
                            _source: 'fofi',
                            _uniqueKey: `fofi_${plan.planid || plan.srvid || idx}_${plan.planname || ''}`
                        }));
                        plansSource = 'fofi_plans (new user)';
                        console.log('✅ [UPGRADE] Using fofi_plans ONLY for new user (contains correct planid)');
                    }
                }
                
                console.log('✅ [UPGRADE] Using plans from:', plansSource);
                console.log('✅ [UPGRADE] Plans count:', plans.length);
                if (plans.length > 0) {
                    console.log('✅ [UPGRADE] First plan (FULL):', JSON.stringify(plans[0], null, 2));
                    console.log('✅ [UPGRADE] First plan keys:', Object.keys(plans[0]));
                    
                    // Look for ANY field with small numbers (like 55)
                    Object.entries(plans[0]).forEach(([key, value]) => {
                        if (typeof value === 'number' && value < 200) {
                            console.log(`✅ [UPGRADE] Small number field: ${key} = ${value}`);
                        }
                        if (key.toLowerCase().includes('plan') || key.toLowerCase().includes('id')) {
                            console.log(`✅ [UPGRADE] ID-related field: ${key} =`, value);
                        }
                    });
                    
                    if (plans[0].serv_rates) {
                        console.log('✅ [UPGRADE] First plan serv_rates (FULL):', JSON.stringify(plans[0].serv_rates, null, 2));
                        console.log('✅ [UPGRADE] serv_rates keys:', Object.keys(plans[0].serv_rates));
                        
                        // Look for planid inside serv_rates
                        Object.entries(plans[0].serv_rates).forEach(([key, value]) => {
                            console.log(`✅ [UPGRADE] serv_rates.${key} =`, value);
                        });
                    }
                }
                
                if (Array.isArray(plans) && plans.length > 0) {
                    setUpgradePlans(plans);
                    setFilteredUpgradePlans(plans);
                    enterSubView('upgrade-plans');
                } else {
                    setUpgradePlansError('No upgrade plans available at the moment.');
                }
            } else {
                const errorMsg = plansResponse?.status?.err_msg || 'Failed to fetch upgrade plans.';
                setUpgradePlansError(errorMsg);
            }
            
            setUpgradePlansLoading(false);
        } catch (error) {
            console.error('❌ [UPGRADE] Error in upgrade flow:', error);
            setUpgradePlansError('An error occurred while fetching upgrade plans. Please try again.');
        } finally {
            setUpgradePlansLoading(false);
        }
    };

    // Filter upgrade plans based on search term
    const handleUpgradeSearch = (term) => {
        setUpgradeSearchTerm(term);
        if (!term) {
            setFilteredUpgradePlans(upgradePlans);
            return;
        }

        const lowerTerm = term.toLowerCase();
        const filtered = upgradePlans.filter(plan => {
            const name = plan.planname || plan.serv_name || plan.plan_name || plan.name || '';
            const price = String(plan.planrate || plan.serv_rates?.prices?.[0] || plan.price || '');
            return name.toLowerCase().includes(lowerTerm) ||
                plan.serv_desc?.toLowerCase().includes(lowerTerm) ||
                price.includes(term);
        });
        setFilteredUpgradePlans(filtered);
    };

    // Select an upgrade plan (supports both fofi_plans and internet_plans)
    const handleUpgradePlanSelect = async (plan) => {
        console.log('🔵 [UPGRADE] Plan selected:', plan);
        console.log('🔵 [UPGRADE] Plan keys:', Object.keys(plan));
        console.log('🔵 [UPGRADE] Plan source:', plan._source);

        // Get plan ID - supports both planid (fofi_plans) and servid (internet_plans)
        const planIdentifier = plan.planid || plan.servid || plan.srvid || plan.id;
        console.log('🔵 [UPGRADE] Plan ID:', planIdentifier, '(planid:', plan.planid, ', servid:', plan.servid, ')');

        // Validate that some ID exists (required for payment API)
        if (!planIdentifier) {
            console.error('❌ [UPGRADE] No plan ID found! This plan cannot be used for payment.');
            toast.add('Error: This plan does not have a valid Plan ID. Please select another plan.', { type: 'error' });
            return;
        }

        // Get the plan price - supports both fofi_plans (planrate) and internet_plans (serv_rates.prices)
        let planPrice = plan.planrate || plan.price || plan.amount || 0;

        // For internet_plans, extract price from serv_rates
        if (!planPrice && plan.serv_rates?.prices?.length > 0) {
            planPrice = plan.serv_rates.prices[0];
        }

        const numericPrice = parseFloat(String(planPrice).replace(/[^0-9.]/g, '')) || 0;

        console.log('🔵 [UPGRADE] Plan price:', planPrice, 'Numeric:', numericPrice);

        // FTA plans legitimately have ₹0 price — allow them to proceed
        setSelectedPlan(plan);

        // Check if this is an existing FoFi user (has service already)
        if (hasConfirmedFofiService && fofiServiceDetails) {
            // EXISTING USER - Show subscription confirmation screen with auto-detected Box ID
            console.log('🔵 [UPGRADE] Existing user - showing subscription confirmation screen...');
            console.log('🔵 [UPGRADE] Plan Name:', plan?.planname || plan?.serv_name);
            console.log('🔵 [UPGRADE] Plan ID:', planIdentifier);
            console.log('🔵 [UPGRADE] Box ID:', fofiServiceDetails.boxId);

            // Navigate to subscription confirmation view
            enterSubView('subscription-confirm');
        } else {
            // NEW USER - Navigate to link-fofi view with selected plan
            setIsUpgradeLinkContinuation(true);
            enterSubView('link-fofi');
        }
    };
    
    // Handle SUBMIT from subscription confirmation screen (existing users)
    const handleSubscriptionSubmit = async () => {
        if (!selectedPlan || !fofiServiceDetails) {
            toast.add('Please select a plan first', { type: 'error' });
            return;
        }
        
        console.log('🔵 [SUBSCRIPTION] Submitting subscription...');
        setIsLoading(true);
        
        try {
            const user = getUser();
            const loginuname = user?.username || 'superadmin';
            const username = customerData?.username || customerData?.customer_id;
            
            // Get FoFi box details from existing service
            // CRITICAL: Use raw fofiboxid from _rawFofiItem — backend expects the
            // original API field value, not the processed/displayed boxId.
            // The _rawFofiItem contains the original getUserAssignedItems response.
            const _sanitize = (v) => (!v || v === 'N/A') ? '' : v;
            const rawItem = fofiServiceDetails._rawFofiItem || {};
            const fofiBoxId = _sanitize(rawItem.fofiboxid || rawItem.fofi_box_id || rawItem.boxid || fofiServiceDetails.boxId);
            const fofiMac = _sanitize(rawItem.mac || rawItem.macid || rawItem.mac_addr || fofiServiceDetails.macAddress);
            const fofiSerial = _sanitize(rawItem.fserialno || rawItem.serial_number || rawItem.serialno || rawItem.fofiserailnumber || fofiServiceDetails.serialNumber);

            // Debug: log raw API data to help identify correct field names
            console.log('🔵 [SUBSCRIPTION] Raw fofiItem fields:', JSON.stringify(fofiServiceDetails._rawFofiItem, null, 2));
            console.log('🔵 [SUBSCRIPTION] Raw fofiSvc fields:', JSON.stringify(fofiServiceDetails._rawFofiSvc, null, 2));
            console.log('🔵 [SUBSCRIPTION] Sanitized → boxId:', fofiBoxId, '| mac:', fofiMac, '| serial:', fofiSerial);

            // Validate box ID before calling API
            if (!fofiBoxId) {
                toast.add('FoFi Box ID not found. Please contact support.', { type: 'error' });
                setIsLoading(false);
                return;
            }

            // Log ALL plan fields exhaustively to find planid like "55"
            console.log('🔵 [SUBSCRIPTION] ========== FULL PLAN ANALYSIS ==========');
            console.log('🔵 [SUBSCRIPTION] Full plan object (JSON):', JSON.stringify(selectedPlan, null, 2));
            console.log('🔵 [SUBSCRIPTION] All plan keys:', Object.keys(selectedPlan));
            
            // Check all possible planid fields
            console.log('🔵 [SUBSCRIPTION] === Direct plan fields ===');
            console.log('  plan.id:', selectedPlan.id);
            console.log('  plan.planid:', selectedPlan.planid);
            console.log('  plan.plan_id:', selectedPlan.plan_id);
            console.log('  plan.srvid:', selectedPlan.srvid);
            console.log('  plan.servid:', selectedPlan.servid);
            console.log('  plan.service_id:', selectedPlan.service_id);
            console.log('  plan.fofi_planid:', selectedPlan.fofi_planid);
            console.log('  plan.ott_planid:', selectedPlan.ott_planid);
            
            // Check serv_rates deeply
            if (selectedPlan.serv_rates) {
                console.log('🔵 [SUBSCRIPTION] === serv_rates fields ===');
                console.log('  serv_rates (JSON):', JSON.stringify(selectedPlan.serv_rates, null, 2));
                console.log('  serv_rates keys:', Object.keys(selectedPlan.serv_rates));
                console.log('  serv_rates.planid:', selectedPlan.serv_rates.planid);
                console.log('  serv_rates.plan_id:', selectedPlan.serv_rates.plan_id);
                console.log('  serv_rates.id:', selectedPlan.serv_rates.id);
                console.log('  serv_rates.srvid:', selectedPlan.serv_rates.srvid);
                console.log('  serv_rates.servid:', selectedPlan.serv_rates.servid);
                console.log('  serv_rates.priceid:', selectedPlan.serv_rates.priceid);
            }
            
            // Check if there's a rates array
            if (selectedPlan.rates) {
                console.log('🔵 [SUBSCRIPTION] === rates array ===');
                console.log('  rates:', selectedPlan.rates);
            }
            
            // Check plan_details
            if (selectedPlan.plan_details) {
                console.log('🔵 [SUBSCRIPTION] === plan_details ===');
                console.log('  plan_details:', JSON.stringify(selectedPlan.plan_details, null, 2));
            }
            
            console.log('🔵 [SUBSCRIPTION] ========================================');
            
            // Extract plan details
            const servRates = selectedPlan.serv_rates || {};
            const planName = selectedPlan.serv_name || selectedPlan.planname || selectedPlan.plan_name || '';

            // DEBUG: Log full plan object to find correct OTT plan ID field
            console.log('🔴🔴🔴 DEBUG: selectedPlan FULL:', JSON.stringify(selectedPlan, null, 2));
            console.log('🔴🔴🔴 DEBUG: serv_rates FULL:', JSON.stringify(servRates, null, 2));
            console.log('🔴🔴🔴 DEBUG: selectedPlan keys:', Object.keys(selectedPlan));
            console.log('🔴🔴🔴 DEBUG: serv_rates keys:', Object.keys(servRates));
            console.log('🔴🔴🔴 DEBUG: ottPlansMap:', ottPlansMap);
            console.log('🔴🔴🔴 DEBUG: fofiServiceDetails:', fofiServiceDetails);
            console.log('🔴🔴🔴 DEBUG: planName:', planName);

            // PLAN ID EXTRACTION:
            // - fofi_plans: use planid
            // - internet_plans: use servid
            // Both are valid for the payment API

            let planId = '';

            // Get plan ID - supports both planid (fofi_plans) and servid (internet_plans)
            planId = String(
                selectedPlan.planid ||
                selectedPlan.servid ||
                selectedPlan.srvid ||
                selectedPlan.plan_id ||
                selectedPlan.id ||
                ''
            );
            console.log('🔵 [SUBSCRIPTION] Using plan ID:', planId, '(source:', selectedPlan._source || 'unknown', ')');

            // Validate we have a plan ID
            if (!planId) {
                console.error('❌ [SUBSCRIPTION] No plan ID found! Selected plan:', selectedPlan);
                toast.add('Error: Plan ID not found. Please select a valid plan.', { type: 'error' });
                setIsLoading(false);
                return;
            }

            // Extract price ID and plan price - supports both plan structures
            // fofi_plans: priceid, planrate
            // internet_plans: serv_rates.priceid, serv_rates.prices[0]
            const priceId = String(
                selectedPlan.priceid ||
                selectedPlan.price_id ||
                servRates.priceid ||
                servRates.price_id ||
                '99'
            );

            let planPrice = selectedPlan.planrate || selectedPlan.price || 0;
            // For internet_plans, extract price from serv_rates
            if (!planPrice && servRates.prices?.length > 0) {
                planPrice = servRates.prices[0];
            }

            // Service ID for FoFi/OTT is ALWAYS '3' - this is the service type for FoFi payment API
            const servId = '3';

            console.log('🔵 [SUBSCRIPTION] Plan details - planId:', planId, 'priceId:', priceId, 'planPrice:', planPrice);
            console.log('🔵 [SUBSCRIPTION] Box details - boxId:', fofiBoxId, 'mac:', fofiMac, 'serial:', fofiSerial);
            
            // =====================================================
            // STEP 1: Call upgradeRegistration API
            // =====================================================
            const upgradePayload = {
                fofiboxid: fofiBoxId,
                fofimac: fofiMac,
                fofiserailnumber: fofiSerial,
                loginuname: loginuname,
                services: ["ott"],
                username: username
            };
            
            // =====================================================
            // STEP 1+2: Fire upgradeRegistration + paymentinfo in PARALLEL
            // (saves ~500-1000ms vs sequential calls)
            // Customer details already fetched on page load — skip redundant calls
            // =====================================================
            const paymentPayload = {
                fofi_box_id: fofiBoxId,
                planid: planId,
                priceid: priceId,
                servapptype: "crmapp",
                servid: servId,
                userid: username,
                // username here is the SYSTEM caller, not the
                // logged-in operator. Cable TV hardcodes "superadmin"
                // and works; FoFi sending the real operator name
                // (e.g. "demopwa") makes generateorder reject the
                // returned transactionid with the misleading
                // "Available balance in wallet [X] should be greater
                // than 100" message. Operator identity is sent
                // through apiopid / paydoneby in the savePaymentApi
                // step, NOT here. Keep "superadmin" verbatim.
                username: "superadmin",
                voipnumber: ""
            };

            console.log('🔵 [PARALLEL] Calling upgradeRegistration + paymentinfo...');

            let upgradeResponse, paymentResponse;
            try {
                [upgradeResponse, paymentResponse] = await Promise.all([
                    upgradeRegistration(upgradePayload),
                    getFofiPaymentInfo(paymentPayload)
                ]);
            } catch (stepErr) {
                console.error('❌ API network error:', stepErr);
                toast.add('Request failed: ' + (stepErr?.message || 'Network error'), { type: 'error' });
                setIsLoading(false);
                return;
            }

            console.log('🟢 Upgrade Response:', upgradeResponse);
            console.log('🟢 Payment Info Response:', paymentResponse);

            if (upgradeResponse?.status?.err_code !== 0) {
                const errorMsg = upgradeResponse?.status?.err_msg || 'Failed to register upgrade';
                console.error('❌ Upgrade registration failed:', errorMsg);
                toast.add('Failed to register upgrade: ' + errorMsg, { type: 'error' });
                setIsLoading(false);
                return;
            }

            if (paymentResponse?.status?.err_code !== 0) {
                const errorMsg = paymentResponse?.status?.err_msg || 'Failed to get payment info';
                console.error('❌ Payment info failed:', errorMsg);
                toast.add('Failed to get payment info: ' + errorMsg, { type: 'error' });
                setIsLoading(false);
                return;
            }
            
            // =====================================================
            // STEP 4: Navigate to payment page with response data
            // =====================================================
            const paymentBody = paymentResponse?.body || {};
            
            // Debug: Log the full API response structure
            console.log('🔴 [DEBUG] Full paymentBody:', JSON.stringify(paymentBody, null, 2));
            
            // API Response Structure (actual):
            // - planrate: "130.00" (string)
            // - total_amt: 153.4 (number)
            // - tax: 23.4 (total tax)
            // - tax_details: [{ title: "SGST", percent: "9%", amt: 11.7 }, { title: "CGST", percent: "9%", amt: 11.7 }]
            // - balance_amt: 0
            // - other_amt: 0
            // - oprtrshare: 153.4 (operator share)
            // - bbnl_share: "-23.40"
            // - tds: 0
            // - softwarecharges: 0
            // - fofishare: 0
            // - deduction: { title: "...", totalamount: "0.00" }
            
            // Extract tax details from tax_details array
            const taxDetails = paymentBody?.tax_details || [];
            const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
            const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
            const cgst = cgstObj?.amt || 0;
            const sgst = sgstObj?.amt || 0;
            
            // Extract amounts directly from paymentBody
            const extractedPlanRate = parseFloat(paymentBody?.planrate) || planPrice || 0;
            const extractedTotal = paymentBody?.total_amt || 0;
            const otherCharges = paymentBody?.other_amt || 0;
            const balanceAmount = paymentBody?.balance_amt || 0;
            
            // Extract share info directly from paymentBody
            const operatorShare = paymentBody?.oprtrshare || 0;
            const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
            const softCharge = paymentBody?.softwarecharges || 0;
            const tds = paymentBody?.tds || 0;
            const fofiShare = paymentBody?.fofishare || 0;
            
            const amountDeductable = resolveFoFiAmountDeductable(paymentBody);

            const fofiPaymentData = {
                // Customer & Plan identifiers (using fofi_plans structure)
                userid: username,
                fofiboxid: fofiBoxId,
                planid: planId, // from fofi_plans.planid
                priceid: priceId, // from fofi_plans.priceid
                servid: servId,
                loginuname: loginuname,
                // paytype "upgrade" matches the mobile-app trace
                // (verified May 2026 by client-side log dump).
                // Earlier probes that seemed to require "renewal"
                // were running against a customer whose subscription
                // state caused every payload variant to reject —
                // the real bug was the username field.
                paytype: 'upgrade',
                transactionid: paymentBody?.transactionid || '',
                
                // Wallet balance (not in this response, default to 0)
                walletBalance: 0,
                
                // Payment details for display
                paymentDetails: {
                    "Plan Name": paymentBody?.planname || selectedPlan?.planname || "N/A",
                    "Plan Rate": extractedPlanRate,
                    "CGST": cgst,
                    "SGST": sgst,
                    "Other Charges": otherCharges,
                    "Balance Amount": balanceAmount,
                    "Total Amount": extractedTotal
                },
                
                // More details — only include non-zero positive values (matches production)
                moreDetails: {
                    "Operator Share": operatorShare,
                    ...(bbnlShare > 0 ? { "BBNL Share": bbnlShare } : {}),
                    ...(softCharge > 0 ? { "Software Charges": softCharge } : {}),
                    ...(tds > 0 ? { "TDS": tds } : {}),
                    "Amount Deductable": amountDeductable
                },

                noofmonth: 1,
                amountDeductable: amountDeductable,
                customer: customerData,
                planName: paymentBody?.planname || selectedPlan?.planname || "N/A",
                planRate: extractedPlanRate,
                totalAmount: extractedTotal,
                operatorShare: operatorShare
            };
            
            console.log('🔵 [STEP 4] Navigating to FoFi Payment with fofi_plans data:', fofiPaymentData);

            // Pop our subview history entries (upgrade-plans,
            // subscription-confirm, link-fofi etc.) BEFORE pushing
            // the /fofi-payment route. Without this, after payment
            // success the back button walks the user back through
            // those subview markers — but the component has been
            // unmounted/remounted by then so subview state is empty
            // (operator saw "No plans found", "Plan Name: N/A", etc.).
            // Cleaning the history here means back from the
            // post-payment overview lands cleanly on the customer
            // list, matching the mobile app behaviour.
            const subviewDepth = subViewDepthRef.current;
            if (subviewDepth > 0) {
                cleanupPopStateRef.current = subviewDepth;
                window.history.go(-subviewDepth);
                // history.go fires popstates on the next task; wait
                // for them to drain so the listener processes the
                // cleanup ref before we push the new route.
                await new Promise(resolve => setTimeout(resolve, 30 * subviewDepth + 30));
            }
            // Navigate to FoFi Payment Review page
            navigate('/fofi-payment', { state: fofiPaymentData });
            
        } catch (error) {
            console.error('❌ [SUBSCRIPTION] Error:', error);
            const errMsg = error?.message || 'Unknown error';
            toast.add('Failed to process subscription: ' + errMsg, { type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    // ── Hardware back button / history support for internal views ──
    //
    // Per-transition history entries — each enterSubView pushes its
    // own marker, so phone-back walks the user one view at a time:
    //
    //   overview → upgrade-plans → subscription-confirm → payment
    //   ← back ← back ← back ← back to Choose Service
    //
    // Previously the code pushed ONE entry on first leave-from-
    // overview and treated every back press as "go to overview" —
    // that skipped intermediate steps and was the cross-cutting
    // reason QA reported "back doesn't go to previous page".
    //
    // subViewDepthRef tracks how many entries we've pushed so
    // programmatic returns (errors, post-payment) can pop exactly
    // that many — never overshooting and exiting the route.
    const subViewDepthRef = useRef(0);
    // Number of popstate events the listener should ignore because
    // we triggered them programmatically as part of pre-payment
    // history cleanup. Without this guard, the popstates fired by
    // window.history.go(-N) would each call setView() to a stale
    // subview just before we navigate away.
    const cleanupPopStateRef = useRef(0);
    const enterSubView = (newView) => {
        if (view === newView) return;
        try {
            // CRITICAL: spread the existing history state. React
            // Router stores location.state inside window.history.state
            // under its own keys (`usr`, `key`, `idx`). A bare
            // pushState({ fofiView }) wipes those — and on popstate
            // React Router rehydrates location.state as empty, which
            // is what produced the "No customer data available"
            // page and the TypeError reading customerData.name on
            // some devices.
            window.history.pushState(
                { ...(window.history.state || {}), fofiView: newView },
                ''
            );
            subViewDepthRef.current += 1;
        } catch (_) {}
        // Clear any stale validation error from a prior attempt so the
        // error popup doesn't re-appear when the user enters the scan view.
        setValidationError('');
        setView(newView);
    };
    useEffect(() => {
        // When entered from Internet Service, there is no FoFi overview to
        // return to — back should pop the route and land on Internet Service.
        // Registering this listener would override that with setView('overview').
        if (fromInternet) return;
        const onPopState = (e) => {
            // Skip this popstate if it was triggered by the QR scanner
            // closing its own history entry (not a real back navigation)
            if (skipNextPopStateRef.current) {
                skipNextPopStateRef.current = false;
                return;
            }
            // Skip this popstate if it's part of the pre-payment
            // history cleanup. We're about to navigate to /fofi-payment
            // anyway, so re-rendering an intermediate subview here
            // just creates a flicker.
            if (cleanupPopStateRef.current > 0) {
                cleanupPopStateRef.current -= 1;
                if (subViewDepthRef.current > 0) subViewDepthRef.current -= 1;
                return;
            }
            // Each pop reduces our owned-entries count.
            if (subViewDepthRef.current > 0) subViewDepthRef.current -= 1;
            // Read the fofiView marker from the entry we landed on.
            // Missing marker means we popped past all our sub-view
            // entries — back to the route's natural state (overview).
            const target = e.state?.fofiView || 'overview';
            setView(target);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [fromInternet]);

    // In-app back chevrons — call this so they share the popstate
    // path with the phone hardware back button. Keeps history and
    // view in sync regardless of which back path the user chose.
    const goBackOneView = () => { try { window.history.back(); } catch (_) {} };
    // Programmatic full-reset (errors / post-payment success). Pops
    // exactly subViewDepthRef.current entries so we land cleanly on
    // overview without overshooting and exiting the route.
    const goBackToOverview = () => {
        const depth = subViewDepthRef.current;
        if (depth > 0) {
            try { window.history.go(-depth); return; } catch (_) {}
        }
        // Already at overview, or history.go failed — just sync state.
        subViewDepthRef.current = 0;
        setView('overview');
    };

    // Open QR scanner — push a history entry so the hardware back button
    // closes the scanner instead of navigating away from the page.
    const handleQRScan = () => {
        // Clear any stale error popup from a previous scan attempt
        setValidationError('');
        window.history.pushState({ ...window.history.state, qrScanner: true }, '');
        setShowQRScanner(true);
    };

    // Close QR scanner when the user presses the hardware/OS back button.
    // On Android the hardware back key fires popstate; on iPhone a swipe-back
    // gesture does the same. In both cases the pushed entry is already popped
    // by the browser, so we only need to close the scanner UI.
    useEffect(() => {
        if (!showQRScanner) return;
        const onPopState = () => {
            setShowQRScanner(false);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [showQRScanner]);

    // Handle QR code scan result
    const handleQRCodeScanned = async (qrData) => {
        try {
            // Close scanner first, then clean up the history entry
            setShowQRScanner(false);
            // Pop the QR scanner history entry. Set the skip flag so the
            // sub-view popstate listener ignores this pop (it's not a real
            // back navigation — we're just cleaning up the scanner's entry).
            queueMicrotask(() => {
                if (window.history.state?.qrScanner) {
                    skipNextPopStateRef.current = true;
                    window.history.back();
                }
            });
            setIsLoading(true);
            setValidationError('');
            setValidationMethod('qr');

            console.log('🔵 QR Code scanned:', qrData);

            // ──────────────────────────────────────────────────────
            // Native QR-scan flow (per server log of native app):
            //
            //   1. Decode QR → extract emacid (MAC) + serialno.
            //      The QR does NOT carry the Box ID; it's the
            //      backend's job to issue it.
            //
            //   2. POST /netmon/fofi/fofiapis/validateAsset with
            //      { mac_addr, serialno, userid:"<operator>",
            //        boxid:"" }
            //      — userid is ALWAYS the logged-in operator, not
            //      the customer. boxid is empty so the backend
            //      generates / returns the canonical Box ID.
            //
            //   3. Read Box ID from the response and display it
            //      in the FOFI Box ID field. MAC stays as the QR
            //      value. Don't fall back to anything QR-encoded.
            //
            //   4. If err_code !== 0 (e.g. "device already
            //      assigned"), surface the backend message and
            //      clear MAC so the operator can't link a taken
            //      device.
            // ──────────────────────────────────────────────────────
            let parsedQRData;
            try {
                const decodedData = atob(qrData);
                parsedQRData = JSON.parse(decodedData);
                console.log('🟢 Parsed QR data:', parsedQRData);
            } catch (parseError) {
                console.error('❌ Failed to parse QR data:', parseError);
                setValidationError('Invalid QR code format. Please scan a valid FoFi device QR code.');
                setIsLoading(false);
                return;
            }

            const qrMacAddress = parsedQRData.emacid || parsedQRData.macid || parsedQRData.mac || '';
            const qrSerialNumber = parsedQRData.serialno || parsedQRData.serial || '';

            if (!qrMacAddress || !qrSerialNumber) {
                setValidationError('QR code is missing MAC or serial number. Please rescan.');
                setIsLoading(false);
                return;
            }

            const opUser = getUser();
            const operatorUserId = opUser?.username || 'superadmin';

            console.log('🔵 [QR] validateAsset →', {
                mac_addr: qrMacAddress,
                serialno: qrSerialNumber,
                userid: operatorUserId,
                boxid: '',
            });

            let response;
            try {
                response = await validateFoFiAsset({
                    mac_addr: qrMacAddress,
                    serialno: qrSerialNumber,
                    userid: operatorUserId,
                    boxid: '',
                });
            } catch (validateErr) {
                if (validateErr?.message?.includes('navigated away')) return;
                console.error('❌ [QR] validateAsset threw:', validateErr);
                // Network failure — keep MAC/serial from QR so the
                // operator sees what they scanned, then surface the
                // error and let them retry.
                setMacAddress(qrMacAddress);
                setSerialNumber(qrSerialNumber);
                setBoxId('');
                setValidationError(validateErr?.message || 'Could not validate this device. Please try again.');
                setIsLoading(false);
                return;
            }
            console.log('🟢 [QR] validateAsset response:', response);

            // Deep-search helper — the backend embeds the canonical
            // Box ID in different places across success vs. error
            // responses (named field, err_msg, nested wrapper).
            //
            // The Box ID and the QR-encoded serial number are
            // DIFFERENT identifiers — verified against the live API:
            //   serialno  FOFI20190729000335
            //   mac_addr  68:1D:EF:14:6B:97
            //   boxid     bbnl-ANDBOX-... (issued by validateAsset)
            // The product owner has been explicit that the field
            // here must show the API-returned Box ID and never the
            // serial. So this regex only matches actual Box ID
            // formats (bbnl-*, BBNL_*) — never the FOFI<digits>
            // serial pattern, even though it appears in some err_msg
            // strings.
            const BOX_ID_PATTERN = /\b(bbnl[-_][A-Za-z0-9_-]+|BBNL[-_][A-Za-z0-9_-]+)\b/i;
            const deepFindBoxId = (obj, depth = 0) => {
                if (obj == null || depth > 6) return '';
                if (typeof obj === 'string') {
                    const m = obj.match(BOX_ID_PATTERN);
                    return (m && m[1]) || '';
                }
                if (typeof obj !== 'object') return '';
                if (Array.isArray(obj)) {
                    for (const item of obj) {
                        const found = deepFindBoxId(item, depth + 1);
                        if (found) return found;
                    }
                    return '';
                }
                for (const key of Object.keys(obj)) {
                    const found = deepFindBoxId(obj[key], depth + 1);
                    if (found) return found;
                }
                return '';
            };

            // Pull the Box ID from named fields on the response body.
            // We trust whatever the named field carries (no pattern
            // gate here) — the API is authoritative for what the Box
            // ID is. We deliberately exclude `product_name` and
            // similar serial-bearing fields because they may carry
            // the FOFI<digits> serial which is NOT the Box ID.
            const respBody = Array.isArray(response?.body) ? (response.body[0] || {}) : (response?.body || {});
            let apiBoxId =
                respBody.boxid || respBody.box_id ||
                respBody.fofiboxid || respBody.fofi_box_id ||
                respBody.stbid || respBody.stb_id ||
                respBody.device_id || '';
            apiBoxId = String(apiBoxId || '').trim();

            // Fallback — deep search the entire response, including
            // status.err_msg, for a bbnl-style Box ID. Some backends
            // embed the canonical ID in the "already assigned"
            // message; that's still the authoritative Box ID.
            if (!apiBoxId && response) {
                apiBoxId = deepFindBoxId(response) || '';
                if (apiBoxId) console.log('🔎 [QR] Box ID via deep search:', apiBoxId);
            }

            const apiMacAddress =
                respBody.mac_addr || respBody.macAddress || respBody.mac || respBody.macid || qrMacAddress;
            const apiSerialNumber =
                respBody.serialno || respBody.serialNumber || respBody.serial_number ||
                respBody.serial || respBody.fserialno || qrSerialNumber;
            const multicastDeviceId = respBody.multicast_id || respBody.multicastDeviceId || '';
            const unicastDeviceId = respBody.unicast_id || respBody.unicastDeviceId || '';

            // ALWAYS populate MAC + serial — they come from the QR
            // and stay valid regardless of whether the API succeeded.
            // Box ID populates ONLY from what validateAsset returned;
            // we never substitute the serial here. If the API didn't
            // return a Box ID (e.g. "device not found"), the field
            // stays blank and the operator sees the err_msg banner.
            setMacAddress(apiMacAddress);
            setSerialNumber(apiSerialNumber);
            setBoxId(apiBoxId || '');
            setDeviceInfo({
                boxId: apiBoxId,
                macAddress: apiMacAddress,
                serialNumber: apiSerialNumber,
                multicastDeviceId,
                unicastDeviceId,
            });

            const errCode = response?.status?.err_code;
            const errMsg = response?.status?.err_msg || '';

            if (errCode === 0) {
                // Fresh device — operator can pick a plan and link.
                console.log('✅ [QR] Validated:', { boxId: apiBoxId, macAddress: apiMacAddress, serialNumber: apiSerialNumber });
                setDeviceValidated(true);
                setShowValidationSuccess(true);
                setValidationError('');
            } else {
                // Backend rejected (typically "already assigned").
                // MAC + serial stay populated so operator sees what
                // they scanned. Surface the verbatim backend message.
                console.log(`📛 [QR] Backend rejected: "${errMsg}". Box ID extracted: "${apiBoxId}"`);
                setDeviceValidated(false);
                setShowValidationSuccess(false);
                setValidationError(
                    formatFoFiValidationError(response, { fallbackMac: apiMacAddress, fallbackBoxId: apiBoxId }) ||
                    'This device cannot be linked. Please rescan or check the box.'
                );
            }
        } catch (error) {
            // Navigation-controller aborts throw this message — not a
            // user-facing error. Silently drop.
            if (error?.message?.includes('navigated away')) return;
            console.error('❌ QR validation error:', error);
            // Surface the real message (backend err_msg or HTTP failure)
            // rather than hiding it behind a generic prefix.
            setValidationError(error?.message || 'Device validation failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle QR scanner error
    const handleQRScanError = (error) => {
        console.error('QR scanner error:', error);
        setValidationError('QR scanner error: ' + error);
    };

    // Handle QR scanner close (Cancel / X button)
    const handleQRScannerClose = () => {
        setShowQRScanner(false);
        // Pop the QR scanner history entry. Set the skip flag so the
        // sub-view popstate listener ignores this pop.
        queueMicrotask(() => {
            if (window.history.state?.qrScanner) {
                skipNextPopStateRef.current = true;
                window.history.back();
            }
        });
    };

    // MAC fetch handler with backend integration using validateFoFiAsset API
    // API: fofi/fofiapis/validateAsset
    // Request: { mac_addr: "", serialno: "", userid: "superadmin", boxid: "BBNL-ANDBOX-00000933" }
    const handleFetchMAC = async () => {
        try {
            setValidationError('');
            setIsLoading(true);

            if (!boxId.trim()) {
                setValidationError('Please enter a Box ID');
                setIsLoading(false);
                return;
            }
            setMacAddress('');
            setSerialNumber('');
            setDeviceInfo(null);
            setDeviceValidated(false);
            setShowValidationSuccess(false);

            // Manual flow has NO QR fallback — if validateAsset rejects,
            // the user can't get the MAC. So we try multiple userid
            // values and use whichever the backend accepts. Production
            // saw a regression where "operator op_id" used to work and
            // now returns "not a valid user to register" for some
            // customers, while "customer username" works for others
            // (and vice versa). Trying both sequentially is the only
            // way to keep the manual flow working without a backend
            // contract guarantee.
            const opUser = getUser();
            const customerUsername = customerData?.username || customerData?.customer_id || '';
            const operatorOpId = opUser?.op_id || '';
            const operatorUsername = opUser?.username || '';

            // De-dup and order: operator username first (same as QR),
            // superadmin second (legacy/native trace), OPID third for
            // ownership checks, customer last for old compatibility.
            const useridCandidates = Array.from(new Set(
                [operatorUsername, 'superadmin', operatorOpId, customerUsername].filter(Boolean)
            ));
            if (useridCandidates.length === 0) {
                setValidationError('No valid user identifier found. Please log in again or re-open this service from the customer list.');
                setIsLoading(false);
                return;
            }

            console.log('🔵 [GET MAC ID] Calling validateAsset API...');
            console.log('🔵 [GET MAC ID] Box ID:', boxId);
            console.log('🔵 [GET MAC ID] userid candidates (in order):', useridCandidates);

            // GET MAC ID is just a MAC LOOKUP at this stage — the
            // ownership decision is made at SUBMIT (handleLinkFoFiBox
            // STEP 0 re-validates with the final Box ID + MAC).
            //
            // Strategy: try each userid candidate; collect every
            // response. ANY response that contains a MAC (in body or
            // in err_msg — backend emits the MAC even on errors like
            // "Fo-Fi device(11:1D:EF:1A:12:3F) already assigned") is
            // accepted as the result for display purposes. err_code
            // is no longer a gate here. We prefer success responses
            // when available, but fall back to a MAC-bearing error
            // response so the user sees the device's MAC.
            const extractMacFromBody = (resp) => {
                return extractFoFiMac({ body: getFoFiValidationBody(resp) });
            };
            const extractMacFromMsg = (resp) => {
                return extractFoFiMac({ status: resp?.status });
            };

            // Ownership-blocker detector — recognises every backend
            // phrasing we've seen in production for "this device is
            // already taken by another user":
            //
            //   By MAC (QR flow) → "Fo-Fi device(MAC) already assigned"
            //   By Box ID (manual) → "Device details not found" — the
            //     backend's way of saying "you don't have access to
            //     this device" when it's claimed by another op pool.
            //   Other variants → already registered / in use / linked /
            //     belongs to <op> & <not available>.
            //
            // Treating "Device details not found" as an assignment
            // conflict here is intentional: in the manual-entry path
            // the operator has already typed a real Box ID off the
            // sticker, so a "not found" response on a real-format ID
            // overwhelmingly means it's assigned, not missing.
            let successResp = null;
            let successUserid = '';
            let macResp = null;       // any response that yielded a MAC
            let macUserid = '';
            let lastErrMsg = '';
            // ownershipBlocker captures the FIRST conflict signal AND
            // any MAC seen across attempts — sometimes the MAC arrives
            // in one userid's response while the "Device details not
            // found" message arrives from another. Pooling them lets
            // us emit "FoFi device(MAC) already assigned" even when
            // the MAC and the conflict signal came from different
            // attempts.
            let ownershipBlocker = null;
            let bestMacAcrossAttempts = '';

            for (const candidate of useridCandidates) {
                try {
                    console.log(`🔵 [GET MAC ID] Trying userid="${candidate}"...`);
                    const r = await validateFoFiAsset({
                        mac_addr: '',
                        serialno: '',
                        userid: candidate,
                        boxid: boxId.trim()
                    });
                    const errCode = r?.status?.err_code;
                    const errMsg = r?.status?.err_msg || '';
                    console.log(`🟢 [GET MAC ID] userid="${candidate}" → err_code=${errCode}, err_msg="${errMsg}"`);

                    // Pool any MAC we see across attempts.
                    const macFromBody = extractMacFromBody(r);
                    const macFromMsg = extractMacFromMsg(r);
                    if (!bestMacAcrossAttempts && (macFromBody || macFromMsg)) {
                        bestMacAcrossAttempts = macFromBody || macFromMsg;
                    }

                    if (errCode === 0) {
                        successResp = r;
                        successUserid = candidate;
                        break; // clean success — abort retry
                    }

                    // Definitive ownership-conflict signal.
                    const classification = classifyFoFiValidationMessage(errMsg);
                    if (!ownershipBlocker && (classification.kind === 'not-belongs' || classification.kind === 'already-assigned')) {
                        ownershipBlocker = {
                            kind: classification.kind,
                            msg: errMsg,
                            mac: macFromMsg || macFromBody,
                            opid: classification.opid,
                        };
                        console.log(`📛 [GET MAC ID] Ownership blocker captured: "${errMsg}"`);
                        // Don't break yet — a later candidate's response
                        // might surface the MAC even when this one didn't.
                    }

                    // Capture any MAC-bearing response for the success path.
                    if ((macFromBody || macFromMsg) && !macResp) {
                        macResp = r;
                        macUserid = candidate;
                        console.log(`📌 [GET MAC ID] Captured MAC-bearing error response from userid="${candidate}"`);
                    }
                    lastErrMsg = errMsg || lastErrMsg;
                } catch (e) {
                    if (e?.message?.includes('navigated away')) {
                        return;
                    }
                    console.warn(`⚠️ [GET MAC ID] userid="${candidate}" threw:`, e?.message);
                    lastErrMsg = e?.message || lastErrMsg;
                }
            }

            // SHORT-CIRCUIT: device is already assigned. Match the
            // reference app's wording exactly: "Fo-Fi device(MAC)
            // already assigned" (with hyphen, no space before paren).
            // Prefer the backend's verbatim message when it's already
            // in this shape — otherwise synthesise it.
            //
            // Manual flow deliberately does NOT clear the Box ID field
            // the operator typed — that mirrors the reference app
            // where the Box ID stays visible while the toast appears
            // at the bottom (matches the screenshot the user shared).
            //
            // Order matters: we ONLY treat this as a conflict if no
            // userid succeeded. A later candidate succeeding overrides
            // the earlier blocker (rare but possible — e.g. operator
            // username works after customer/op_id failed).
            if (ownershipBlocker && !successResp) {
                const rawMsg = String(ownershipBlocker.msg || '');
                const blockerResponse = {
                    status: { err_msg: rawMsg },
                    body: {
                        mac_addr: ownershipBlocker.mac || bestMacAcrossAttempts,
                        boxid: boxId.trim(),
                    },
                };
                const userMsg = formatFoFiValidationError(blockerResponse, {
                    fallbackMac: ownershipBlocker.mac || bestMacAcrossAttempts,
                    fallbackBoxId: boxId.trim(),
                });
                console.log(`📛 [GET MAC ID] Surfacing to user: "${userMsg}" (raw: "${rawMsg}")`);
                setValidationError(userMsg);
                setShowValidationSuccess(false);
                setDeviceValidated(false);
                setIsLoading(false);
                return;
            }

            // Pick the best response we have: success > MAC-bearing
            // error > nothing.
            const response = successResp || macResp;
            const userid = successUserid || macUserid;

            if (!response) {
                // No response had any MAC at all — either backend was
                // unreachable for every candidate or the Box ID is
                // genuinely invalid.
                setValidationError(formatFoFiValidationError({
                    status: { err_msg: lastErrMsg },
                    body: { boxid: boxId.trim() },
                }, { fallbackBoxId: boxId.trim() }) || 'Device not found. Please verify the Box ID is correct.');
                setIsLoading(false);
                return;
            }

            console.log(`✅ [GET MAC ID] Using response from userid="${userid}" (success=${!!successResp})`);
            console.log('🟢 [GET MAC ID] Response (full):', JSON.stringify(response, null, 2));

            {
                let extractedMac = extractMacFromBody(response);
                let extractedSerial = '';
                let extractedBoxId = extractFoFiBoxId(response, '');

                if (response?.body) {
                    const bodyData = getFoFiValidationBody(response);
                    extractedSerial = bodyData?.serial_number || bodyData?.serialNumber || bodyData?.serialno || bodyData?.serial || bodyData?.fserialno || '';
                    // Read the Box ID strictly from box-ID fields.
                    // product_name on the FoFi response carries the
                    // FOFI<digits> serial (same string surfaced as
                    // itemid in cabletvapis), so we deliberately
                    // exclude it here — Box ID and serial are
                    // separate identifiers and the user-facing field
                    // must show the API-issued Box ID only.
                    extractedBoxId = extractedBoxId || bodyData?.boxid || bodyData?.box_id || bodyData?.fofiboxid || bodyData?.fofi_box_id || bodyData?.stbid || bodyData?.stb_id || '';
                }

                // MAC from message — works for both success
                // ("Fo-Fi device(...) belongs to ... & available") and
                // error ("Fo-Fi device(...) already assigned").
                if (!extractedMac) {
                    extractedMac = extractMacFromMsg(response);
                    if (extractedMac) console.log('✅ [GET MAC ID] Extracted MAC from message:', extractedMac);
                }

                // Box ID from message — only matches actual Box ID
                // formats (bbnl-*, BBNL_*). Serial numbers
                // (FOFI<digits>) often appear in err_msg strings too,
                // but the product owner has been explicit that this
                // field must carry the API-issued Box ID, never the
                // serial. So we keep the regex strictly to
                // box-ID-shaped tokens.
                if (!extractedBoxId && response?.status?.err_msg) {
                    const boxMatch = String(response.status.err_msg).match(/\b(bbnl[-_][A-Za-z0-9_-]+|BBNL[-_][A-Za-z0-9_-]+)\b/i);
                    if (boxMatch && boxMatch[1]) {
                        extractedBoxId = boxMatch[1];
                        console.log('✅ [GET MAC ID] Extracted Box ID from message:', extractedBoxId);
                    }
                }

                if (!extractedMac) {
                    setValidationError(lastErrMsg || 'MAC address not found for this Box ID. Please verify the Box ID is correct.');
                    setIsLoading(false);
                    return;
                }

                // Optional enrichment: if serial / canonical box ID
                // missing, do a second call. Only on a clean success
                // (avoids piling more "already assigned" errors on the
                // user — STEP 0 at submit will surface that cleanly).
                if (successResp && (!extractedSerial || !extractedBoxId)) {
                    console.log('🔵 [GET MAC ID] Missing serial/boxId — second call with MAC...');
                    try {
                        const detailResp = await validateFoFiAsset({
                            mac_addr: extractedMac,
                            serialno: '',
                            userid: userid,
                            boxid: boxId.trim()
                        });
                        console.log('🟢 [GET MAC ID] Detail response:', JSON.stringify(detailResp, null, 2));
                        if (detailResp?.status?.err_code === 0 && detailResp?.body) {
                            const d = getFoFiValidationBody(detailResp);
                            if (!extractedSerial) extractedSerial = d?.serial_number || d?.serialNumber || d?.serialno || d?.serial || d?.fserialno || '';
                            if (!extractedBoxId) extractedBoxId = d?.boxid || d?.box_id || d?.fofiboxid || d?.fofi_box_id || '';
                        }
                        if (!extractedBoxId && detailResp?.status?.err_msg) {
                            const m = String(detailResp.status.err_msg).match(/\b(bbnl[-_][A-Za-z0-9_-]+|BBNL[-_][A-Za-z0-9_-]+)\b/i);
                            if (m && m[1]) extractedBoxId = m[1];
                        }
                    } catch (e) {
                        console.warn('⚠️ [GET MAC ID] Detail call failed (non-fatal):', e.message);
                    }
                }

                const finalBoxId = extractedBoxId || boxId.trim();
                const finalMac = extractedMac.toUpperCase();

                console.log('✅ [GET MAC ID] Final Box ID:', finalBoxId, extractedBoxId ? '(from API)' : '(user input)');
                console.log('✅ [GET MAC ID] Final MAC:', finalMac);
                console.log('✅ [GET MAC ID] Final Serial:', extractedSerial || '(empty)');

                // Populate the form. SUBMIT will re-validate ownership
                // via STEP 0 in handleLinkFoFiBox — that's the gate.
                setBoxId(finalBoxId);
                setMacAddress(finalMac);
                setSerialNumber(extractedSerial);
                setDeviceInfo({
                    macAddress: finalMac,
                    serialNumber: extractedSerial,
                    boxId: finalBoxId
                });
                setDeviceValidated(true);
                setShowValidationSuccess(true);
                setValidationMethod('manual');
                // Clear any previous error popup — fields populated is the success signal.
                setValidationError('');
            }
        } catch (error) {
            // Navigation-controller aborts throw this message — not a
            // user-facing error. Silently drop.
            if (error?.message?.includes('navigated away')) return;
            console.error('❌ [GET MAC ID] Error:', error);
            setValidationError(error?.message || 'Failed to validate device. Please check the Box ID and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Link FoFi Box handler - Uses upgradeRegistration API for fresh/new user registration
    const handleLinkFoFiBox = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            // Pre-flight check — only reject obviously incomplete
            // forms. We deliberately DON'T gate on deviceValidated
            // any more: that flag flips false on the validateAsset
            // "already assigned" path and used to block the LINK
            // button with a misleading "Please get MAC ID first"
            // message even when the MAC was clearly populated. The
            // STEP 0 re-validation below talks to validateAsset
            // again at submit time and surfaces the actual backend
            // verdict ("already assigned", "device not belongs to
            // this op", etc.), which is the message operators need.
            if (!selectedPlan) {
                setValidationError('Please select one plan from the selection');
                setIsLoading(false);
                return;
            }
            if (!boxId || !boxId.trim()) {
                setValidationError('Please scan the QR or enter the FOFI Box ID');
                setIsLoading(false);
                return;
            }
            if (!macAddress || !macAddress.trim()) {
                setValidationError('MAC ID is missing — click GET MAC ID or scan the QR');
                setIsLoading(false);
                return;
            }

            const user = getUser();
            const loginuname = user?.username || 'superadmin';
            const username = firstTrimmedValue(
                customerData?.username,
                customerData?.customer_id,
                routeCustomerId,
                loginuname
            );

            // Extract plan details
            // For combo plans (IPTV_OTT_COMBO), the OTT plan ID is in ottservplanid field inside serv_rates
            // For registrationNecessities API: servid is the internet plan ID, but we need OTT plan ID
            const servRates = selectedPlan.serv_rates || {};
            const { planid: planId, priceid: priceId, planrate: planPrice, servid: servId } = resolveFoFiPlanSelection(selectedPlan);
            const registrationFields = resolveFoFiRegistrationFields(selectedPlan);
            if (!planId) {
                setValidationError('Selected FoFi plan is missing a plan ID. Please select another plan.');
                setIsLoading(false);
                return;
            }
            // Service ID for FoFi/OTT is ALWAYS '3' - this is the service type

            console.log('🔵 Selected Plan Object:', selectedPlan);
            console.log('🔵 All plan fields:', Object.keys(selectedPlan));
            console.log('🔵 serv_rates fields:', Object.keys(servRates));
            console.log('🔵 serv_rates.ottservplanid:', servRates.ottservplanid);
            console.log('🔵 serv_rates.ottplanid:', servRates.ottplanid);
            console.log('🔵 serv_rates.fofiplanid:', servRates.fofiplanid);
            console.log('🔵 serv_rates.planid:', servRates.planid);
            console.log('🔵 Plan ID:', planId, 'Price ID:', priceId, 'Service ID:', servId);

            // Build the values that go into the freeOTAService /
            // upgradeRegistration payload. Prefer what GET MAC ID /
            // QR-scan stored on deviceInfo, but fall back to the form
            // fields so an operator who typed values manually still
            // works.
            //
            // No pre-flight validateAsset re-check here: the mobile
            // native trace goes straight from GET MAC ID to
            // freeOTAService with no intermediate re-validate, and
            // the previous PWA "STEP 0" was the actual reason
            // already-assigned devices saw "Please get MAC ID first"
            // and never reached the link API. The link/upgrade APIs
            // themselves validate ownership server-side and return
            // err_msg verbatim — the catch blocks below surface
            // those messages to the operator, which is the same
            // signal STEP 0 used to relay just one network hop
            // earlier.
            const finalBoxIdForSubmit = (deviceInfo && deviceInfo.boxId) || boxId;
            const finalMacForSubmit = macAddress;
            const finalSerialForSubmit = (deviceInfo && deviceInfo.serialNumber) || serialNumber || '';

            // =====================================================
            // FIRST-TIME LINK PATH (new user — !hasFofiService).
            //
            // Native app contract: ServiceApis/freeOTAService with
            //   { fofiboxid, fofimac, fofiserailnumber, loginuname,
            //     plan_id, services:["ott"], username }
            // On success: fetch FoFi payment info and continue to
            // the payment review page, matching the CRM flow.
            // =====================================================
            if (!hasConfirmedFofiService) {
                const linkPayload = {
                    fofiboxid: finalBoxIdForSubmit,
                    fofimac: finalMacForSubmit,
                    fofiserailnumber: finalSerialForSubmit,
                    loginuname: loginuname,
                    plan_id: planId,
                    ...registrationFields,
                    username: username,
                };
                console.log('🔵 [LINK] Calling freeOTAService…', linkPayload);
                let linkResp;
                try {
                    linkResp = await linkFoFiBox(linkPayload);
                } catch (e) {
                    if (e?.message?.includes('navigated away')) return;
                    setValidationError(e?.message || 'Failed to link FoFi box. Please try again.');
                    setIsLoading(false);
                    return;
                }
                console.log('🟢 [LINK] freeOTAService response:', linkResp);
                if (linkResp?.status?.err_code !== 0) {
                    setValidationError(linkResp?.status?.err_msg || 'Failed to link FoFi box.');
                    setIsLoading(false);
                    return;
                }

                const paymentPayload = {
                    fofi_box_id: finalBoxIdForSubmit,
                    planid: planId,
                    priceid: priceId,
                    servapptype: "crmapp",
                    servid: servId,
                    userid: username,
                    username: "superadmin",
                    voipnumber: ""
                };

                console.log('ðŸ”µ [LINK] Calling getFofiPaymentInfo API...', paymentPayload);
                const paymentResponse = await getFofiPaymentInfo(paymentPayload);
                console.log('ðŸŸ¢ [LINK] Payment Info Response:', paymentResponse);

                if (paymentResponse?.status?.err_code !== 0) {
                    setValidationError(paymentResponse?.status?.err_msg || 'Failed to get FoFi payment info.');
                    setIsLoading(false);
                    return;
                }

                const paymentBody = paymentResponse?.body || {};
                const taxDetails = paymentBody?.tax_details || [];
                const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
                const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
                const cgst = cgstObj?.amt || 0;
                const sgst = sgstObj?.amt || 0;
                const extractedPlanRate = parseFloat(paymentBody?.planrate) || parseFloat(planPrice) || 0;
                const extractedTotal = paymentBody?.total_amt || 0;
                const otherCharges = paymentBody?.other_amt || 0;
                const balanceAmount = paymentBody?.balance_amt || 0;
                const operatorShare = paymentBody?.oprtrshare || 0;
                const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
                const softCharge = paymentBody?.softwarecharges || 0;
                const tds = paymentBody?.tds || 0;
                const amountDeductable = resolveFoFiAmountDeductable(paymentBody);

                const fofiPaymentData = {
                    userid: username,
                    fofiboxid: finalBoxIdForSubmit,
                    planid: planId,
                    priceid: priceId,
                    servid: servId,
                    loginuname: loginuname,
                    paytype: 'new_registration',
                    transactionid: paymentBody?.transactionid || '',
                    walletBalance: 0,
                    paymentDetails: {
                        "Plan Name": paymentBody?.planname || selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || "N/A",
                        "Plan Rate": extractedPlanRate,
                        "CGST": cgst,
                        "SGST": sgst,
                        "Other Charges": otherCharges,
                        "Balance Amount": balanceAmount,
                        "Total Amount": extractedTotal
                    },
                    moreDetails: {
                        "Operator Share": operatorShare,
                        ...(bbnlShare > 0 ? { "BBNL Share": bbnlShare } : {}),
                        ...(softCharge > 0 ? { "Software Charges": softCharge } : {}),
                        ...(tds > 0 ? { "TDS": tds } : {}),
                        "Amount Deductable": amountDeductable
                    },
                    noofmonth: 1,
                    amountDeductable: amountDeductable,
                    planName: paymentBody?.planname || selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || "N/A",
                    planRate: extractedPlanRate,
                    totalAmount: extractedTotal,
                    operatorShare: operatorShare,
                    customer: customerData
                };

                try {
                    lsRemove(`uai_fofi_${username}`);
                    lsRemove(`uai_cabletv_${username}`);
                    lsRemove(`cblcust_${username}`);
                    lsRemove(`pricust_${username}`);
                    lsRemove(`plandets_fofi_${username}_${finalBoxIdForSubmit}`);
                    lsRemove(`plandets_fofi_${username}_`);
                } catch (_) { /* cache clear is best-effort */ }

                const subviewDepth = subViewDepthRef.current;
                if (subviewDepth > 0) {
                    cleanupPopStateRef.current = subviewDepth;
                    window.history.go(-subviewDepth);
                    await new Promise(resolve => setTimeout(resolve, 30 * subviewDepth + 30));
                }
                navigate('/fofi-payment', { state: fofiPaymentData });
                return;

            }

            // =====================================================
            // STEP 1: Call upgradeRegistration API (existing-user upgrade path)
            // =====================================================
            const upgradePayload = {
                fofiboxid: finalBoxIdForSubmit,
                fofimac: finalMacForSubmit,
                fofiserailnumber: finalSerialForSubmit,
                loginuname: loginuname,
                services: registrationFields.services,
                username: username
            };

            console.log('🔵 [STEP 1] Calling upgradeRegistration API...');
            console.log('🔵 Upgrade Payload:', JSON.stringify(upgradePayload, null, 2));

            const upgradeResponse = await upgradeRegistration(upgradePayload);
            console.log('🟢 Upgrade Registration Response:', upgradeResponse);

            if (upgradeResponse?.status?.err_code !== 0) {
                setValidationError(upgradeResponse?.status?.err_msg || 'Failed to register upgrade');
                setIsLoading(false);
                return;
            }

            // =====================================================
            // STEP 2: Call cblCustDet and primaryCustdet APIs
            // =====================================================
            console.log('🔵 [STEP 2] Fetching customer details...');
            try {
                const [cableDetails, primaryDetails] = await Promise.all([
                    getCableCustomerDetails(username),
                    getPrimaryCustomerDetails(username)
                ]);
                console.log('🟢 Cable Customer Details:', cableDetails);
                console.log('🟢 Primary Customer Details:', primaryDetails);
                setCustomerDetails(cableDetails);
                setPrimaryCustomerDetails(primaryDetails);
            } catch (detailsError) {
                console.warn('⚠️ Could not fetch customer details:', detailsError);
            }

            // =====================================================
            // STEP 3: Call paymentinfo/fofi API
            // =====================================================
            const paymentPayload = {
                fofi_box_id: finalBoxIdForSubmit,
                planid: planId,
                priceid: priceId,
                servapptype: "crmapp",
                servid: servId,
                userid: username,
                // Hardcoded "superadmin" — see equivalent comment
                // in handleSubscriptionSubmit. Sending the real
                // operator name binds the txn to that operator on
                // the backend and generateorder later rejects it
                // with the misleading wallet-balance message.
                username: "superadmin",
                voipnumber: ""
            };

            console.log('🔵 [STEP 3] Calling getFofiPaymentInfo API...');
            console.log('🔵 Payment Payload:', JSON.stringify(paymentPayload, null, 2));

            const paymentResponse = await getFofiPaymentInfo(paymentPayload);
            console.log('🟢 Payment Info Response:', paymentResponse);

            if (paymentResponse?.status?.err_code !== 0) {
                // Payment info API failed, but registration was successful
                console.warn('⚠️ Payment info API failed, but registration succeeded');
                toast.add('FoFi Box registered successfully! Payment info could not be retrieved.', { type: 'info' });
                // Reset form and navigate back to overview
                setView('overview');
                setDeviceValidated(false);
                setMacAddress('');
                setSerialNumber('');
                setBoxId('');
                setDeviceInfo(null);
                setSelectedPlan(null);
            } else {
                // Both APIs succeeded - Navigate to FoFi Payment Review Page
                console.log('✅ Registration successful, navigating to payment page...');
                
                // Extract payment details from the response
                const paymentBody = paymentResponse?.body || {};
                
                // Debug: Log the full API response structure
                console.log('🔴 [DEBUG] Full paymentBody (new user):', JSON.stringify(paymentBody, null, 2));
                
                // Extract tax details from tax_details array
                const taxDetails = paymentBody?.tax_details || [];
                const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
                const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
                const cgst = cgstObj?.amt || 0;
                const sgst = sgstObj?.amt || 0;
                
                // Extract amounts directly from paymentBody
                const extractedPlanRate = parseFloat(paymentBody?.planrate) || selectedPlan?.price || 0;
                const extractedTotal = paymentBody?.total_amt || 0;
                const otherCharges = paymentBody?.other_amt || 0;
                const balanceAmount = paymentBody?.balance_amt || 0;
                
                // Extract share info directly from paymentBody
                const operatorShare = paymentBody?.oprtrshare || 0;
                const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
                const softCharge = paymentBody?.softwarecharges || 0;
                const tds = paymentBody?.tds || 0;
                const fofiShare = paymentBody?.fofishare || 0;
                
                const amountDeductable = resolveFoFiAmountDeductable(paymentBody);

                // Prepare payment data for the review page
                const fofiPaymentData = {
                    // Customer & Plan identifiers
                    userid: username,
                    fofiboxid: deviceInfo.boxId || boxId,
                    planid: planId,
                    priceid: priceId,
                    servid: servId,
                    loginuname: loginuname,
                    paytype: 'new_registration',
                    transactionid: paymentBody?.transactionid || '',

                    // Wallet balance
                    walletBalance: 0,

                    // Payment details for display
                    paymentDetails: {
                        "Plan Name": paymentBody?.planname || selectedPlan?.planname || selectedPlan?.plan_name || "N/A",
                        "Plan Rate": extractedPlanRate,
                        "CGST": cgst,
                        "SGST": sgst,
                        "Other Charges": otherCharges,
                        "Balance Amount": balanceAmount,
                        "Total Amount": extractedTotal
                    },

                    // More details — only include non-zero positive values (matches production)
                    moreDetails: {
                        "Operator Share": operatorShare,
                        ...(bbnlShare > 0 ? { "BBNL Share": bbnlShare } : {}),
                        ...(softCharge > 0 ? { "Software Charges": softCharge } : {}),
                        ...(tds > 0 ? { "TDS": tds } : {}),
                        "Amount Deductable": amountDeductable
                    },

                    // Additional payment info
                    noofmonth: 1,
                    amountDeductable: amountDeductable,
                    planName: paymentBody?.planname || selectedPlan?.planname || selectedPlan?.plan_name || "N/A",
                    planRate: extractedPlanRate,
                    totalAmount: extractedTotal,
                    operatorShare: operatorShare,
                    
                    // Customer data for reference
                    customer: customerData
                };

                console.log('🔵 Navigating to FoFi Payment with data:', fofiPaymentData);

                // Same history-cleanup as the existing-user submit path
                // — see comment at the other navigate('/fofi-payment')
                // call. Pop our subview entries first so back from the
                // post-payment overview is clean.
                const subviewDepth = subViewDepthRef.current;
                if (subviewDepth > 0) {
                    cleanupPopStateRef.current = subviewDepth;
                    window.history.go(-subviewDepth);
                    await new Promise(resolve => setTimeout(resolve, 30 * subviewDepth + 30));
                }
                // Navigate to FoFi Payment Review page
                navigate('/fofi-payment', { state: fofiPaymentData });
                return; // Exit the function after navigation
            }

        } catch (error) {
            console.error('❌ Upgrade registration error:', error);
            const errMsg = error?.message || 'Unknown error';
            setValidationError('Failed to register FoFi box: ' + errMsg);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePlanSelect = (plan) => {
        setSelectedPlan(plan);
        // For existing users, skip device validation
        if (hasConfirmedFofiService) {
            enterSubView('payment');
        } else {
            enterSubView('device-validation');
        }
    };

    // Handle payment for new registration
    const handlePayment = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            // Step 1: Create payment order
            const orderResponse = await createFoFiPaymentOrder({
                customerId: customerData.customer_id,
                planId: selectedPlan.id,
                amount: selectedPlan.price,
                deviceId: deviceInfo?.serialNumber,
                orderType: hasConfirmedFofiService ? 'renewal' : 'new_registration'
            });

            if (!orderResponse.success) {
                setValidationError(orderResponse.message || 'Failed to create payment order');
                setIsLoading(false);
                return;
            }

            setPaymentOrderId(orderResponse.data.orderId);

            // Step 2: For new users, register the device first
            if (!hasConfirmedFofiService && deviceInfo) {
                const registerResponse = await registerFoFiDevice({
                    customerId: customerData.customer_id,
                    planId: selectedPlan.id,
                    serialNumber: deviceInfo.serialNumber,
                    macAddress: macAddress,
                    multicastDeviceId: deviceInfo.multicastDeviceId,
                    unicastDeviceId: deviceInfo.unicastDeviceId,
                    validationMethod: validationMethod
                });

                if (!registerResponse.success) {
                    setValidationError(registerResponse.message || 'Failed to register device');
                    setIsLoading(false);
                    return;
                }
            }

            // Step 3: Redirect to payment gateway or handle payment
            // In production, this would redirect to payment gateway
            console.log('Payment order created:', orderResponse.data);

            // For demo: simulate successful payment after 2 seconds
            setTimeout(async () => {
                try {
                    const verifyResponse = await verifyFoFiPayment({
                        orderId: orderResponse.data.orderId,
                        paymentId: 'DEMO_PAYMENT_' + Date.now(),
                        customerId: customerData.customer_id
                    });

                    if (verifyResponse.success && verifyResponse.verified) {
                        toast.add('Payment successful! Your FoFi Smart Box has been activated.', { type: 'success' });
                        // Navigate back to customer overview
                        navigate('/customers');
                    } else {
                        setValidationError('Payment verification failed');
                    }
                } catch (verifyError) {
                    console.error('Payment verification error:', verifyError);
                    setValidationError('Failed to verify payment');
                } finally {
                    setIsLoading(false);
                }
            }, 2000);

        } catch (error) {
            console.error('Payment error:', error);
            setValidationError('Failed to process payment. Please try again.');
            setIsLoading(false);
        }
    };

    // Handle plan change for existing users
    const handlePlanChange = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            const response = await changeFoFiPlan({
                customerId: customerData.customer_id,
                currentPlanId: fofiService?.planId,
                newPlanId: selectedPlan.id,
                action: 'change'
            });

            if (response.success) {
                toast.add('Plan changed successfully!', { type: 'success' });
                navigate('/customers');
            } else {
                setValidationError(response.message || 'Failed to change plan');
            }
        } catch (error) {
            console.error('Plan change error:', error);
            setValidationError('Failed to change plan. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!customerData) {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50">
                <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
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

    // =====================================================
    // CUSTOMER OVERVIEW VIEW - Shows customer details and service status
    // Matches Internet module UI/UX exactly
    // =====================================================
    if (view === 'overview') {
        // Get customer details from API response or fallback to passed customerData
        const displayUsername = primaryCustomerDetails?.body?.username || 
                               customerDetails?.body?.username || 
                               customerData?.username || 
                               customerData?.customer_id || 'N/A';
        const displayName = primaryCustomerDetails?.body?.custname || 
                           primaryCustomerDetails?.body?.name ||
                           customerDetails?.body?.custname ||
                           customerDetails?.body?.name ||
                           customerData?.name || 
                           customerData?.customer_name || 'N/A';
        const displayPhone = primaryCustomerDetails?.body?.mobile || 
                            primaryCustomerDetails?.body?.phone ||
                            customerDetails?.body?.mobile ||
                            customerDetails?.body?.contactno ||
                            customerData?.mobile || 
                            customerData?.phone || 'N/A';
        const displayEmail = primaryCustomerDetails?.body?.email || 
                            customerDetails?.body?.email ||
                            customerData?.email || 'N/A';

        console.log('📊 [FoFi SmartBox] Overview Display Data:', {
            username: displayUsername,
            name: displayName,
            phone: displayPhone,
            email: displayEmail,
            hasFofiService: hasFofiService,
            isOverviewLoading: isOverviewLoading
        });

        // No fullScreen gate — render the shell (header, user
        // details, filter, action buttons) immediately from
        // customerData (which we always have from navigation
        // state). Only the FoFi service-status section below
        // shows an inline loading state while the assigned-items
        // call resolves. Operators see something useful in
        // ~50 ms instead of a blank loader for 1+ RTT.

        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <SuccessAlert />

                {/* Header - Matching Internet module exactly */}
                <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                </header>

                <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
                    {/* User Details - Matching Internet module */}
                    <div className="space-y-3">
                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                    User Details
                                </h3>
                                <div className="space-y-1 text-sm">
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Username</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayUsername}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Customer Name</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayName}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Ph Number</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayPhone}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Email Id</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayEmail}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons - Matching Internet module */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleUploadDocument}
                                    disabled={isLoading}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-[background-color,box-shadow] duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? 'Loading...' : 'Upload Document'}
                                </button>
                                <button
                                    onClick={handleOrderHistory}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-[background-color,box-shadow] duration-200 shadow-md hover:shadow-lg"
                                >
                                    Order History
                                </button>
                            </div>

                            {/* Filter Badge - Matching Internet module */}
                            <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 -mx-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-base text-indigo-600 font-semibold">Filtered by :</span>
                                    <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-md">
                                        FOFI Smart Box
                                    </span>
                                </div>
                                <button onClick={() => setShowServiceModal(true)} className="text-indigo-600 hover:text-indigo-700 transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                </button>
                            </div>

                            {/* Service Status Section */}
                            {error ? (
                                // Error state - API calls failed
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
                                        <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <p className="text-red-600 dark:text-red-400 text-center text-sm mb-2">{error}</p>
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="mt-4 text-indigo-600 hover:text-indigo-700 text-sm font-medium underline"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : isOverviewLoading ? (
                                // Inline skeleton while getUserAssignedItems
                                // is in flight. Avoids a flash of
                                // "not opted" before the API decides.
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin"></div>
                                    <p className="text-gray-500 dark:text-gray-400 text-xs mt-3">Loading service status…</p>
                                </div>
                            ) : isCheckingFofiService ? (
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin"></div>
                                    <p className="text-gray-600 dark:text-gray-400 text-center text-sm mt-3">
                                        Checking FoFi service status...
                                    </p>
                                </div>
                            ) : !hasConfirmedFofiService ? (
                                // NEW USER - Not opted for FoFi service
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <p className="text-gray-600 dark:text-gray-400 text-center text-sm mb-6">
                                        Selected Customer have not opted<br />for this Service
                                    </p>
                                    <button
                                        onClick={handleUpgradeClick}
                                        disabled={upgradePlansLoading}
                                        className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-10 rounded-lg text-sm uppercase tracking-wide transition-shadow duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {upgradePlansLoading ? 'Loading...' : 'ADD FO-FI BOX'}
                                    </button>
                                    {upgradePlansError && (
                                        <p className="text-red-500 text-sm mt-3 text-center">{upgradePlansError}</p>
                                    )}
                                </div>
                            ) : (
                                // EXISTING USER - Has FoFi service
                                <>
                                    {/* FoFi Box ID Section - Matching Internet ID style exactly */}
                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            FoFi Box ID
                                        </h3>
                                        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700">
                                            <p className="text-indigo-600 font-semibold text-base">{fofiServiceDetails?.boxId || 'N/A'}</p>
                                        </div>
                                    </div>

                                    {/* Current Plan (Read-Only) Section - Matching Internet style exactly */}
                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            Current Plan 
                                        </h3>
                                        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 dark:border-gray-700">
                                            <div className="flex items-start gap-3">
                                                {/* FoFi Smart Box Logo - Hardcoded SVG */}
                                                <div className="flex-shrink-0">
                                                    <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        {/* Blue circle background */}
                                                        <circle cx="50" cy="50" r="50" fill="url(#fofiGradient)" />
                                                        {/* Top dome/arc */}
                                                        <path d="M25 48 Q50 22, 75 48" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
                                                        {/* Three horizontal wave lines */}
                                                        <line x1="22" y1="55" x2="78" y2="55" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="26" y1="66" x2="74" y2="66" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="32" y1="77" x2="68" y2="77" stroke="white" strokeWidth="4" strokeLinecap="round" />
                                                        <defs>
                                                            <linearGradient id="fofiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                <stop offset="0%" stopColor="#38BDF8" />
                                                                <stop offset="100%" stopColor="#0284C7" />
                                                            </linearGradient>
                                                        </defs>
                                                    </svg>
                                                </div>

                                                {/* Plan Info - Matching Internet style */}
                                                <div className="flex-1 min-w-0 space-y-2 text-sm">
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Service Name</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: FoFi Smart Box</span>
                                                    </div>
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Plan Name</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {fofiServiceDetails?.planName || 'N/A'}</span>
                                                    </div>
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Expiry Date</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {fofiServiceDetails?.expiryDate || 'N/A'}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Action Buttons.
                                                PAY BILL is the renew-the-current-plan path
                                                and is only meaningful AFTER the plan has
                                                expired — that's the only state where the
                                                customer can pay to keep the same plan.
                                                Before expiry there's nothing to renew, so
                                                we hide the button entirely instead of
                                                showing it disabled (which the client
                                                reported as confusing). The backend's
                                                btn_status='disable' flag is still honoured
                                                as a secondary gate when present. */}
                                            <div className="space-y-3 mt-4">
                                                {isFofiExpired && fofiPlanDetailsRaw?.body?.other_service_renewal?.btn_status !== 'disable' && (
                                                    <button
                                                        onClick={handlePayBill}
                                                        className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-4 rounded-lg transition-shadow duration-200 text-sm shadow-md hover:shadow-lg"
                                                    >
                                                        PAY BILL
                                                    </button>
                                                )}
                                                <button
                                                    onClick={handleUpgradeClick}
                                                    disabled={upgradePlansLoading}
                                                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-shadow duration-200 text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {upgradePlansLoading ? 'Loading...' : 'Upgrade Plan'}
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
                    currentServiceKey="fofi-smart-box"
                    fofiboxid={fofiServiceDetails?.boxId || ''}
                    cableDetails={customerDetails}
                />
                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // UPGRADE PLANS VIEW - Show available upgrade plans/services
    // =====================================================
    if (view === 'upgrade-plans') {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <SuccessAlert />

                {/* Header - Blue/Indigo gradient matching app theme */}
                <header className="sticky top-0 z-40 flex items-center px-4 pb-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
                    <button onClick={goBackToOverview} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-white">Services</h1>
                </header>

                <div className="flex-1 px-4 py-4 space-y-4 pb-24 max-w-2xl mx-auto w-full">
                    {/* Search Input - Matching app theme */}
                    <div className="relative w-full">
                        <input
                            type="text"
                            placeholder="Search Plans"
                            value={upgradeSearchTerm}
                            onChange={(e) => handleUpgradeSearch(e.target.value)}
                            className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                        />
                        <MagnifyingGlassIcon className="h-5 w-5 absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>

                    {/* All Services Section Header - Matching app theme */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-base">All Services</span>
                            {!upgradePlansLoading && (
                                <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">
                                    {filteredUpgradePlans.length}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Loading State */}
                    {upgradePlansLoading && (
                        <div className="flex justify-center py-10">
                            <Loader size={10} color="indigo" text="Loading plans..." />
                        </div>
                    )}

                    {/* Error State */}
                    {upgradePlansError && !upgradePlansLoading && (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-lg p-4">
                            <p className="text-red-700 dark:text-red-400 text-sm">{upgradePlansError}</p>
                        </div>
                    )}

                    {/* Plans List */}
                    {!upgradePlansLoading && filteredUpgradePlans.length > 0 && (
                        <div className="space-y-3">
                            {filteredUpgradePlans.map((plan, index) => {
                                // Plan display - supports both fofi_plans and internet_plans
                                // fofi_plans: planname, planrate, planid
                                // internet_plans: serv_name, serv_rates, servid
                                const planName = plan.planname || plan.serv_name || plan.plan_name || plan.name || 'Unknown Plan';
                                const planPrice = plan.planrate || plan.serv_rates?.prices?.[0] || plan.price || plan.amount || '0';
                                // Use _uniqueKey for React key to avoid duplicates
                                const uniqueKey = plan._uniqueKey || `plan_${index}`;

                                return (
                                    <div
                                        key={uniqueKey}
                                        onClick={() => handleUpgradePlanSelect(plan)}
                                        className="relative flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-[box-shadow,border-color] duration-200 overflow-hidden"
                                    >
                                        {/* Special Offer Ribbon - Always shown */}
                                        <div className="absolute top-0 right-0">
                                            <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold px-3 py-1 shadow-md uppercase tracking-wide" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 10% 100%)' }}>
                                                SPECIAL OFFER
                                            </div>
                                        </div>

                                        {/* Plan Details */}
                                        <div className="flex-1 pr-20">
                                            <p className="font-medium text-gray-800 dark:text-white text-base">{planName}</p>
                                            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                                                {import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL || '₹'}{planPrice}
                                            </p>
                                        </div>

                                        {/* Arrow Icon */}
                                        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Empty State */}
                    {!upgradePlansLoading && !upgradePlansError && filteredUpgradePlans.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10">
                            <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400 text-center text-sm">No plans found matching your search.</p>
                            <button 
                                onClick={() => { setUpgradeSearchTerm(''); setFilteredUpgradePlans(upgradePlans); }}
                                className="mt-3 text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:underline"
                            >
                                Clear search
                            </button>
                        </div>
                    )}
                </div>

                {/* Zero Price Plan Popup */}
                <AnimatePresence>
                    {showZeroPricePopup && (
                        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 px-4" onClick={() => setShowZeroPricePopup(false)}>
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: -20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Gradient Header */}
                                <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-white">Alert</h3>
                                    <button
                                        onClick={() => setShowZeroPricePopup(false)}
                                        className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-colors duration-200"
                                    >
                                        <XMarkIcon className="h-6 w-6" />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="p-8">
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                                        className="flex justify-center mb-6"
                                    >
                                        <div className="bg-gradient-to-br from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 rounded-full p-4">
                                            <ExclamationCircleIcon className="h-16 w-16 text-orange-500" />
                                        </div>
                                    </motion.div>

                                    <p className="text-gray-700 dark:text-gray-300 text-center text-base leading-relaxed mb-6">
                                       Plan Rate is Missing.Please Contact Admin to Update the Plan Rate.
                                    </p>

                                    {/* Action Button */}
                                    <button
                                        onClick={() => setShowZeroPricePopup(false)}
                                        className="w-full px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-lg transition-shadow duration-200 shadow-md hover:shadow-lg"
                                    >
                                        OK, Select Other Plan
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // SUBSCRIPTION CONFIRMATION VIEW - For EXISTING users
    // Shows Plan Type, Plan Name, auto-detected Box ID, and SUBMIT button
    // =====================================================
    if (view === 'subscription-confirm') {
        const confirmPlanName = selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || selectedPlan?.name || 'N/A';
        const confirmBoxId = fofiServiceDetails?.boxId || 'N/A';
        
        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <SuccessAlert />

                {/* Header - Blue/Indigo gradient matching app theme */}
                <header className="sticky top-0 z-40 flex items-center px-4 pb-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
                    {/* In-app chevron pops one history entry; popstate
                        handler reads the marker and restores the
                        previous view. Same path as phone hardware back. */}
                    <button onClick={goBackOneView} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-white">Services Subscription</h1>
                </header>

                <div className="flex-1 px-4 py-6 space-y-6 max-w-md mx-auto w-full">
                    {/* Plan Info Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                        <div className="space-y-3">
                            <div className="flex">
                                <span className="text-gray-600 dark:text-gray-400 w-28">Plan Type</span>
                                <span className="text-gray-600 dark:text-gray-400 mr-2">:</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">FoFi Plan</span>
                            </div>
                            <div className="flex">
                                <span className="text-gray-600 dark:text-gray-400 w-28">Plan Name</span>
                                <span className="text-gray-600 dark:text-gray-400 mr-2">:</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold uppercase">{confirmPlanName}</span>
                            </div>
                        </div>
                    </div>

                    {/* FOFI Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-sm uppercase tracking-wide">FOFI</span>
                        </div>
                        
                        {/* FoFi Box ID - Auto-detected (Read-only) */}
                        <div className="relative pt-2.5">
                            <label className="absolute top-0 left-3 bg-gray-50 dark:bg-gray-900 px-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                FOFI BOX ID
                            </label>
                            <input
                                type="text"
                                value={confirmBoxId}
                                readOnly
                                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl focus:outline-none cursor-not-allowed"
                            />
                        </div>
                    </div>

                    {/* SUBMIT Button */}
                    <div className="pt-4">
                        <button
                            onClick={handleSubscriptionSubmit}
                            disabled={isLoading}
                            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Processing...
                                </>
                            ) : (
                                'SUBMIT'
                            )}
                        </button>
                    </div>
                </div>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // LINK FO-FI BOX VIEW (single-page first-time link)
    // Mirrors the native app contract:
    //   - Plan dropdown sourced from specialInternetPlans (already
    //     loaded into fofiPlans state on mount)
    //   - FOFI Box ID input + Scan From TV
    //   - GET MAC ID → fofi/fofiapis/validateAsset
    //   - LINK FO-FI BOX → ServiceApis/freeOTAService, then
    //     service/paymentinfo/fofi, then FoFi payment review
    // =====================================================
    const selectedPlanName = selectedPlan?.serv_name || selectedPlan?.planname || selectedPlan?.plan_name || selectedPlan?.name || 'Select a Plan';
    const selectedPlanPrice = selectedPlan?.planrate || selectedPlan?.serv_rates?.prices?.[0] || selectedPlan?.price || selectedPlan?.amount || selectedPlan?.rate || '0';
    
    return (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* QR Scanner Modal — lazy loaded */}
            {showQRScanner && (
                <Suspense fallback={<Loader text="Loading scanner..." />}>
                    <QRScanner
                        onScan={handleQRCodeScanned}
                        onClose={handleQRScannerClose}
                        onError={handleQRScanError}
                    />
                </Suspense>
            )}

            {/* Blue/Indigo Gradient Header - Matching app theme */}
            <header className="sticky top-0 z-40 flex items-center px-4 pb-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
                {/* When entered from Internet Service the route was
                    pushed by them — go back via React Router. Otherwise
                    pop one of our own history entries via the shared
                    popstate path. */}
                <button onClick={() => { if (fromInternet) navigate(-1); else goBackOneView(); }} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-xl font-medium text-white">Link FO-FI Box</h1>
            </header>

            <div className="flex-1 px-4 py-4 space-y-4 pb-24 max-w-md mx-auto w-full">

                {/* Validation error banner — pinned at the TOP of the
                    content area so the operator sees the rejection
                    reason immediately, with no scrolling. The banner
                    used to render below the LINK FO-FI BOX button at
                    the bottom of the form, which on small phones was
                    completely off-screen after a click. The
                    scroll-into-view effect above brings it back into
                    sight even if the user has scrolled down.
                    Tap × to dismiss. */}
                {validationError && (
                    <div
                        ref={validationErrorRef}
                        role="alert"
                        aria-live="polite"
                        className="relative bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 rounded-lg p-4 shadow-sm"
                    >
                        <div className="flex items-start gap-3 pr-7">
                            <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-800 dark:text-red-200 whitespace-pre-line break-words">
                                {validationError}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setValidationError('')}
                            aria-label="Dismiss error"
                            className="absolute top-2 right-2 text-red-500 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                        >
                            <XMarkIcon className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* FOFI Section Card */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                    {/* FOFI Header */}
                    <div className="flex items-center gap-2 mb-5">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                        <h2 className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">FOFI</h2>
                    </div>

                    {/* Scan From TV Button */}
                    <div className="flex justify-center mb-4">
                        <button
                            onClick={handleQRScan}
                            disabled={isLoading}
                            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 text-white font-semibold py-3 px-6 rounded-lg flex items-center gap-2 transition-shadow duration-200 shadow-md hover:shadow-lg"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            Scan From TV
                        </button>
                    </div>

                    {/* OR Divider */}
                    <div className="flex items-center justify-center py-2">
                        <span className="text-gray-400 dark:text-gray-500 font-medium text-sm">OR</span>
                    </div>

                    {/* FOFI Box ID Input */}
                    <div className="space-y-3 mb-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={boxId}
                                onChange={(e) => setBoxId(e.target.value)}
                                placeholder="FOFI Box Id*"
                                className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 dark:text-white bg-white dark:bg-gray-700 placeholder-gray-400 transition-[border-color,box-shadow] duration-200"
                            />
                            <button type="button" onClick={handleQRScan} className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer">
                                {/* Barcode Icon */}
                                <svg className="w-6 h-6 text-gray-400 hover:text-indigo-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M2 4h2v16H2V4zm4 0h1v16H6V4zm2 0h2v16H8V4zm4 0h1v16h-1V4zm2 0h3v16h-3V4zm4 0h1v16h-1V4zm2 0h2v16h-2V4z"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* GET MAC ID Button */}
                    <div className="flex justify-center mb-4">
                        <button
                            onClick={handleFetchMAC}
                            disabled={isLoading || !boxId}
                            className={`bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-3 px-10 rounded-full transition-shadow duration-200 uppercase text-sm shadow-md hover:shadow-lg ${isLoading || !boxId ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isLoading ? 'Getting MAC...' : 'GET MAC ID'}
                        </button>
                    </div>

                    {/* FOFI MAC ID Input */}
                    <div className="space-y-3">
                        <div className="relative">
                            <input
                                type="text"
                                value={macAddress}
                                onChange={(e) => setMacAddress(e.target.value)}
                                placeholder="FOFI MAC ID*"
                                className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 dark:text-white bg-white dark:bg-gray-700 font-mono text-sm placeholder-gray-400 transition-[border-color,box-shadow] duration-200"
                            />
                            <button type="button" onClick={handleQRScan} className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer">
                                {/* Barcode Icon */}
                                <svg className="w-6 h-6 text-gray-400 hover:text-indigo-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M2 4h2v16H2V4zm4 0h1v16H6V4zm2 0h2v16H8V4zm4 0h1v16h-1V4zm2 0h3v16h-3V4zm4 0h1v16h-1V4zm2 0h2v16h-2V4z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Select a Plan dropdown — sourced from
                    registrationNecessities (body.fofi_plans, the
                    FoFi-box-compatible list). Plans on this list
                    can carry either srvid or planid; the selected
                    plan's srvid/planid maps to the plan_id in the
                    freeOTAService submit payload. */}
                {!isUpgradeLinkContinuation && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                    <select
                        value={selectedPlan?.planid || selectedPlan?.srvid || selectedPlan?.servid || selectedPlan?.id || ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (!v) { setSelectedPlan(null); return; }
                            const match = (fofiPlans || []).find(p =>
                                String(p.planid ?? p.srvid ?? p.servid ?? p.id ?? '') === String(v)
                            );
                            setSelectedPlan(match || null);
                        }}
                        className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="">Select a Plan</option>
                        {(fofiPlans || []).map((p, idx) => {
                            const id = p.planid ?? p.srvid ?? p.servid ?? p.id ?? idx;
                            const name = p.serv_name || p.planname || p.plan_name || p.name || `Plan ${idx + 1}`;
                            return (
                                <option key={`${id}-${idx}`} value={String(id)}>
                                    {name}
                                </option>
                            );
                        })}
                    </select>
                </div>
                )}

                {/* Loading overlay during device validation */}
                {isLoading && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 flex flex-col items-center max-w-xs mx-4">
                            <div className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-gray-600 animate-spin mb-4"></div>
                            <p className="text-gray-700 dark:text-gray-300 text-sm font-medium text-center">Validating device...</p>
                        </div>
                    </div>
                )}

                {/* Validation errors render inline below the SUBMIT
                    button (see further down). No fullscreen popup —
                    QA asked for the raw backend message shown in-place
                    so operators see exactly why the server rejected
                    the device (e.g. "Fo-Fi device (XX:XX) already
                    assigned") without a modal interrupting them. */}

                {/* Success Message */}
                {showValidationSuccess && macAddress && (
                    <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded-lg p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="text-sm font-semibold text-green-800 dark:text-green-300">Device validated successfully</p>
                                <p className="text-xs text-green-700 dark:text-green-400 mt-1 font-mono">MAC: {macAddress}</p>
                                {deviceInfo?.serialNumber && (
                                    <p className="text-xs text-green-700 dark:text-green-400 font-mono">Serial: {deviceInfo.serialNumber}</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* LINK FO-FI BOX Button.
                    Disabled when any of the four required fields for
                    freeOTAService are missing: Box ID, MAC, plan,
                    and a non-empty form. Serial isn't blocked here —
                    if it's missing the gate inside handleLinkFoFiBox
                    will report a clearer message than a disabled
                    button. */}
                <div className="flex justify-center pt-6 pb-4">
                    <button
                        onClick={handleLinkFoFiBox}
                        disabled={isLoading || !boxId || !macAddress || !selectedPlan}
                        className={`bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-4 px-12 rounded-full transition-shadow duration-200 uppercase text-sm shadow-lg hover:shadow-xl tracking-wide ${isLoading || !boxId || !macAddress || !selectedPlan ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!selectedPlan ? 'Please select a plan first' : !boxId ? 'Please scan or enter FOFI Box ID' : !macAddress ? 'Please get MAC ID first' : 'Link this box'}
                    >
                        {isLoading ? 'Linking…' : 'LINK FO-FI BOX'}
                    </button>
                </div>

                {/* Validation error banner moved to the TOP of this
                    content area (see above) so it lands inside the
                    operator's viewport instead of below the bottom
                    LINK FO-FI BOX button. */}
            </div>

            <BottomNav />
        </div>
    );
}

export default FoFiSmartBox;
