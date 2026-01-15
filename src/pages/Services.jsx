import { useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { MagnifyingGlassIcon, ChevronRightIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import { mockCustomerServices } from "../data";
import BottomNav from "../components/BottomNav";

export default function Services() {
    const { customerId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    // Use customer data from API (passed via location state)
    // Only fallback to mock data if not available
    const customerData = location.state?.customer;

    // For service availability, check mock data (new features)
    const mockServices = mockCustomerServices[customerId];

    const [searchTerm, setSearchTerm] = useState("");

    // Services list as per PRD - removed Games, Multiservice, IP Camera
    // Renamed Cable TV to IPTV
    const services = [
        {
            id: 'internet',
            name: 'Internet',
            path: `/customer/${customerId}/service/internet`,
            isActive: mockServices?.services?.internet?.active || false,
            hasSpecialOffer: false
        },
        {
            id: 'voice',
            name: 'Unlimited Calling',
            path: `/customer/${customerId}/service/voice`,
            isActive: mockServices?.services?.voice?.active || false,
            hasSpecialOffer: true,
            price: 100
        },
        {
            id: 'fofi',
            name: 'FoFi Smart Box',
            path: `/customer/${customerId}/service/fofi-smart-box`,
            isActive: mockServices?.services?.fofi?.active || false,
            hasSpecialOffer: false
        },
        {
            id: 'iptv',
            name: 'IPTV',
            path: `/customer/${customerId}/service/iptv`,
            isActive: mockServices?.services?.iptv?.active || false,
            hasSpecialOffer: false
        }
    ];

    const filteredServices = services.filter(service =>
        service.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleServiceClick = (service) => {
        navigate(service.path, { state: { customer: customerData } });
    };

    if (!customerData) {
        return (
            <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900">
                {/* Teal Header */}
                <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-teal-500">
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <ArrowLeftIcon className="h-6 w-6 text-white" />
                    </button>
                    <h1 className="text-lg font-medium text-white">Services</h1>
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
        <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900">
            {/* Teal Header */}
            <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-teal-500">
                <button onClick={() => navigate(-1)} className="p-1 mr-3">
                    <ArrowLeftIcon className="h-6 w-6 text-white" />
                </button>
                <h1 className="text-lg font-medium text-white">Services</h1>
            </header>

            <div className="flex-1 max-w-2xl mx-auto w-full space-y-4 px-4 py-4 pb-24">
                {/* Search Bar */}
                <div className="relative w-full">
                    <input
                        type="text"
                        placeholder="Search Plans"
                        className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-500"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <MagnifyingGlassIcon className="h-6 w-6 absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>

                {/* All Services Heading */}
                <h2 className="text-base font-medium text-orange-500 pt-2">All Services</h2>

                {/* Services List */}
                <div className="space-y-0 border-t border-gray-200 dark:border-gray-700">
                    {filteredServices.map((service) => (
                        <div
                            key={service.id}
                            className="relative flex items-center justify-between bg-white dark:bg-gray-800 px-0 py-5 border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                            onClick={() => handleServiceClick(service)}
                        >
                            {/* Special Offer Badge */}
                            {service.hasSpecialOffer && (
                                <div className="absolute top-0 right-0 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] font-bold px-4 py-1.5 rounded-bl-2xl rounded-tr-none shadow-md">
                                    SPECIAL OFFER
                                </div>
                            )}

                            <div className="flex flex-col flex-1">
                                <h3 className="text-base font-medium text-orange-500 uppercase tracking-wide">
                                    {service.name}
                                </h3>
                                {service.price && (
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                        ₹{service.price}.00
                                    </p>
                                )}
                            </div>

                            <ChevronRightIcon className="h-5 w-5 text-orange-500 flex-shrink-0" />
                        </div>
                    ))}
                </div>

                {filteredServices.length === 0 && (
                    <div className="text-center text-gray-500 dark:text-gray-400 py-10">
                        No services found
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
}
