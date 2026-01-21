import React from "react";
import { motion } from "framer-motion";

export default function Loader({
  size = "md",
  color = "indigo",
  text = "",
  fullScreen = false,
  showHeader = false,
  headerTitle = "Loading"
}) {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-12 w-12",
    lg: "h-16 w-16",
    xl: "h-20 w-20"
  };

  const LoadingSpinner = () => (
    <div className="relative">
      {/* Outer rotating ring */}
      <motion.div
        className={`${sizeClasses[size]} rounded-full border-4 border-indigo-200`}
        style={{ borderTopColor: '#4f46e5' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      />

      {/* Inner pulsing circle */}
      <motion.div
        className="absolute inset-0 m-auto h-3 w-3 rounded-full bg-indigo-600"
        animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        {/* Blue Gradient Header */}
        {showHeader && (
          <header className="flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
            <h1 className="text-lg font-medium text-white">{headerTitle}</h1>
          </header>
        )}

        {/* Loading Content */}
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 px-4">
          <LoadingSpinner />

          {text && (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-6 text-gray-600 text-base font-medium text-center"
            >
              {text}
            </motion.p>
          )}

          {/* Animated dots */}
          <motion.div
            className="flex gap-2 mt-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full bg-indigo-600"
                animate={{ y: [0, -8, 0] }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut"
                }}
              />
            ))}
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-center items-center py-10">
      <LoadingSpinner />

      {text && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-4 text-gray-600 text-sm font-medium"
        >
          {text}
        </motion.p>
      )}
    </div>
  );
}
