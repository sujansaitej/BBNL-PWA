# KT — Franchise ticketing: PWA aligned byte-identical to native

Date: 2026-07-18

## Scope correction (important)

The native franchise ticketing is a **job-queue only** — it has NO create/raise
ticket, NO comment/reply, NO reopen, NO attachment, and NO ticket-detail screen.
Tickets are raised by *customers*; the franchise app lists → picks →
closes/transfers → job-done. The PWA already mirrored this structure, so the work
was closing specific gaps, not building a ticketing system.

## Native contract (verified live)

All native ticket endpoints hit `prod/Apis/<method>` as **POST form-urlencoded
with NO auth headers** (the `//Ticket` block in `ApiInterface.java` carries no
`@Headers`). `getDepartments` is the one GET. Success envelope
`{status:{err_code,err_msg}, body:[...]}` (OPEN uses `ticketstatus`). Smoke-tested
with zero auth headers: getDepartments→25, getEmployee→23, pendingTickets,
jobDoneList→111, getAvailableTicket→200 all returned.

| Action | Native endpoint (POST form) | Fields |
|---|---|---|
| departments | `Apis/getDepartments` (GET) | — |
| open list | `Apis/getAvailableTicket` | apiopid, newcon |
| pending list | `Apis/pendingTickets` | apiopid, newcon, loginid |
| new-conn list | `Apis/getNewConnectionTicket` | apiopid |
| disconn list | `Apis/disConnection` | apiopid |
| jobdone list | `Apis/jobDoneList` | apiopid, userid |
| pick | `Apis/pickTicket` | ticketid, apiopid, empname, empcontact |
| close | `Apis/crmCloseTicket` | ticketid, apiopid, empname, reason, opid |
| employees | `Apis/getEmployee` | opid, group(=accounts) |
| transfer | `Apis/transferTicket` | ticketid, toEmpname, toEmpLoginId, fromemp, toEmpMob, opid |

`newcon` defaults to the literal `"Departments"` (first item getDepartments
returns = "all").

## Gaps found in the PWA and how they were fixed

1. **Fake employee list** — the transfer dropdown used a hardcoded 3-person array;
   `getEmployee` was never called. → Added `getTicketEmployees(opid, group)` and
   wired the real list (loaded when the Transfer dialog opens).
2. **Broken transfer payload** — the PWA sent a bogus `employeeId` that `pickTkt`
   ignored, so transfers routed to no one. → `TicketDialog` now returns the
   selected employee's `{toEmpname, toEmpLoginId, toEmpMob}`; `pickTkt` builds the
   native transfer field set.
3. **`apiopid=raghav` hardcoded** on New Connections. → Uses the operator's op_id.
4. **TicketsMap Customer-ID/Name swap** — popup showed name under "Customer ID"
   and cid under "Name". → Swapped back.
5. **Wire format** — endpoints were `apis/…` GET with JSON+auth headers. → Now
   `Apis/…` POST form-urlencoded with no auth, matching native exactly (also
   corrected close/pick field order to native).

Note: `fromemp` — native sends it empty (uninitialized field); the PWA sends the
logged-in operator username instead (semantically correct, backend-compatible).

## Not changed
- No create/comment/reopen/attachment/detail added — native has none of these.
- The Leaflet map view is a PWA superset over native's "open Google Maps" button;
  left as-is (only its bugs fixed).

## Verification
- 10 contract tests in `src/services/contract.test.js` pin every ticket endpoint
  to native's URL casing, POST-form method, absence of `Authorization`, and exact
  field sets (incl. `apiopid != raghav`, transfer sends native fields not
  `employeeId`). Suite 63/63; build clean.
- Live smoke (byte-identical format, no auth): getDepartments/getEmployee/
  pendingTickets/jobDoneList/getAvailableTicket all return correctly.
- Mutating calls (pick/close/transfer) not fired live — contract-tested for
  payload shape; native proves the backend accepts them.
