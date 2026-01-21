import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon } from "@heroicons/react/24/outline";

const Modal = ({ isOpen, onClose, children, title }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
        <motion.div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          initial={{ opacity: 0, scale: 0.9, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {/* Gradient Header */}
          {title && (
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-all duration-200"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
          )}

          {/* Content */}
          <div className="p-6">
            {children}
          </div>

          {/* Close button if no title */}
          {!title && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-2 transition-all duration-200"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default Modal;
