import { forwardRef } from "react";

const Button = forwardRef(
  (
    {
      type = "button",
      onClick,
      children,
      submitting = false,
      loadingText = "Loading...",
      loadingIcon: LoadingIcon,
      loadingPosition = "left",
      loadingOnly = false,
      disabled = false,
      className = "",
      size = "md", // sm | md | lg
      variant = "primary", // primary | secondary | danger
      mode = "filled", // filled | outlined
      icon: Icon,
      iconPosition = "left",
      fullWidth = false,
      shape = "rounded", // NEW: circle | rounded | square
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "font-semibold flex justify-center items-center gap-2 transition";

    // Sizes
    const sizes = {
      sm: "px-3 py-1 text-sm",
      md: "px-4 py-2 text-base",
      lg: "px-6 py-3 text-lg",
    };

    // Shapes
    const shapes = {
      rounded: "rounded-lg",
      square: "rounded-none",
      circle: "rounded-full p-2 aspect-square", // perfect circle
    };

    // Variants
    const variants = {
      primary: {
        filled: "bg-indigo-600 text-white hover:bg-indigo-700",
        outlined:
          "border border-indigo-600 text-indigo-600 hover:bg-indigo-50",
      },
      secondary: {
        filled: "bg-gray-200 text-gray-700 hover:bg-gray-300",
        outlined:
          "border border-gray-400 text-gray-700 hover:bg-gray-100",
      },
      danger: {
        filled: "bg-red-600 text-white hover:bg-red-700",
        outlined:
          "border border-red-600 text-red-600 hover:bg-red-50",
      },
    };

    const Loader = () =>
      LoadingIcon ? (
        <LoadingIcon className="h-5 w-5 animate-spin" />
      ) : (
        <svg
          className="h-5 w-5 animate-spin text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          ></path>
        </svg>
      );

    return (
      <button
        ref={ref}
        type={type}
        onClick={onClick}
        disabled={disabled || submitting}
        className={`${baseStyles} ${sizes[size]} ${shapes[shape]} ${
          variants[variant][mode]
        } ${submitting || disabled ? "opacity-60 cursor-not-allowed" : ""} ${
          fullWidth ? "w-full" : ""
        } ${className}`}
        {...props}
      >
        {submitting && loadingOnly ? (
          <Loader />
        ) : (
          <>
            {!submitting && Icon && iconPosition === "left" && (
              <Icon className="h-5 w-5" />
            )}

            {submitting && loadingPosition === "left" && <Loader />}

            {submitting ? loadingText : children}

            {submitting && loadingPosition === "right" && <Loader />}

            {!submitting && Icon && iconPosition === "right" && (
              <Icon className="h-5 w-5" />
            )}
          </>
        )}
      </button>
    );
  }
);

export default Button;
