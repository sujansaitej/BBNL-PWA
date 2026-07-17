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

Native has no ATV-specific code (traced: `product_name → selectedFofiId →
setFofiboxid`, verbatim); it "works" only because cabletv customers go through
the cabletv flow, never `upgradeRegistration`.

### Fix (client-side routing, `src/pages/services/FoFiSmartBox.jsx`)

New pure helper `isFofiAndroidBoxId(id)` in `src/utils/boxId.js` mirrors the
backend gate exactly (11-char `AUG-ANDBOX-` / `BBNL-ANDBOX` prefix). Two guards:
- `handleUpgradeClick`: if the customer already has a non-ANDBOX box, route to
  the Cable TV flow (`/service/iptv`) instead of opening the FoFi plan picker.
- `handleSubscriptionSubmit`: backstop — if the resolved box is non-ANDBOX,
  route to Cable TV instead of firing the doomed `upgradeRegistration`.

A brand-new customer with no box has an empty id → guard is skipped → stays on
the add-FoFi-box path (unchanged). Unit-tested: `src/utils/boxId.test.js`.

### Still open (backend / product)
Routing sends the operator to the Cable TV subscription surface, which the ATV
device is compatible with. Whether that surface fully supports buying the
specific FTA plan the operator intended is a separate existing concern; the
guard's job is to stop the guaranteed FoFi-path failure and point at the flow
the backend accepts.

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
