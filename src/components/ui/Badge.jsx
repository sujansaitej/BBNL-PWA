import React from "react";
import clsx from "clsx";

const colorClasses = {
  indigo: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-200",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300",
  green: "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  red: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300",
  purple: "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-200",
  grey: "bg-gray-200 text-gray-600 dark:bg-grey-900 dark:text-grey-300",
};

export default function Badge({ children, color = "indigo", size = "sm" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full font-medium",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-3 py-1 text-sm",
        size === "lg" && "px-4 py-1.5 text-base",
        colorClasses[color]
      )}
    >
      {children}
    </span>
  );
}
