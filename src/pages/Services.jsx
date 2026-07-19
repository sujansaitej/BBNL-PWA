import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeftIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { getServiceList, getCustKYCPreview } from "../services/generalApis";
import { lsGetStale } from "../services/lsCache";
import { prefetchCustomerData, prioritizeCustomerService } from "../services/prefetch";
import { loadKycWithRetry } from "../utils/kycRetry";
import BottomNav from "../components/BottomNav";
import { formatCustomerId } from "../services/helpers";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui";
import { getUser } from "../services/safeStorage";

// Only these 4 services are shown (matches production)
const ALLOWED_SERVICES = [
    { route: 'iptv',           displayName: 'Cable TV',         order: 0 },
    { route: 'fofi-smart-box', displayName: 'Fo-Fi Smart Box', order: 1 },
    { route: 'voice',          displayName: 'Voice Call',       order: 2 },
    { route: 'internet',       displayName: 'Internet',         order: 3 },
];

// Resolve any API service key or name to its route path
function resolveServiceRoute(key, name) {
    const k = (key || '').toLowerCase().trim();
    const n = (name || '').toLowerCase().trim();

    if (k === 'internet' || n === 'internet') return 'internet';
    if (k === 'voice' || k === 'voicecall' || k === 'voice_call' || k === 'voice-call'
        || n === 'voice call' || n === 'voice' || n === 'unlimited calling') return 'voice';
    if (k === 'fofi' || k === 'fofi-smart-box' || k === 'fofi_smart_box' || k === 'fofismartbox'
        || n.includes('fo-fi') || n.includes('fofi') || n.includes('smart box')) return 'fofi-smart-box';
    if (k === 'iptv' || k === 'cabletv' || k === 'cable_tv' || k === 'cable-tv'
        || n === 'cable tv' || n === 'iptv' || n === 'cabletv') return 'iptv';
    if (k === 'ott' || n === 'ott') return 'fofi-smart-box';

    return null;
}

export default function Services() {
    const { customerId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const customerData = location.state?.customer;
    const servicesFromState = location.state?.services;

    const toast = useToast();

    // SWR-style hydration: paint instantly, never block on the API.
    //
    // The 4 services we display are hardcoded in ALLOWED_SERVICES below
    // — the only thing the API contributes is the display name (which
    // may differ per operator, e.g. "Cable TV" vs "IPTV TV"). So we
    // can ALWAYS render the page on first paint:
    //   1. From `servicesFromState` if Customerlist passed it (best).
    //   2. From stale cache (`lsGetStale`) — last successful response
    //      kept for fast display even if older than the 10-min TTL.
    //   3. Empty array — the render falls back to ALLOWED_SERVICES'
    //      hardcoded display names.
    // In every case `loading` is false at first paint — no spinner
    // blocks the choose-service list. Background fetch refreshes
    // names if the API returns a different label.
    const STALE_TTL = 24 * 60 * 60 * 1000; // 24h — names rarely change
    const cachedServiceList = (() => {
        try {
            const c = lsGetStale('svclist_all', STALE_TTL);
            // lsGetStale returns { data, ts } shape — pull body.
            const body = c?.data?.body;
            return Array.isArray(body) ? body : null;
        } catch (_) { return null; }
    })();

    const [apiServices, setApiServices] = useState(
        servicesFromState && servicesFromState.length > 0
            ? servicesFromState
            : (cachedServiceList || [])
    );
    const [loading, setLoading] = useState(false);
    const [selectedService, setSelectedService] = useState(null);
    const [uploadLoading, setUploadLoading] = useState(false);
    const [comingSoonOpen, setComingSoonOpen] = useState(false);

    useEffect(() => {
        const userid = customerData?.customer_id || customerData?.username || customerId;
        if (!userid) return;
        const logUname = getUser()?.username || '';
        prefetchCustomerData(userid, logUname);
    }, [customerData, customerId]);

    // Background refresh — updates display names if backend has them
    // changed, but never blocks the UI. Only fires when we don't
    // already have services from navigation state.
    useEffect(() => {
        if (servicesFromState && servicesFromState.length > 0) return;
        let cancelled = false;
        getServiceList()
            .then(res => {
                if (cancelled) return;
                if (res?.status?.err_code === 0 && Array.isArray(res?.body)) {
                    setApiServices(res.body);
                }
            })
            .catch(() => { /* silent — page already painted */ });
        return () => { cancelled = true; };
    }, []);

    // Build the final 4-service list — always instant when services arrive from state
    const services = (() => {
        // If API returned services, resolve each to a known route and keep only the 4 allowed
        if (apiServices.length > 0) {
            const resolved = new Map(); // route -> display name from API
            for (const svc of apiServices) {
                const rawKey = svc.servkey || svc.id;
                const svcName = svc.title || svc.servname || svc.name || '';
                const route = resolveServiceRoute(rawKey, svcName);
                if (route && !resolved.has(route)) {
                    resolved.set(route, svcName);
                }
            }
            // Return allowed services in production order, using API display name if available
            return ALLOWED_SERVICES.map(a => ({
                id: a.route,
                name: resolved.get(a.route) || a.displayName,
                path: `/customer/${customerId}/service/${a.route}`,
            }));
        }
        // Fallback: hardcoded 4 services
        return ALLOWED_SERVICES.map(a => ({
            id: a.route,
            name: a.displayName,
            path: `/customer/${customerId}/service/${a.route}`,
        }));
    })();

    const handleServiceSelect = (service) => {
        // Voice Call is not yet available — show Coming Soon popup
        if (service.id === 'voice') {
            setComingSoonOpen(true);
            return;
        }
        const userid = customerData?.customer_id || customerData?.username || customerId;
        const logUname = getUser()?.username || '';
        prioritizeCustomerService(userid, logUname, service.id);
        setSelectedService(service.id);
        navigate(service.path, { state: { customer: customerData, services: apiServices } });
    };

    // Guard + auto-retry on backend operator-sync errors
    // (see src/utils/kycRetry.js).
    const uploadRequestInFlightRef = useRef(false);
    const handleUploadDocument = async () => {
        if (uploadRequestInFlightRef.current) return;
        uploadRequestInFlightRef.current = true;
        setUploadLoading(true);
        try {
            const cid = customerData?.customer_id || customerId;
            const response = await loadKycWithRetry({ cid, reqtype: 'update' });
            if (response?.status?.err_code === 0) {
                navigate('/upload-documents', { state: { customer: customerData, kycData: response.body } });
            } else {
                toast.add('Failed to load documents: ' + (response?.status?.err_msg || 'Unknown error'), { type: 'error' });
            }
        } catch (err) {
            toast.add('Failed to load documents. Please try again.', { type: 'error' });
        } finally {
            setUploadLoading(false);
            uploadRequestInFlightRef.current = false;
        }
    };

    const handleOrderHistory = () => {
        navigate('/payment-history', { state: { customer: customerData } });
    };

    if (!customerData) {
        return (
            <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900">
                <header className="sticky top-0 z-40 flex items-center justify-between px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <div className="flex items-center">
                        <button onClick={() => navigate(-1)} className="p-1 mr-3"><ArrowLeftIcon className="h-6 w-6 text-white" /></button>
                        <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                    </div>
                    <button onClick={() => navigate('/customers')} className="p-1"><XMarkIcon className="h-6 w-6 text-white" /></button>
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
        <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900">
            <header className="sticky top-0 z-40 flex items-center justify-between px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                <div className="flex items-center">
                    <button onClick={() => navigate(-1)} className="p-1 mr-3"><ArrowLeftIcon className="h-6 w-6 text-white" /></button>
                    <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                </div>
                <button onClick={() => navigate('/customers')} className="p-1"><XMarkIcon className="h-6 w-6 text-white" /></button>
            </header>

            <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 pb-24 space-y-5">
                {/* User Details */}
                <div>
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full" />
                        <h2 className="text-lg font-semibold text-indigo-600">User Details</h2>
                    </div>
                    <div className="space-y-2 text-[15px]">
                        <div className="flex">
                            <span className="w-40 flex-shrink-0 text-gray-600 dark:text-gray-400">Username</span>
                            <span className="text-gray-600 dark:text-gray-300 min-w-0 break-all">: {formatCustomerId(customerData.customer_id)}</span>
                        </div>
                        <div className="flex">
                            <span className="w-40 flex-shrink-0 text-gray-600 dark:text-gray-400">Customer Name</span>
                            <span className="text-gray-600 dark:text-gray-300 min-w-0 break-all">: {customerData.name || '-'}</span>
                        </div>
                        <div className="flex">
                            <span className="w-40 flex-shrink-0 text-gray-600 dark:text-gray-400">Ph Number</span>
                            <span className="text-gray-600 dark:text-gray-300 min-w-0 break-all">: {customerData.mobile || '-'}</span>
                        </div>
                        <div className="flex">
                            <span className="w-40 flex-shrink-0 text-gray-600 dark:text-gray-400">Email Id</span>
                            <span className="text-gray-600 dark:text-gray-300 min-w-0 break-all">: {customerData.email || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* Upload Document + Order History buttons live INSIDE
                    each service page (and the filter modal). On the
                    Customer OverView page itself we deliberately show
                    only the Choose Service list — those actions are
                    service-scoped and require a service context to
                    target the right backing data (e.g. Order History
                    needs a serviceType filter). Showing them at the
                    overview level confused QA because tapping Order
                    History there had no service context. Buttons
                    surface again the moment a service is selected. */}

                {/* Choose Service — always painted from the hardcoded
                    ALLOWED_SERVICES list (display names enriched from
                    cache / state / API when available). No spinner: the
                    services don't depend on the API to render. */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-5">
                    <h2 className="text-lg font-semibold text-indigo-600 mb-1">Choose Service</h2>
                    <div className="border-t border-gray-200 dark:border-gray-700 mt-2" />

                    <div>
                        {services.map((service) => (
                            <div
                                key={service.id}
                                className="flex items-center gap-4 py-4 border-b border-gray-100 dark:border-gray-700 last:border-b-0 cursor-pointer"
                                onClick={() => handleServiceSelect(service)}
                            >
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                    selectedService === service.id
                                        ? 'border-indigo-600 bg-indigo-600'
                                        : 'border-gray-300 dark:border-gray-500'
                                }`}>
                                    {selectedService === service.id && (
                                        <div className="w-2.5 h-2.5 rounded-full bg-white" />
                                    )}
                                </div>
                                <span className="text-base text-gray-800 dark:text-gray-200 font-normal">
                                    {service.name}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <BottomNav />

            {/* Coming Soon Modal for Voice Call */}
            <Modal isOpen={comingSoonOpen} onClose={() => setComingSoonOpen(false)}>
                <h2 className="text-xl font-semibold text-center text-red-500 mb-2">Coming Soon!</h2>
                <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/under_dev.jpg'} alt="Coming Soon" className="w-70 h-70 mx-auto" />
                <p className="text-center text-violet-900 mt-1">We're working on this feature — check back soon!</p>
            </Modal>
        </div>
    );
}
