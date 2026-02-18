export default function ResetOptionsModal({ isOpen, onClose, onSelectOption }) {
    if (!isOpen) return null;

    const options = [
        { id: 'pppoe', name: 'Reset PPPoE', icon: '🔌' },
        { id: 'mac', name: 'Reset MAC', icon: '🔄' },
        { id: 'password', name: 'Reset Password', icon: '🔒' },
        { id: 'data-usage', name: 'Data Usage', icon: '📊' }
    ];

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-40 px-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-md shadow-2xl w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">Reset Settings</h2>
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-1 transition-colors"
                        aria-label="Close"
                    >
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Options List */}
                <div className="py-2">
                    {options.map((option, index) => (
                        <div
                            key={option.id}
                            className="flex items-center px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                            onClick={() => {
                                onSelectOption(option.id);
                                onClose();
                            }}
                        >
                            {/* Icon */}
                            <span className="text-2xl mr-4">{option.icon}</span>

                            {/* Option Name */}
                            <span className="text-base text-gray-800 font-normal">
                                {option.name}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
