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
  findOpenTicket,
  getSubjects,
  raiseTicket,
  getParticularTicketStatus,
  closeTicket,
} from "../services/customer/tickets";
import { decideCloseFlow } from "../services/customer/ticketFlow";

/**
 * The raise-screen gate.
 *
 * Android's order is maintenance -> pendingticket -> subjects, each gating the
 * next. We deliberately do NOT reproduce that, because two of those three
 * calls run a BLOCKING SHELL PING on the server and one of them cannot
 * report anything useful at all. Measured 2026-09-01:
 *
 *     apis/subjects/            1.2 - 1.7s
 *     apis/maintenance/        12.5s   exec("ping -c 3 $nas")
 *     apis/cust/pendingticket/ 12.6s   exec("ping -c 3 $nas")
 *
 * The NAS does not answer ICMP on this deployment, so both pings wait out all
 * three packets on every page view. Gating on them cost ~12.6s to learn
 * nothing, and made the form show a scary "we couldn't reach your connection"
 * banner to every customer, every time.
 *
 * So: the catalogue opens the form, and the duplicate check runs behind it.
 * `state` is one of: null (loading) | 'pending' | 'ready' | 'error'.
 *
 * `warning` is retained in the return shape but is no longer produced — see
 * the note in run() for why the ping result is not worth showing anyone.
 */
export function useRaiseGate({ service, customerId, customerMobile = "", enabled = true }) {
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
      // BOTH CALLS ARE FAST, SO BOTH ARE AWAITED. Measured 2026-09-01:
      //
      //     apis/subjects/            1.2 - 1.7s
      //     Apis/gettickets/          0.5s
      //     apis/maintenance/        12.5s   <- dropped
      //     apis/cust/pendingticket/ 12.6s   <- dropped
      //
      // The two dropped endpoints each run a blocking `exec("ping -c 3 $nas")`
      // server-side (OldApis.php). The NAS does not answer ICMP here, so they
      // wait out all three packets on every page view.
      //
      // maintenance was pure cost: read the controller and there is no
      // maintenance flag in it at all, only ping success/failure dressed up
      // with a cosmetic "Under Maintenance" string. Its failure branches
      // ("No IP Address to ping", "Host details for X Not Available") used to
      // LOCK the form, and its always-failing ping showed every customer a
      // "we couldn't reach your connection" banner.
      //
      // pendingticket is the endpoint NAMED for the duplicate guard, but it
      // pings BEFORE looking the ticket up, so on this deployment it never
      // finds one. For a customer who demonstrably had an open ticket it
      // answered `ticketstatus:{}` after 12.8s while Apis/gettickets/ returned
      // the whole ticket in 0.5s. That is why the duplicate was only caught
      // when raiseTicket rejected it — as a toast, instead of the
      // existing-complaint dialog with its Close / Raise-Back actions.
      const [subs, open] = await Promise.all([
        getSubjects({ apiopid: service.opid, cid: customerId, servid: service.servid }),
        // A guard that cannot be read is not worth blocking on: if this throws
        // we still open the form, and raiseTicket remains the backstop (the
        // backend rejects duplicates itself with "Tickets Are Pending").
        findOpenTicket({ userid: customerId, mobile: customerMobile, servicekey: service.servicekey })
          .catch(() => null),
      ]);

      // NATIVE PARITY: the form is rendered whatever the catalogue size,
      // exactly as RaiseNewTicketsFragment does — it binds the adapter and
      // moves on. An empty catalogue therefore presents as a dropdown that
      // never opens, and Submit fails the "Invalid complaint" check.
      setSubjects(subs || []);

      if (open) {
        setExisting(open);
        setState("pending");
        return;
      }
      setState("ready");
      return;
    } catch (err) {
      setState("error");
      setMessage(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [service?.servicekey, service?.opid, service?.servid, customerId, customerMobile]);

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
