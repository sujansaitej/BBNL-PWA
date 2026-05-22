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
      <div className="relative w-full overflow-visible pt-3">
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
          className={`peer w-full rounded-xl border px-3 pb-2.5 pt-4 text-base sm:text-sm dark:text-gray-700 bg-white outline-none transition-colors
            ${error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500"
              : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"}
            ${className}`}
          {...props}
        />

        <label
          htmlFor={name}
          className={`absolute left-2.5 z-[1] bg-white px-1.5 py-0.5 pointer-events-none transition-all duration-200
            top-0 text-xs font-medium
            peer-placeholder-shown:top-[26px] peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal
            peer-focus:top-0 peer-focus:text-xs peer-focus:font-medium
            ${error
              ? "text-red-500 peer-focus:text-red-500"
              : "text-purple-700 peer-placeholder-shown:text-gray-400 peer-focus:text-blue-600"
            }
          `}
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-[26px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {showPassword ? (
              <EyeSlashIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
        )}

        {children}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
