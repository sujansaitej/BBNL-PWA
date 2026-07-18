import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserCircleIcon } from "@heroicons/react/24/solid";
import StarRating from "./StarRating";

// Android's RateEngineerDialog shows one of these under the stars as soon as
// a rating is picked. Reproduced verbatim (index = rating).
const RATING_LABELS = [
  "",
  "You rated Bad!",
  "You rated Average!",
  "You rated Good!",
  "You rated Excellent!",
  "You rated Fabulous!",
];

/**
 * "Rate Your Engineer" — shown between the close-confirmation and the actual
 * close request, matching the Android customer app.
 *
 * A rating is MANDATORY to confirm (Android toasts "Please rate the
 * engineer." otherwise); Cancel dismisses without closing the ticket.
 *
 * NO COMMENT FIELD, deliberately. Android's dialog renders one but never
 * reads it — Apis/closeticket accepts only custid/ticketid/engr_rating/
 * status/servicekey, so the text is silently discarded. Collecting feedback
 * we cannot transmit is worse than not asking. If the backend ever grows a
 * param, add the field here and pass it through onConfirm.
 */
export default function RateEngineerDialog({
  open,
  engineerName = "",
  engineerImg = "",
  onConfirm,
  onCancel,
  submitting = false,
}) {
  const [rating, setRating] = useState(0);
  const [error, setError] = useState("");
  const [imgFailed, setImgFailed] = useState(false);

  // Reset every time the dialog is re-opened for a different ticket.
  useEffect(() => {
    if (open) {
      setRating(0);
      setError("");
      setImgFailed(false);
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = () => {
    if (rating < 1) {
      setError("Please rate the engineer.");
      return;
    }
    onConfirm?.({ rating });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] px-4">
        <motion.div
          className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
          initial={{ opacity: 0, scale: 0.9, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <div className="px-6 pt-6 pb-5 text-center space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              Rate Your Engineer
            </h3>

            {/* Engineer avatar — empimg is an absolute URL from the backend */}
            <div className="flex flex-col items-center gap-1.5">
              {engineerImg && !imgFailed ? (
                <img
                  src={engineerImg}
                  alt={engineerName || "Field engineer"}
                  onError={() => setImgFailed(true)}
                  className="w-16 h-16 rounded-full object-cover border-2 border-indigo-100 dark:border-indigo-900"
                />
              ) : (
                <UserCircleIcon className="w-16 h-16 text-gray-300 dark:text-gray-600" />
              )}
              {engineerName && (
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {engineerName}
                </span>
              )}
            </div>

            <StarRating
              value={rating}
              size="md"
              onChange={(v) => {
                setRating(v);
                setError("");
              }}
            />

            <p
              className={`text-sm min-h-[1.25rem] ${
                error ? "text-red-500" : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {error || RATING_LABELS[rating] || "Tap a star to rate"}
            </p>
          </div>

          <div className="flex gap-3 px-6 pb-6">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? "Please wait…" : "Confirm"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
