import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader, ConfirmDialog, RateEngineerDialog, Alert } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { getTickets } from "../../services/customer/tickets";
import {
  statusLabel,
  statusTone,
  isNewConnection,
  isResolved,
  isJobDone,
  assigneeName,
} from "../../services/customer/ticketFlow";
import { useTicketClose } from "../../hooks/useTicketFlow";
import {
  ChevronLeftIcon,
  ArrowPathIcon,
  UserCircleIcon,
  PhoneIcon,
  ClipboardDocumentListIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";

/**
 * Ticket Status — port of Android's TicketsStatusFragment.
 *
 * A STANDALONE screen, deliberately. In the Android app this and Raise Ticket
 * are two independent siblings launched from the home screen; Ticket Status
 * never renders a raise form and Raise Ticket never renders a list. They share
 * only the close/rating dialogs and the closeticket call.
 *
 * Single API: GET Apis/gettickets/ (capital A — a different controller from
 * the lowercase apis/ endpoints, and it takes no auth headers).
 *
 * The list row IS the whole screen — Android has no detail view, so every
 * field is rendered inline on the card.
 */
export default function TicketStatus() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const toast = useToast();
  const account = getActiveAccount();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const service = account
    ? { servicekey: account.servicekey || "internet", servid: account.servid, opid: account.opid }
    : null;

  /**
   * @param {boolean} silent - background refresh: don't show the page loader
   *   and don't blank the list on failure. A visible spinner every poll would
   *   yank the list out from under someone mid-read, and a transient network
   *   blip must not wipe tickets that are already on screen.
   */
  const load = useCallback(async (silent = false) => {
    if (!account?.userid) { setLoading(false); return; }
    if (!silent) { setLoading(true); setError(""); }
    try {
      const rows = await getTickets({
        userid: account.userid,
        mobile: account.mobileno,
        servicekey: service.servicekey,
      });
      setTickets(rows);
      setError("");
    } catch (err) {
      // Android logs network failures and shows nothing at all — the screen
      // just sits on its empty state. Always say what happened.
      if (!silent) {
        setError(err?.message || "Could not load your tickets.");
        setTickets([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.userid, account?.mobileno, service?.servicekey]);

  useEffect(() => { load(false); }, [load]);

  // ── Keep the ticket live ───────────────────────────────────────────
  // A ticket's assignee and status change on the OPERATOR's side: an
  // employee picks it (available → pending), transfers it (→ transfered,
  // new engineer), or marks it done (→ jobdone). Android has no polling and
  // no push, so a customer sees none of that until they pull to refresh.
  //
  // The customer is explicitly expected to see the engineer's details appear
  // once the ticket is picked, so we refresh: whenever the tab regains
  // focus, and on a slow poll while it is open. gettickets is cheap
  // (~200-600ms measured on production) so this is not an expensive loop.
  const POLL_MS = 45000;
  useEffect(() => {
    if (!account?.userid) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") load(true);   // silent
    };
    // Don't poll a backgrounded tab — it wastes the customer's data and the
    // backend's capacity for a screen nobody is looking at.
    const id = setInterval(refreshIfVisible, POLL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.userid, load]);

  const close = useTicketClose({
    service,
    customerId: account?.userid || "",
    onDone: () => load(false),
  });

  useEffect(() => {
    if (!close.result) return;
    toast.add(close.result.message, { type: close.result.ok ? "success" : "error" });
    close.clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close.result]);

  if (!account?.userid) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">No account selected.</p>
          <button
            onClick={() => navigate("/cust/internet")}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
          >
            Link an account
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate("/cust/internet/home")}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Home
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0">
              <ClipboardDocumentListIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Ticket Status</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 break-words">{account.userid}</p>
            </div>
          </div>
          {/* Android uses pull-to-refresh; a button is the web equivalent. */}
          <button
            onClick={() => load(false)}
            disabled={loading}
            className="flex items-center gap-1 text-sm text-indigo-600 flex-shrink-0 disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading tickets…" />
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center space-y-3">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={() => load(false)} className="text-sm font-medium text-indigo-600">Retry</button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No tickets found.
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t, i) => (
              <TicketCard
                key={t.tid || i}
                t={t}
                busy={close.busy}
                onClose={() => close.ask(t, "close")}
                onReraise={() => close.ask(t, "reraise")}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={close.confirmOpen}
        title={close.action === "reraise" ? "Re-Raise same Ticket!" : "Close Your Ticket!"}
        message={
          close.action === "reraise"
            ? "Are you sure? You want to Re-Raise the same ticket?"
            : "Are you sure? You want to close the ticket?"
        }
        onConfirm={close.confirm}
        onCancel={close.cancel}
      />

      <RateEngineerDialog
        open={close.rateOpen}
        engineerName={close.ticket?.empname || close.ticket?.assigned || ""}
        engineerImg={close.ticket?.empimg || ""}
        submitting={close.busy}
        onConfirm={close.rate}
        onCancel={close.cancel}
      />
    </Layout>
  );
}

/** One ticket. Android's row carries every field — there is no detail screen. */
function TicketCard({ t, busy, onClose, onReraise }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasPhone = Boolean(t.empmobile);
  // Re-raise appears only for "jobdone" — the engineer says it's fixed and the
  // customer disagrees. (Android leaks this button onto other rows through
  // ListView recycling; keying off the status directly avoids that.)
  const jobDone = isJobDone(t);
  const canClose = !isNewConnection(t) && !isResolved(t);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
      {/* Engineer band */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-3 flex items-center gap-3">
        {t.empimg && !imgFailed ? (
          <img
            src={t.empimg}
            alt=""
            onError={() => setImgFailed(true)}
            className="w-12 h-12 rounded-full object-cover border-2 border-white/40 flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <UserCircleIcon className="w-7 h-7 text-white/80" />
          </div>
        )}
        <div className="min-w-0 text-sm space-y-0.5">
          <div className="flex gap-2">
            <span className="w-20 flex-shrink-0 text-white/70">Assigned To</span>
            <span className="text-white font-medium break-words min-w-0">
              {/* Falls back to `assigned` — a picked ticket often has that set
                  while empname is still empty. */}
              {assigneeName(t)}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="w-20 flex-shrink-0 text-white/70">Phone</span>
            {hasPhone ? (
              <a
                href={`tel:${t.empmobile}`}
                className="text-white font-medium underline underline-offset-2 flex items-center gap-1"
              >
                <PhoneIcon className="w-3.5 h-3.5" /> {t.empmobile}
              </a>
            ) : (
              <span className="text-white/80">Not Available</span>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 text-sm space-y-1.5">
        <Row label="Ticket Subject" value={t.subject} />
        {t.reqtdsrv && <Row label="Services" value={t.reqtdsrv} />}
        <Row label="Ticket Id" value={t.tid} />
        <Row
          label="Status"
          value={
            <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold text-white ${statusTone(t.status)}`}>
              {statusLabel(t.status)}
            </span>
          }
        />
        <Row label="Raised Time" value={t.risedtime || "Not Available"} />
        <Row label="Time Taken" value={t.solvedtime || "Not Available"} />

        {/* Job done — the decision point. The engineer says it's fixed; the
            customer either accepts (close) or disagrees (re-raise). The
            backend auto-closes after a window if they do neither, but it
            exposes no deadline timestamp, so we prompt rather than count
            down — see the note in this file's header. */}
        {jobDone && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
            <CheckCircleIcon className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Your engineer has marked this resolved. Please close the ticket if you're
              satisfied, or re-raise it if the problem is still there.
            </p>
          </div>
        )}

        {canClose ? (
          <div className="flex gap-2 pt-3">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              Close Ticket
            </button>
            {jobDone && (
              <button
                onClick={onReraise}
                disabled={busy}
                className="flex-1 py-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm font-semibold disabled:opacity-50"
              >
                Re-Raise
              </button>
            )}
          </div>
        ) : (
          <p className="pt-2 text-xs text-gray-500 dark:text-gray-400">
            {isNewConnection(t)
              ? "New-connection requests are closed by your operator."
              : "This ticket is already resolved."}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex">
      <span className="w-28 flex-shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-700 dark:text-gray-300 break-words min-w-0">{value || "—"}</span>
    </div>
  );
}
