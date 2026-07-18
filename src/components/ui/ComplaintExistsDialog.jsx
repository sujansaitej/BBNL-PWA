import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/solid";

/**
 * "A complaint already exists!" — blocks the raise form while the customer
 * has an open ticket, and offers the way out (close it, or re-raise it).
 *
 * Two variants, exactly as in Android's ComplaintExistsDialogFragment:
 *   status === "jobdone" → the engineer says it's fixed, so the customer
 *     chooses: "Close Ticket" (satisfied) or "Raise Back" (not satisfied).
 *   any other status     → single "Close Ticket" action.
 *
 * Data comes from apis/cust/pendingticket/ — note the backend's misspelled
 * `risedtime` field, surfaced here as "Raised Time".
 */
export default function ComplaintExistsDialog({
  open,
  ticket,
  onClose,        // close (X) — dismiss without acting
  onCloseTicket,  // status "yes"
  onRaiseBack,    // status "no"
  busy = false,
}) {
  if (!open || !ticket) return null;

  const isJobDone = String(ticket.status || "").toLowerCase() === "jobdone";

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
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="absolute top-3 right-3 z-10 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full p-1.5 transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>

          <div className="px-6 pt-7 pb-5 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <ExclamationTriangleIcon className="h-8 w-8 text-amber-500" />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {isJobDone
                ? "Dear Customer, your complaint has been resolved. If you are satisfied close the ticket, else re-raise the same ticket."
                : "A complaint already exists! Please close the previously raised complaint to open a new one."}
            </p>
          </div>

          {/* Detail panel */}
          <div className="mx-6 mb-5 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 px-4 py-3.5 space-y-2 text-sm">
            <DetailRow label="Subject" value={ticket.subject} />
            <DetailRow label="Ticket Id" value={ticket.tid} />
            <DetailRow
              label="Status"
              value={
                <span className="inline-block rounded bg-orange-500 px-2.5 py-0.5 text-xs font-semibold text-white">
                  {ticket.status || "—"}
                </span>
              }
            />
            <DetailRow label="Assigned To" value={ticket.assigned} />
            <DetailRow label="Raised Time" value={ticket.risedtime} />
          </div>

          <div className="flex gap-3 px-6 pb-6">
            {isJobDone && (
              <button
                type="button"
                onClick={onRaiseBack}
                disabled={busy}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold disabled:opacity-50"
              >
                Raise Back
              </button>
            )}
            <button
              type="button"
              onClick={onCloseTicket}
              disabled={busy}
              className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Please wait…" : "Close Ticket"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 flex-shrink-0 text-white/70">{label}</span>
      <span className="text-white font-medium break-words min-w-0">
        {value || "—"}
      </span>
    </div>
  );
}
