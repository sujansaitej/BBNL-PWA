import { useState } from 'react';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

export default function DataUsage({ customer, onBack }) {
    const [customerId] = useState(customer?.customer_id || '');

    // Mock data - will be replaced with API data
    const usageData = {
        totalData: '100 GB',
        usedData: '45.5 GB',
        remainingData: '54.5 GB',
        usagePercentage: 45.5,
        validityDays: 15,
        lastUpdated: new Date().toLocaleString()
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-teal-500 text-white px-4 py-4 flex items-center gap-3">
                <button onClick={onBack} className="p-1">
                    <ArrowLeftIcon className="h-6 w-6" />
                </button>
                <h1 className="text-lg font-medium">Data Usage</h1>
            </div>

            {/* Content */}
            <div className="px-6 py-8 space-y-6">
                {/* Icon */}
                <div className="flex justify-center">
                    <div className="w-24 h-24 rounded-full border-4 border-orange-500 flex items-center justify-center">
                        <svg className="w-12 h-12 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                    </div>
                </div>

                {/* Customer ID Display */}
                <div className="bg-white rounded-lg p-4 shadow-sm">
                    <p className="text-sm text-gray-600">Customer ID</p>
                    <p className="text-lg font-semibold text-gray-900">{customerId}</p>
                </div>

                {/* Usage Stats */}
                <div className="bg-white rounded-lg p-6 shadow-sm space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Usage Statistics</h3>

                    {/* Progress Bar */}
                    <div>
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-gray-600">Data Used</span>
                            <span className="font-semibold text-orange-500">{usageData.usagePercentage}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                            <div
                                className="bg-orange-500 h-3 rounded-full transition-all duration-300"
                                style={{ width: `${usageData.usagePercentage}%` }}
                            ></div>
                        </div>
                    </div>

                    {/* Data Details */}
                    <div className="grid grid-cols-2 gap-4 pt-4">
                        <div className="bg-teal-50 rounded-lg p-4">
                            <p className="text-xs text-teal-600 mb-1">Total Data</p>
                            <p className="text-lg font-bold text-teal-700">{usageData.totalData}</p>
                        </div>
                        <div className="bg-orange-50 rounded-lg p-4">
                            <p className="text-xs text-orange-600 mb-1">Used Data</p>
                            <p className="text-lg font-bold text-orange-700">{usageData.usedData}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-4">
                            <p className="text-xs text-green-600 mb-1">Remaining</p>
                            <p className="text-lg font-bold text-green-700">{usageData.remainingData}</p>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-4">
                            <p className="text-xs text-blue-600 mb-1">Validity</p>
                            <p className="text-lg font-bold text-blue-700">{usageData.validityDays} days</p>
                        </div>
                    </div>

                    {/* Last Updated */}
                    <div className="pt-4 border-t border-gray-200">
                        <p className="text-xs text-gray-500">
                            Last updated: {usageData.lastUpdated}
                        </p>
                    </div>
                </div>

                {/* Backend Note */}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-xs text-yellow-800 text-center">
                        ⚠️ Backend integration pending - showing mock data
                    </p>
                </div>
            </div>
        </div>
    );
}
