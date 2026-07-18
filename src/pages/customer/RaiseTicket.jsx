import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader, SubjectCombobox, ComplaintExistsDialog, ConfirmDialog, RateEngineerDialog, Alert } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { getActiveAccount, ensureServiceContext } from "../../services/customer/linkAccount";
import { serviceTitle } from "../../services/customer/serviceHome";
import { statusLabel } from "../../services/customer/ticketFlow";
import { useRaiseGate, useRaiseSubmit, useTicketClose } from "../../hooks/useTicketFlow";
import {
  GlobeAltIcon,
  ChevronLeftIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

/**
 * Raise Ticket — 1:1 port of Android's RaiseNewTicketsFragment.
 *
 * Reached from the service home's "Raise Ticket" icon. Like the Android
 * fragment it takes NO parameters: every identifier comes from the active
 * linked account, which is the web equivalent of Android reading
 * service_user_id / service_username / user_mobile / cust_address /
 * operatior_id / serviceKey out of SharedPreferences.
 *
 * Layout follows the original: header band (icon, Name, User Id, "Raise
 * Ticket" caption) over a white sheet holding "Select Ticket", the subject
 * combobox, a "Comments" / "Clear" row, the textarea, and a full-width orange
 * Submit.
 */
export default function RaiseTicket() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const toast = useToast();
  const user = getUser();
  // Held in state so a back-filled service context re-renders the page.
  const [account, setAccount] = useState(getActiveAccount);

  // Accounts linked before `serviceListId` existed carry the wrong servid,
  // which makes apis/subjects/ return an empty complaint list. Repair it once
  // on mount rather than making the customer re-link.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const a = getActiveAccount();
      if (!a?.userid || a.serviceListId) return;
      const fixed = await ensureServiceContext(a);
      if (!cancelled && fixed?.serviceListId) setAccount(fixed);
    })();
    return () => { cancelled = true; };
  }, []);

  const [subject, setSubject] = useState("");
  const [comment, setComment] = useState("");
  // Android's X on the duplicate-complaint dialog pops the whole screen. We
  // just hide the dialog and fall back to the inline pending panel, which
  // carries the same details and the same actions — dismissing a dialog
  // should not eject you from the page you chose to open.
  const [existingDismissed, setExistingDismissed] = useState(false);

  const service = account
    ? {
        servicekey: account.servicekey || "internet",
        // The SERVICE's id (servServiceList `id`), not the account's own
        // servid — apis/subjects/ returns an empty list for the latter, which
        // is what leaves the complaint dropdown blank. `serviceListId` is
        // attached when the account is activated; fall back for accounts
        // persisted before that existed.
        servid: account.serviceListId || account.servid,
        opid: account.opid,
        address: account.address,
      }
    : null;

  const identity = {
    customerId: account?.userid || user?.username || "",
    custName: account?.name || `${user?.firstname || ""} ${user?.lastname || ""}`.trim() || "",
    custMobile: account?.mobileno || user?.mobileno || "",
  };

  const gate = useRaiseGate({
    service,
    customerId: identity.customerId,
    enabled: !!account?.userid,
  });

  const { submit, submitting } = useRaiseSubmit({
    service,
    identity,
    subjectsLoaded: gate.subjects.length > 0,
    // Android pops back to the service home on success — it does NOT jump to
    // the ticket list. Same here.
    onRaised: () => navigate("/cust/internet/home"),
  });

  const close = useTicketClose({
    service,
    customerId: identity.customerId,
    onDone: () => {
      // A successful close clears the block — re-run the gate so the form
      // becomes usable, and let the dialog show again if one still exists.
      setExistingDismissed(false);
      gate.refresh();
    },
  });

  const handleSubmit = async () => {
    const res = await submit({ subject, comment });
    if (res.ok) {
      setSubject("");
      setComment("");
      toast.add(res.message, { type: "success" });
      return;
    }
    toast.add(res.message, { type: "error" });
    if (res.reGate) gate.refresh();
  };

  if (!account?.userid) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <GlobeAltIcon className="w-10 h-10 text-gray-300 mx-auto" />
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

        {/* Header band — icon + Name / User Id, then the screen caption */}
        <div className="rounded-xl shadow overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <GlobeAltIcon className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0 text-sm space-y-0.5">
              <div className="flex gap-2">
                <span className="w-14 flex-shrink-0 text-white/70">Name</span>
                <span className="text-white font-medium break-words min-w-0">
                  {identity.custName || "—"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="w-14 flex-shrink-0 text-white/70">User Id</span>
                <span className="text-white font-medium break-words min-w-0">
                  {account.userid}
                </span>
              </div>
            </div>
          </div>
          <div className="bg-indigo-700/90 py-2 text-center text-sm font-medium text-white">
            Raise Ticket
          </div>
        </div>

        {/* Body sheet */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
          {gate.loading ? (
            <div className="py-10 flex justify-center">
              <Loader size="md" color="indigo" text="Fetching connection details…" />
            </div>
          ) : gate.state === "ready" ? (
            <>
              {/* Line unreachable — informational only, the form stays usable. */}
              {gate.warning && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800 dark:text-amber-200">{gate.warning}</p>
                </div>
              )}
              {/*
                contentVisibility/contain reset is load-bearing. This block is
                a direct child of the `space-y-4` sheet, and index.css applies
                `content-visibility: auto` to `.space-y-*  > *` (a list-perf
                optimization). That implies `contain: …paint`, which CLIPS the
                combobox's absolutely-positioned dropdown to this block's box —
                the dropdown opens below the input, over the Comments area, so
                it was being clipped away entirely (the "dropdown not visible"
                bug). Inline style because that index.css rule is unlayered and
                would otherwise out-cascade a utility class.
              */}
              <div style={{ contentVisibility: "visible", contain: "none" }}>
                <label className="text-sm font-medium text-teal-600 dark:text-teal-400">
                  Select Ticket
                </label>
                <div className="mt-2">
                  <SubjectCombobox
                    subjects={gate.subjects}
                    value={subject}
                    onChange={setSubject}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-teal-600 dark:text-teal-400">
                    Comments
                  </label>
                  {/* Android's Clear wipes ONLY the comments box, not the subject. */}
                  <button
                    type="button"
                    onClick={() => setComment("")}
                    disabled={!comment}
                    className="text-sm font-medium text-orange-500 disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
                <textarea
                  rows={7}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="mt-2 w-full border rounded-lg py-2.5 px-3 text-sm bg-gray-100 dark:bg-gray-900 dark:border-gray-700 text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none resize-none"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting || !subject || !comment.trim()}
                className="w-full py-3 rounded-lg bg-orange-500 text-white text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Please wait…" : "Submit"}
              </button>
            </>
          ) : gate.state === "pending" ? (
            // The blocking dialog below owns this state. This is the fallback
            // once it has been dismissed — never leave the screen empty.
            <div className="text-center py-6 space-y-3">
              <ExclamationTriangleIcon className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="text-sm text-gray-700 dark:text-gray-300">
                A complaint already exists. Please close it before raising a new one.
              </p>
              {gate.existing && (
                <div className="text-sm text-left space-y-1 border rounded-lg p-3 dark:border-gray-700">
                  <Row label="Ticket Id" value={gate.existing.tid} />
                  <Row label="Subject" value={gate.existing.subject} />
                  <Row label="Status" value={statusLabel(gate.existing.status)} />
                  <Row label="Assigned To" value={gate.existing.assigned || "Not Available"} />
                  <Row label="Raised Time" value={gate.existing.risedtime} />
                </div>
              )}
              <button
                onClick={() => close.ask(gate.existing, "close")}
                disabled={!gate.existing || close.busy}
                className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
              >
                Close Ticket
              </button>
            </div>
          ) : (
            <div className="text-center py-6 space-y-3">
              <ExclamationTriangleIcon
                className={`w-8 h-8 mx-auto ${gate.state === "error" ? "text-red-500" : "text-amber-500"}`}
              />
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {gate.message || "Something went wrong. Please try again."}
              </p>
              <button
                onClick={gate.refresh}
                className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Blocking duplicate-complaint dialog, as Android shows it over the
          disabled form. Dismissing returns to the fallback state above rather
          than kicking the user off the screen (Android pops the fragment). */}
      <ComplaintExistsDialog
        open={
          gate.state === "pending" &&
          !!gate.existing &&
          !existingDismissed &&
          !close.confirmOpen &&
          !close.rateOpen
        }
        ticket={gate.existing}
        busy={close.busy}
        onClose={() => setExistingDismissed(true)}
        onCloseTicket={() => close.ask(gate.existing, "close")}
        onRaiseBack={() => close.ask(gate.existing, "reraise")}
      />

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

      <Alert
        isOpen={!!close.result}
        onClose={close.clearResult}
        type={close.result?.ok ? "success" : "error"}
        title={close.result?.ok ? "Done!" : "Sorry!"}
        message={close.result?.message}
      />
    </Layout>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex">
      <span className="w-24 flex-shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-700 dark:text-gray-300 break-words min-w-0">{value || "—"}</span>
    </div>
  );
}
