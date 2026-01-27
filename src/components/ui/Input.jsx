import { useState, forwardRef } from "react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";

const Input = forwardRef(
  (
    {
      label,
      type = "text",
      name,
      className = "",
      value,
      maxLength = 100,
      onChange,
      error,
      children,
      required = false,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";

    return (
      <div className="relative w-full">
        {/* Input field */}
        <input
          id={name}
          type={isPassword && showPassword ? "text" : type}
          name={name}
          ref={ref}
          value={value}
          onChange={onChange}
          maxLength={maxLength}
          placeholder=" "
          required={required}
          className={`peer w-full rounded-xl border p-3 text-sm dark:text-gray-700 bg-white outline-none transition 
            ${error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500"
              : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"} 
            ${className}`}
          {...props}
        />

        {/* Floating Label */}
        <label
          htmlFor={name}
          className={`absolute left-3 top-2 bg-white dark:bg-white px-1 text-purple-700 text-sm transition-all
            peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
            peer-focus:-top-2 peer-focus:text-xs peer-focus:text-blue-500
            ${value ? "-top-2.4 text-xs text-blue-600" : ""}
            ${error ? "text-red-500 peer-focus:text-red-500" : ""}
          `}
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>

        {/* Eye Icon for Password */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {showPassword ? (
              <EyeSlashIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
        )}

        {/* Extra children (icons, addons, etc.) */}
        {children}

        {/* Error message */}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
