import { useState } from 'react';
import { ArrowLeftIcon, PencilIcon } from '@heroicons/react/24/outline';

export default function ResetPPPoE({ customer, onBack }) {
    const [customerId, setCustomerId] = useState(customer?.customer_id || '');

    const handleReset = () => {
        // TODO: Backend integration - Reset PPPoE API call
        console.log('Resetting PPPoE for customer:', customerId);
        alert('PPPoE reset functionality will be integrated with backend');
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-teal-500 text-white px-4 py-4 flex items-center gap-3">
                <button onClick={onBack} className="p-1">
                    <ArrowLeftIcon className="h-6 w-6" />
                </button>
                <h1 className="text-lg font-medium">Reset PPPoE</h1>
            </div>

            {/* Content */}
            <div className="px-6 py-8 space-y-6">
                {/* Icon */}
                <div className="flex justify-center">
                    <div className="w-24 h-24 rounded-full border-4 border-orange-500 flex items-center justify-center">
                        <svg className="w-12 h-12 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                </div>

                {/* Warning Message */}
                <p className="text-center text-orange-500 text-sm leading-relaxed px-4">
                    Resetting PPPoE will disconnect the current session and require reconnection with updated credentials.
                </p>

                {/* Customer ID Input */}
                <div className="relative">
                    <label className="block text-teal-500 text-sm mb-2">Enter customer Id</label>
                    <div className="relative">
                        <input
                            type="text"
                            value={customerId}
                            onChange={(e) => setCustomerId(e.target.value)}
                            className="w-full px-4 py-3 border-b-2 border-gray-300 focus:border-teal-500 outline-none bg-transparent"
                            placeholder="Enter customer ID"
                        />
                        <PencilIcon className="h-5 w-5 text-teal-500 absolute right-2 top-1/2 -translate-y-1/2" />
                    </div>
                </div>

                {/* Confirmation Text */}
                <p className="text-center text-orange-500 font-medium text-base pt-4">
                    Do you want to Reset PPPoE ?
                </p>

                {/* YES Button */}
                <div className="pt-4">
                    <button
                        onClick={handleReset}
                        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                    >
                        YES
                    </button>
                </div>
            </div>
        </div>
    );
}
