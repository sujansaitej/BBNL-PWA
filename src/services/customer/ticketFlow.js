// Pure decision logic for the customer ticket flow.
//
// Extracted from the React components so the rules that actually matter —
// which subjects a query matches, and whether closing a ticket should prompt
// for an engineer rating — are unit-testable without a DOM. The components
// import from here; nothing in this file touches React or the network.

// ── Subject filtering ────────────────────────────────────────────────
// Reproduces Android's ArrayFilter (the filter behind AutoCompleteTextView +
// ArrayAdapter), which is NOT a substring match and NOT a plain prefix match:
// an option matches when the whole option starts with the query OR when ANY
// WORD in it does.
//
// Verified against the app's own screenshot (Ticket Raising flow.pdf p.4):
// query "u" returns "change the ro[u]ter [u]ser name", "connected but
// [u]nable to browse", "olt fw [u]pgradation" — and nothing else. A substring
// filter would additionally surface every option containing a "u" anywhere
// ("slow speed iss[u]e", "ro[u]ter not working"), which the app does not show.
export function wordPrefixMatch(option, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const text = String(option || "").toLowerCase();
  if (text.startsWith(q)) return true;
  return text.split(/\s+/).some((word) => word.startsWith(q));
}

export function filterSubjects(subjects, query) {
  return (subjects || []).filter((s) => wordPrefixMatch(s?.subject, query));
}

// ── Status presentation ──────────────────────────────────────────────
// Android remaps a handful of raw status strings for display and passes the
// rest through untouched (TicketsStatusFragment.MyBaseAdapter.getView).
const STATUS_LABELS = {
  resolved: "Resolved",
  pending: "Pending",
  jobdone: "Job Done",
  available: "Available",
  transfered: "Transferred",
};

export function statusLabel(status) {
  if (!status) return "—";
  return STATUS_LABELS[String(status).toLowerCase()] || status;
}

export function statusTone(status) {
  const v = String(status || "").toLowerCase();
  if (v === "resolved" || v === "closed") return "bg-green-500";
  if (v === "jobdone") return "bg-blue-500";
  if (v === "transfered") return "bg-purple-500";
  return "bg-orange-500"; // pending / available / unknown
}

/**
 * Who the ticket is assigned to.
 *
 * `empname` and `assigned` are NOT the same field. A real captured response
 * has `assigned: "BBNL_OP49"` with `empname`, `empmobile` and `empimg` all
 * empty — i.e. the ticket IS taken, but the employee's display name hasn't
 * propagated. Android reads only `empname` and therefore tells the customer
 * "Not available" on a ticket that is demonstrably assigned.
 *
 * Falling back to `assigned` is what makes "assigned to should be shown"
 * actually hold as soon as an employee picks the ticket.
 */
export function assigneeName(t) {
  const name = String(t?.empname || "").trim();
  if (name) return name;
  const assigned = String(t?.assigned || "").trim();
  if (assigned) return assigned;
  return "Not Available";
}

/** True once an employee has picked the ticket up. */
export function isAssigned(t) {
  return Boolean(String(t?.empname || "").trim() || String(t?.assigned || "").trim());
}

/** After job done the customer must choose: accept (close) or re-raise. */
export function isJobDone(t) {
  return String(t?.status || "").toLowerCase() === "jobdone";
}

export const isNewConnection = (t) =>
  String(t?.subject || "").toLowerCase().includes("new connection");

export const isResolved = (t) =>
  String(t?.status || "").toLowerCase() === "resolved";

// ── Close / re-raise decision ────────────────────────────────────────
// Given the user's action and the live status returned by
// Apis/getParticularTicketStatus/, decide whether to prompt for an engineer
// rating or to send the close request straight away.
//
// Returns either { rate: true } — open the rating dialog, the rating the user
// picks becomes engr_rating with status "yes" — or
// { rate: false, rating, status } — send immediately.
//
// TWO DELIBERATE DIVERGENCES FROM ANDROID, both documented:
//
//  1. A re-raise never prompts for a rating. Re-raising means "this is NOT
//     fixed", so there is nothing to rate. Android's TicketsStatusFragment
//     routes re-raises through the rating dialog and then hardcodes
//     status "yes" in onEngineerRated — silently converting the re-raise
//     into a close. That is a bug; we send rating 0 / status "no" directly,
//     matching RaiseNewTicketsFragment.
//
//  2. A failed probe prompts the user instead of fabricating a rating.
//
// ONE KNOWN PARITY WART, kept intentionally: when the probe reports a state
// with no engineer engagement, Android sends a fabricated 5-star rating. It
// pollutes engineer rating data, but changing it changes what the backend
// records, so it stays until that is a deliberate product decision.
const RATEABLE_STATES = ["pending", "transfered", "jobdone"];

export function decideCloseFlow({ action, probeState, probeFailed = false }) {
  if (action === "reraise") {
    return { rate: false, rating: "0", status: "no" };
  }
  if (probeFailed) {
    return { rate: true };
  }
  if (RATEABLE_STATES.includes(String(probeState || "").toLowerCase())) {
    return { rate: true };
  }
  return { rate: false, rating: "5", status: "yes" };
}
