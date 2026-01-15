import { useState } from 'react';

export default function ServiceSelectionModal({ isOpen, onClose, onSelectService, customer }) {
    const [selectedService, setSelectedService] = useState('');

    const services = [
        { id: 'fofi', name: 'FOFI Smart Box', path: 'fofi-smart-box' },
        { id: 'voice', name: 'Voice Call Service', path: 'voice' },
        { id: 'internet', name: 'Internet', path: 'internet' },
        { id: 'iptv', name: 'Cable TV', path: 'iptv' }
    ];

    const handleServiceClick = (service) => {
        // Directly navigate when a service is clicked
        onSelectService(service);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-x-0 bottom-0 top-44 z-50 flex items-start justify-center px-4 pt-8"
            onClick={onClose}
        >
            {/* White background overlay */}
            <div className="absolute inset-0 bg-white"></div>
            
            {/* Modal */}
            <div
                className="relative bg-white rounded-md shadow-2xl w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">Choose Service</h2>
                </div>

                {/* Service List */}
                <div className="py-2">
                    {services.map((service, index) => (
                        <div
                            key={service.id}
                            className={`flex items-center px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${index !== services.length - 1 ? '' : ''
                                }`}
                            onClick={() => handleServiceClick(service)}
                        >
                            {/* Radio Button */}
                            <div className="flex items-center justify-center w-5 h-5 mr-4">
                                <div className="w-5 h-5 rounded-full border-2 border-gray-400 flex items-center justify-center">
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
    );
}
