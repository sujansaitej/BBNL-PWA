import { motion, AnimatePresence } from "framer-motion";
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";

const Alert = ({ isOpen, onClose, type = "success", title, message, autoClose = true }) => {
    // Auto close after 3 seconds if autoClose is true
    if (autoClose && isOpen) {
        setTimeout(() => {
            onClose();
        }, 5000);
    }

    const icons = {
        success: <CheckCircleIcon className="h-16 w-16 text-purple-500" />,
        error: <XCircleIcon className="h-16 w-16 text-red-500" />,
        warning: <ExclamationTriangleIcon className="h-16 w-16 text-orange-500" />,
        info: <InformationCircleIcon className="h-16 w-16 text-blue-500" />
    };

    const gradients = {
        success: "from-purple-500 to-violet-600",
        error: "from-red-500 to-rose-600",
        warning: "from-orange-500 to-amber-600",
        info: "from-indigo-600 to-blue-600"
    };

    const bgColors = {
        success: "bg-purple-50",
        error: "bg-red-50",
        warning: "bg-orange-50",
        info: "bg-indigo-50"
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 px-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8, y: 20 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                    >
                        {/* Gradient Header */}
                        <div className={`bg-gradient-to-r ${gradients[type]} p-6 text-center relative`}>
                            <button
                                onClick={onClose}
                                className="absolute top-3 right-3 text-white/80 hover:text-white transition-colors"
                            >
                                <XMarkIcon className="h-6 w-6" />
                            </button>
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                                className="flex justify-center mb-3"
                            >
                                <div className="bg-white rounded-full p-3 shadow-lg">
                                    {icons[type]}
                                </div>
                            </motion.div>
                            {title && (
                                <h3 className="text-xl font-bold text-white mb-1">
                                    {title}
                                </h3>
                            )}
                        </div>

                        {/* Content */}
                        <div className={`${bgColors[type]} p-6`}>
                            <p className="text-gray-700 text-center text-base leading-relaxed">
                                {message}
                            </p>
                        </div>

                        {/* Footer Button */}
                        <div className="p-4 bg-white">
                            <button
                                onClick={onClose}
                                className={`w-full bg-gradient-to-r ${gradients[type]} hover:opacity-90 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg`}
                            >
                                OK
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default Alert;
