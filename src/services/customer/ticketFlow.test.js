/**
 * Customer ticket flow logic — subject filtering + close/rating decisions.
 *
 * Run: npx vitest run
 *
 * These are pure-logic tests, no network. They pin two things that were
 * DERIVED rather than read straight off the Android source, and so are the
 * most likely to be wrong:
 *
 *   1. The subject filter's word-prefix semantics, calibrated against the
 *      app's own screenshot (Ticket Raising flow.pdf p.4).
 *   2. The close pipeline's branch table, including the two places we
 *      deliberately diverge from Android.
 */

import { describe, test, expect } from "vitest";
import {
  wordPrefixMatch,
  filterSubjects,
  statusLabel,
  statusTone,
  isNewConnection,
  isResolved,
  isJobDone,
  isAssigned,
  assigneeName,
  decideCloseFlow,
} from "./ticketFlow.js";

// ══════════════════════════════════════════════════════════════════════
//  Subject filter — calibrated against the real app screenshot
// ══════════════════════════════════════════════════════════════════════
describe("subject filter (Android ArrayFilter parity)", () => {
  // The EXACT list the Android app rendered for query "u" (PDF p.4).
  // Not invented — read off the screenshot.
  const PDF_RESULTS_FOR_U = [
    "change the router user name",
    "change to tcp and udb",
    "connected but unable to browse",
    "getting pop up messages from bbnl",
    "hotspot webspage not opening up",
    "invalid username and password",
    "no more session is allowed for your userid",
    "old user id reconnection",
    "olt fw upgradation",
    "page under construction",
  ];

  // Plausible catalogue entries that contain a "u" but have NO word starting
  // with one. Android does not show these for "u"; a substring filter would.
  const CONTAINS_U_BUT_NO_WORD_STARTS_WITH_U = [
    "slow speed issue",
    "router not working",
    "bill amount dispute",
    "frequent disconnection during rain",
  ];

  test("every option the app showed for 'u' matches", () => {
    for (const s of PDF_RESULTS_FOR_U) {
      expect(wordPrefixMatch(s, "u"), s).toBe(true);
    }
  });

  test("options the app did NOT show for 'u' do not match", () => {
    // This is the assertion that distinguishes our filter from a substring
    // match. If someone "simplifies" filterSubjects to .includes(), this
    // fails — and the dropdown starts showing noise the app never showed.
    for (const s of CONTAINS_U_BUT_NO_WORD_STARTS_WITH_U) {
      expect(s.includes("u"), `${s} should contain u for this test to matter`).toBe(true);
      expect(wordPrefixMatch(s, "u"), s).toBe(false);
    }
  });

  test("matches on a whole-option prefix, not only interior words", () => {
    expect(wordPrefixMatch("unable to browse", "un")).toBe(true);
    expect(wordPrefixMatch("olt fw upgradation", "olt")).toBe(true);
  });

  test("is case-insensitive in both directions", () => {
    expect(wordPrefixMatch("Invalid Username And Password", "user")).toBe(true);
    expect(wordPrefixMatch("invalid username", "USER")).toBe(true);
  });

  test("empty / whitespace query matches everything (threshold behaviour)", () => {
    expect(wordPrefixMatch("anything at all", "")).toBe(true);
    expect(wordPrefixMatch("anything at all", "   ")).toBe(true);
    expect(filterSubjects([{ subject: "a" }, { subject: "b" }], "")).toHaveLength(2);
  });

  test("multi-space and irregular whitespace still split into words", () => {
    expect(wordPrefixMatch("olt   fw    upgradation", "upg")).toBe(true);
    expect(wordPrefixMatch("olt\tfw\nupgradation", "upg")).toBe(true);
  });

  test("filterSubjects preserves catalogue order and shape", () => {
    const subjects = PDF_RESULTS_FOR_U.map((subject, i) => ({ id: String(i), subject }));
    const out = filterSubjects(subjects, "u");
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual({ id: "0", subject: "change the router user name" });
  });

  test("word-prefix, NOT substring — the distinction the dropdown depends on", () => {
    // From the live catalogue (~271 rows). Typing "net" must NOT surface
    // "No Internet": "internet" starts with 'i', not 'net'. A substring
    // filter would wrongly include it and bury the real matches.
    expect(wordPrefixMatch("Network Issue", "net")).toBe(true);
    expect(wordPrefixMatch("Net Is Very Slow", "net")).toBe(true);
    expect(wordPrefixMatch("No Internet", "net")).toBe(false);
    expect("No Internet".toLowerCase().includes("net")).toBe(true); // proves the case is real
  });

  test("survives null/undefined rows without throwing", () => {
    // getSubjects filters these out, but the component must not explode if a
    // malformed row ever reaches it.
    expect(() => filterSubjects([{ subject: null }, {}, null], "u")).not.toThrow();
    expect(wordPrefixMatch(undefined, "u")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Close / re-raise branch table
// ══════════════════════════════════════════════════════════════════════
describe("close/re-raise decision", () => {
  test("engineer-engaged states prompt for a rating", () => {
    // getParticularTicketStatus returns a BARE STRING body, these values.
    for (const state of ["pending", "transfered", "jobdone"]) {
      expect(decideCloseFlow({ action: "close", probeState: state })).toEqual({ rate: true });
    }
  });

  test("a state with no engineer engagement closes directly with Android's 5", () => {
    // PARITY WART, asserted so it is a visible decision rather than an
    // accident: Android fabricates a 5-star rating for tickets no engineer
    // ever worked. If we ever stop doing that, this test should be changed
    // deliberately, not deleted.
    expect(decideCloseFlow({ action: "close", probeState: "available" })).toEqual({
      rate: false,
      rating: "5",
      status: "yes",
    });
    expect(decideCloseFlow({ action: "close", probeState: "" })).toEqual({
      rate: false,
      rating: "5",
      status: "yes",
    });
  });

  test("re-raise NEVER prompts for a rating and never sends status yes", () => {
    // The Android bug we refuse to reproduce: TicketsStatusFragment routes a
    // re-raise through the rating dialog, then onEngineerRated hardcodes
    // status "yes" — silently CLOSING the ticket the user asked to re-raise.
    for (const state of ["pending", "transfered", "jobdone", "available", ""]) {
      const d = decideCloseFlow({ action: "reraise", probeState: state });
      expect(d.rate).toBe(false);
      expect(d.status).toBe("no");
      expect(d.rating).toBe("0");
    }
  });

  test("a failed probe asks the user rather than fabricating a rating", () => {
    expect(decideCloseFlow({ action: "close", probeFailed: true })).toEqual({ rate: true });
  });

  test("re-raise short-circuits even when the probe failed", () => {
    const d = decideCloseFlow({ action: "reraise", probeFailed: true });
    expect(d).toEqual({ rate: false, rating: "0", status: "no" });
  });

  test("probe state matching is case-insensitive", () => {
    // Backend has shipped both "PENDING" and "pending" in this family of
    // endpoints; a case slip must not silently downgrade to the fabricated-5
    // path.
    expect(decideCloseFlow({ action: "close", probeState: "PENDING" })).toEqual({ rate: true });
    expect(decideCloseFlow({ action: "close", probeState: "JobDone" })).toEqual({ rate: true });
  });

  test("ratings are sent as integer strings, never floats", () => {
    // Android sends Float.toString(4.0f) = "4.0" from the dialog but "0"/"5"
    // from its hardcoded paths. We normalise to integers everywhere.
    const d = decideCloseFlow({ action: "reraise" });
    expect(d.rating).toBe("0");
    expect(d.rating).not.toBe("0.0");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Status presentation
// ══════════════════════════════════════════════════════════════════════
describe("status presentation", () => {
  test("known statuses are remapped, unknown ones pass through", () => {
    expect(statusLabel("resolved")).toBe("Resolved");
    expect(statusLabel("jobdone")).toBe("Job Done");
    expect(statusLabel("transfered")).toBe("Transferred"); // backend misspells; UI does not
    expect(statusLabel("available")).toBe("Available");
    expect(statusLabel("something-new")).toBe("something-new");
  });

  test("PENDING and pending both render as Pending", () => {
    // Android has a literal `.equals("PENDING")` branch AND a lowercase one.
    expect(statusLabel("PENDING")).toBe("Pending");
    expect(statusLabel("pending")).toBe("Pending");
  });

  test("empty status renders an em dash, not 'undefined'", () => {
    expect(statusLabel("")).toBe("—");
    expect(statusLabel(null)).toBe("—");
    expect(statusLabel(undefined)).toBe("—");
  });

  test("tone colours are distinct per state family", () => {
    expect(statusTone("resolved")).toBe("bg-green-500");
    expect(statusTone("jobdone")).toBe("bg-blue-500");
    expect(statusTone("transfered")).toBe("bg-purple-500");
    expect(statusTone("pending")).toBe("bg-orange-500");
    expect(statusTone(undefined)).toBe("bg-orange-500");
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Lifecycle: available → pending → (transfered) → jobdone → resolved
// ══════════════════════════════════════════════════════════════════════
describe("ticket lifecycle", () => {
  test("every operator-written status renders a human label", async () => {
    const { statusLabel } = await import("./ticketFlow.js");
    // The operator side writes these via pickTicket / transferTicket /
    // crmCloseTicket. None of them may leak a raw token to the customer.
    expect(statusLabel("available")).toBe("Available");
    expect(statusLabel("pending")).toBe("Pending");
    expect(statusLabel("transfered")).toBe("Transferred");
    expect(statusLabel("jobdone")).toBe("Job Done");
    expect(statusLabel("resolved")).toBe("Resolved");
  });

  test("status matching is case-insensitive — Android's PENDING/pending split", async () => {
    const { statusLabel, statusTone } = await import("./ticketFlow.js");
    // Android compares "PENDING" in its list renderer but "pending" in its
    // status probe, in the SAME file. At most one of those is right. We
    // lower-case everything so both spellings land on the same state.
    expect(statusLabel("PENDING")).toBe(statusLabel("pending"));
    expect(statusLabel("JobDone")).toBe(statusLabel("jobdone"));
    expect(statusTone("PENDING")).toBe(statusTone("pending"));
  });

  test("assignee falls back to `assigned` when empname is empty", () => {
    // Captured production shape: a ticket IS assigned (assigned:"BBNL_OP49")
    // while empname/empmobile/empimg are still empty. Android reads only
    // empname and tells the customer "Not available" on an assigned ticket.
    expect(assigneeName({ empname: "", assigned: "BBNL_OP49" })).toBe("BBNL_OP49");
    expect(assigneeName({ empname: "Demo demo", assigned: "BBNL_OP49" })).toBe("Demo demo");
    expect(assigneeName({ empname: "   ", assigned: "BBNL_OP49" })).toBe("BBNL_OP49");
    expect(assigneeName({ empname: "", assigned: "" })).toBe("Not Available");
    expect(assigneeName(null)).toBe("Not Available");
  });

  test("isAssigned is true as soon as an employee picks it up", () => {
    expect(isAssigned({ empname: "", assigned: "BBNL_OP49" })).toBe(true);
    expect(isAssigned({ empname: "Demo", assigned: "" })).toBe(true);
    expect(isAssigned({ empname: "", assigned: "" })).toBe(false);
    expect(isAssigned({})).toBe(false);
  });

  test("close + re-raise are offered together ONLY at jobdone", () => {
    // The spec: after job done the customer has exactly two options.
    // Before job done there is nothing to accept or dispute yet.
    expect(isJobDone({ status: "jobdone" })).toBe(true);
    expect(isJobDone({ status: "JobDone" })).toBe(true);
    for (const s of ["available", "pending", "transfered", "resolved", ""]) {
      expect(isJobDone({ status: s }), s).toBe(false);
    }
  });

  test("a resolved ticket is terminal — no further customer action", () => {
    // Auto-close (backend, ~8h after job done) lands here. Once resolved the
    // customer must not be offered close or re-raise.
    expect(isResolved({ status: "resolved" })).toBe(true);
    expect(isJobDone({ status: "resolved" })).toBe(false);
  });

  test("a transferred ticket is still open and still actionable", () => {
    // Transfer moves it to a new engineer; it must NOT read as resolved or
    // as job done, and the customer keeps the ability to close it.
    expect(isResolved({ status: "transfered" })).toBe(false);
    expect(isJobDone({ status: "transfered" })).toBe(false);
    // And the probe treats transfered like pending — an engineer to rate.
    expect(decideCloseFlow({ action: "close", probeState: "transfered" })).toEqual({ rate: true });
  });
});

describe("ticket action guards", () => {
  test("new-connection tickets are identified regardless of case", () => {
    // Android disables the close button on these — they are closed by the
    // operator, not the customer.
    expect(isNewConnection({ subject: "New Connection" })).toBe(true);
    expect(isNewConnection({ subject: "new connection request" })).toBe(true);
    expect(isNewConnection({ subject: "internet access" })).toBe(false);
    expect(isNewConnection({})).toBe(false);
    expect(isNewConnection(null)).toBe(false);
  });

  test("only exactly-resolved counts as resolved", () => {
    expect(isResolved({ status: "resolved" })).toBe(true);
    expect(isResolved({ status: "Resolved" })).toBe(true);
    // "jobdone" is NOT resolved — the customer still has to accept or re-raise.
    expect(isResolved({ status: "jobdone" })).toBe(false);
    expect(isResolved({ status: "pending" })).toBe(false);
    expect(isResolved(null)).toBe(false);
  });
});
