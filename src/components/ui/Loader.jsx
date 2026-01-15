import React from "react";

export default function Loader({ size = 8, color = "indigo", text = "", className = "" }) {
  return (
    <div className={`flex flex-col justify-center items-center ${className}`}>
      {/* Spinner */}
      <div
        className={`border-4 border-${color}-500 border-t-transparent rounded-full h-${size} w-${size} animate-spin`}
      ></div>

      {/* Optional Loading Text */}
      {text && <span className="mt-2 text-gray-700 dark:text-gray-300 text-sm">{text}</span>}
    </div>
  );
}
