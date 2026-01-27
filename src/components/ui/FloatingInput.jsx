import { forwardRef, useState } from "react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";

const FloatingInput = forwardRef(
  (
    {
      label,
      type = "text",
      name,
      cls,
      value,
      len = "100",
      onChange,
      error,
      children,
      required = false,
      onlyNumbers = false,
      onlyLetters = false,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";

    const handleChange = (e) => {
      let val = e.target.value;

      if (onlyNumbers) {
        val = val.replace(/[^0-9]/g, "");
      }

      if (onlyLetters) {
        val = val.replace(/[^a-zA-Z\s]/g, "");
      }

      if (len && val.length > len) {
        val = val.substring(0, len);
      }

      if (onChange) {
        if (onChange.length >= 2) {
          onChange(val, name); // (value, name)
        } else {
          const clonedEvent = {
            ...e,
            target: { ...e.target, value: val, name },
          };
          onChange(clonedEvent); // (event)
        }
      }
    };

    return (
      <div className="relative w-full">
        <input
          id={name}
          type={isPassword && showPassword ? "text" : type}
          name={name}
          ref={ref}
          value={value ?? ""}
          onChange={handleChange}
          maxLength={len}
          placeholder=" "
          inputMode={onlyNumbers ? "numeric" : undefined}
          pattern={onlyNumbers ? "[0-9]*" : undefined}
          className={`peer w-full rounded-xl border p-3 text-sm dark:text-gray-700 bg-white outline-none transition ${cls || ""}
            ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"}
          `}
          {...props}
        />

        {/* Label */}
        <label
          htmlFor={name}
          className={`absolute left-3 top-3 px-1 bg-white text-sm text-purple-700 transition-all
            peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
            peer-focus:-top-2 peer-focus:text-xs peer-focus:text-blue-500
            ${value ? "-top-2.4 text-xs text-blue-500" : ""}
            ${error ? "text-red-500 peer-focus:text-red-500" : ""}
          `}
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>

        {/* Password Toggle */}
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

        {children}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);

export default FloatingInput;
