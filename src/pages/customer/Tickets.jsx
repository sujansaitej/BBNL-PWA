import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
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
import { getTickets } from "../../services/customer/tickets";
import {
  statusLabel,
  statusTone,
  isNewConnection,
  isResolved,
} from "../../services/customer/ticketFlow";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { useRaiseGate, useRaiseSubmit, useTicketClose } from "../../hooks/useTicketFlow";
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
  const [searchParams] = useSearchParams();
  const user = getUser();

  // A linked service account, when one has been chosen, is the BETTER source
  // of identity than the app login: it carries a real `opid` and `address`
  // straight from the backend, whereas the login response has neither
  // (op_id is frequently empty for customer logins). Where it is present we
  // prefer it, and fall back to the plan-derived values otherwise.
  const account = getActiveAccount();
  const customerId = account?.userid || user?.username || "";
  const custName =
    account?.name ||
    `${user?.firstname || ""} ${user?.lastname || ""}`.trim() ||
    customerId;
  const custMobile = account?.mobileno || user?.mobileno || "";

  // ?tab=status lands straight on the list — the service home's "Ticket
  // Status" icon uses it, mirroring Android's two separate entry points into
  // the same subsystem.
  const [tab, setTab] = useState(
    searchParams.get("tab") === "status" ? LIST : RAISE
  );

  // Services
  const [services, setServices] = useState([]);
  const [svcLoading, setSvcLoading] = useState(true);
  const [svcError, setSvcError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const selectedService = useMemo(
    () => services.find((s) => s.servicekey === selectedKey) || null,
    [services, selectedKey]
  );

  // Duplicate-complaint dialog visibility (the gate itself lives in the hook)
  const [existingDialogOpen, setExistingDialogOpen] = useState(false);

  // Raise form
  const [subject, setSubject] = useState("");
  const [comment, setComment] = useState("");

  // List + detail
  const [tickets, setTickets] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [detail, setDetail] = useState(null); // ticket object, or null for the list

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
          .filter((s) => s.servicekey)
          // Fill gaps from the linked account. The plan rows often carry no
          // opid or address at all, and both are required by raiseTicket —
          // `operid` (the operator) and the customer's address. The linked
          // account got them from the backend at link time, so it wins where
          // the derived value is empty.
          .map((s) =>
            account && s.servicekey === account.servicekey
              ? {
                  ...s,
                  opid: s.opid || account.opid || "",
                  address: s.address || account.address || "",
                  servid: s.servid || account.servid || "",
                }
              : s
          );
        setServices(list);
        if (list.length > 0) {
          // Prefer the service the customer actually picked upstream.
          const preferred = list.find((s) => s.servicekey === account?.servicekey);
          setSelectedKey((preferred || list[0]).servicekey);
        } else setSvcError("No active services found on your account.");
      } catch (err) {
        if (!cancelled) setSvcError("Couldn't load your services. Please try again.");
      } finally {
        if (!cancelled) setSvcLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // ── Raise-flow gate + submit — shared with the dedicated Raise Ticket
  // screen via hooks/useTicketFlow, so both run identical logic.
  const gate = useRaiseGate({
    service: selectedService,
    customerId,
    enabled: tab === RAISE && !!selectedService,
  });

  const { submit, submitting } = useRaiseSubmit({
    service: selectedService,
    identity: { customerId, custName, custMobile },
    subjectsLoaded: gate.subjects.length > 0,
    onRaised: () => {
      setTab(LIST);
      loadTickets(selectedService);
    },
  });

  // Android shows the duplicate-complaint dialog over the disabled form.
  useEffect(() => {
    setExistingDialogOpen(gate.state === "pending" && !!gate.existing);
  }, [gate.state, gate.existing]);

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

  // ── Close / re-raise pipeline (shared hook) ────────────────────────
  const close = useTicketClose({
    service: selectedService,
    customerId,
    onDone: () => {
      setDetail(null);
      // Refresh whichever surface the action came from.
      if (tab === RAISE) gate.refresh();
      else loadTickets(selectedService);
    },
  });

  // Surface the hook's outcome through the page's existing toast channel.
  useEffect(() => {
    if (!close.result) return;
    toast.add(close.result.message, { type: close.result.ok ? "success" : "error" });
    close.clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close.result]);

  const askAction = close.ask;
  const busy = close.busy;
  const actionTicket = close.ticket;

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
                {gate.loading ? (
                  <div className="py-8 flex justify-center"><Loader size="md" color="indigo" text="Fetching connection details…" /></div>
                ) : gate.state === "maintenance" ? (
                  <div className="text-center py-6 space-y-3">
                    <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                    <p className="text-sm text-gray-700 dark:text-gray-300">{gate.message}</p>
                    <div className="flex gap-2">
                      <button onClick={gate.refresh} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">Retry</button>
                      <button onClick={() => setTab(LIST)} className="flex-1 py-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm font-medium">View ticket status</button>
                    </div>
                  </div>
                ) : gate.state === "pending" ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        A complaint already exists. Please close the previously raised complaint to open a new one.
                      </p>
                    </div>
                    {gate.existing && (
                      <div className="text-sm space-y-1 border rounded-lg p-3 dark:border-gray-700">
                        {gate.existing.tid && <Row label="Ticket Id" value={gate.existing.tid} />}
                        {gate.existing.subject && <Row label="Subject" value={gate.existing.subject} />}
                        {gate.existing.status && <Row label="Status" value={statusLabel(gate.existing.status)} />}
                        {gate.existing.assigned && <Row label="Assigned To" value={gate.existing.assigned} />}
                        {gate.existing.risedtime && <Row label="Raised Time" value={gate.existing.risedtime} />}
                      </div>
                    )}
                    <div className="flex gap-2">
                      {gate.existing && (
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
                ) : gate.state === "error" ? (
                  <div className="text-center py-6 space-y-2">
                    <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
                    <p className="text-sm text-gray-700 dark:text-gray-300">{gate.message}</p>
                    <button onClick={gate.refresh} className="text-sm font-medium text-indigo-600">Retry</button>
                  </div>
                ) : gate.state === "ready" ? (
                  <>
                    {/* Line unreachable — informational only, form stays usable. */}
                    {gate.warning && (
                      <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800 dark:text-amber-200">{gate.warning}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Select Ticket</label>
                      <div className="mt-1">
                        <SubjectCombobox
                          subjects={gate.subjects}
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
        ticket={gate.existing}
        busy={busy}
        onClose={() => setExistingDialogOpen(false)}
        onCloseTicket={() => { setExistingDialogOpen(false); askAction(gate.existing, "close"); }}
        onRaiseBack={() => { setExistingDialogOpen(false); askAction(gate.existing, "reraise"); }}
      />

      {/* Step 1 — close / re-raise confirmation */}
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

      {/* Step 2 — engineer rating (only on close, only when an engineer was engaged) */}
      <RateEngineerDialog
        open={close.rateOpen}
        engineerName={actionTicket?.empname || actionTicket?.assigned || ""}
        engineerImg={actionTicket?.empimg || ""}
        submitting={busy}
        onConfirm={close.rate}
        onCancel={close.cancel}
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
