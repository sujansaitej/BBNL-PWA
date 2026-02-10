import { useState, useRef, useEffect } from "react";

export default function UserToggle({ loginType, setLoginType }) {
  const [pillPosition, setPillPosition] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const activeIndex = loginType === "franchisee" ? 0 : 1;
    const buttonWidth = container.clientWidth / 2;

    setPillPosition(activeIndex * buttonWidth);
    localStorage.setItem("loginType", loginType);
  }, [loginType]);

  const vibrate = () => {
    if ("vibrate" in navigator) navigator.vibrate(10); // tiny haptic
  };

  return (
    <div className="flex items-center justify-center mb-6">
      <div
        ref={containerRef}
        className="relative bg-gray-200 dark:bg-gray-800 rounded-full p-1 flex w-64"
      >
        {/* Moving Pill */}
        <div
          className="absolute top-1 bottom-1 bg-blue-600 rounded-full transition-all duration-300 ease-out"
          style={{
            left: pillPosition,
            width: "50%",
          }}
        ></div>

        {/* Franchisee */}
        <button
          onClick={() => {
            setLoginType("franchisee");
            vibrate();
          }}
          className={`relative z-10 w-1/2 py-1 text-sm font-medium transition ${
            loginType === "franchisee"
              ? "text-white"
              : "text-gray-600 dark:text-gray-300"
          }`}
        >
          Franchisee
        </button>

        {/* Customer */}
        <button
          onClick={() => {
            setLoginType("customer");
            vibrate();
          }}
          className={`relative z-10 w-1/2 py-1 text-sm font-medium transition ${
            loginType === "customer"
              ? "text-white"
              : "text-gray-600 dark:text-gray-300"
          }`}
        >
          Customer
        </button>
      </div>
    </div>
  );
}
