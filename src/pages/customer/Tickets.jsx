import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import {
  Loader,
  ConfirmDialog,
  RateEngineerDialog,
  ComplaintExistsDialog,
  SubjectCombobox,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { getMyPlanDetails } from "../../services/generalApis";
import {
  checkMaintenance,
  checkPendingTickets,
  getSubjects,
  raiseTicket,
  getTickets,
  getParticularTicketStatus,
  closeTicket,
} from "../../services/customer/tickets";
import {
  decideCloseFlow,
  statusLabel,
  statusTone,
  isNewConnection,
  isResolved,
} from "../../services/customer/ticketFlow";
import {
  ClipboardList,
  RefreshCw,
  Ticket as TicketIcon,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Phone,
  User as UserIcon,
} from "lucide-react";

// Map a subscribed_services[] row to the identifiers the ticket endpoints need.
// Field names vary across the backend's service objects (servid/srvid,
// serv_name/title/planname) so we read defensively.
function normalizeService(svc, planBody, user) {
  return {
    servicekey: svc?.servicekey || svc?.servkey || "",
    servid: String(svc?.servid ?? svc?.srvid ?? svc?.id ?? ""),
    name: svc?.serv_name || svc?.title || svc?.servname || svc?.name || svc?.planname || svc?.servicekey || "Service",
    // Operator id: prefer the service's own, then the plan body, then the
    // operator captured at login. Android sources this from the linked account.
    opid: String(svc?.opid || svc?.operator_id || planBody?.opid || planBody?.operator_id || user?.op_id || ""),
    address: svc?.address || svc?.custaddress || planBody?.address || planBody?.custaddress || planBody?.billaddress || "",
  };
}

const RAISE = "RAISE";
const LIST = "LIST";

export default function CustomerTickets() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const toast = useToast();
  const user = getUser();
  const customerId = user?.username || "";
  const custName = `${user?.firstname || ""} ${user?.lastname || ""}`.trim() || customerId;
  const custMobile = user?.mobileno || "";

  const [tab, setTab] = useState(RAISE);

  // Services
  const [services, setServices] = useState([]);
  const [svcLoading, setSvcLoading] = useState(true);
  const [svcError, setSvcError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const selectedService = useMemo(
    () => services.find((s) => s.servicekey === selectedKey) || null,
    [services, selectedKey]
  );

  // Raise-flow gate state
  const [gateLoading, setGateLoading] = useState(false);
  const [gateState, setGateState] = useState(null); // 'maintenance' | 'pending' | 'ready' | 'error'
  const [gateMessage, setGateMessage] = useState("");
  const [existing, setExisting] = useState(null);
  const [existingDialogOpen, setExistingDialogOpen] = useState(false);
  const [subjects, setSubjects] = useState([]);

  // Raise form
  const [subject, setSubject] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // List + detail
  const [tickets, setTickets] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [detail, setDetail] = useState(null); // ticket object, or null for the list

  // Close / re-raise pipeline:
  //   confirm dialog → status probe → (rating dialog) → closeTicket
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { ticket, action: 'close'|'reraise' }
  const [rateOpen, setRateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── Load the customer's subscribed services once ───────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSvcLoading(true);
      setSvcError("");
      try {
        const plan = await getMyPlanDetails({ servicekey: "internet", userid: customerId, fofiboxid: "", voipnumber: "" });
        if (cancelled) return;
        const body = plan?.body || {};
        const raw = Array.isArray(body?.subscribed_services) ? body.subscribed_services : [];
        const list = raw
          .map((s) => normalizeService(s, body, user))
          .filter((s) => s.servicekey);
        setServices(list);
        if (list.length > 0) setSelectedKey(list[0].servicekey);
        else setSvcError("No active services found on your account.");
      } catch (err) {
        if (!cancelled) setSvcError("Couldn't load your services. Please try again.");
      } finally {
        if (!cancelled) setSvcLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // ── Run the raise-flow gate whenever the selected service changes ──
  const runGate = async (svc) => {
    if (!svc) return;
    setGateLoading(true);
    setGateState(null);
    setGateMessage("");
    setExisting(null);
    setExistingDialogOpen(false);
    setSubjects([]);
    setSubject("");
    try {
      const maint = await checkMaintenance({ apiopid: svc.opid, cid: customerId, servicekey: svc.servicekey });
      if (!maint.open) {
        // Never surface maint.message — it is a backend diagnostic
        // ("Error Pinging"), not something to show a customer.
        setGateState(maint.pingFailed ? "unreachable" : "maintenance");
        setGateMessage(
          maint.pingFailed
            ? "We couldn't reach your connection just now."
            : "This service is under maintenance. Please try again shortly."
        );
        return;
      }
      const pend = await checkPendingTickets({ userid: customerId, servicekey: svc.servicekey });
      if (pend.hasPending) {
        setGateState("pending");
        setExisting(pend.existing);
        // Android surfaces this as a blocking dialog over the disabled form.
        if (pend.existing) setExistingDialogOpen(true);
        return;
      }
      // Ready to raise — load subjects.
      const subs = await getSubjects({ apiopid: svc.opid, cid: customerId, servid: svc.servid });
      setSubjects(subs);
      setGateState("ready");
    } catch (err) {
      setGateState("error");
      setGateMessage(err?.message || "Something went wrong. Please try again.");
    } finally {
      setGateLoading(false);
    }
  };

  useEffect(() => {
    if (tab === RAISE && selectedService) runGate(selectedService);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, tab]);

  // ── Submit a new ticket ────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedService) return;
    if (!subject) { toast.add("Please select a complaint from the list.", { type: "error" }); return; }
    if (!comment.trim()) { toast.add("Please comment on the issue.", { type: "error" }); return; }
    if (submitting) return;

    setSubmitting(true);
    try {
      const res = await raiseTicket({
        opid: customerId,                 // backend inversion: opid = customer id
        name: custName,
        sub: subject,
        mobile: custMobile,
        comment: comment.trim(),
        address: selectedService.address,
        operid: selectedService.opid,     // operid = operator id
        servicekey: selectedService.servicekey,
      });
      if (res.status === "success") {
        toast.add("Complaint raised successfully.", { type: "success" });
        setComment("");
        setSubject("");
        setTab(LIST);
        loadTickets(selectedService);
      } else if (res.status === "pending") {
        toast.add("Sorry, we can't process this — your previous ticket is still pending.", { type: "error" });
        runGate(selectedService);
      } else if (res.status === "invalid") {
        toast.add(res.message || "Invalid complaint. Please check the details.", { type: "error" });
      } else {
        toast.add(res.message || "Could not raise the complaint. Please try again.", { type: "error" });
      }
    } catch (err) {
      toast.add(err?.message || "Could not raise the complaint. Please try again.", { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Load / refresh tickets ─────────────────────────────────────────
  const loadTickets = async (svc) => {
    const service = svc || selectedService;
    if (!service) return;
    setListLoading(true);
    try {
      const rows = await getTickets({ userid: customerId, mobile: custMobile, servicekey: service.servicekey });
      setTickets(rows);
      // Keep an open detail view in sync with the refreshed data.
      setDetail((d) => (d ? rows.find((r) => r.tid === d.tid) || null : null));
    } catch (err) {
      toast.add(err?.message || "Could not load your tickets.", { type: "error" });
      setTickets([]);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (tab === LIST && selectedService) loadTickets(selectedService);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, tab]);

  // ── Close / re-raise pipeline ──────────────────────────────────────
  // Step 1 — ask for confirmation ("Close Your Ticket!" / "Re-Raise same
  // Ticket!"). Mirrors CloseTicketDialogFragment.
  const askAction = (ticket, action) => {
    setPendingAction({ ticket, action });
    setConfirmOpen(true);
  };

  // Step 2 — probe the ticket's live status to decide whether the engineer
  // should be rated (Apis/getParticularTicketStatus/), then either open the
  // rating dialog or close straight away.
  const onConfirmed = async () => {
    setConfirmOpen(false);
    if (!pendingAction || !selectedService) return;
    const { ticket, action } = pendingAction;

    // A re-raise never needs the live status — decideCloseFlow short-circuits
    // it — so skip the probe entirely.
    if (action === "reraise") {
      const d = decideCloseFlow({ action });
      await performClose({ ticket, rating: d.rating, status: d.status });
      return;
    }

    setBusy(true);
    let decision;
    try {
      const { state } = await getParticularTicketStatus({
        ticketid: ticket.tid,
        servicekey: selectedService.servicekey,
      });
      decision = decideCloseFlow({ action, probeState: state });
    } catch (err) {
      decision = decideCloseFlow({ action, probeFailed: true });
    } finally {
      setBusy(false);
    }

    if (decision.rate) setRateOpen(true);
    else await performClose({ ticket, rating: decision.rating, status: decision.status });
  };

  // Step 3 — the actual close/re-raise request.
  const performClose = async ({ ticket, rating, status }) => {
    if (!selectedService) return;
    setBusy(true);
    try {
      const res = await closeTicket({
        custid: customerId,
        ticketid: ticket.tid,
        engr_rating: String(rating),
        status,
        servicekey: selectedService.servicekey,
      });
      if (res.result === "closed") {
        toast.add("Your complaint is closed successfully.", { type: "success" });
      } else if (res.result === "pending") {
        toast.add("Your ticket has been re-raised successfully.", { type: "success" });
      } else if (res.result === "error") {
        toast.add(res.message || "Error closing the ticket.", { type: "error" });
      } else {
        toast.add(res.message || "Could not update the complaint.", { type: "error" });
      }

      // Refresh whichever surface the action came from.
      setDetail(null);
      if (tab === RAISE) runGate(selectedService);
      else loadTickets(selectedService);
    } catch (err) {
      toast.add(err?.message || "Could not update the complaint.", { type: "error" });
    } finally {
      setBusy(false);
      setRateOpen(false);
      setPendingAction(null);
    }
  };

  const onRated = ({ rating }) => {
    if (!pendingAction) return;
    performClose({ ticket: pendingAction.ticket, rating: String(rating), status: "yes" });
  };

  const actionTicket = pendingAction?.ticket || null;

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Title */}
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <TicketIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Complaints &amp; Tickets</h1>
        </div>

        {/* Service selector */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Service</label>
          {svcLoading ? (
            <div className="py-3 flex justify-center"><Loader size="sm" color="indigo" text="Loading services…" /></div>
          ) : svcError ? (
            <p className="text-sm text-red-500 mt-1">{svcError}</p>
          ) : (
            <select
              value={selectedKey}
              onChange={(e) => { setSelectedKey(e.target.value); setDetail(null); }}
              className="mt-1 w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none"
            >
              {services.map((s) => (
                <option key={s.servicekey} value={s.servicekey}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {!svcLoading && !svcError && (
          <>
            {/* Tabs */}
            <div className="flex bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
              {[{ k: RAISE, label: "Raise Ticket" }, { k: LIST, label: "Ticket Status" }].map((t) => (
                <button
                  key={t.k}
                  onClick={() => { setTab(t.k); setDetail(null); }}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                    tab === t.k
                      ? "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── RAISE TAB ── */}
            {tab === RAISE && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
                {gateLoading ? (
                  <div className="py-8 flex justify-center"><Loader size="md" color="indigo" text="Fetching connection details…" /></div>
                ) : gateState === "maintenance" ? (
                  <div className="text-center py-6 space-y-3">
                    <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                    <p className="text-sm text-gray-700 dark:text-gray-300">{gateMessage}</p>
                    <div className="flex gap-2">
                      <button onClick={() => runGate(selectedService)} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">Retry</button>
                      <button onClick={() => setTab(LIST)} className="flex-1 py-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm font-medium">View ticket status</button>
                    </div>
                  </div>
                ) : gateState === "unreachable" ? (
                  // The backend could not ping the customer's connection. This
                  // is NOT maintenance — and it is the single most likely state
                  // for someone who wants to report an outage, so it must not
                  // dead-end. Explain it plainly and always offer a way on.
                  <div className="text-center py-6 space-y-3">
                    <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{gateMessage}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        If your connection is down, that may be why. Please retry, or call
                        your operator to report the outage.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => runGate(selectedService)} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">Retry</button>
                      <button onClick={() => setTab(LIST)} className="flex-1 py-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm font-medium">View ticket status</button>
                    </div>
                  </div>
                ) : gateState === "pending" ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        A complaint already exists. Please close the previously raised complaint to open a new one.
                      </p>
                    </div>
                    {existing && (
                      <div className="text-sm space-y-1 border rounded-lg p-3 dark:border-gray-700">
                        {existing.tid && <Row label="Ticket Id" value={existing.tid} />}
                        {existing.subject && <Row label="Subject" value={existing.subject} />}
                        {existing.status && <Row label="Status" value={statusLabel(existing.status)} />}
                        {existing.assigned && <Row label="Assigned To" value={existing.assigned} />}
                        {existing.risedtime && <Row label="Raised Time" value={existing.risedtime} />}
                      </div>
                    )}
                    <div className="flex gap-2">
                      {existing && (
                        <button
                          onClick={() => setExistingDialogOpen(true)}
                          className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium"
                        >
                          Close this ticket
                        </button>
                      )}
                      <button onClick={() => setTab(LIST)} className="flex-1 py-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm font-medium">
                        View ticket status
                      </button>
                    </div>
                  </div>
                ) : gateState === "error" ? (
                  <div className="text-center py-6 space-y-2">
                    <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
                    <p className="text-sm text-gray-700 dark:text-gray-300">{gateMessage}</p>
                    <button onClick={() => runGate(selectedService)} className="text-sm font-medium text-indigo-600">Retry</button>
                  </div>
                ) : gateState === "ready" ? (
                  <>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Select Ticket</label>
                      <div className="mt-1">
                        <SubjectCombobox
                          subjects={subjects}
                          value={subject}
                          onChange={setSubject}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Comments</label>
                        <button
                          type="button"
                          onClick={() => setComment("")}
                          disabled={!comment}
                          className="text-xs font-medium text-orange-600 disabled:opacity-40"
                        >
                          Clear
                        </button>
                      </div>
                      <textarea
                        rows={5}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Tell us what's wrong…"
                        className="mt-1 w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none resize-none"
                      />
                    </div>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || !subject || !comment.trim()}
                      className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? "Please wait…" : "Submit"}
                    </button>
                  </>
                ) : null}
              </div>
            )}

            {/* ── TICKET STATUS TAB ── */}
            {tab === LIST && (
              detail ? (
                <TicketDetail
                  ticket={detail}
                  onBack={() => setDetail(null)}
                  onClose={() => askAction(detail, "close")}
                  onReraise={() => askAction(detail, "reraise")}
                  busy={busy}
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {listLoading ? "Loading…" : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
                    </span>
                    <button onClick={() => loadTickets(selectedService)} className="flex items-center gap-1 text-sm text-indigo-600" disabled={listLoading}>
                      <RefreshCw className={`w-4 h-4 ${listLoading ? "animate-spin" : ""}`} /> Refresh
                    </button>
                  </div>

                  {listLoading ? (
                    <div className="py-10 flex justify-center"><Loader size="lg" color="indigo" text="Loading tickets…" /></div>
                  ) : tickets.length === 0 ? (
                    <div className="text-center text-gray-500 dark:text-gray-400 py-10">No tickets found.</div>
                  ) : (
                    tickets.map((t, i) => (
                      <button
                        key={t.tid || i}
                        onClick={() => setDetail(t)}
                        className="w-full text-left bg-white dark:bg-gray-800 rounded-xl shadow p-3 text-sm space-y-1.5 hover:ring-2 hover:ring-indigo-200 dark:hover:ring-indigo-800 transition"
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex items-center text-indigo-700 dark:text-indigo-300 font-semibold">
                            <ClipboardList className="w-4 h-4 mr-2" /> Ticket #{t.tid}
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </div>
                        {t.subject && <Row label="Subject" value={t.subject} />}
                        <Row
                          label="Status"
                          value={
                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold text-white ${statusTone(t.status)}`}>
                              {statusLabel(t.status)}
                            </span>
                          }
                        />
                        {t.risedtime && <Row label="Raised Time" value={t.risedtime} />}
                      </button>
                    ))
                  )}
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Blocking duplicate-complaint dialog over the raise form */}
      <ComplaintExistsDialog
        open={existingDialogOpen}
        ticket={existing}
        busy={busy}
        onClose={() => setExistingDialogOpen(false)}
        onCloseTicket={() => { setExistingDialogOpen(false); askAction(existing, "close"); }}
        onRaiseBack={() => { setExistingDialogOpen(false); askAction(existing, "reraise"); }}
      />

      {/* Step 1 — close / re-raise confirmation */}
      <ConfirmDialog
        open={confirmOpen}
        title={pendingAction?.action === "reraise" ? "Re-Raise same Ticket!" : "Close Your Ticket!"}
        message={
          pendingAction
            ? pendingAction.action === "reraise"
              ? "Are you sure? You want to Re-Raise the same ticket?"
              : "Are you sure? You want to close the ticket?"
            : ""
        }
        onConfirm={onConfirmed}
        onCancel={() => { setConfirmOpen(false); setPendingAction(null); }}
      />

      {/* Step 2 — engineer rating (only on close, only when an engineer was engaged) */}
      <RateEngineerDialog
        open={rateOpen}
        engineerName={actionTicket?.empname || actionTicket?.assigned || ""}
        engineerImg={actionTicket?.empimg || ""}
        submitting={busy}
        onConfirm={onRated}
        onCancel={() => { setRateOpen(false); setPendingAction(null); }}
      />
    </Layout>
  );
}

// ── Ticket Status detail ─────────────────────────────────────────────
// Mirrors list_item_ticket_status_enhanced.xml: engineer header (photo, name,
// tap-to-call phone) over the ticket facts, with the close / re-raise actions.
function TicketDetail({ ticket: t, onBack, onClose, onReraise, busy }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasPhone = Boolean(t.empmobile);
  const jobDone = String(t.status || "").toLowerCase() === "jobdone";
  const canAct = !isNewConnection(t) && !isResolved(t);

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-indigo-600">
        <ChevronLeft className="w-4 h-4" /> All tickets
      </button>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        {/* Engineer header */}
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-3.5 flex items-center gap-3">
          {t.empimg && !imgFailed ? (
            <img
              src={t.empimg}
              alt={t.empname || "Field engineer"}
              onError={() => setImgFailed(true)}
              className="w-14 h-14 rounded-full object-cover border-2 border-white/40 flex-shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <UserIcon className="w-7 h-7 text-white/80" />
            </div>
          )}
          <div className="min-w-0 text-sm space-y-0.5">
            <div className="flex gap-2">
              <span className="w-20 flex-shrink-0 text-white/70">Assigned To</span>
              <span className="text-white font-medium break-words min-w-0">{t.empname || "Not Available"}</span>
            </div>
            <div className="flex gap-2 items-center">
              <span className="w-20 flex-shrink-0 text-white/70">Phone</span>
              {hasPhone ? (
                <a href={`tel:${t.empmobile}`} className="text-white font-medium underline underline-offset-2 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> {t.empmobile}
                </a>
              ) : (
                <span className="text-white/80">Not Available</span>
              )}
            </div>
          </div>
        </div>

        {/* Ticket facts */}
        <div className="p-4 text-sm space-y-1.5">
          <Row label="Ticket Subject" value={t.subject || "—"} />
          {t.reqtdsrv && <Row label="Services" value={t.reqtdsrv} />}
          <Row label="Ticket Id" value={t.tid || "—"} />
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

          {canAct ? (
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
            <p className="pt-3 text-xs text-gray-500 dark:text-gray-400">
              {isNewConnection(t)
                ? "New-connection requests are closed by your operator."
                : "This ticket is already resolved."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex">
      <span className="w-28 flex-shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-700 dark:text-gray-300 break-words min-w-0">{value}</span>
    </div>
  );
}
