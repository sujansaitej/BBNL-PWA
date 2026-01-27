// components/ui/Toast.jsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ToastContext = createContext(null);

// Hook to use in components
export function useToast() {
  return useContext(ToastContext);
}

let idCounter = 0;

export function ToastProvider({ children, position = "top-right", autoDismiss = 4000 }) {
  const [toasts, setToasts] = useState([]);

  const add = (message, opts = {}) => {
    const id = ++idCounter;
    const toast = {
      id,
      message,
      type: opts.type || "info", // 'success' | 'error' | 'info'
      duration: typeof opts.duration === "number" ? opts.duration : autoDismiss,
    };
    setToasts((s) => [toast, ...s]);
    return id;
  };

  const remove = (id) => setToasts((s) => s.filter((t) => t.id !== id));

  const value = useMemo(() => ({ add, remove }), []);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast container */}
      <div
        aria-live="polite"
        className={`fixed z-50 pointer-events-none flex flex-col gap-2 p-2 ${
          position === "top-right"
            ? "top-2 right-2 items-end"
            : position === "top-left"
            ? "top-2 left-2 items-start"
            : position === "bottom-right"
            ? "bottom-2 right-2 items-end"
            : "bottom-2 left-2 items-start"
        }`}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }) {
  const { id, message, type, duration } = toast;
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(() => {
      setShow(false);
      setTimeout(onClose, 180); // give time for exit animation
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bg =
    type === "success" ? "bg-purple-500 ring-purple-300" : type === "error" ? "bg-red-400 ring-red-300" : type === "warning" ? "bg-orange-400 ring-orange-300" : type === "info" ? "bg-blue-500 ring-blue-300" : "bg-gray-200 ring-slate-300";
  const accent =
    type === "success" ? "text-white" : type === "error" ? "text-white" : type === "warning" ? "text-white" : type === "info" ? "text-white" : "text-slate-700";

  return (
    <div
      role="status"
      className={`pointer-events-auto max-w-sm w-full transform transition-all duration-180
        ${show ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-2 scale-95"}
        ${bg} ring-1 ring-opacity-80 rounded-xl shadow-lg p-2 flex items-start gap-1`}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 mt-0.5 ${accent}`}>
        {type === "success" ? (
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414L8.414 15l-4.121-4.121a1 1 0 011.414-1.414L8.414 12.172l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : type === "error" ? (
          <svg className="w-5 h-5" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ) : type === "warning" ? (
          <svg className="w-5 h-5" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        ) : type === "info" ? (
          <svg className="w-5 h-5" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="8" />
          </svg>
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM8 8h2v5H8V8zM8 14h2v2H8v-2z" />
          </svg>
        )}
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0 mt-0.5">
        {/* <p className={`text-sm font-medium ${accent}`}>{type.charAt(0).toUpperCase() + type.slice(1)}</p> */}
        <p className="text-sm text-white truncate break-words">{message}</p>
      </div>

      {/* Close */}
      <button
        onClick={() => {
          setShow(false);
          setTimeout(onClose, 140);
        }}
        aria-label="Close toast"
        className="ml-2 p-1 rounded-md hover:bg-slate-100"
      >
        <svg className="w-4 h-4 text-slate-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M6.293 6.293a1 1 0 011.414 0L10 8.586l2.293-2.293a1 1 0 111.414 1.414L11.414 10l2.293 2.293a1 1 0 01-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 01-1.414-1.414L8.586 10 6.293 7.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}
