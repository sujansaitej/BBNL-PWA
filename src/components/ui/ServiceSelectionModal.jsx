import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';

export default function ServiceSelectionModal({ isOpen, onClose, onSelectService, customer, services: propServices }) {
    const navigate = useNavigate();
    const [selectedService, setSelectedService] = useState('');
    const [comingSoonOpen, setComingSoonOpen] = useState(false);

    // Default services (fallback if no services provided)
    const defaultServices = [
        { id: 'fofi', name: 'Fo-Fi Smart Box', path: 'fofi-smart-box' },
        { id: 'voice', name: 'Voice Call', path: 'voice' },
        { id: 'internet', name: 'Internet', path: 'internet' },
        { id: 'iptv', name: 'Cable TV', path: 'iptv' }
    ];

    // Services to hide from the UI
    const hiddenServices = ['games', 'multi service', 'ip camera'];

    // Services not yet available (show "Coming Soon" on click)
    const comingSoonServices = ['cable tv', 'voice call service', 'voice call', 'iptv'];

    // Use services from props if available, otherwise use default
    const services = (propServices && propServices.length > 0
        ? propServices.map((service, idx) => ({
            id: service.servkey || service.id || `service-${idx}`,
            name: service.title || service.servname || service.name || `Service ${idx + 1}`,
            path: service.servkey || service.id || `service-${idx}`
        }))
        : defaultServices
    ).filter(service => !hiddenServices.includes(service.name.toLowerCase()));

    const handleServiceClick = (service) => {
        if (comingSoonServices.includes(service.name.toLowerCase())) {
            setComingSoonOpen(true);
            return;
        }
        onSelectService(service);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white">
            {/* Blue Gradient Header */}
            <header className="flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
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
