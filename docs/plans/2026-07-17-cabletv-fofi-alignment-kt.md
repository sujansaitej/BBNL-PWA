# KT — Cable TV ↔ FoFi/AndroidTV flow: Android vs PWA alignment

Date: 2026-07-17 · Scope: internet-operator (employee) cable-TV eligibility & checkout

## The business rule, as actually implemented

"Only FoFi / Android TV subscribers may opt for Cable TV" is **not** a client-side
guard in either app. It is **backend-enforced and structural**: a cable order's
box id is drawn exclusively from the assigned-items response and threaded into
every cable call, so a customer with no box is rejected server-side. There is no
`if (hasBox) showCable` check in Android, and none should be added to the PWA.

Android also makes **no FoFi-vs-AndroidTV distinction** — both are just
`BBNL-ANDBOX-…` rows in the assigned-items `fofi[]` bucket.

## Backend fact that drives everything

`POST ServiceApis/getUserAssignedItems { servkey, userid }` — **`servkey` is a
CONTENT FILTER, not a label.** Verified live (prod, 2026-07-17):

| servkey sent | fofi[] | internet[] |
|---|---|---|
| `fofi` | box | **empty** |
| `internet` | empty | item |
| `multi` | box | item (union) |
| `cabletv` | box (in `fofi[]`) | empty |

So a **cable-only** customer's box can appear under `servkey="cabletv"` and not
under `fofi`. `multi` is a union but was only confirmed to include fofi/internet;
cable-only coverage could not be proven (no cable-only test user available).

## Android cable flow (reference — `CustomerCompleteOverviewFragment.java`)

1. Operator selects "cabletv" → `getUserAssignedItems(servkey="cabletv")`; box
   list read from response `fofi[]` (`:688-714`).
2. Operator picks box → `selectedFofiId` (a `BBNL-ANDBOX-…` string).
3. `getMyPlanDetails(servicekey="cabletv", fofiboxid=selectedFofiId)` (`:1420-1423`
   — note: cable is the ONLY branch that calls even with an empty box id; fofi/
   voip/multi short-circuit).
4. Cable action buttons shown **only when** `err_code==0` AND non-empty
   `subscribed_services[0].planname` AND `chnls_pkgs_selection.btn_status != "disable"`
   (`:873-886`). No plan → generic "not opted" (`:1030-1036`).
5. Every cable step ships the box id: `fofiboxid` (getMyPlanDetails, generateorder),
   `fofi_box_id` (service/paymentinfo/cabletv), `itemid` (planExtensionPeriods,
   iptvLastSubscribedinfo).

## PWA divergences found, and the tweaks applied

| # | Android | PWA (before) | Fix applied |
|---|---------|--------------|-------------|
| A | box discovery via `servkey="cabletv"` | `fofi` then `multi/voip/internet` — never `cabletv` | Added `cabletv` to the discovery fan-out and box-id resolution chain in `IPTVService.jsx`. Pure superset (cached/deduped read); can only find more boxes. **Likely the real root cause for cable-only customers.** |
| B | buttons gated on `chnls_pkgs_selection.btn_status != "disable"` | only checked plan presence + expiry — ignored `btn_status` | Added `packageSelectionDisabled` / `canSelectPackages`; when the backend disables selection on an active plan, show a note instead of the Select buttons (native hides them). Mirrors the PWA's own internet-renewal `btn_status` handling (`InternetService.jsx:225`). |
| C | any no-plan state → generic "not opted" → opt-in | usertype string split into "not opted"(SUBSCRIBE) vs "temporarily unavailable"(REFRESH) | Stripped the usertype branch; every no-plan outcome now shows "not opted → SUBSCRIBE", matching `CustomerCompleteOverviewFragment:1030-1036`. |

## Deliberately NOT changed

- **No explicit "must own a box" guard** — neither app has one; the coupling stays
  structural (box id feeds every cable call).
- **`utils/boxId.js` device-type detection** stays; it's a PWA superset that does
  not contradict the backend.
- **FoFiSmartBox.jsx cable fallback** (`resolveCableTvBoxes`) left as-is. It is the
  FoFi opt-in page, not the cable page; its cable fallback benefits from the
  `cabletv_boxid_${userid}` cache that IPTVService now populates via the new
  `cabletv` query. Aligning its own discovery would partially revert the
  single-call perf refactor (9a93c0c) — deferred unless a cable-only customer is
  shown to fail when opening FoFiSmartBox with a cold cache.

## Verification

- `servkey="cabletv"` validity + `fofi[]`-bucket behaviour: confirmed live (prod).
- Cable-only box-discovery gap (the motivating hypothesis for tweak A): **not
  empirically confirmed** — no cable-only test user was available. Tweak A is
  justified as zero-regression alignment regardless.
- `vite build` clean; `vitest` 43/43 pass. Changes are component-render logic not
  covered by the node-only test suite (no jsdom); no new pure-logic seam to unit
  test. Repo has no ESLint.
