// Shared ticket-flow logic for the customer surface.
//
// Extracted so the dedicated Raise Ticket screen
// (pages/customer/RaiseTicket.jsx, the 1:1 port of Android's
// RaiseNewTicketsFragment) and the Ticket Status screen
// (pages/customer/TicketStatus.jsx) share one implementation of the gate and
// the close/re-raise pipeline instead of two copies that would drift.
//
// These previously also backed a combined multi-service page
// (pages/customer/Tickets.jsx), removed once tickets moved behind the
// Internet service flow to match the native app.
//
// Nothing here renders. Dialog visibility is returned as state for the host
// to render, because the two hosts present them differently.

import { useCallback, useEffect, useState } from "react";
import {
  checkMaintenance,
  checkPendingTickets,
  getSubjects,
  raiseTicket,
  getParticularTicketStatus,
  closeTicket,
} from "../services/customer/tickets";
import { decideCloseFlow } from "../services/customer/ticketFlow";

/**
 * The raise-screen gate.
 *
 * Android's load order, reproduced exactly:
 *   maintenance  → err_code 0 required, else the form is dead
 *   pendingticket → "Pending Tickets Unavailable" required
 *   subjects      → populates the dropdown
 *
 * Each step gates the next; the form stays disabled until all three pass.
 * `state` is one of: null (loading) | 'maintenance' | 'unreachable' |
 * 'pending' | 'ready' | 'error'.
 *
 * `unreachable` is ours, not Android's: the maintenance endpoint answers
 * err_msg "Error Pinging" with a top-level "Under Maintenance" message when
 * the customer's LINE is down — which is not a maintenance window and is
 * precisely when they need to complain. See services/customer/tickets.js.
 */
export function useRaiseGate({ service, customerId, enabled = true }) {
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState(null);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [existing, setExisting] = useState(null);
  const [subjects, setSubjects] = useState([]);

  const run = useCallback(async () => {
    if (!service?.servicekey) return;
    setLoading(true);
    setState(null);
    setMessage("");
    setWarning("");
    setExisting(null);
    setSubjects([]);

    try {
      // A missing operator id no longer blocks the gate. The complaint
      // catalogue does not need it (see getSubjects), so blocking here would
      // deny the customer a working form for a value only the SUBMIT step
      // actually requires — useRaiseSubmit checks it there instead, where a
      // missing operid would otherwise file an orphaned ticket.
      const maint = await checkMaintenance({
        apiopid: service.opid,
        cid: customerId,
        servicekey: service.servicekey,
      });

      // A PING FAILURE IS NOT A MAINTENANCE WINDOW — and must not block.
      //
      // This endpoint pings the customer's line as part of its check and
      // answers err_code 1 / err_msg "Error Pinging" when it is unreachable,
      // under a generic top-level "Under Maintenance" message. Android treats
      // every non-zero err_code as a hard stop, which locks the raise form for
      // exactly the customer who most needs it: the one whose connection is
      // down. We downgrade it to a warning and continue.
      //
      // Safe because raiseTicket is a separate endpoint that performs no ping
      // and never consults maintenance, and because the backend still rejects
      // duplicates itself with "Tickets Are Pending".
      if (!maint.open && !maint.pingFailed) {
        setState("maintenance");
        setMessage("This service is under maintenance. Please try again shortly.");
        return;
      }
      if (maint.pingFailed) {
        setWarning(
          "We couldn't reach your connection. You can still raise a complaint — that may be exactly what's wrong."
        );
      }

      const pend = await checkPendingTickets({
        userid: customerId,
        servicekey: service.servicekey,
      });
      if (pend.hasPending) {
        setState("pending");
        setExisting(pend.existing);
        return;
      }
      // When the ping failed, `ticketstatus` comes back as an empty object, so
      // hasPending is false and the duplicate check is simply unverified — not
      // a block. raiseTicket is the backstop.

      const subs = await getSubjects({
        apiopid: service.opid,
        cid: customerId,
        servid: service.servid,
      });

      // NATIVE PARITY: the form is rendered whatever the catalogue size,
      // exactly as RaiseNewTicketsFragment does — it binds the adapter and
      // moves on. An empty catalogue therefore presents as a dropdown that
      // never opens, and Submit fails the "Invalid complaint" check.
      //
      // We intentionally do NOT convert that into an error screen: this
      // subsystem is being held to native behaviour. getSubjects logs a
      // warning naming the apiopid and the backend's message, which is how an
      // empty catalogue gets diagnosed.
      setSubjects(subs || []);
      setState("ready");
    } catch (err) {
      setState("error");
      setMessage(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [service?.servicekey, service?.opid, service?.servid, customerId]);

  useEffect(() => {
    if (enabled) run();
  }, [enabled, run]);

  return { loading, state, message, warning, existing, subjects, refresh: run, setState, setExisting };
}

/**
 * Submit a complaint.
 *
 * Android's validation ladder, in order, with its literal messages:
 *   subjects never loaded      → "Invalid complaint"
 *   nothing picked             → "Predefined Complaint"
 *   typed text ≠ picked option → "No complaint selected/Invalid complaint"
 *   empty comment              → "Please Comment on Issue"
 *
 * The third rule is enforced structurally by SubjectCombobox (it only emits a
 * value on a real pick and clears on edit), so `subject` being non-empty
 * already means "picked and unmodified".
 */
export function useRaiseSubmit({ service, identity, subjectsLoaded, onRaised }) {
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async ({ subject, comment }) => {
      if (!service?.servicekey) return { ok: false, message: "No service selected." };
      // raiseTicket sends this as `operid`. Filing without it produces a
      // ticket no operator owns, so this is the one place a missing operator
      // id must genuinely stop the flow.
      if (!service.opid) {
        return {
          ok: false,
          message: "We couldn't identify your operator for this connection. Please re-link your account and try again.",
        };
      }
      if (!subjectsLoaded) return { ok: false, message: "Invalid complaint" };
      if (!subject) return { ok: false, message: "Predefined Complaint" };
      // Android checks for the empty string only — "   " passes there. We
      // trim, because a whitespace-only complaint helps nobody.
      if (!comment.trim()) return { ok: false, message: "Please Comment on Issue" };

      setSubmitting(true);
      try {
        const res = await raiseTicket({
          opid: identity.customerId,        // backend inversion: opid = CUSTOMER id
          name: identity.custName,
          sub: subject,
          mobile: identity.custMobile,
          comment: comment.trim(),
          address: service.address,
          operid: service.opid,             // operid = OPERATOR id
          servicekey: service.servicekey,
        });

        if (res.status === "success") {
          onRaised?.();
          return { ok: true, message: "Complaint Raised Successfully" };
        }
        if (res.status === "pending") {
          return { ok: false, message: "Sorry!! Cannot process. Previous ticket is pending", reGate: true };
        }
        if (res.status === "invalid") {
          // Android shows the SAME message here as for "pending" — a
          // copy-paste bug in the original. We say what actually went wrong.
          return { ok: false, message: res.message || "Invalid complaint. Please check the details." };
        }
        // Android does nothing at all for an unrecognised err_msg — a silent
        // no-op that looks like a hang. Always say something.
        return { ok: false, message: res.message || "Could not raise the complaint. Please try again." };
      } catch (err) {
        return { ok: false, message: err?.message || "Could not raise the complaint. Please try again." };
      } finally {
        setSubmitting(false);
      }
    },
    [service, identity, subjectsLoaded, onRaised]
  );

  return { submit, submitting };
}

/**
 * The close / re-raise pipeline:
 *   confirm dialog → status probe → (rating dialog) → closeticket
 *
 * Ordering is load-bearing and matches Android. See decideCloseFlow for the
 * two places we deliberately diverge.
 */
export function useTicketClose({ service, customerId, onDone }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { ticket, action }
  const [rateOpen, setRateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  const ask = useCallback((ticket, action) => {
    setPendingAction({ ticket, action });
    setConfirmOpen(true);
  }, []);

  const cancel = useCallback(() => {
    setConfirmOpen(false);
    setRateOpen(false);
    setPendingAction(null);
  }, []);

  const perform = useCallback(
    async ({ ticket, rating, status }) => {
      if (!service?.servicekey) return;
      setBusy(true);
      try {
        const res = await closeTicket({
          custid: customerId,
          ticketid: ticket.tid,
          engr_rating: String(rating),
          status,
          servicekey: service.servicekey,
        });
        const message =
          res.result === "closed" ? "Your complaint is closed successfully."
          : res.result === "pending" ? "Dear Customer your Tickets Re-Raised Successfully"
          : res.result === "error" ? (res.message || "Error Closing Ticket")
          : (res.message || "Could not update the complaint.");
        const ok = res.result === "closed" || res.result === "pending";
        setResult({ ok, message });
        onDone?.(ok);
      } catch (err) {
        setResult({ ok: false, message: err?.message || "Could not update the complaint." });
      } finally {
        setBusy(false);
        setRateOpen(false);
        setPendingAction(null);
      }
    },
    [service?.servicekey, customerId, onDone]
  );

  const confirm = useCallback(async () => {
    setConfirmOpen(false);
    if (!pendingAction || !service?.servicekey) return;
    const { ticket, action } = pendingAction;

    // Re-raise short-circuits — decideCloseFlow never rates it, so the probe
    // would be a wasted round trip.
    if (action === "reraise") {
      const d = decideCloseFlow({ action });
      await perform({ ticket, rating: d.rating, status: d.status });
      return;
    }

    setBusy(true);
    let decision;
    try {
      const { state } = await getParticularTicketStatus({
        ticketid: ticket.tid,
        servicekey: service.servicekey,
      });
      decision = decideCloseFlow({ action, probeState: state });
    } catch {
      decision = decideCloseFlow({ action, probeFailed: true });
    } finally {
      setBusy(false);
    }

    if (decision.rate) setRateOpen(true);
    else await perform({ ticket, rating: decision.rating, status: decision.status });
  }, [pendingAction, service?.servicekey, perform]);

  const rate = useCallback(
    ({ rating }) => {
      if (!pendingAction) return;
      perform({ ticket: pendingAction.ticket, rating: String(rating), status: "yes" });
    },
    [pendingAction, perform]
  );

  return {
    ask, confirm, cancel, rate,
    confirmOpen, rateOpen, busy, pendingAction,
    ticket: pendingAction?.ticket || null,
    action: pendingAction?.action || null,
    result, clearResult: () => setResult(null),
  };
}
