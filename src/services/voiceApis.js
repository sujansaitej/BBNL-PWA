/**
 * voiceApis.js — Voice Call ("voicecall") service, ported 1:1 from the Android
 * operator app (crmapp-new-master, `employee` flavour).
 *
 * ANDROID CALL GRAPH (the whole voicecall surface — there is no more than this)
 * ---------------------------------------------------------------------------
 *   PrimaryServicesFragment.onServiceSelected()          case "voicecall"
 *     → falls through to the SAME branch as "internet"/"fofi": open the
 *       customer list for the service. Voice has no bespoke entry screen.
 *
 *   CustomerCompleteOverviewFragment
 *     1. ServiceApis/getUserAssignedItems  {servkey:"voicecall", userid}
 *          → body.voip[].product_name   (the VOIP numbers)
 *          → body.fofi[].product_name   (a linked box, when the customer has one)
 *        `selectedVoipId` = first entry; a spinner lets the operator switch and
 *        re-runs step 2. `selectedFofiId` is only auto-picked when there is
 *        EXACTLY ONE fofi entry (populateSpinner/size()==1 rule).
 *     2. getMyPlanDetails(:1404) case "voicecall":
 *          if (selectedVoipId is non-empty)
 *              ServiceApis/getMyPlanDetails {servicekey:"voicecall", userid,
 *                                            fofiboxid, voipnumber}
 *          else  → "not opted" state + the upgrade CTA. NO call is made.
 *     3. Renew ("Pay Bill") → EmployeeCommonPaymentInfoFragment
 *        Upgrade            → validateBeforeFofiBoxReg → registrationNecessities
 *
 *   EmployeeCommonPaymentInfoFragment (:139-190, :487-513) — the renewal
 *     1. ServiceApis/myWallet          {loginuname, servicekey:"voicecall"}
 *     2. service/paymentinfo/voicecall {fofi_box_id, planid, priceid,
 *                                       servapptype:"crmapp", voipnumber,
 *                                       userid, username, servid}
 *     3. gate: wallet_balance >= (total_amt − final_split_data.OPERATOR.amount)
 *     4. ServiceApis/cabletv/generateorder — see generateVoiceOrder() below.
 *
 * WHY THIS FILE IS SEPARATE FROM fofiApis.js
 * ------------------------------------------
 * The endpoints are shared (`service/paymentinfo/{servicekey}` and the one
 * `cabletv/generateorder`), but the PAYLOADS are not. FoFi's PWA order sends
 * `paytype:"upgrade"` and a `fofiboxid`; Android's voicecall renewal sends
 * NEITHER a paytype nor any cable field — Gson omits every null, so the wire
 * body is exactly the 16 keys listed in generateVoiceOrder(). Reaching for
 * generateFofiOrder() here would silently add `paytype` to a payload the
 * backend has never seen carry one on this path.
 */

import logger from "../utils/logger";
import { apiFetch, getBaseUrl, getHeadersJson, UPLOAD_TIMEOUT } from "./apiCore";
import { getServiceList } from "./generalApis";
// Shared, already-cached endpoints. See the re-export block near the bottom
// for why the Voice module fronts them under its own names.
import { getFofiUpgradePlans, validateBeforeFofiBoxReg } from "./fofiApis";

/** Constants.CONGIF_PAYMENT_FROM — the operator app's caller tag. */
export const VOICE_APP_TYPE = "crmapp";

/** ServiceApis/getUserAssignedItems servkey, and getMyPlanDetails servicekey. */
export const VOICE_SERVICE_KEY = "voicecall";

/**
 * The numeric `servid` the voice service is registered under.
 *
 * NEVER hardcode this. Native reads it off the service list row it was
 * launched from (`ServiceListDetails.getId()` → the `serviceid` bundle arg
 * that flows into both paymentinfo and generateorder), and the id is
 * deployment data, not a constant — constants/services.js deliberately leaves
 * `VOICE.servid = null` for the same reason.
 *
 * @param {Array} [servicesFromState] rows already carried in nav state, if any
 * @returns {Promise<string>} the id, or "" when the service is not provisioned
 */
export async function resolveVoiceServiceId(servicesFromState) {
    const pick = (rows) => {
        if (!Array.isArray(rows)) return "";
        const hit = rows.find(
            (s) => String(s?.keyword || s?.servkey || "").toLowerCase().trim() === VOICE_SERVICE_KEY
        ) || rows.find((s) => {
            const t = String(s?.title || s?.servname || s?.name || "").toLowerCase().trim();
            return t === "voice call" || t === "voice" || t === "unlimited calling";
        });
        return hit?.id ? String(hit.id) : "";
    };

    const fromState = pick(servicesFromState);
    if (fromState) return fromState;

    try {
        const data = await getServiceList();
        return pick(data?.body);
    } catch (err) {
        logger.debug("Voice", "resolveVoiceServiceId failed", { error: err?.message });
        return "";
    }
}

/**
 * POST service/paymentinfo/voicecall — the renewal quote.
 *
 * Native: EmployeeCommonPaymentInfoFragment.requestServer() building a
 * PaymnentInfoDetailsRequest. Field names are that model's, verbatim
 * (note the snake_case `fofi_box_id` next to camel-free `voipnumber`).
 *
 * Every call RESERVES a pending transaction server-side and returns its
 * `body.transactionid`; the caller must pay with that id or kill it. Same
 * contract as paymentinfo/fofi — see killFofiTxn in fofiApis.js.
 *
 * @param {object} payload
 * @param {string} payload.fofi_box_id  linked FoFi box, "" when none
 * @param {string} payload.planid
 * @param {string} payload.priceid
 * @param {string} payload.servid       numeric service id from servServiceList
 * @param {string} payload.userid       customer id
 * @param {string} payload.username     logged-in OPERATOR username (native
 *                                      passes app_username here, not the
 *                                      customer and not "superadmin")
 * @param {string} payload.voipnumber   the selected VOIP number
 */
export async function getVoicePaymentInfo(payload) {
    const url = `${getBaseUrl()}service/paymentinfo/voicecall`;

    const body = {
        fofi_box_id: payload.fofi_box_id || "",
        planid: String(payload.planid || ""),
        priceid: String(payload.priceid || ""),
        servapptype: payload.servapptype || VOICE_APP_TYPE,
        servid: String(payload.servid || ""),
        userid: payload.userid || "",
        username: payload.username || "",
        voipnumber: payload.voipnumber || "",
    };

    logger.debug("Voice", "getVoicePaymentInfo request", {
        userid: body.userid, voipnumber: body.voipnumber, planid: body.planid, servid: body.servid,
    });

    const resp = await apiFetch(url, {
        method: "POST",
        headers: getHeadersJson(),
        body: JSON.stringify(body),
    }, "getVoicePaymentInfo", { group: "Voice", timeout: UPLOAD_TIMEOUT });

    if (!resp.ok) {
        throw new Error(`Failed to get voice payment info: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    logger.debug("Voice", "getVoicePaymentInfo response", {
        errCode: data?.status?.err_code, txn: data?.body?.transactionid,
    });
    return data;
}

/**
 * POST ServiceApis/cabletv/generateorder — take the money.
 *
 * TWO NATIVE CALLERS, AND THEY DIFFER BY EXACTLY ONE FIELD
 * -------------------------------------------------------
 * Both build a GenerateOrderRequestDataModel and leave every unset field null,
 * which Gson drops from the wire body.
 *
 *   RENEW  — EmployeeCommonPaymentInfoFragment.generateOrderRequest() :487-513
 *            reached from "Pay Bill" on the customer overview.
 *            Sets 16 fields. **NEVER touches paytype** → the key is ABSENT.
 *
 *   UPGRADE — RegistrationPaymentOverviewActivity.generateOrderRequest() :281-312
 *            reached from the plan list (isupgrade=true).
 *            Sets the same 16 fields PLUS:
 *                if (isUpgrade) setPaytype("upgrade"); else setPaytype("");
 *            → the key is PRESENT and equals "upgrade".
 *
 * So `paytype` is opt-in per call site, and passing it on a renewal would be
 * just as wrong as omitting it on an upgrade. Callers pass `paytype` only when
 * native would; `undefined` keeps the key off the wire entirely.
 *
 * Everything else is identical across both:
 *   • NO `payrequest`, no channelid/packageid/pkgcode/lcochid, no denominations.
 *   • `paidamount` is the FULL `total_amt` from paymentinfo, never the wallet
 *     deductible (`setPaidamount(totalAmount)` in both), matching every other
 *     native employee payment path.
 *   • `username` is the OPERATOR's app_username — the same value sent to
 *     paymentinfo above. The backend binds the transactionid to it, so a
 *     mismatch between the two calls comes back as "Invalid transaction id"
 *     or a bogus wallet-balance rejection.
 */
export async function generateVoiceOrder(payload) {
    const url = `${getBaseUrl()}ServiceApis/cabletv/generateorder`;

    const orderPayload = {
        bankname: payload.bankname || "",
        banktxnid: payload.banktxnid || "",
        fofiboxid: payload.fofiboxid || "",
        gateway: payload.gateway || "",
        gatewaytxnid: payload.gatewaytxnid || "",
        orderedbytype: payload.orderedbytype || VOICE_APP_TYPE,
        // Numeric on the wire — same as generateFofiOrder; the backend rejects
        // a quoted amount on this endpoint.
        paidamount: Number(payload.paidamount || 0),
        paymentmode: payload.paymentmode || "offline",
        payresponse: payload.payresponse || "",
        planid: String(payload.planid || ""),
        priceid: String(payload.priceid || ""),
        servid: String(payload.servid || ""),
        transactionid: payload.transactionid || "",
        txnstatus: payload.txnstatus || "success",
        userid: payload.userid || "",
        username: payload.username || "",
        voipnumber: payload.voipnumber || "",
    };

    // Present ONLY on the upgrade leg — see the two call sites above. Assigning
    // it unconditionally (even as "") would put a key on the renewal wire body
    // that native has never sent there.
    if (payload.paytype !== undefined && payload.paytype !== null) {
        orderPayload.paytype = String(payload.paytype);
    }

    logger.debug("Voice", "generateVoiceOrder request", {
        userid: orderPayload.userid,
        voipnumber: orderPayload.voipnumber,
        planid: orderPayload.planid,
        paidamount: orderPayload.paidamount,
        transactionid: orderPayload.transactionid,
    });

    const resp = await apiFetch(url, {
        method: "POST",
        headers: getHeadersJson(),
        body: JSON.stringify(orderPayload),
    }, "generateVoiceOrder", { group: "Voice", timeout: UPLOAD_TIMEOUT });

    if (!resp.ok) {
        throw new Error(`Failed to generate voice order: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    logger.debug("Voice", "generateVoiceOrder response", { errCode: data?.status?.err_code });
    return data;
}

// ─────────────────────────────────────────────────────────────────────
// SHARED ENDPOINTS, RE-EXPORTED UNDER VOICE NAMES
// ─────────────────────────────────────────────────────────────────────
//
// Two endpoints on the voice flow carry FoFi-flavoured names but are generic:
// `validateBeforeFofiBoxReg` is the "can this customer take a new or changed
// subscription?" privilege gate, and `registrationNecessities` is the whole
// operator plan catalog (its voice half is body.voicecall_plans). Native calls
// both from the voicecall overview — checkUserStatus() (:490-496) and
// AddServicesToCustomerActivity.requestServerForPlans() (:139-156).
//
// They are NOT re-implemented here. Both are already cached in fofiApis.js —
// the catalog per operator, the gate per customer — and a parallel copy would
// double the traffic and let the two drift. What the Voice module owns is the
// NAMING: these wrappers are the module's front door, so the voice screens
// import from voiceApis alone and nothing about voice depends on reading a
// FoFi-named symbol. Swapping the transport later is a change to these two
// lines, not to every call site.

/**
 * The privilege gate. `username` carries the CUSTOMER id and `loginuname` the
 * operator — native's inversion (checkUserStatus:491-493), not a typo.
 */
export function checkVoiceUpgradeAllowed({ username, loginuname }) {
    return validateBeforeFofiBoxReg({ username, loginuname });
}

/**
 * The operator's plan catalog for an existing customer. `moduletype`
 * "upgradation" is the branch AddServicesToCustomerActivity takes when
 * `isupgrade` is set (:150-155). Pair with extractVoicePlans().
 */
export function getVoicePlanCatalog({ userid, logUname }) {
    return getFofiUpgradePlans({ userid, moduletype: "upgradation", logUname });
}

/**
 * Pull the voice plans out of a registrationNecessities response.
 *
 * Native: ServicePlansListAdapter (:103) — case "voicecall" reads
 * `body.voicecall_plans` and nothing else. Each row renders `planname` +
 * `planrate` and carries planid / priceid / payuri / servid / reg_serv_keys
 * forward (:301-314).
 */
export function extractVoicePlans(registrationNecessities) {
    const body = registrationNecessities?.body;
    const rows = body?.voicecall_plans ?? body?.voicecallplans ?? body?.voice_plans;
    return Array.isArray(rows) ? rows : [];
}

// ─────────────────────────────────────────────────────────────────────
// PROVISIONING — how a customer actually GETS a voice line
// ─────────────────────────────────────────────────────────────────────

/**
 * The service keys `_checkGroupRegistrations` (RegistrationConfig.php) knows.
 * Anything else in a plan row is display text, not a service key.
 */
const KNOWN_SERVICE_KEYS = new Set(["internet", "ott", "fofi", "voicecall", "games", "cabletv"]);

/**
 * The `services` array for provisionVoiceNumber(), taken from a plan row.
 *
 * DIVERGENCE FROM ANDROID, and it is DEFENSIVE rather than a bug fix — read
 * this before "simplifying" it back.
 *
 * ServicePlansListAdapter (:301-314) puts `reg_serv_keys` on the intent and
 * ServiceSubscriptionsActivity forwards it as `services`. That field is not
 * consistently service keys across deployments:
 *   • the sample captured on RegistrationNecessityResponseModel:62 has
 *     `reg_serv_keys:["Unlimited calls"]` next to `subscriptions:["voicecall"]`
 *     — a LABEL (fofi_plans in the same sample carries `["only ott"]`)
 *   • netmontest staging, probed 2026-08-19, returns `["voicecall"]` for both
 *     fields, so Android's choice happens to work there
 * `subscriptions` is service keys in BOTH, so it is the safer read. It matters
 * because `_checkGroupRegistrations` silently matches no branch on an
 * unrecognised list: err_code 0, nothing registered, no number allocated.
 * Reading `subscriptions` first costs nothing and cannot hit that.
 *
 * @param {object} plan a row from body.voicecall_plans
 * @returns {string[]} always non-empty; falls back to ["voicecall"]
 */
export function resolveVoicePlanServices(plan) {
    const pick = (rows) =>
        (Array.isArray(rows) ? rows : [])
            .map((s) => String(s || "").toLowerCase().trim())
            .filter((s) => KNOWN_SERVICE_KEYS.has(s));

    const withVoice = (keys) =>
        keys.includes(VOICE_SERVICE_KEY) ? keys : [...keys, VOICE_SERVICE_KEY];

    const fromSubscriptions = pick(plan?.subscriptions);
    if (fromSubscriptions.length > 0) return withVoice(fromSubscriptions);

    const fromRegKeys = pick(plan?.reg_serv_keys);
    if (fromRegKeys.length > 0) return withVoice(fromRegKeys);

    // `subscriptions: null` is a real production shape (plan 13,
    // BBNLVOICE100). A voice plan still needs a voice registration.
    return [VOICE_SERVICE_KEY];
}

/**
 * POST ServiceApis/upgradeRegistration — allocate (or look up) the customer's
 * billable VOIP number.
 *
 * THIS IS THE CALL THAT MAKES "ADD VOICE PLAN" POSSIBLE, and the reason this
 * screen no longer needs a Fo-Fi box as a prerequisite.
 *
 * Backend: CustomerUpgradeRegistration::_upgradeRegistration.
 *   - `chk__fofiboxid` joins the validation set ONLY when `services` contains
 *     "ott" or "fofi" (:66-70). The voicecall block that would have added
 *     `chk__voip` is commented out (:72-74). A voicecall-only registration
 *     therefore requires NO box and NO existing number.
 *   - services:["voicecall"] hits the single-service branch of
 *     _checkGroupRegistrations (:78-85): voicecallRegistration is the ONLY
 *     flag set — no radius insert, no OTT / cable / fofi registration.
 *   - VoiceCallRegistration::_voiceCallRegistration(..., 'register') inserts
 *     into `voip_customers` with `checkduplicatenotavailabletheninsert`, and
 *     Voip_model::addCustomer (:33-40) only inserts when voipDetails() is
 *     empty. The response then reads voipDetails() unconditionally (:245-248).
 *     -> IDEMPOTENT: allocates when absent, returns the existing number when
 *     present. Safe to call without first knowing which case you are in.
 *   - Every other field the validator wants (fname, email, mobile, address,
 *     pincode, city...) is read server-side off the existing customer record,
 *     so the wire body is just the keys below.
 *
 * ONE SIDE EFFECT WORTH KNOWING: on success the backend sends the customer an
 * SMS and an email from the `servcustreg2` template, unconditionally. Call it
 * when the operator has committed to a plan, never speculatively on load.
 *
 * WHY ANDROID NEVER REACHES THIS ON THE VOICE PATH —
 * ServiceSubscriptionsActivity.requesrServerPlanUpgradation() (:883-903) only
 * fires the request when the FoFi box field is visible or `intent_fofi_id` is
 * set. On the voicecall overview `intent_fofi_id` is ALWAYS "" because
 * getUserAssignedItems hardcodes `fofi: []` for servkey "voicecall"
 * (CustomerServiceItems.php:27-29). So native's Submit matches neither branch
 * and silently does nothing. That is an Android bug, not a backend rule, and
 * it is deliberately not ported.
 *
 * @param {object} payload
 * @param {string} payload.username   the CUSTOMER id (native's inversion again)
 * @param {string} payload.loginuname the logged-in OPERATOR username
 * @param {string[]} payload.services from resolveVoicePlanServices()
 * @param {string} [payload.fofiboxid] only when a box is genuinely in play
 * @returns {Promise<object>} {status, body:{voipno}}
 */
export async function provisionVoiceNumber(payload) {
    const url = `${getBaseUrl()}ServiceApis/upgradeRegistration`;

    const body = {
        username: payload.username || "",
        loginuname: payload.loginuname || "",
        services: Array.isArray(payload.services) && payload.services.length > 0
            ? payload.services
            : [VOICE_SERVICE_KEY],
    };
    // Sent only when a box is real — an empty string would drag
    // `chk__fofiboxid` into play for plans whose subscriptions include "fofi".
    if (payload.fofiboxid) body.fofiboxid = payload.fofiboxid;

    logger.debug("Voice", "provisionVoiceNumber request", {
        username: body.username, services: body.services,
    });

    const resp = await apiFetch(url, {
        method: "POST",
        headers: getHeadersJson(),
        body: JSON.stringify(body),
    }, "provisionVoiceNumber", { group: "Voice", timeout: UPLOAD_TIMEOUT });

    if (!resp.ok) {
        throw new Error(`Failed to register the voice line: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    logger.debug("Voice", "provisionVoiceNumber response", {
        errCode: data?.status?.err_code, allocated: !!data?.body?.voipno,
    });
    return data;
}

/**
 * Backend error strings -> something an operator can act on.
 *
 * "Please choose fofiboxid" is the voicecall arm's message for a MISSING
 * VOIPNUMBER (ServiceApis.php:2803 — copy-pasted from the fofi arm above it
 * and never re-worded). Passing it through tells the operator to go find a
 * box, which is the wrong instruction, and is how the Fo-Fi hand-off that
 * shipped on this screen came to exist in the first place.
 */
export function describeVoiceError(errMsg, fallback) {
    const raw = String(errMsg || "").trim();
    if (!raw) return fallback || "The backend rejected this request.";
    if (raw.toLowerCase().includes("please choose fofiboxid")) {
        return "This customer has no registered VOIP number yet.";
    }
    return raw;
}
