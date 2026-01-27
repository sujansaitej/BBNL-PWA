import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { mockCustomerServices, iptvAddonPackages } from "../../data";
import BottomNav from "../../components/BottomNav";
import { ServiceSelectionModal } from "@/components/ui";
import { getCustKYCPreview } from "../../services/generalApis";
import { formatCustomerId } from "../../services/helpers";

export default function IPTVService() {
    const location = useLocation();
    const navigate = useNavigate();

    // Use actual customer data from API (passed from customer list)
    const customerData = location.state?.customer || {
        customer_id: 'testus1',
        name: 'MohanRaj',
        mobile: '8433544736',
        email: 'dghddh@email.com'
    };

    // Check if we should show the service modal automatically (coming from customer list)
    const shouldShowModal = location.state?.showServiceModal || false;

    // Get services from location state (passed from Customerlist)
    const servicesFromState = location.state?.services || [];

    // Use mock data ONLY for service details (new feature)
    const mockServiceData = mockCustomerServices[customerData.customer_id];
    const iptvService = mockServiceData?.services?.iptv;

    // State management
    const [showServiceModal, setShowServiceModal] = useState(false);
    const [view, setView] = useState('overview'); // 'overview', 'packages', 'channels'
    const [selectedPackages, setSelectedPackages] = useState([]);
    const [activeTab, setActiveTab] = useState('BROAD-CASTER PA...');
    const [uploadLoading, setUploadLoading] = useState(false);

    // Show modal automatically when navigating from customer list
    useEffect(() => {
        if (shouldShowModal) {
            setShowServiceModal(true);
        }
    }, [shouldShowModal]);

    const tabs = ['LCO PACKAGE', 'BROAD-CASTER PA...', 'MSO PACKAGE', 'FOUNDATION PACKAG...'];

    const handleServiceSelect = (service) => {
        if (service) {
            console.log('🔵 [IPTVService] Service selected:', service);

            // Map service name to route
            // API services have numeric IDs, so we need to check by name
            const serviceName = (service.name || '').toLowerCase();

            // Navigate to specific service pages based on service name
            if (serviceName.includes('voice') || serviceName.includes('calling')) {
                console.log('🔵 [IPTVService] Navigating to Voice service');
                navigate(`/customer/${customerData.customer_id}/service/voice`, {
                    state: { customer: customerData, services: servicesFromState }
                });
                return;
            } else if (serviceName.includes('internet')) {
                console.log('🔵 [IPTVService] Navigating to Internet service');
                navigate(`/customer/${customerData.customer_id}/service/internet`, {
                    state: { customer: customerData, services: servicesFromState }
                });
                return;
            } else if (serviceName.includes('fofi') || serviceName.includes('smart box')) {
                console.log('🔵 [IPTVService] Navigating to FoFi Smart Box service');
                navigate(`/customer/${customerData.customer_id}/service/fofi-smart-box`, {
                    state: { customer: customerData, services: servicesFromState }
                });
                return;
            } else if (serviceName.includes('cable') || serviceName.includes('iptv') || serviceName.includes('tv')) {
                console.log('🔵 [IPTVService] Staying on IPTV/Cable TV service');
                // For IPTV/Cable TV, stay on this page
                setShowServiceModal(false);
                return;
            }

            // Default: close modal and stay on current page
            console.log('🔵 [IPTVService] Unknown service, staying on current page');
            setShowServiceModal(false);
        }
    };

    // Handle Order History button click
    const handleOrderHistory = () => {
        navigate('/payment-history', {
            state: {
                customer: customerData
            }
        });
    };

    // Handle Upload Document button click
    const handleUploadDocument = async () => {
        setUploadLoading(true);
        try {
            const cid = customerData?.customer_id;
            const response = await getCustKYCPreview({ cid, reqtype: 'update' });

            if (response?.status?.err_code === 0) {
                // Navigate to upload documents page with the fetched data
                navigate('/upload-documents', {
                    state: {
                        customer: customerData,
                        kycData: response.body
                    }
                });
            } else {
                alert('Failed to load documents: ' + (response?.status?.err_msg || 'Unknown error'));
            }
        } catch (err) {
            console.error('Error loading document preview:', err);
            alert('Failed to load documents. Please try again.');
        } finally {
            setUploadLoading(false);
        }
    };

    if (view === 'packages') {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50">
                {/* Blue Gradient Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-3">
                    <div className="flex items-center gap-3 mb-4">
                        <button onClick={() => setView('overview')} className="p-1">
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

                {/* Tabs */}
                <div className="bg-gradient-to-r from-indigo-600 to-blue-600 shadow-md">
                    <div className="grid grid-cols-4">
                        {tabs.map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-2 py-3 text-[10px] leading-tight font-bold transition-colors text-white ${activeTab === tab ? 'border-b-4 border-white' : 'border-b-4 border-transparent opacity-70'}`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 px-4 py-4 space-y-3 pb-24 bg-white">
                    {/* Search */}
                    <div className="relative">
                        <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search.."
                            className="w-full bg-white border border-gray-300 rounded-md pl-10 pr-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    {/* Package List */}
                    <div className="space-y-3">
                        {iptvAddonPackages.map(pkg => (
                            <div key={pkg.id} className="bg-white rounded-lg p-3 flex items-center gap-3 border border-gray-200">
                                <input
                                    type="checkbox"
                                    className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0"
                                    checked={selectedPackages.includes(pkg.id)}
                                    onChange={(e) => {
                                        if (e.target.checked) setSelectedPackages([...selectedPackages, pkg.id]);
                                        else setSelectedPackages(selectedPackages.filter(id => id !== pkg.id));
                                    }}
                                />
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-gray-800 text-sm font-normal leading-tight">{pkg.name}</h4>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-normal text-gray-800 mb-1">₹ {pkg.price.toFixed(2)}</p>
                                    <button className="text-xs text-indigo-600 font-bold">Details &gt;</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="fixed bottom-16 left-0 right-0 p-3 bg-white border-t flex gap-3">
                    <button className="flex-1 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-3 rounded-lg text-sm shadow-md hover:shadow-lg transition-all duration-200">
                        Continue
                    </button>
                    <button className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-3 rounded-lg text-sm shadow-md hover:shadow-lg transition-all duration-200">
                        Skip and create new pack
                    </button>
                </div>

                <BottomNav />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-gray-50">
            {/* Service Selection Modal - Now with services prop */}
            <ServiceSelectionModal
                isOpen={showServiceModal}
                onClose={() => setShowServiceModal(false)}
                onSelectService={handleServiceSelect}
                customer={customerData}
                services={servicesFromState}
            />

            {/* Blue Gradient Header */}
            <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                <button onClick={() => navigate('/customers')} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>
                <h1 className="text-lg font-medium text-white">Customer OverView</h1>
            </header>

            <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
                {/* User Details */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                        <h3 className="text-indigo-600 font-semibold text-lg">User Details</h3>
                    </div>
                    <div className="space-y-1 text-sm">
                        <div className="flex">
                            <span className="w-36 text-gray-600 dark:text-gray-400">Username</span>
                            <span className="text-gray-600 dark:text-gray-400">: {formatCustomerId(customerData.customer_id)}</span>
                        </div>
                        <div className="flex">
                            <span className="w-36 text-gray-600 dark:text-gray-400">Customer Name</span>
                            <span className="text-gray-600 dark:text-gray-400">: {customerData.name}</span>
                        </div>
                        <div className="flex">
                            <span className="w-36 text-gray-600 dark:text-gray-400">Ph Number</span>
                            <span className="text-gray-600 dark:text-gray-400">: {customerData.mobile}</span>
                        </div>
                        <div className="flex">
                            <span className="w-36 text-gray-600 dark:text-gray-400">Email Id</span>
                            <span className="text-gray-600 dark:text-gray-400">: {customerData.email}</span>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                    <button
                        onClick={handleUploadDocument}
                        disabled={uploadLoading}
                        className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg text-sm transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {uploadLoading ? 'Loading...' : 'Upload Document'}
                    </button>
                    <button
                        className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg text-sm transition-all duration-200 shadow-md hover:shadow-lg"
                        onClick={handleOrderHistory}
                    >
                        Order History
                    </button>
                </div>

                {/* Filter Badge */}
                <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 -mx-4">
                    <div className="flex items-center gap-2">
                        <span className="text-base text-indigo-600 font-semibold">Filtered by :</span>
                        <span className="bg-indigo-600 text-white text-sm font-medium px-4 py-1.5 rounded-md">
                            Cable TV
                        </span>
                    </div>
                    <button
                        onClick={() => setShowServiceModal(true)}
                        className="text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                    </button>
                </div>

                {/* FoFi Box ID */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                        <h3 className="text-indigo-600 font-semibold text-lg">FoFi Box ID</h3>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded flex justify-between items-center">
                        <p className="text-indigo-600 font-medium text-base">{iptvService?.fofiBoxId || 'A43EA0A01F4A'}</p>
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>

                {/* Plan Details */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                        <h3 className="text-indigo-600 font-semibold text-lg">Plan Details</h3>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
                        <div className="flex items-start gap-4">
                            {/* TV Icon */}
                            <div className="flex-shrink-0">
                                <svg className="w-16 h-16" viewBox="0 0 100 100">
                                    <rect x="10" y="20" width="80" height="50" rx="5" fill="#333" />
                                    <rect x="18" y="27" width="64" height="36" rx="3" fill="#6EC6FF" />
                                    <rect x="75" y="50" width="8" height="8" rx="2" fill="#FF5252" />
                                    <rect x="85" y="50" width="8" height="8" rx="2" fill="#FFD600" />
                                    <rect x="10" y="20" width="80" height="4" fill="#555" />
                                </svg>
                            </div>

                            {/* Plan Info */}
                            <div className="flex-1 space-y-2 text-sm">
                                <div className="flex">
                                    <span className="w-28 text-gray-700 dark:text-gray-300">Service Name</span>
                                    <span className="text-gray-700 dark:text-gray-300">:   cabletv</span>
                                </div>
                                <div className="flex">
                                    <span className="w-28 text-gray-700 dark:text-gray-300">Plan Name</span>
                                    <span className="text-gray-700 dark:text-gray-300">:   {iptvService?.planName || 'FTA+SUPER SAVER PACK'}</span>
                                </div>
                                <div className="flex items-start">
                                    <span className="w-28 text-gray-700 dark:text-gray-300">Expiry Date</span>
                                    <span className="text-gray-700 dark:text-gray-300">:</span>
                                    <span className="flex flex-col ml-2 text-gray-700 dark:text-gray-300">
                                        <span>{new Date(iptvService?.expiryDate || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</span>
                                        <span>{new Date(iptvService?.expiryDate || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toLowerCase()}</span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={() => setView('packages')}
                                className="flex-1 bg-purple-400 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors text-sm"
                            >
                                SELECT PACKAGES
                            </button>
                            <button
                                onClick={() => setView('packages')}
                                className="flex-1 bg-purple-400 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors text-sm"
                            >
                                SELECT CHANNELS
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <BottomNav />
        </div>
    );
}
