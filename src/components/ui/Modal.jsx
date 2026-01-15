import React from "react";
import { motion } from "framer-motion";

const Modal = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <motion.div
        className="bg-white rounded-2xl shadow-lg p-4 w-80 relative"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.3 }}
      >
        {children}
        <button
          onClick={onClose}
          className="absolute -top-4 -right-2 text-white w-[25px] rounded-full"
          style={{ backgroundColor: '#9e9e9e99' }}
        >
          X
        </button>
      </motion.div>
    </div>
  );
};

export default Modal;
