import React from "react";

export default function FullPageLoader({ color = "indigo", text = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-center items-center bg-black/30 backdrop-blur-sm">
      {/* Spinner */}
      <div className={`border-4 border-${color}-500 border-t-transparent rounded-full h-12 w-12 animate-spin`}></div>

      {/* Optional Text */}
      <span className="mt-4 text-white text-lg font-medium">{text}</span>
    </div>
  );
}
