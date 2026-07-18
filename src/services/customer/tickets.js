// Customer ticket subsystem — PWA port of the Android customer app's
// raise / view / close complaint flow.
//
// SOURCE OF TRUTH
// ---------------
// Ported 1:1 from bbnlcustomerapp-master (customer flavor), verified against
// TICKET-RAISING-API-AUDIT.md and the Java source. Seven endpoints:
//
//   apis/raiseTicket/               GET   no auth      raise a new complaint
//   apis/subjects/                  GET   APIS block   complaint-subject dropdown
//   apis/maintenance/               POST  APIS block   precondition gate
//   apis/cust/pendingticket/        POST  APIS block   duplicate-ticket guard
//   Apis/gettickets/                GET   no auth      list a customer's tickets
//   Apis/getParticularTicketStatus/ POST  no auth      pre-close status probe
//   Apis/closeticket                POST  no auth      close / re-raise a ticket
//
// TWO THINGS THAT MAKE THESE ENDPOINTS DIFFERENT FROM EVERY OTHER PWA CALL
// (do NOT route them through readEnvelope / isEnvelopeOk):
//
//   1. Path casing is load-bearing. subjects/maintenance/pendingticket/
//      raiseTicket use lowercase `apis/`; gettickets/closeticket use capital
//      `Apis/`. The backend is case-sensitive (Linux) — these resolve to
//      different controllers. The exact strings below are intentional.
//
//   2. The success discriminator is NOT `err_code === 0`. Each endpoint has
//      its own contract, matched by the Android UI on err_msg SUBSTRINGS:
//        - subjects   : returns err_code **1** on success ("Subject Details
//                       Fetched Successfully") — body is still valid. Never
//                       gate subjects on err_code.
//        - maintenance: numeric err_code === 0 means "open".
//        - pending    : two nested status blocks (pingingstatus + ticketstatus)
//                       matched on "Pinging Successfully" / "Pending Tickets
//                       Available" | "Pending Tickets Unavailable".
//        - raiseTicket: err_msg contains "Successfully Raised" | "Tickets Are
//                       Pending" | "invalid".
//        - closeticket: err_msg contains "Ticket Closed Successfully" |
//                       "Ticket become pending Successfully" | "Error while
//                       closing the ticket".
//      All substrings are reproduced exactly (casing included) from source.
//
// PARAM NAMING QUIRK: in raiseTicket, `opid` is the CUSTOMER id
// (service_user_id) and `operid` is the OPERATOR id. That inversion is the
// backend's, confirmed in RaiseNewTicketsFragment — kept as-is on purpose.

import { apiFetch, getBaseUrl, readEnvelopeRaw, dedupe } from "../apiCore";
import { lsGet, lsSet } from "../lsCache";
import perfMonitor from "../../utils/apiPerfMonitor";
import logger from "../../utils/logger";

const GROUP = "CustTickets";

// The customer-app "APIS" credential block (Constants.java _APIS). These are
// static, shared credentials — the same set already lives in orderApis.js for
// the netmon contract. They are NOT a trust boundary (see apiCore's note on
// header credentials); the backend authorizes on them regardless of session.
function apisHeaders(contentType) {
  const h = {
    Authorization: "c4f79e15f8c6ed0715a8ea44aebc38d8",
    username: "e2798af12a7a0f4f70b4d69efbc25f4d",
    password: "c1f377afbaa874acbb6b61f66957710a",
    apptype: "customerapp-v1",
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

const contains = (v, needle) =>
  typeof v === "string" && v.toLowerCase().includes(needle.toLowerCase());

// ── 1. Maintenance gate (POST · apis/maintenance/ · APIS) ────────────
// Runs first when the raise screen opens. Android keeps the form disabled
// until err_code === 0. Returns { open, message }.
export async function checkMaintenance({ apiopid, cid, servicekey }) {
  // DEDUPED, NOT CACHED. This endpoint pings the customer's line server-side
  // and takes ~2.4s on production (~12s on staging) — by far the slowest call
  // in the customer flow. Anything that mounts the raise screen twice (React
  // StrictMode in dev, a fast tab switch, a retry tap) otherwise fires two
  // full round trips. dedupe() collapses concurrent identical calls.
  //
  // Deliberately NOT cached: a stale "under maintenance" verdict is worse
  // than a slow one.
  return dedupe(`custtkt_maint_${apiopid}_${cid}_${servicekey}`, async () => {
  const url = `${getBaseUrl()}apis/maintenance/`;
  const body = new URLSearchParams({
    apiopid: apiopid || "",
    cid: cid || "",
    servicekey: servicekey || "",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: apisHeaders("application/x-www-form-urlencoded"), body },
    "checkMaintenance",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Maintenance check failed (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "checkMaintenance");
  const code = data?.status?.err_code;
  const errMsg = data?.status?.err_msg || "";

  // VERIFIED LIVE (staging, smoke run): this endpoint pings the customer's
  // connection and answers err_code 1 / err_msg "Error Pinging" when the
  // device is unreachable — with a top-level message of "Under Maintenance",
  // which is misleading. It is NOT a maintenance window; the customer's link
  // is simply down. That is precisely when they need to raise a complaint,
  // so the caller must distinguish the two and must never show err_msg to a
  // customer ("Error Pinging" is a diagnostic, not a user message).
  const pingFailed = /error\s*pinging/i.test(errMsg);

  return {
    open: Number(code) === 0,
    pingFailed,
    message: errMsg,   // diagnostic only — do not render this to customers
    raw: data,
  };
  });
}

// ── 2. Subjects dropdown (GET · apis/subjects/ · APIS) ───────────────
// Success returns err_code 1 (not 0) — do NOT gate on err_code. Body rows
// expose { id, subject }; only `subject` text is user-facing and is what
// raiseTicket sends back as `sub`. Cached 30 min (subjects are static).
export async function getSubjects({ apiopid, cid, servid }) {
  const cacheKey = `custtkt_subjects_${servid || "x"}`;
  const cached = lsGet(cacheKey, 30 * 60 * 1000);
  if (cached) {
    perfMonitor.recordCacheHit(GROUP, "getSubjects", cacheKey);
    return cached;
  }

  async function fetchSubjects(opid) {
    const query = new URLSearchParams({
      apiopid: opid || "",
      cid: cid || "",
      servid: servid || "",
    }).toString();
    const url = `${getBaseUrl()}apis/subjects/?${query}`;

    const resp = await apiFetch(
      url,
      { method: "GET", headers: apisHeaders() },
      "getSubjects",
      { group: GROUP }
    );
    if (!resp.ok) throw new Error(`Failed to load subjects (HTTP ${resp.status})`);

    const data = await readEnvelopeRaw(resp, "getSubjects");
    const rows = Array.isArray(data?.body) ? data.body : [];
    return {
      subjects: rows.map((r) => ({ id: r?.id, subject: r?.subject })).filter((r) => r.subject),
      message: data?.status?.err_msg || "",
    };
  }

  // ── WHY apiopid IS NOT SENT ──────────────────────────────────────
  //
  // `apiopid` on this endpoint is a HOST LOOKUP, not a filter. Measured
  // directly against production:
  //
  //   apiopid="BBNL_OP49" → 389 rows  ("Subject Details Fetched Successfully")
  //   apiopid=""          → 389 rows  — the SAME full catalogue
  //   apiopid="BOGUS_OP"  →   0 rows  ("Host details for BOGUS_OP Not Available")
  //   apiopid="undefined" →   0 rows  ("Host details for undefined Not Available")
  //
  // A known operator and no operator return an identical list, so the
  // parameter buys no filtering whatsoever. All it can do is fail: any
  // operator without a host entry returns NOTHING, the complaint dropdown is
  // empty, and the customer cannot raise a ticket at all. That is the
  // production failure this replaces — and an operator-scoped attempt first
  // was still not enough, because the scoped call can also hang or error,
  // and either way the customer ends up stuck.
  //
  // So we ask for the catalogue un-scoped, always. Deliberate deviation from
  // Android, which sends the operator id and simply shows an empty dropdown
  // when the lookup misses. `cid`/`servid` are kept: they are harmless (the
  // endpoint returns the same catalogue regardless) and preserve the wire
  // shape for the backend's logs.
  let { subjects, message } = await fetchSubjects("");

  // Last-ditch: if the un-scoped catalogue is somehow empty, try the
  // operator-scoped form before giving up, in case the backend ever starts
  // requiring it.
  if (subjects.length === 0 && apiopid) {
    const scoped = await fetchSubjects(apiopid);
    if (scoped.subjects.length > 0) subjects = scoped.subjects;
    else message = scoped.message || message;
  }

  if (subjects.length === 0) {
    // Surfaced by the caller so a residual failure is diagnosable rather
    // than presenting as a mysteriously empty dropdown.
    logger.warn("API", "getSubjects returned an empty catalogue", { apiopid, cid, servid, message });
  }

  if (subjects.length > 0) lsSet(cacheKey, subjects);
  return subjects;
}

// ── 3. Pending-ticket guard (POST · apis/cust/pendingticket/ · APIS) ─
// Duplicate-complaint guard. Android enables the form only when
// pingingstatus contains "Pinging Successfully" AND ticketstatus contains
// "Pending Tickets Unavailable". "Pending Tickets Available" surfaces the
// existing-complaint details instead.
export async function checkPendingTickets({ userid, servicekey }) {
  const url = `${getBaseUrl()}apis/cust/pendingticket/`;
  const body = new URLSearchParams({
    userid: userid || "",
    servicekey: servicekey || "",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: apisHeaders("application/x-www-form-urlencoded"), body },
    "checkPendingTickets",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Pending-ticket check failed (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "checkPendingTickets");
  const pingMsg = data?.pingingstatus?.err_msg;
  const tktMsg = data?.ticketstatus?.err_msg;

  const pinged = contains(pingMsg, "Pinging Successfully");
  const hasPending = contains(tktMsg, "Pending Tickets Available");
  const canRaise = pinged && contains(tktMsg, "Pending Tickets Unavailable");

  // Existing complaint details (shown when hasPending) — first body row.
  const row = Array.isArray(data?.body) ? data.body[0] : data?.body;
  const existing = hasPending && row
    ? {
        tid: row.tid,
        status: row.status,
        subject: row.subject,
        assigned: row.assigned,
        risedtime: row.risedtime,
        solvedtime: row.solvedtime,
      }
    : null;

  return { pinged, canRaise, hasPending, existing, raw: data };
}

// ── 4. Raise a new ticket (GET · apis/raiseTicket/ · no auth) ────────
// NOTE: mutating GET with PII in the query string — that is the backend's
// only accepted shape (mirrors Android). `opid` = customer id, `operid` =
// operator id (backend naming inversion, intentional).
export async function raiseTicket({
  opid, name, sub, mobile, comment, address, operid, servicekey,
}) {
  const query = new URLSearchParams({
    opid: opid || "",
    name: name || "",
    sub: sub || "",
    mobile: mobile || "",
    comment: comment || "",
    address: address || "",
    operid: operid || "",
    servicekey: servicekey || "",
  }).toString();
  const url = `${getBaseUrl()}apis/raiseTicket/?${query}`;

  const resp = await apiFetch(
    url,
    { method: "GET", headers: {} },
    "raiseTicket",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Failed to raise ticket (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "raiseTicket");
  const msg = data?.status?.err_msg || "";
  let status = "unknown";
  if (contains(msg, "Successfully Raised")) status = "success";
  else if (contains(msg, "Tickets Are Pending")) status = "pending";
  else if (contains(msg, "invalid")) status = "invalid";

  return { status, message: msg, raw: data };
}

// ── 5. List a customer's tickets (GET · Apis/gettickets/ · no auth) ──
// userstatus + totalno are hardcoded in Android (registereduser / 300).
export async function getTickets({ userid, mobile, servicekey }) {
  const query = new URLSearchParams({
    userid: userid || "",
    mobile: mobile || "",
    userstatus: "registereduser",
    totalno: "300",
    servicekey: servicekey || "",
  }).toString();
  const url = `${getBaseUrl()}Apis/gettickets/?${query}`;

  const resp = await apiFetch(
    url,
    { method: "GET", headers: {} },
    "getTickets",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Failed to load tickets (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "getTickets");
  const rows = Array.isArray(data?.body) ? data.body : [];
  // Fields per audit: tid, status, subject, assigned, risedtime, solvedtime,
  // empimg, empname, empmobile, reqtdsrv.
  return rows;
}

// ── 6. Live status of one ticket (POST · Apis/getParticularTicketStatus/) ─
// Called after the user confirms "close" and BEFORE the close request, to
// decide whether the engineer-rating dialog is shown. Unlike every other
// endpoint here the payload is a bare string in `body` — "pending" |
// "transfered" | "jobdone" | (other) — not an object. Android compares it
// with .equals(), so the value is used verbatim.
export async function getParticularTicketStatus({ ticketid, servicekey }) {
  const url = `${getBaseUrl()}Apis/getParticularTicketStatus/`;
  const body = new URLSearchParams({
    ticketid: ticketid || "",
    servicekey: servicekey || "",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    "getParticularTicketStatus",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Failed to read ticket status (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "getParticularTicketStatus");
  const state = typeof data?.body === "string" ? data.body.trim() : "";
  return { state, raw: data };
}

// ── 7. Close / re-raise a ticket (POST · Apis/closeticket · no auth) ─
// status "yes" = close, "no" = re-raise. engr_rating "0" re-raise, "5"
// default close (Android's TicketsStatusFragment default), else the value
// the caller passes from a rating dialog.
export async function closeTicket({
  custid, ticketid, engr_rating = "5", status = "yes", servicekey,
}) {
  const url = `${getBaseUrl()}Apis/closeticket`;
  const body = new URLSearchParams({
    custid: custid || "",
    ticketid: ticketid || "",
    engr_rating: String(engr_rating),
    status,
    servicekey: servicekey || "",
  }).toString();

  const resp = await apiFetch(
    url,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    "closeTicket",
    { group: GROUP }
  );
  if (!resp.ok) throw new Error(`Failed to close ticket (HTTP ${resp.status})`);

  const data = await readEnvelopeRaw(resp, "closeTicket");
  const msg = data?.status?.err_msg || "";
  let result = "unknown";
  if (contains(msg, "Ticket Closed Successfully")) result = "closed";
  else if (contains(msg, "become pending Successfully")) result = "pending";
  else if (contains(msg, "Error while closing the ticket")) result = "error";

  return { result, message: msg, raw: data };
}
