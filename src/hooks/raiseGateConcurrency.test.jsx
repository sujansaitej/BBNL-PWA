/** @vitest-environment jsdom */
/**
 * Raise Ticket: fast to open, and a duplicate is a DIALOG not a toast.
 *
 * QA, Sep 2026, two reports that turned out to be one cause:
 *   "Raise Ticket page taking time to load... showing error message We
 *    couldn't reach your connection."
 *   "it should show a popup to close the ticket but it shows like a toaster."
 *
 * Two of the three endpoints the gate used run a BLOCKING SHELL PING
 * server-side — `exec("ping -c 3 $nas")` in OldApis.php::maintenance() and
 * ::customerPendingTicket(). The NAS does not answer ICMP on this deployment,
 * so both wait out all three packets on every page view. Measured 2026-09-01
 * against a customer who demonstrably HAD an open ticket:
 *
 *     apis/subjects/            1.2 - 1.7s
 *     Apis/gettickets/          0.5s   -> returned the ticket in full
 *     apis/maintenance/        12.5s   -> "Error Pinging", no maintenance flag
 *     apis/cust/pendingticket/ 12.8s   -> ticketstatus:{}, FOUND NOTHING
 *
 * The endpoint NAMED for the duplicate guard pings before it looks the ticket
 * up, so on this deployment it is not merely slow — it is blind. That is what
 * produced the toast: nothing detected the duplicate until raiseTicket refused
 * it, and a refusal has no Close / Raise Back buttons.
 *
 * So the gate now awaits the catalogue and Apis/gettickets/ together (both
 * fast), and an open ticket puts the screen straight into the
 * existing-complaint dialog — which is what it did before, only 20x quicker
 * and now actually working.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const checkMaintenance = vi.fn();
const checkPendingTickets = vi.fn();
const findOpenTicket = vi.fn();
const getSubjects = vi.fn();

vi.mock("../services/customer/tickets", () => ({
  checkMaintenance: (...a) => checkMaintenance(...a),
  checkPendingTickets: (...a) => checkPendingTickets(...a),
  findOpenTicket: (...a) => findOpenTicket(...a),
  getSubjects: (...a) => getSubjects(...a),
  getTickets: vi.fn(),
  raiseTicket: vi.fn(),
  getParticularTicketStatus: vi.fn(),
  closeTicket: vi.fn(),
}));

import { useRaiseGate } from "./useTicketFlow";

const SERVICE = { servicekey: "internet", servid: "7", opid: "BBNL_OP49", address: "" };
const SUBJECTS = [{ id: 1, subject: "No internet" }];
// The real shape Apis/gettickets/ returns, captured 2026-09-01.
const OPEN_TICKET = {
  tid: "20260890006", status: "available", subject: "Fiber cut ", assigned: "",
  risedtime: "27-08-2026  20:23:07", solvedtime: "27d 20h 23m", empname: "", empimg: "",
};

const mount = () => renderHook(() =>
  useRaiseGate({ service: SERVICE, customerId: "demopwa1", customerMobile: "9999999999" }));

beforeEach(() => {
  checkMaintenance.mockReset();
  checkPendingTickets.mockReset();
  findOpenTicket.mockReset().mockResolvedValue(null);
  getSubjects.mockReset().mockResolvedValue(SUBJECTS);
});

describe("the two ping endpoints are gone", () => {
  test.each([
    ["apis/maintenance/", () => checkMaintenance],
    ["apis/cust/pendingticket/", () => checkPendingTickets],
  ])("%s is never called", async (_name, fn) => {
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(fn()).not.toHaveBeenCalled();
  });

  test("no ping banner is shown to the customer any more", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.warning).toBe("");
  });
});

describe("a customer with no open complaint gets the form", () => {
  test("state is ready and the catalogue is loaded", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.subjects).toEqual(SUBJECTS);
    expect(result.current.existing).toBeNull();
  });

  test("both calls get the identifiers they need", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(getSubjects).toHaveBeenCalledWith({
      apiopid: "BBNL_OP49", cid: "demopwa1", servid: "7",
    });
    expect(findOpenTicket).toHaveBeenCalledWith({
      userid: "demopwa1", mobile: "9999999999", servicekey: "internet",
    });
  });
});

// THE REGRESSION QA REPORTED. An open complaint must land on the dialog, which
// only renders when state is 'pending' AND `existing` carries the ticket.
describe("a customer WITH an open complaint gets the dialog, not a toast", () => {
  beforeEach(() => findOpenTicket.mockResolvedValue(OPEN_TICKET));

  test("the screen goes straight to the pending state", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("pending"));
  });

  test("the ticket is carried, so the dialog can render its details", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("pending"));
    // ComplaintExistsDialog bails on a falsy ticket — this is what feeds it.
    expect(result.current.existing).toEqual(OPEN_TICKET);
    expect(result.current.existing.tid).toBe("20260890006");
  });

  test("'jobdone' is treated as open too — that is the Close / Raise Back branch", async () => {
    findOpenTicket.mockResolvedValue({ ...OPEN_TICKET, status: "jobdone" });
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("pending"));
    expect(result.current.existing.status).toBe("jobdone");
  });
});

describe("failure handling", () => {
  // A guard that cannot be read must not deny a working form. raiseTicket is
  // the backstop — the backend rejects duplicates with "Tickets Are Pending".
  test("an unreadable duplicate guard still opens the form", async () => {
    findOpenTicket.mockRejectedValue(new Error("gettickets down"));
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.message).toBe("");
  });

  test("the catalogue is the one hard dependency", async () => {
    getSubjects.mockRejectedValue(new Error("subjects down"));
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.message).toMatch(/subjects down/);
  });

  // Native renders the form whatever the catalogue size.
  test("an empty catalogue still opens the form", async () => {
    getSubjects.mockResolvedValue([]);
    const { result } = mount();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.subjects).toEqual([]);
  });
});
