/**
 * Customer ticket endpoints — wire contract + response-branch tests.
 *
 * Run: npx vitest run
 *
 * WHAT THESE DO
 * -------------
 * Mock `fetch` and assert the EXACT request each of the seven ticket
 * functions puts on the wire — URL (including path CASING), method, headers,
 * field names — then feed back real Android response shapes and assert we
 * branch correctly.
 *
 * WHY THE CASING ASSERTIONS MATTER
 * --------------------------------
 * This subsystem mixes lowercase `apis/` and capital `Apis/` prefixes. The
 * backend runs on Linux and is case-sensitive, so they resolve to DIFFERENT
 * controllers. A well-meaning "consistency" cleanup silently 404s the flow.
 * Each URL below is pinned character-for-character on purpose.
 *
 * WHY err_code IS MOSTLY ABSENT
 * -----------------------------
 * Unlike the rest of the app, success here is NOT `err_code === 0`. Each
 * endpoint has its own discriminator (subjects returns err_code **1** on
 * success; raise/close match err_msg substrings; getParticularTicketStatus
 * returns a bare string). Routing any of these through readEnvelope breaks
 * them. These tests encode that.
 *
 * WHAT THEY DO NOT DO
 * -------------------
 * They do not prove the backend accepts any of this — the fixtures come from
 * the Android source and TICKET-RAISING-API-AUDIT.md, NOT from live traffic.
 * This flow has never been exercised against a real customer login. Run
 * `npm run smoke` (which now includes the read-only ticket probes) before
 * trusting a green run here.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/prod/");
vi.stubEnv("VITE_API_AUTH_KEY", "TEST_AUTH_KEY");
vi.stubEnv("VITE_API_USERNAME", "testuser");
vi.stubEnv("VITE_API_PASSWORD", "testpass");
vi.stubEnv("VITE_API_APP_USER_TYPE", "employee");
vi.stubEnv("VITE_API_APP_USER_TYPE_CUST", "customer");
vi.stubEnv("VITE_API_APP_VERSION", "1.2.0");

const BASE = "https://test.example/prod/";

// The customer-app APIS credential block (Constants.java _APIS).
const APIS_AUTH = "c4f79e15f8c6ed0715a8ea44aebc38d8";
const APIS_USER = "e2798af12a7a0f4f70b4d69efbc25f4d";
const APIS_PASS = "c1f377afbaa874acbb6b61f66957710a";

// ── response fixtures (shapes from the Android Gson models + audit) ──
const MAINTENANCE_OPEN = { status: { err_code: 0, err_msg: "" } };
const MAINTENANCE_CLOSED = { status: { err_code: 1, err_msg: "Under maintenance" } };

// subjects returns err_code 1 on SUCCESS. This is not a typo.
const SUBJECTS_OK = {
  status: { err_code: 1, err_msg: "Subject Details Fetched Successfully" },
  body: [
    { id: "1", subject: "internet access" },
    { id: "2", subject: "olt fw upgradation" },
  ],
};

const TICKET_ROW = {
  tid: "20260700193",
  status: "pending",
  assigned: "demo",
  subject: "internet access",
  risedtime: "2026-07-18 12:13:52", // backend misspelling, verbatim
  closedtime: "",
  solvedtime: "",
  empname: "Demo demo",
  empmobile: "9945762186",
  empimg: "https://cdn.example/emp/demo.jpeg",
  reqtdsrv: "",
};

const PENDING_AVAILABLE = {
  pingingstatus: { err_code: 0, err_msg: "Pinging Successfully" },
  ticketstatus: { err_code: 0, err_msg: "Pending Tickets Available" },
  body: [TICKET_ROW],
};
const PENDING_UNAVAILABLE = {
  pingingstatus: { err_code: 0, err_msg: "Pinging Successfully" },
  ticketstatus: { err_code: 1, err_msg: "Pending Tickets Unavailable" },
  body: [],
};

let fetchMock;

function mockResponse(payload, { status = 200 } = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function lastRequest() {
  const [url, opts] = fetchMock.mock.calls.at(-1);
  return { url, opts, headers: opts?.headers || {} };
}

/** Query params of the last request, as a plain object. */
function lastQuery() {
  return Object.fromEntries(new URL(lastRequest().url).searchParams);
}

/** Form-encoded body of the last request, as a plain object. */
function lastForm() {
  return Object.fromEntries(new URLSearchParams(lastRequest().opts.body));
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(mockResponse(MAINTENANCE_OPEN));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
//  Path casing — the single most fragile thing in this file
// ══════════════════════════════════════════════════════════════════════
describe("path casing (backend is case-sensitive)", () => {
  test("lowercase apis/ endpoints", async () => {
    const m = await import("./tickets.js");

    await m.checkMaintenance({ apiopid: "OP1", cid: "c1", servicekey: "internet" });
    expect(lastRequest().url).toBe(`${BASE}apis/maintenance/`);

    await m.checkPendingTickets({ userid: "c1", servicekey: "internet" });
    expect(lastRequest().url).toBe(`${BASE}apis/cust/pendingticket/`);

    fetchMock.mockResolvedValue(mockResponse(SUBJECTS_OK));
    await m.getSubjects({ apiopid: "OP1", cid: "c1", servid: "casing-test" });
    expect(lastRequest().url).toContain(`${BASE}apis/subjects/?`);

    await m.raiseTicket({ opid: "c1", sub: "x", comment: "y" });
    expect(lastRequest().url).toContain(`${BASE}apis/raiseTicket/?`);
  });

  test("capital Apis/ endpoints", async () => {
    const m = await import("./tickets.js");

    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await m.getTickets({ userid: "c1", mobile: "9", servicekey: "internet" });
    expect(lastRequest().url).toContain(`${BASE}Apis/gettickets/?`);

    await m.getParticularTicketStatus({ ticketid: "T1", servicekey: "internet" });
    expect(lastRequest().url).toBe(`${BASE}Apis/getParticularTicketStatus/`);

    await m.closeTicket({ custid: "c1", ticketid: "T1", servicekey: "internet" });
    // No trailing slash on this one — also load-bearing.
    expect(lastRequest().url).toBe(`${BASE}Apis/closeticket`);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Credentials — three different postures across seven endpoints
// ══════════════════════════════════════════════════════════════════════
describe("credential posture", () => {
  test("maintenance/subjects/pendingticket send the APIS block", async () => {
    const m = await import("./tickets.js");

    await m.checkMaintenance({ apiopid: "OP1", cid: "c1", servicekey: "internet" });
    let h = lastRequest().headers;
    expect(h.Authorization).toBe(APIS_AUTH);
    expect(h.username).toBe(APIS_USER);
    expect(h.password).toBe(APIS_PASS);
    // `apptype`, NOT `appkeytype` — the customer-app value.
    expect(h.apptype).toBe("customerapp-v1");
    expect(h.appkeytype).toBeUndefined();

    await m.checkPendingTickets({ userid: "c1", servicekey: "internet" });
    expect(lastRequest().headers.Authorization).toBe(APIS_AUTH);

    fetchMock.mockResolvedValue(mockResponse(SUBJECTS_OK));
    await m.getSubjects({ apiopid: "OP1", cid: "c1", servid: "cred-test" });
    expect(lastRequest().headers.apptype).toBe("customerapp-v1");
  });

  test("raise/list/status/close send NO auth headers at all", async () => {
    const m = await import("./tickets.js");

    await m.raiseTicket({ opid: "c1", sub: "x", comment: "y" });
    expect(lastRequest().headers.Authorization).toBeUndefined();

    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [] }));
    await m.getTickets({ userid: "c1", mobile: "9", servicekey: "internet" });
    expect(lastRequest().headers.Authorization).toBeUndefined();

    await m.getParticularTicketStatus({ ticketid: "T1", servicekey: "internet" });
    expect(lastRequest().headers.Authorization).toBeUndefined();

    await m.closeTicket({ custid: "c1", ticketid: "T1", servicekey: "internet" });
    expect(lastRequest().headers.Authorization).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Per-endpoint request shape + response branching
// ══════════════════════════════════════════════════════════════════════
describe("checkMaintenance", () => {
  test("POST form {apiopid,cid,servicekey}", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    await checkMaintenance({ apiopid: "OP1", cid: "cust1", servicekey: "internet" });
    const { opts, headers } = lastRequest();
    expect(opts.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(lastForm()).toEqual({ apiopid: "OP1", cid: "cust1", servicekey: "internet" });
  });

  test("err_code 0 opens the gate, non-zero closes it with the message", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(MAINTENANCE_OPEN));
    expect((await checkMaintenance({})).open).toBe(true);

    fetchMock.mockResolvedValue(mockResponse(MAINTENANCE_CLOSED));
    const closed = await checkMaintenance({});
    expect(closed.open).toBe(false);
    expect(closed.message).toBe("Under maintenance");
  });

  test("string err_code '0' still opens the gate", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: "0", err_msg: "" } }));
    expect((await checkMaintenance({})).open).toBe(true);
  });

  test("an unreachable connection is flagged separately from real maintenance", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    // CAPTURED LIVE from staging on the smoke run — this exact payload. The
    // top-level "Under Maintenance" is a red herring: err_msg says the real
    // cause is that the customer's link could not be pinged. Conflating the
    // two tells a customer with an outage that the service is under
    // maintenance, and buries the one case they most need to report.
    fetchMock.mockResolvedValue(
      mockResponse({
        message: "Under Maintenance",
        status: { err_code: 1, err_msg: "Error Pinging" },
      })
    );
    const r = await checkMaintenance({});
    expect(r.open).toBe(false);
    expect(r.pingFailed).toBe(true);
  });

  test("a genuine maintenance window is NOT flagged as a ping failure", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(MAINTENANCE_CLOSED));
    const r = await checkMaintenance({});
    expect(r.open).toBe(false);
    expect(r.pingFailed).toBe(false);
  });

  test("an open gate is never a ping failure", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(MAINTENANCE_OPEN));
    expect((await checkMaintenance({})).pingFailed).toBe(false);
  });

  test("concurrent identical calls collapse into ONE request", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(MAINTENANCE_OPEN));
    const args = { apiopid: "OP1", cid: "dedupe-test", servicekey: "internet" };

    // This endpoint pings the customer's line and is the slowest call in the
    // flow (~2.4s prod, ~12s staging). React StrictMode double-mounts effects
    // in dev, and a retry tap can double-fire in prod — without dedupe that
    // is two full round trips.
    const before = fetchMock.mock.calls.length;
    const [a, b] = await Promise.all([checkMaintenance(args), checkMaintenance(args)]);
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    // Both callers still get a real result.
    expect(a.open).toBe(true);
    expect(b.open).toBe(true);
  });

  test("different services are NOT deduped together", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(MAINTENANCE_OPEN));
    const before = fetchMock.mock.calls.length;
    await Promise.all([
      checkMaintenance({ apiopid: "OP1", cid: "c", servicekey: "internet" }),
      checkMaintenance({ apiopid: "OP1", cid: "c", servicekey: "cabletv" }),
    ]);
    expect(fetchMock.mock.calls.length).toBe(before + 2);
  });

  test("the result is NOT cached — a later call re-checks", async () => {
    const { checkMaintenance } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(MAINTENANCE_OPEN));
    const args = { apiopid: "OP1", cid: "nocache-test", servicekey: "internet" };
    await checkMaintenance(args);
    const after = fetchMock.mock.calls.length;
    await checkMaintenance(args);
    // A stale "under maintenance" verdict is worse than a slow one, so this
    // must dedupe concurrent calls only — never serve a remembered answer.
    expect(fetchMock.mock.calls.length).toBe(after + 1);
  });
});

describe("getSubjects", () => {
  test("GET with {apiopid,cid,servid} in the query", async () => {
    const { getSubjects } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(SUBJECTS_OK));
    await getSubjects({ apiopid: "OP1", cid: "cust1", servid: "q-test" });
    expect(lastRequest().opts.method).toBe("GET");
    expect(lastQuery()).toEqual({ apiopid: "OP1", cid: "cust1", servid: "q-test" });
  });

  test("returns rows even though err_code is 1 (success value for THIS endpoint)", async () => {
    const { getSubjects } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(SUBJECTS_OK));
    // If anyone routes this through readEnvelope/isEnvelopeOk, err_code 1
    // reads as failure and the dropdown goes permanently empty — the user
    // can then never raise a ticket at all.
    const subs = await getSubjects({ apiopid: "OP1", cid: "c", servid: "errcode-test" });
    expect(subs).toEqual([
      { id: "1", subject: "internet access" },
      { id: "2", subject: "olt fw upgradation" },
    ]);
  });

  test("drops rows with no subject text", async () => {
    const { getSubjects } = await import("./tickets.js");
    fetchMock.mockResolvedValue(
      mockResponse({
        status: { err_code: 1 },
        body: [{ id: "1", subject: "ok" }, { id: "2", subject: "" }, { id: "3" }],
      })
    );
    const subs = await getSubjects({ servid: "drop-test" });
    expect(subs).toHaveLength(1);
  });

  test("caches per servid and does not refetch", async () => {
    const { getSubjects } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(SUBJECTS_OK));
    await getSubjects({ apiopid: "OP1", cid: "c", servid: "cache-test" });
    const callsAfterFirst = fetchMock.mock.calls.length;
    await getSubjects({ apiopid: "OP1", cid: "c", servid: "cache-test" });
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  test("an empty result is NOT cached (so a transient blank self-heals)", async () => {
    const { getSubjects } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1 }, body: [] }));
    await getSubjects({ servid: "empty-cache-test" });
    const calls = fetchMock.mock.calls.length;
    await getSubjects({ servid: "empty-cache-test" });
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });
});

describe("checkPendingTickets", () => {
  test("POST form {userid,servicekey}", async () => {
    const { checkPendingTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(PENDING_UNAVAILABLE));
    await checkPendingTickets({ userid: "cust1", servicekey: "internet" });
    expect(lastRequest().opts.method).toBe("POST");
    expect(lastForm()).toEqual({ userid: "cust1", servicekey: "internet" });
  });

  test("'Pending Tickets Unavailable' clears the way to raise", async () => {
    const { checkPendingTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(PENDING_UNAVAILABLE));
    const r = await checkPendingTickets({ userid: "c" });
    expect(r.pinged).toBe(true);
    expect(r.hasPending).toBe(false);
    expect(r.canRaise).toBe(true);
    expect(r.existing).toBeNull();
  });

  test("'Pending Tickets Available' blocks and surfaces the existing ticket", async () => {
    const { checkPendingTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(PENDING_AVAILABLE));
    const r = await checkPendingTickets({ userid: "c" });
    expect(r.hasPending).toBe(true);
    expect(r.canRaise).toBe(false);
    // These five feed the "A complaint already exists!" dialog.
    expect(r.existing).toMatchObject({
      tid: "20260700193",
      subject: "internet access",
      status: "pending",
      assigned: "demo",
      risedtime: "2026-07-18 12:13:52",
    });
  });

  test("'Available' is not matched by a naive substring of 'Unavailable'", async () => {
    // "Pending Tickets Unavailable" CONTAINS "Available" as a substring once
    // you lowercase it ("unavailable" ⊃ "available"). If the two checks were
    // ordered or written carelessly, every customer would be told they have a
    // pending ticket and could never raise one. Pin the discrimination.
    const { checkPendingTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse(PENDING_UNAVAILABLE));
    const r = await checkPendingTickets({ userid: "c" });
    expect(r.hasPending).toBe(false);
  });

  test("a ping failure with an EMPTY ticketstatus object does not crash", async () => {
    const { checkPendingTickets } = await import("./tickets.js");
    // CAPTURED LIVE from staging. When the ping fails the backend returns
    // `ticketstatus: {}` — an empty object, not the usual {err_code,err_msg}.
    // Reading .err_msg off it yields undefined, which must be tolerated
    // rather than thrown on; this is the response a customer with a down
    // connection actually gets.
    fetchMock.mockResolvedValue(
      mockResponse({
        body: [],
        ticketstatus: {},
        pingingstatus: { err_code: 1, err_msg: "Error Pinging IP Address - 103.5.132.58" },
      })
    );
    const r = await checkPendingTickets({ userid: "c" });
    expect(r.pinged).toBe(false);
    expect(r.hasPending).toBe(false);
    expect(r.canRaise).toBe(false);
    expect(r.existing).toBeNull();
  });

  test("a failed ping is reported and does not claim raise-readiness", async () => {
    const { checkPendingTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(
      mockResponse({
        pingingstatus: { err_code: 1, err_msg: "Pinging Failed" },
        ticketstatus: { err_code: 1, err_msg: "Pending Tickets Unavailable" },
        body: [],
      })
    );
    const r = await checkPendingTickets({ userid: "c" });
    expect(r.pinged).toBe(false);
    expect(r.canRaise).toBe(false);
  });
});

describe("raiseTicket", () => {
  test("GET carrying all eight fields, with the opid/operid inversion intact", async () => {
    const { raiseTicket } = await import("./tickets.js");
    await raiseTicket({
      opid: "cust1",      // CUSTOMER id — yes, in `opid`
      name: "Pwa Testing",
      sub: "internet access",
      mobile: "9945762186",
      comment: "no browsing",
      address: "12 Main St",
      operid: "BBNL_OP49", // OPERATOR id — yes, in `operid`
      servicekey: "internet",
    });
    expect(lastRequest().opts.method).toBe("GET");
    const q = lastQuery();
    expect(q).toEqual({
      opid: "cust1",
      name: "Pwa Testing",
      sub: "internet access",
      mobile: "9945762186",
      comment: "no browsing",
      address: "12 Main St",
      operid: "BBNL_OP49",
      servicekey: "internet",
    });
    // The inversion is the backend's. Guard it explicitly so nobody
    // "corrects" it and silently files every ticket against the wrong party.
    expect(q.opid).not.toBe("BBNL_OP49");
    expect(q.operid).not.toBe("cust1");
  });

  test("comment text is URL-encoded, not truncated at special characters", async () => {
    const { raiseTicket } = await import("./tickets.js");
    // A mutating GET with free text in the query — ampersands and hashes in a
    // complaint would otherwise corrupt the request.
    await raiseTicket({ opid: "c", sub: "s", comment: "speed <1Mbps & drops #3 100% daily" });
    expect(lastQuery().comment).toBe("speed <1Mbps & drops #3 100% daily");
  });

  test("branches on err_msg substrings", async () => {
    const { raiseTicket } = await import("./tickets.js");
    const cases = [
      ["Ticket Successfully Raised", "success"],
      ["Tickets Are Pending", "pending"],
      ["invalid request", "invalid"],
      ["something we have never seen", "unknown"],
    ];
    for (const [err_msg, expected] of cases) {
      fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0, err_msg } }));
      expect((await raiseTicket({ opid: "c" })).status, err_msg).toBe(expected);
    }
  });
});

describe("getTickets", () => {
  test("GET with the two hardcoded Android params", async () => {
    const { getTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [TICKET_ROW] }));
    await getTickets({ userid: "cust1", mobile: "9945762186", servicekey: "internet" });
    expect(lastQuery()).toEqual({
      userid: "cust1",
      mobile: "9945762186",
      userstatus: "registereduser", // hardcoded in TicketsStatusFragment
      totalno: "300",               // hardcoded in ServerManager
      servicekey: "internet",
    });
  });

  test("returns body rows untouched, including the detail-view fields", async () => {
    const { getTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: [TICKET_ROW] }));
    const rows = await getTickets({ userid: "c" });
    // The ticket-status detail view reads these; if the service layer ever
    // starts mapping rows, they must survive.
    expect(rows[0]).toMatchObject({
      empname: "Demo demo",
      empmobile: "9945762186",
      empimg: "https://cdn.example/emp/demo.jpeg",
      solvedtime: "",
      risedtime: "2026-07-18 12:13:52",
    });
  });

  test("a missing body yields [] rather than throwing", async () => {
    const { getTickets } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 1, err_msg: "no tickets" } }));
    await expect(getTickets({ userid: "c" })).resolves.toEqual([]);
  });
});

describe("getParticularTicketStatus", () => {
  test("POST form {ticketid,servicekey}", async () => {
    const { getParticularTicketStatus } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: "pending" }));
    await getParticularTicketStatus({ ticketid: "20260700193", servicekey: "internet" });
    expect(lastRequest().opts.method).toBe("POST");
    expect(lastForm()).toEqual({ ticketid: "20260700193", servicekey: "internet" });
  });

  test("reads the BARE STRING body (not body.status, not body[0])", async () => {
    const { getParticularTicketStatus } = await import("./tickets.js");
    for (const state of ["pending", "transfered", "jobdone"]) {
      fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: state }));
      expect((await getParticularTicketStatus({ ticketid: "T" })).state).toBe(state);
    }
  });

  test("a non-string body degrades to '' instead of throwing", async () => {
    const { getParticularTicketStatus } = await import("./tickets.js");
    // Every OTHER endpoint here returns an object/array body, so a backend
    // change to this shape is plausible. It must not crash the close flow —
    // decideCloseFlow treats '' as "no engineer engagement".
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: { s: "pending" } }));
    expect((await getParticularTicketStatus({ ticketid: "T" })).state).toBe("");

    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 } }));
    expect((await getParticularTicketStatus({ ticketid: "T" })).state).toBe("");
  });

  test("surrounding whitespace is trimmed before comparison", async () => {
    const { getParticularTicketStatus } = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0 }, body: "  jobdone\n" }));
    expect((await getParticularTicketStatus({ ticketid: "T" })).state).toBe("jobdone");
  });
});

describe("closeTicket", () => {
  test("POST form with all five fields", async () => {
    const { closeTicket } = await import("./tickets.js");
    await closeTicket({
      custid: "cust1",
      ticketid: "20260700193",
      engr_rating: "4",
      status: "yes",
      servicekey: "internet",
    });
    expect(lastRequest().opts.method).toBe("POST");
    expect(lastForm()).toEqual({
      custid: "cust1",
      ticketid: "20260700193",
      engr_rating: "4",
      status: "yes",
      servicekey: "internet",
    });
  });

  test("numeric ratings are coerced to strings on the wire", async () => {
    const { closeTicket } = await import("./tickets.js");
    await closeTicket({ custid: "c", ticketid: "T", engr_rating: 4 });
    expect(lastForm().engr_rating).toBe("4");
  });

  test("re-raise sends status 'no'", async () => {
    const { closeTicket } = await import("./tickets.js");
    await closeTicket({ custid: "c", ticketid: "T", engr_rating: "0", status: "no" });
    expect(lastForm().status).toBe("no");
  });

  test("branches on err_msg substrings", async () => {
    const { closeTicket } = await import("./tickets.js");
    const cases = [
      ["Ticket Closed Successfully", "closed"],
      ["Ticket become pending Successfully", "pending"],
      ["Error while closing the ticket", "error"],
      ["mystery", "unknown"],
    ];
    for (const [err_msg, expected] of cases) {
      fetchMock.mockResolvedValue(mockResponse({ status: { err_code: 0, err_msg } }));
      expect((await closeTicket({ custid: "c", ticketid: "T" })).result, err_msg).toBe(expected);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Transport failures
// ══════════════════════════════════════════════════════════════════════
describe("transport failures surface, never silently succeed", () => {
  test("HTTP 5xx throws on every endpoint", async () => {
    const m = await import("./tickets.js");
    fetchMock.mockResolvedValue(mockResponse("<html>502</html>", { status: 502 }));
    // Android routes 4xx/5xx into its SUCCESS handler with a null body and
    // NPEs. We must not reproduce that anywhere in this subsystem.
    await expect(m.checkMaintenance({})).rejects.toThrow(/HTTP 502/);
    await expect(m.checkPendingTickets({})).rejects.toThrow(/HTTP 502/);
    await expect(m.getSubjects({ servid: "err-502" })).rejects.toThrow(/HTTP 502/);
    await expect(m.raiseTicket({})).rejects.toThrow(/HTTP 502/);
    await expect(m.getTickets({})).rejects.toThrow(/HTTP 502/);
    await expect(m.getParticularTicketStatus({})).rejects.toThrow(/HTTP 502/);
    await expect(m.closeTicket({})).rejects.toThrow(/HTTP 502/);
  });

  test("missing params degrade to empty strings, never the literal 'undefined'", async () => {
    const m = await import("./tickets.js");
    // A param that reaches the wire as the string "undefined" is worse than
    // an empty one — the backend treats it as a real value.
    await m.raiseTicket({});
    expect(Object.values(lastQuery())).not.toContain("undefined");

    await m.closeTicket({});
    expect(Object.values(lastForm())).not.toContain("undefined");
  });
});
