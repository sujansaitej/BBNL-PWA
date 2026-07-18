import React, { useState } from "react";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { StarIcon as StarOutline } from "@heroicons/react/24/outline";

/**
 * Accessible 1–5 star rating input.
 *
 * Mirrors the Android RatingBar used in the customer app's "Rate Your
 * Engineer" dialog (numStars=5, stepSize=1.0) — whole stars only, and 0
 * means "not yet rated" rather than a valid score.
 */
const SIZES = { sm: "h-6 w-6", md: "h-9 w-9", lg: "h-11 w-11" };

export default function StarRating({
  value = 0,
  onChange,
  size = "md",
  readOnly = false,
  className = "",
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const box = SIZES[size] || SIZES.md;

  return (
    <div
      className={`flex items-center justify-center gap-1.5 ${className}`}
      role={readOnly ? "img" : "radiogroup"}
      aria-label={readOnly ? `Rated ${value} out of 5` : "Rate out of 5"}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= shown;
        const Icon = filled ? StarSolid : StarOutline;
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            role={readOnly ? undefined : "radio"}
            aria-checked={readOnly ? undefined : value === star}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            onClick={() => !readOnly && onChange?.(star)}
            onMouseEnter={() => !readOnly && setHover(star)}
            onMouseLeave={() => !readOnly && setHover(0)}
            className={`transition-transform duration-150 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              readOnly ? "cursor-default" : "cursor-pointer hover:scale-110 active:scale-95"
            }`}
          >
            <Icon
              className={`${box} ${
                filled ? "text-amber-400" : "text-gray-300 dark:text-gray-600"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
