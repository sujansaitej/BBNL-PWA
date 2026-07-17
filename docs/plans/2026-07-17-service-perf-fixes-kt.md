# KT — Cable/FoFi service-screen performance fixes

Date: 2026-07-17 · Root theme: a very slow, wildly-variable backend
(measured 4–45s per call, one key 41s while another returned the same box in
4s) hit **serially and redundantly**, with `skipCache=true` discarding caches
that were populated one screen earlier, and loading states that paint a
definitive answer before data arrives.

## Shipped (client-only, zero correctness risk)

### #1 — Cable TV first load showed "not opted", only worked after manual refresh
`src/pages/services/IPTVService.jsx`
- **Premature "not opted".** `_cachedDefinitelyNotOpted` derived a definitive
  "not opted" from `usertype != 'cable'`. Verified live that **every** customer
  in this base carries `usertype="internet"` (never "cable"), including real
  cable subscribers like `pwaram`. That painted "not opted" with **no spinner**
  before the slow box fetch resolved. Removed the usertype shortcut from
  `_hasCachedPlanRender`; the plan section now shows a spinner until the real
  fetch settles.
- **Box discovery awaited the slowest key.** It `await`ed `fofi` first (41s for
  `pwaram`) before trying anything else. Replaced with a first-box-wins race
  across `fofi`+`cabletv` (`raceForFirstMatch`, unit-tested) — caps discovery at
  the fastest key that carries a box (4s instead of 41s for `pwaram`).

### #2 — PAY BILL took 10–15s
`src/pages/services/FoFiSmartBox.jsx` `handlePayBill`
- Re-fetched `getMyPlanDetails` (skipCache=true) on **every** tap even though the
  overview mount already cached it in state — the bulk of the wait when the
  operator arrived straight from the overview. Now skipped when
  `planDetailsSnapshot.body` is already present.
- The plan refresh and the plan-catalog fetch were sequential though
  independent — now fire in one `Promise.all`, each skipped when its data
  already exists. Warm path fires **nothing** here.

### #5 — Checkout "Wallet Balance: Loading…" hung
`src/pages/services/IPTVService.jsx`, `src/components/Dashboard.jsx`
- `refreshCableWalletBalance` forced `skipCache=true` on checkout-open. Now
  cache-first on open (`debitAmount === 0`); still forces fresh post-payment.
- Order-success no longer wipes `walbal_*_cabletv` — the immediate post-order
  refresh (skipCache=true → getWalBal lsSets) leaves the cache warm+correct.
- Dashboard now warms the `cabletv` wallet cache (was internet+fofi only), so
  checkout paints instantly from cache.

## Deferred — #3 & #4 need backend sign-off (payment mutation path)

These are slow because two 60s-ceiling calls run on a **mutation→read chain**.
Reordering risks breaking payments and cannot be verified read-only (testing
means firing a real mutation). **Do not change without backend confirmation.**

### #3 — "Services Subscription" stuck on "Processing…"
`FoFiSmartBox.jsx` `handleSubscriptionSubmit` (~:2760)
- `upgradeRegistration` (≤60s) then `getFofiPaymentInfo` (≤60s) run
  **sequentially** (`await` at ~:2939 then ~:2947), despite a comment at ~:2910
  claiming they run in parallel.
- **Proposed patch (needs sign-off):** run them in `Promise.all`.
  ```js
  const [upgradeResp, payInfoResp] = await Promise.all([
      upgradeRegistration(upgradePayload),
      getFofiPaymentInfo(paymentPayload),
  ]);
  ```
- **Backend question:** does `service/paymentinfo/fofi` require the
  `upgradeRegistration` row to already exist? If yes, this MUST stay sequential
  and the misleading "PARALLEL" comment should be corrected instead.

### #4 — "PROCEED TO PAY" long "PROCESSING…"
`src/pages/FofiPayment.jsx` `handleProceedToPay` (~:491)
- Foreground chain is `getFofiPaymentInfo` (≤60s, ~:548) → `generateFofiOrder`
  (≤60s, ~:651). Inherent: `generateorder` consumes `paymentinfo`'s
  `transactionid`, so it cannot be parallelized. Post-success work is already
  correctly backgrounded (immediate navigate, fire-and-forget activation poll,
  15s-bounded reconcile).
- **The only removable cost:** `service/paymentinfo/fofi` is called TWICE per
  subscription — once in #3's submit (~:2947) and again here (~:548), which
  deliberately discards the first `transactionid` (rationale at
  `FofiPayment.jsx:529-540`).
- **Backend question:** is the first `transactionid` reusable, or does it go
  stale between screens? If reusable, drop the refresh at :548 and reuse
  `paymentData.transactionid` — removes one ≤60s call from the critical path.

## Verification
- `raceForFirstMatch` unit-tested (`src/utils/raceForFirst.test.js`): fast-key
  wins without waiting, slow-key-with-box still waits, no-match waits for all,
  rejection handling, empty list. Suite: 48/48. `vite build` clean.
- #1 root cause confirmed live (prod): `pwaram` box resolves in 4.2s via
  `cabletv` vs 41.7s via `fofi`; `usertype="internet"` across all 5,644
  customers. #2/#5 redundant-call and cache-miss paths confirmed by the flow
  audit (file:line in commit body).
- The shipped changes are component/effect logic not covered by the node-only
  suite (no jsdom); the extracted race is the unit-tested core.
