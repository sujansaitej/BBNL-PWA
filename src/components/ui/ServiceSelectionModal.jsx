import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';
import { loadKycWithRetry } from '../../utils/kycRetry';
import { useToast } from './Toast';
import { getUser } from '../../services/safeStorage';
import { prioritizeCustomerService } from '../../services/prefetch';

export default function ServiceSelectionModal({ isOpen, onClose, onSelectService, customer, services: propServices, currentServiceKey, fofiboxid, cableDetails }) {
    const navigate = useNavigate();
    const toast = useToast();
    const [selectedService, setSelectedService] = useState('');
    const [comingSoonOpen, setComingSoonOpen] = useState(false);
    const [uploadLoading, setUploadLoading] = useState(false);
    const uploadRequestInFlightRef = useRef(false);

    // Upload Document — same KYC retry pattern as Services.jsx and
    // each service page. Closes the modal first so the user lands
    // cleanly on the upload screen with no overlay.
    const handleUploadDocument = async () => {
        if (uploadRequestInFlightRef.current) return;
        uploadRequestInFlightRef.current = true;
        setUploadLoading(true);
        try {
            const cid = customer?.customer_id || customer?.username;
            const response = await loadKycWithRetry({ cid, reqtype: 'update' });
            if (response?.status?.err_code === 0) {
                onClose();
                navigate('/upload-documents', { state: { customer, kycData: response.body } });
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

    // Order History — pass currentServiceKey so the destination
    // page only shows bills for the service the operator was just
    // viewing. Falls back to "all" when the modal is opened from a
    // context with no specific service.
    const handleOrderHistory = () => {
        const state = { customer };
        if (currentServiceKey) {
            // Map the service-route key the modal callers use to the
            // serviceType label PaymentHistory expects.
            const routeToServiceType = {
                'iptv': 'cabletv',
                'fofi-smart-box': 'fofi',
                'internet': 'internet',
                'voice': 'voice',
            };
            state.serviceType = routeToServiceType[currentServiceKey] || currentServiceKey;
            if (cableDetails) state.cableDetails = cableDetails;
            if (fofiboxid) state.fofiboxid = fofiboxid;
        }
        onClose();
        navigate('/payment-history', { state });
    };

    // Static service order — must match Services.jsx ALLOWED_SERVICES exactly
    const SERVICE_ORDER = [
        { route: 'iptv',           displayName: 'Cable TV' },
        { route: 'fofi-smart-box', displayName: 'Fo-Fi Smart Box' },
        { route: 'voice',          displayName: 'Voice Call' },
        { route: 'internet',       displayName: 'Internet' },
    ];

    // Resolve any API service key/name to a known route
    function resolveRoute(key, name) {
        const k = (key || '').toLowerCase().trim();
        const n = (name || '').toLowerCase().trim();
        if (k === 'internet' || n === 'internet') return 'internet';
        if (k === 'voice' || k === 'voicecall' || k === 'voice_call' || k === 'voice-call'
            || n === 'voice call' || n === 'voice' || n === 'unlimited calling') return 'voice';
        if (k === 'fofi' || k === 'fofi-smart-box' || k === 'fofi_smart_box' || k === 'fofismartbox'
            || n.includes('fo-fi') || n.includes('fofi') || n.includes('smart box')) return 'fofi-smart-box';
        if (k === 'iptv' || k === 'cabletv' || k === 'cable_tv' || k === 'cable-tv'
            || n === 'cable tv' || n === 'iptv' || n === 'cabletv') return 'iptv';
        return null;
    }

    // Services to hide from the UI
    const hiddenServices = ['games', 'multi service', 'ip camera'];

    // Services not yet available (show "Coming Soon" on click)
    const comingSoonServices = ['voice call service', 'voice call'];

    // Build the service list in the SAME static order every time,
    // using API display names when available
    const services = (() => {
        const apiNames = new Map();
        if (propServices && propServices.length > 0) {
            for (const svc of propServices) {
                const key = svc.servkey || svc.id || '';
                const name = svc.title || svc.servname || svc.name || '';
                const route = resolveRoute(key, name);
                if (route && !apiNames.has(route)) apiNames.set(route, name);
            }
        }
        return SERVICE_ORDER.map(s => ({
            id: s.route,
            name: apiNames.get(s.route) || s.displayName,
            path: s.route,
        }));
    })().filter(service => !hiddenServices.includes(service.name.toLowerCase()));

    const handleServiceClick = (service) => {
        if (service.id === 'voice' || comingSoonServices.includes(service.name.toLowerCase())) {
            setComingSoonOpen(true);
            return;
        }
        const userid = customer?.customer_id || customer?.username;
        const logUname = getUser()?.username || '';
        prioritizeCustomerService(userid, logUname, service.id);
        onSelectService(service);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white">
            {/* Blue Gradient Header */}
            <header className="flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                <button onClick={() => navigate('/customers')} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-lg font-medium text-white flex-1">Customer OverView</h1>
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-white/20 rounded-full transition-colors"
                    aria-label="Close"
                >
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-5 bg-gray-50">
                {/* User Details Section */}
                {customer && (
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <h3 className="text-indigo-600 text-lg font-semibold">User Details</h3>
                        </div>
                        <div className="space-y-2 text-sm">
                            <div className="flex">
                                <span className="w-36 shrink-0 text-gray-600">Username</span>
                                <span className="text-gray-600 min-w-0 break-all">: {customer.customer_id || customer.username || 'N/A'}</span>
                            </div>
                            <div className="flex">
                                <span className="w-36 shrink-0 text-gray-600">Customer Name</span>
                                <span className="text-gray-600 min-w-0 break-all">: {customer.name || 'N/A'}</span>
                            </div>
                            <div className="flex">
                                <span className="w-36 shrink-0 text-gray-600">Ph Number</span>
                                <span className="text-gray-600 min-w-0 break-all">: {customer.mobile || customer.phone || 'N/A'}</span>
                            </div>
                            {customer.email && (
                                <div className="flex">
                                    <span className="w-36 shrink-0 text-gray-600">Email Id</span>
                                    <span className="text-gray-600 min-w-0 break-all">: {customer.email}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Action Buttons — mirror the Services.jsx layout so
                    the modal-version of "Choose Service" has parity
                    with the standalone page. Buttons only render when
                    a current service context exists; on the standalone
                    page these are also there but driven by Services.jsx
                    state. Order History from here filters to only the
                    bills for the service the operator was viewing. */}
                {currentServiceKey && (
                    <div className="flex gap-3 mb-5">
                        <button
                            onClick={handleUploadDocument}
                            disabled={uploadLoading}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed leading-tight"
                        >
                            {uploadLoading ? 'Loading...' : <>{`Upload`}<br />{`Document`}</>}
                        </button>
                        <button
                            onClick={handleOrderHistory}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm shadow-md hover:shadow-lg"
                        >
                            Order History
                        </button>
                    </div>
                )}

                {/* Choose Service Section */}
                <div className="bg-white rounded-xl shadow-md overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-200">
                        <h2 className="text-lg font-semibold text-indigo-600">Choose Service</h2>
                    </div>

                    <div className="py-2">
                        {services.map((service, index) => (
                            <div
                                key={service.id}
                                className="flex items-center px-5 py-3.5 cursor-pointer hover:bg-indigo-50 transition-colors duration-200 border-b border-gray-100 last:border-b-0"
                                onClick={() => handleServiceClick(service)}
                            >
                                {/* Radio Button */}
                                <div className="flex items-center justify-center w-5 h-5 mr-4">
                                    <div className="w-5 h-5 rounded-full border-2 border-gray-400 flex items-center justify-center hover:border-indigo-600 transition-colors">
                                        <div className="w-2 h-2 rounded-full bg-transparent"></div>
                                    </div>
                                </div>

                                {/* Service Name */}
                                <span className="text-base text-gray-800 font-normal">
                                    {service.name}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Coming Soon Modal */}
            <Modal isOpen={comingSoonOpen} onClose={() => setComingSoonOpen(false)}>
                <h2 className="text-xl font-semibold text-center text-red-500 mb-2">Coming Soon!</h2>
                <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/under_dev.jpg'} alt="Coming Soon" className="w-70 h-70 mx-auto" />
                <p className="text-center text-violet-900 mt-1">We're working on this feature — check back soon!</p>
            </Modal>
        </div>
    );
}
