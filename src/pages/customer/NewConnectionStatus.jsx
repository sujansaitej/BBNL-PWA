import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, TicketIcon } from "@heroicons/react/24/outline";
import { Loader } from "@/components/ui";
import { getUser } from "../../services/safeStorage";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { getNewConnectionStatus } from "../../services/customer/newConnFunnel";

/**
 * Ticket Status — the screen behind the toolbar icon on New Connection.
 *
 * Keyed on MOBILE, not username: `getNewConnectionStatus` looks tickets up by
 * the number the request was raised with (`tag_id`). Verified live — it
 * returned a real new-connection ticket for the mobile used to raise it.
 *
 * Android shows a bare "No Tickets Found!" and nothing else. This keeps that
 * empty state but separates it from a FAILURE, so a backend problem cannot
 * masquerade as "you have no requests" — the same distinction Notification
 * History draws, and for the same reason.
 */
export default function NewConnectionStatus() {
  const navigate = useNavigate();
  const user = getUser();
  const account = getActiveAccount();
  const mobile = account?.mobileno || user?.mobileno || "";

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!mobile) { setError("No mobile number on this account."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { ok, tickets: rows, message } = await getNewConnectionStatus(mobile);
      // err_code 0 with "No records found" is an empty inbox, not an error.
      if (ok) setTickets(rows);
      else { setTickets([]); setError(message || "Could not load your requests."); }
    } catch (err) {
      setTickets([]);
      setError(err?.message || "Could not load your requests.");
    } finally {
      setLoading(false);
    }
  }, [mobile]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-900">
      <header
        className="flex items-center gap-3 px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 text-white"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
      >
        <button onClick={() => navigate(-1)} className="p-1" aria-label="Go back">
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
        <h1 className="text-lg font-medium">Ticket Status</h1>
      </header>

      <div className="px-4 py-4">
        {loading ? (
          <Loader text="Loading your requests..." />
        ) : error ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 text-center">
            <p className="text-sm text-amber-800 dark:text-amber-200">{error}</p>
            <button onClick={load} className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white">
              Try again
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16">
            <TicketIcon className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No Tickets Found!</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {tickets.map((t, i) => (
              <li
                key={t.tid || i}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-sm text-gray-800 dark:text-gray-100">
                    {t.subject || "New Connection"}
                  </p>
                  <span className="shrink-0 rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                    {t.status || "—"}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                  <Row label="Ticket" value={t.tid} />
                  <Row label="Raised" value={t.risedtime} />
                  <Row label="Services" value={t.services || t.reqservices} />
                  <Row label="Assigned" value={t.assigned} />
                  <Row label="Closed" value={t.closedtime} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
