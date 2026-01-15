import { useState } from 'react';
import { ArrowLeftIcon, PencilIcon } from '@heroicons/react/24/outline';

export default function ResetPassword({ customer, onBack }) {
    const [customerId, setCustomerId] = useState(customer?.customer_id || '');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const handleReset = () => {
        // Validation
        if (!customerId) {
            alert('Please enter customer ID');
            return;
        }
        if (!newPassword || !confirmPassword) {
            alert('Please enter both password fields');
            return;
        }
        if (newPassword !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        if (newPassword.length >= 15) {
            alert('Password length should be less than 15 characters');
            return;
        }
        if (newPassword === customerId) {
            alert('Password should not be same as username');
            return;
        }

        // TODO: Backend integration - Reset Password API call
        console.log('Resetting password for customer:', customerId);
        alert('Password reset functionality will be integrated with backend');
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-teal-500 text-white px-4 py-4 flex items-center gap-3">
                <button onClick={onBack} className="p-1">
                    <ArrowLeftIcon className="h-6 w-6" />
                </button>
                <h1 className="text-lg font-medium">Reset Password</h1>
            </div>

            {/* Content */}
            <div className="px-6 py-8 space-y-6">
                {/* Icon */}
                <div className="flex justify-center">
                    <div className="w-24 h-24 rounded-full border-4 border-orange-500 flex items-center justify-center">
                        <svg className="w-12 h-12 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                </div>

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
                <p className="text-center text-orange-500 font-medium text-base">
                    Do you want to reset password?
                </p>

                {/* New Password Input */}
                <div className="relative">
                    <label className="block text-teal-500 text-sm mb-2">Enter new password</label>
                    <div className="relative">
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full px-4 py-3 border-b-2 border-gray-300 focus:border-teal-500 outline-none bg-transparent"
                            placeholder="Enter new password"
                        />
                        <PencilIcon className="h-5 w-5 text-teal-500 absolute right-2 top-1/2 -translate-y-1/2" />
                    </div>
                    <p className="text-xs text-orange-500 mt-2">
                        (Password length should be less than 15 and should not be same as username)
                    </p>
                </div>

                {/* Confirm Password Input */}
                <div className="relative">
                    <label className="block text-teal-500 text-sm mb-2">Confirm password</label>
                    <div className="relative">
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full px-4 py-3 border-b-2 border-gray-300 focus:border-teal-500 outline-none bg-transparent"
                            placeholder="Confirm password"
                        />
                        <PencilIcon className="h-5 w-5 text-teal-500 absolute right-2 top-1/2 -translate-y-1/2" />
                    </div>
                </div>

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
