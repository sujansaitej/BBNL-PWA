import { motion, AnimatePresence } from "framer-motion";
import { QuestionMarkCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function ConfirmDialog({ open, message, onConfirm, onCancel, title = "Confirm Action" }) {
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          {/* Gradient Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <button
              onClick={onCancel}
              className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-all duration-200"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
              className="flex justify-center mb-6"
            >
              <div className="bg-gradient-to-br from-indigo-100 to-blue-100 rounded-full p-4">
                <QuestionMarkCircleIcon className="h-16 w-16 text-indigo-600" />
              </div>
            </motion.div>

            <p className="text-gray-700 text-center text-base leading-relaxed mb-6">
              {message}
            </p>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              >
                Confirm
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}