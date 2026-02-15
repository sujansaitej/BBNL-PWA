import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { voicePlans } from "../../data";
import BottomNav from "../../components/BottomNav";
import { useToast } from "@/components/ui/Toast";

export default function VoiceService() {
    const location = useLocation();
    const navigate = useNavigate();
    const toast = useToast();

    // Use actual customer data from API (passed from customer list)
    const customerData = location.state?.customer;

    const [searchTerm, setSearchTerm] = useState("");

    // Filter plans based on search term
    const filteredPlans = voicePlans.filter(plan =>
        plan.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handlePlanClick = (plan) => {
        toast.add('Voice service details coming soon', { type: 'info' });
    };

    // Handle Order History button click
    const handleOrderHistory = () => {
        navigate('/payment-history', {
            state: {
                customer: customerData
            }
        });
    };

    if (!customerData) {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50">
                <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
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
        <div className="min-h-screen flex flex-col bg-white">
            {/* Header */}
            <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                <button onClick={() => navigate(-1)} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>
                <h1 className="text-lg font-medium text-white">Services</h1>
            </header>

            <div className="flex-1 flex flex-col">
                {/* Search Bar */}
                <div className="bg-white px-4 pt-4 pb-3">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search Plans"
                            className="w-full border border-gray-300 rounded-md py-2.5 pl-4 pr-12 text-gray-800 text-base bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-all duration-200"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2">
                            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </span>
                    </div>
                </div>

                {/* All Services Label */}
                <div className="bg-white px-4 py-2.5 border-b border-gray-200">
                    <h2 className="text-indigo-600 text-base font-semibold">All Services</h2>
                </div>

                {/* Voice Plans List */}
                <div className="flex-1 bg-white pb-20">
                    {filteredPlans.length > 0 ? (
                        filteredPlans.map(plan => (
                            <div
                                key={plan.id}
                                onClick={() => handlePlanClick(plan)}
                                className="relative flex items-center px-4 py-4 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                                style={{ minHeight: 70 }}
                            >
                                {/* Special Offer Ribbon */}
                                {plan.isSpecialOffer && (
                                    <div className="absolute right-0 top-0 overflow-hidden rounded-bl-lg" style={{ zIndex: 2 }}>
                                        <div className="bg-red-600 text-white text-[10px] font-bold px-3 py-1 tracking-wide">
                                            SPECIAL OFFER
                                        </div>
                                    </div>
                                )}

                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="text-indigo-600 font-semibold text-lg truncate mb-1">
                                        {plan.name}
                                    </div>
                                    <div className="text-gray-700 text-base truncate">
                                        {typeof plan.price === 'number' ? `₹${plan.price.toFixed(2)}` : plan.price}
                                    </div>
                                </div>

                                <span className="ml-2 flex-shrink-0">
                                    <svg width="10" height="16" fill="none" stroke="#ff6f00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 10 16">
                                        <path d="M2 2l6 6-6 6" />
                                    </svg>
                                </span>
                            </div>
                        ))
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <p className="text-gray-500 text-base">No plans found</p>
                        </div>
                    )}
                </div>
            </div>

            <BottomNav />
        </div>
    );
}
