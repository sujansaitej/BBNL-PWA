# KT — ATV (Android TV) box "Wrong Fofi box ID" on upgrade + post-payment refresh

Date: 2026-07-18

## Issue A — ATV box upgrade fails "Wrong Fofi box ID!"

### Root cause (confirmed in backend source + live smoke tests)

`ServiceApis/upgradeRegistration` → `CustomerUpgradeRegistration._upgradeRegistration()`
adds the `chk__fofiboxid` validation whenever the plan's services include
`ott` or `fofi` (`CustomerUpgradeRegistration.php:64-70`). That validation
(`CustomerRegistrationValidations.php:428-445`):

```php
$idpre = substr($boxid, 0, 11);
if ($idpre == 'AUG-ANDBOX-' || $idpre == 'BBNL-ANDBOX') { ...ok... }
else $errmsg = 'Wrong Fofi box ID!';
```

So `upgradeRegistration` accepts a box id **only if its first 11 chars are
`AUG-ANDBOX-` or `BBNL-ANDBOX`**.

- An ATV device is a **`unicast`** customer (`unicast_users_new` table), box id
  `TV-<hash>` (`Fofi_model.php:1210` — `deviceid as product_name`). It has **no
  ANDBOX id**, so it can never pass this gate.
- Every fofi/FTA plan carries `reg_serv_keys: ["ott"]` (verified live via
  `registrationNecessities`), so the gate ALWAYS fires for these plans.

### What the smoke tests proved (so we don't repeat dead ends)

`upgradeRegistration` for pwaram's ATV box, `services:['ott']`, returned
`Wrong Fofi box ID!` for **every** shape tried — raw `TV-…`, prefix stripped to
the bare hash, and `mac`/`serial` empty or populated in all combinations. **No
client-side id/mac/serial reshaping fixes it.** (These variations all failed the
box gate, so none created a registration.)

Conversely the SAME `TV-…` id is **accepted** by the cabletv endpoints:
- `getMyPlanDetails(servicekey:"cabletv", fofiboxid:"TV-…")` → returns the plan.
- `service/paymentinfo/cabletv` with the `TV-…` box → reaches package selection
  ("choose one or more channels"), **no box-id rejection**.

### Native's actual behavior — it SKIPS upgradeRegistration for existing boxes

`ServiceSubscriptionsActivity.java:740-751` (the plan-upgrade submit):

```java
if (intent_fofi_id != null && !intent_fofi_id.equals("")) {
    GotoUpgradePayment();          // EXISTING box → straight to payment, NO registration
} else {
    requesrServerPlanUpgradation();  // NEW box → upgradeRegistration
}
```

`upgradeRegistration` is called ONLY when adding a brand-new box. For an
already-linked box (`intent_fofi_id` present), native goes straight to
`GotoUpgradePayment()` (`:841` — paymentinfo + generateorder with the existing
box id, planid, priceid), never touching `upgradeRegistration`. This is not
ATV-specific: native skips registration for ANY existing box. The PWA's bug was
firing `upgradeRegistration` unconditionally — redundant for existing FoFi boxes,
fatal for the ATV box.

### Fix (`src/pages/services/FoFiSmartBox.jsx`, `handleSubscriptionSubmit`)

The FoFi upgrade UI flow is unchanged (same plan picker → confirm → payment
screen — no redirect, no popup). Only the payment-area call changes: gate
`upgradeRegistration` on `isFofiAndroidBoxId(fofiBoxId)` (pure helper in
`utils/boxId.js` mirroring the backend's 11-char ANDBOX prefix). For a
non-ANDBOX (ATV/unicast) box it is SKIPPED — exactly as native skips it for an
existing box — and the flow proceeds to `getFofiPaymentInfo` →
`generateFofiOrder` (`cabletv/generateorder`), both of which accept the `TV-`
box. A real new FoFi box (ANDBOX id) still calls `upgradeRegistration` as before.
`FofiPayment` calls `upgradeRegistration` only via `runPendingFoFiActivation`,
which this flow never triggers (no `pendingActivation`). Unit-tested:
`utils/boxId.test.js`.

### Verified end-to-end (read-only, no order placed)
- `paymentinfo/fofi` with the `TV-` box + FTA plan (planid 51) → err=0, total
  ₹153.40, valid txnid — the ATV box is accepted once registration is skipped.
- Cabletv package path also accepts the box (BBNL FTA Package, ₹153.40) — same
  price, corroborating the plan mapping.
- Only `cabletv/generateorder` + wallet debit remain (real mutations, not fired);
  needs a live in-app tap to confirm the final order.

## Issue B — post-payment overview showed "not opted" until manual refresh

Same slow-backend root cause as the cable-TV first-load bug. FoFiSmartBox
discovered the box via a single `getUserAssignedItems('multi')` call; `multi`
intermittently fails (verified 45s null for pwaram) — most visibly right after a
payment when the operator returns. When it failed, no box was found → "not
opted" until a manual refresh hit a faster key.

Fix: replaced the single call with the same first-box-wins race
(`raceForFirstMatch` over `multi`+`fofi`+`cabletv`) used on the cable page.
Verified live it resolves pwaram's box (4.6s this run; resilient to any one key
stalling). Suite 54/54; build clean.
