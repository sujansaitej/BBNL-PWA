/**
 * VoiceService — the operator-side Voice Call ("voicecall") customer overview.
 *
 * Direct port of the Android app's voicecall branch of
 * CustomerCompleteOverviewFragment (crmapp-new-master, `employee` flavour).
 * Every API call, every field name and every enable/disable rule below has a
 * line reference back to that fragment; nothing here is invented.
 *
 *   1. getUserAssignedItems {servkey:"voicecall", userid}          (:598-601)
 *        body.voip[].product_name → the VOIP numbers; first one is selected
 *        (:740-742). body.fofi[] is ALWAYS EMPTY on this service key — the
 *        backend hardcodes it (CustomerServiceItems.php:27-29), so the box
 *        picker below is defensive, not a normal state.
 *   2. getMyPlanDetails, case "voicecall"                          (:1443-1456)
 *        ONLY when a VOIP number exists. With none, native shows the
 *        "not opted" text plus the upgrade CTA and makes no call at all.
 *   3. "Pay Bill"  → loadPaymentInfo()                             (:442, :518)
 *        carries userid / serviceid / servicekey / username / planid / price /
 *        selected_fofi_id / selected_voip_id into the payment screen.
 *   4. "Upgrade Plan" → checkUserStatus() then the plan list       (:327-329)
 *
 * The upgrade leg keeps native's THREE screens rather than collapsing them:
 *   CustomerCompleteOverviewFragment  → view 'overview'
 *   AddServicesToCustomerActivity     → view 'upgrade-plans'
 *   ServiceSubscriptionsActivity      → view 'subscription'
 *   RegistrationPaymentOverviewActivity → /voice-payment
 * Tapping a plan row does NOT pay — native starts the subscription screen with
 * the plan on the intent (ServicePlansListAdapter:299-314) and does all the
 * work at Submit. handleSubmitSubscription() reproduces that branch.
 *
 * Renewal button state is `body.other_service_renewal.btn_status` (:936-943) —
 * "disable" hides it in native; here it disables it and surfaces the reason,
 * so the operator is never left staring at a card with no action on it.
 *
 * THE UPGRADE CTA IS ALWAYS AVAILABLE, in every state of this screen.
 * That is native's behaviour and it is a privilege question, not a UI one:
 *   • no VOIP number  → getMyPlanDetails is skipped and `upgradeNonMultiBtn`
 *     is shown alongside the not-opted text (:1450-1452).
 *   • plan loaded     → `upgradePlanIndividual` is set VISIBLE on BOTH arms of
 *     the voicecall branch (:928, :934); the first arm's guard
 *     (`planid empty && body == null`) can never be true, since `body` is
 *     dereferenced to evaluate it.
 * An earlier revision of this screen hid the CTA whenever the customer had
 * neither a VOIP number nor a FoFi box and offered a hand-off to the Fo-Fi
 * page instead. Per (1) that condition is true for EVERY customer without a
 * line, so the operator — the person the backend's message tells the customer
 * to contact — was the one being locked out. The prerequisite it claimed was
 * never real either: upgradeRegistration takes no box for a voicecall-only
 * service list.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, FunnelIcon, MagnifyingGlassIcon, PhoneIcon } from "@heroicons/react/24/outline";
import ServiceSelectionModal from "../../components/ui/ServiceSelectionModal";
import BottomNav from "../../components/BottomNav";
import { getUserAssignedItems, getMyPlanDetails } from "../../services/generalApis";
// Everything voice comes from the voice module — including the two endpoints
// that happen to be shared with FoFi, which voiceApis fronts under voice names
// so this screen has no FoFi-shaped dependency at all.
import {
  VOICE_SERVICE_KEY,
  extractVoicePlans,
  resolveVoiceServiceId,
  getVoicePaymentInfo,
  provisionVoiceNumber,
  resolveVoicePlanServices,
  describeVoiceError,
  checkVoiceUpgradeAllowed,
  getVoicePlanCatalog,
} from "../../services/voiceApis";
import { canonicalServiceKey } from "../../constants/services";
import { loadKycWithRetry } from "../../utils/kycRetry";
import { lsGetStale, lsRemove } from "../../services/lsCache";
import { refreshServiceController } from "../../services/navigationController";
import { getUser } from "../../services/safeStorage";
import { formatCustomerId } from "../../services/helpers";
import { useToast } from "@/components/ui/Toast";

const OVERVIEW_TTL = 10 * 60 * 1000; // 10 min — same as the peer service pages

/** body.voip / body.fofi rows → their product_name strings, de-duplicated. */
function productNames(bucket) {
  if (!Array.isArray(bucket)) return [];
  const seen = new Set();
  const out = [];
  for (const row of bucket) {
    const name = String(row?.product_name ?? row ?? "").trim();
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

/**
 * The plan row to render. Native's loadIndividualDetails() walks
 * subscribed_services and lets the LAST entry carrying a planname win; we
 * prefer the entry whose servicekey actually resolves to voice and fall back
 * to that native rule, so a bundled response can't show the box's plan here.
 */
function pickVoiceSubscription(planResponse) {
  const rows = planResponse?.body?.subscribed_services;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const voiceRow = rows.filter((r) => canonicalServiceKey(r?.servicekey) === "voice" && r?.planname);
  if (voiceRow.length > 0) return voiceRow[voiceRow.length - 1];
  const named = rows.filter((r) => r?.planname);
  return named.length > 0 ? named[named.length - 1] : null;
}

export default function VoiceService() {
  const { customerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const customerData = location.state?.customer;
  const servicesFromState = location.state?.services || [];
  const userid = customerData?.customer_id || customerId;

  // Flags set by a successful return from the payment screen.
  const refreshData = location.state?.refreshData;
  const paymentSuccess = location.state?.paymentSuccess;

  const [showServiceModal, setShowServiceModal] = useState(false);
  // Native's three screens on this flow, as views:
  //   overview      → CustomerCompleteOverviewFragment (voicecall branch)
  //   upgrade-plans → AddServicesToCustomerActivity
  //   subscription  → ServiceSubscriptionsActivity ("Services Subscription")
  const [view, setView] = useState("overview");
  // The plan row tapped on the list — native puts it on the intent and reads
  // it back through AppManager.getSelectedPlan().
  const [chosenPlan, setChosenPlan] = useState(null);

  // Instant first paint from the last good response, except right after a
  // payment — there the cache still holds the pre-payment plan and expiry.
  const useCacheForRender = !refreshData;
  const cachedAI = (useCacheForRender && userid) ? lsGetStale(`uai_${VOICE_SERVICE_KEY}_${userid}`, OVERVIEW_TTL) : null;

  const [assignedItems, setAssignedItems] = useState(cachedAI?.data || null);
  const [planDetails, setPlanDetails] = useState(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [renewalStatusReady, setRenewalStatusReady] = useState(false);
  const [error, setError] = useState("");
  // getUserAssignedItems failed. Kept apart from `error` because the plan
  // effect clears that on its own success, and these are different failures.
  const [connectionsFailed, setConnectionsFailed] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [servid, setServid] = useState("");

  // Operator-chosen ids. Native keeps these as mutable fragment fields driven
  // by the two spinners, and re-runs getMyPlanDetails on every change.
  const [selectedVoipId, setSelectedVoipId] = useState("");
  const [selectedFofiId, setSelectedFofiId] = useState("");

  // Upgrade plan list
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradePlans, setUpgradePlans] = useState([]);
  const [planSearch, setPlanSearch] = useState("");

  const voipNumbers = useMemo(
    () => productNames(assignedItems?.body?.voip),
    [assignedItems]
  );
  const fofiBoxes = useMemo(
    () => productNames(assignedItems?.body?.fofi),
    [assignedItems]
  );

  // ── Step 1: assigned items ────────────────────────────────────────────
  useEffect(() => {
    refreshServiceController();

    if (refreshData && userid) {
      try {
        lsRemove(`uai_${VOICE_SERVICE_KEY}_${userid}`);
        lsRemove(`plandets_${VOICE_SERVICE_KEY}_${userid}_`);
      } catch (_) { /* best-effort */ }
    }

    if (!userid) return;
    let cancelled = false;

    // servid is needed by the payment screen, not by this render — fetch it
    // alongside rather than gating anything on it.
    resolveVoiceServiceId(servicesFromState)
      .then((id) => { if (!cancelled) setServid(id); })
      .catch(() => {});

    (async () => {
      try {
        const ai = await getUserAssignedItems(VOICE_SERVICE_KEY, userid, !!refreshData);
        if (cancelled) return;
        setAssignedItems(ai);
      } catch (err) {
        if (cancelled) return;
        if (String(err?.message || "").includes("navigated away")) return;
        console.error("Voice: failed to load assigned items", err);
        // Seeding an empty list keeps the plan effect (and its backend
        // message) reachable, but it is a PLACEHOLDER, not an answer — the
        // real VOIP list is unknown. `connectionsFailed` says so, because the
        // plan call succeeding afterwards used to clear `error` and leave the
        // screen claiming, confidently, that a customer we could not read has
        // no voice line.
        setConnectionsFailed(true);
        setAssignedItems({ body: { voip: [], fofi: [] } });
        setError("Failed to load the customer's voice connections.");
        setPlanLoading(false);
        setRenewalStatusReady(true);
      }
    })();

    if (refreshData || paymentSuccess) {
      try {
        const cleaned = {
          ...(window.history.state || {}),
          usr: { ...((window.history.state && window.history.state.usr) || {}), refreshData: false, paymentSuccess: false },
        };
        window.history.replaceState(cleaned, document.title, window.location.pathname + window.location.search);
      } catch (_) { /* defensive */ }
    }

    return () => { cancelled = true; };
  }, [userid, refreshData, paymentSuccess]);

  // The selections native's two spinners hold, DERIVED rather than seeded
  // into state by an effect.
  //
  // Deriving matters: an effect that seeds `selectedVoipId` lands one render
  // after `assignedItems` arrives, so the plan effect below would run once
  // with an empty selection, take the "not opted" branch, and flash that card
  // before correcting itself. Computing it in the same render as the data
  // removes that window entirely. `selected*Id` now only ever carries the
  // operator's explicit override.
  //
  // Defaults follow native's populateSpinner: the VOIP number always falls
  // back to the first row (:740-742); the FoFi box only auto-selects when the
  // customer has exactly ONE (:710-712) — with several, the box changes what
  // the plan call returns, so native waits for a deliberate pick.
  const effectiveVoipId = (selectedVoipId && voipNumbers.includes(selectedVoipId))
    ? selectedVoipId
    : (voipNumbers[0] || "");
  const effectiveFofiId = (selectedFofiId && fofiBoxes.includes(selectedFofiId))
    ? selectedFofiId
    : (fofiBoxes.length === 1 ? fofiBoxes[0] : "");

  // ── Step 2: plan details ──────────────────────────────────────────────
  //
  // Native SKIPS this call when there is no VOIP number
  // (CustomerCompleteOverviewFragment:1443) and paints `notOptedMultiTxt` from
  // `indivial_notOpted` — a field it never actually assigns, so the native
  // not-opted card is blank. We call it anyway, because the backend answers
  // err_code 0 for a line-less customer and hands back the ONLY accurate
  // explanation of what to do next. Verified live on staging 2026-08-18 for
  // `testrag4` (voip:[] fofi:[] internet:[]):
  //
  //   other_service_renewal: { btn_status: "disable",
  //     message: "Please contact operator to upgrade voicecall services plan" }
  //
  // One extra read, and the operator gets the server's words instead of ours.
  useEffect(() => {
    if (!userid || !assignedItems) return;

    let cancelled = false;
    setPlanLoading(true);
    setRenewalStatusReady(false);

    getMyPlanDetails({
      servicekey: VOICE_SERVICE_KEY,
      userid,
      fofiboxid: effectiveFofiId,
      voipnumber: effectiveVoipId,
    }, !!refreshData)
      .then((plan) => {
        if (cancelled) return;
        setPlanDetails(plan);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        if (String(err?.message || "").includes("navigated away")) return;
        console.error("Voice: failed to load plan details", err);
        setError("Failed to load the voice plan details.");
      })
      .finally(() => {
        if (cancelled) return;
        setPlanLoading(false);
        setRenewalStatusReady(true);
      });

    return () => { cancelled = true; };
  }, [userid, assignedItems, effectiveVoipId, effectiveFofiId, refreshData]);

  // ── Derived view data ─────────────────────────────────────────────────
  const subscription = pickVoiceSubscription(planDetails);
  const planName = subscription?.planname || "N/A";
  const expiryDate = subscription?.expirydate || "N/A";
  const serviceName = subscription?.title || "Voice Call";
  const planId = planDetails?.body?.planid || "";
  const priceId = planDetails?.body?.priceid || "";

  const renewalStatus = String(planDetails?.body?.other_service_renewal?.btn_status || "").toLowerCase();
  // The reason field is `message`, NOT `err_msg`. Verified live on staging
  // 2026-08-17 — a freshly renewed customer comes back as
  //   {"btn_status":"disable",
  //    "message":"Your plan has still 30 more no of days to expire,
  //               you can renew before 10 days"}
  // Reading err_msg here returned undefined, so the operator saw a greyed-out
  // PAY BILL with no explanation — which is the dead-end this screen is
  // supposed to avoid. `err_msg` is kept as a fallback only because the peer
  // screens assume it and the backend is not consistent across endpoints.
  const renewalDisabledReason =
    planDetails?.body?.other_service_renewal?.message ||
    planDetails?.body?.other_service_renewal?.err_msg ||
    "";
  const isRenewalDisabled = !renewalStatusReady || renewalStatus !== "enable";

  // Native's "not opted" state: no VOIP number assigned to this customer.
  const notOpted = !!assignedItems && voipNumbers.length === 0;

  // NOTE — there is deliberately no `canQuoteVoice` predicate here, because
  // native has no equivalent: it gates nothing on whether a quote will be
  // accepted, it just runs its flow and lets Submit register what is missing.
  //
  // The one this replaced (`voipNumbers.length > 0 || fofiBoxes.length > 0`)
  // could not have worked anyway, for two reasons only the backend source
  // makes visible:
  //   • `fofiBoxes` is ALWAYS empty here — CustomerServiceItems.php:27-29
  //     returns a hardcoded `fofi: []` for servkey "voicecall". So the
  //     predicate really read "has a VOIP row", and its false branch was the
  //     one every line-less customer took.
  //   • `voipNumbers` being non-empty does not mean billable either: it comes
  //     from `voipnumbers.extensionno` (getUserAllotedVoipNumbersSip) while
  //     the payment gate `chk__voip` checks `voip_customers.sel_mob_no`
  //     (voipDetails). Different tables — which is why `test40` and `hgggggg`
  //     show a number and still fail with "User ID is not registered in
  //     voip!". Submit's registration call is what reconciles the two.

  // The backend's own words, never ours. Falls back only if it says nothing.
  const notOptedMessage =
    renewalDisabledReason ||
    planDetails?.status?.err_msg ||
    "This customer has no voice connection yet.";

  const cableDetails = customerData ? { body: { op_id: customerData.op_id } } : null;

  // ── Actions ───────────────────────────────────────────────────────────
  const payBillInFlightRef = useRef(false);

  /**
   * Ask for the quote BEFORE leaving this screen, and only navigate if the
   * backend actually issued one.
   *
   * WHY THIS EXISTS — there is no client-side signal that predicts whether a
   * customer can be billed for voice. Verified live on staging 2026-08-18,
   * all four voice customers, all with a `voip[]` row from
   * getUserAssignedItems:
   *
   *   namich    voip ✓ → paymentinfo err_code 0  (quotable)
   *   test40    voip ✓ → err_code 1 "User ID is not registered in voip!"
   *   hgggggg   voip ✓ → err_code 1 "User ID is not registered in voip!"
   *   testrag4  voip ✗ → err_code 1 "Please choose fofiboxid"
   *
   * So an assigned VOIP number does NOT mean the line is registered for
   * billing — that state lives only in the backend. Guessing from
   * `voip.length` (which is what an earlier version did) sent the operator
   * two screens deep to be rejected there.
   *
   * The provisioning decision is NOT made here — it is made at Submit on the
   * subscription screen, which is where native makes it
   * (ServiceSubscriptionsActivity:715-726). By the time this runs, `voipnumber`
   * is already the number the order will be placed against.
   *
   * Same calls, same order, same payload — the quote just happens here instead
   * of on the next screen, so the backend's own message lands on the button the
   * operator actually pressed. The quote is handed forward so the payment
   * screen does not reserve a second transaction on mount.
   */
  const quoteThenNavigate = async ({ planid, priceid, servid, planName, mode, voipnumber }) => {
    const loginuname = getUser()?.username || "";

    const resp = await getVoicePaymentInfo({
      fofi_box_id: effectiveFofiId,
      planid: String(planid || ""),
      priceid: String(priceid || ""),
      servid: String(servid || ""),
      userid,
      username: loginuname,
      voipnumber: voipnumber ?? effectiveVoipId,
    });

    if (resp?.status?.err_code !== 0 || !resp?.body?.transactionid) {
      // The backend's words, on the screen the operator is already on —
      // minus the one string that names the wrong prerequisite.
      toast.add(
        describeVoiceError(
          resp?.status?.err_msg,
          "This customer cannot be billed for voice right now."
        ),
        { type: "error", duration: 7000 }
      );
      return false;
    }

    navigate("/voice-payment", {
      state: {
        customer: customerData,
        customerId,
        userid,
        servid: String(servid || ""),
        servicekey: VOICE_SERVICE_KEY,
        // The number the quote was actually issued against — which, after a
        // registration round, is NOT the one the picker was showing.
        voipnumber: voipnumber ?? effectiveVoipId,
        fofi_box_id: effectiveFofiId,
        planid: String(planid || ""),
        priceid: String(priceid || ""),
        planName,
        services: servicesFromState,
        cableDetails,
        mode,
        // Pre-fetched so VoicePayment does not reserve a second transaction
        // just to render the same numbers.
        quote: resp,
      },
    });
    return true;
  };

  /**
   * Pay Bill → the review screen. Native re-reads nothing here, but the peer
   * PWA screens re-verify the renewal flag immediately before navigating
   * because the operator can sit on this page for minutes; keeping that is
   * strictly safer than native and costs one call.
   */
  const handlePayBill = async () => {
    if (payBillInFlightRef.current) return;
    payBillInFlightRef.current = true;

    let latestPlan = planDetails;
    try {
      const fresh = await getMyPlanDetails({
        servicekey: VOICE_SERVICE_KEY,
        userid,
        fofiboxid: effectiveFofiId,
        voipnumber: effectiveVoipId,
      }, true);
      if (fresh?.status?.err_code === 0) {
        latestPlan = fresh;
        setPlanDetails(fresh);
      }
    } catch (err) {
      console.error("Voice: unable to verify renewal status", err);
      toast.add("Unable to verify payment status. Please try again.", { type: "error" });
      payBillInFlightRef.current = false;
      return;
    }

    const latestStatus = String(latestPlan?.body?.other_service_renewal?.btn_status || "").toLowerCase();
    if (latestStatus === "disable") {
      // `message` first — see renewalDisabledReason above.
      toast.add(
        latestPlan?.body?.other_service_renewal?.message ||
        latestPlan?.body?.other_service_renewal?.err_msg ||
        "Renewal is not available for this customer right now.",
        { type: "error" }
      );
      payBillInFlightRef.current = false;
      return;
    }

    const resolvedServid = servid || (await resolveVoiceServiceId(servicesFromState));
    if (!resolvedServid) {
      toast.add("Voice service is not provisioned for this operator.", { type: "error" });
      payBillInFlightRef.current = false;
      return;
    }

    try {
      await quoteThenNavigate({
        planid: latestPlan?.body?.planid || planId,
        priceid: latestPlan?.body?.priceid || priceId,
        servid: resolvedServid,
        planName: pickVoiceSubscription(latestPlan)?.planname || planName,
        mode: "renewal",
      });
    } catch (err) {
      console.error("Voice: pay-bill quote failed", err);
      toast.add("Could not load the payment details. Please try again.", { type: "error" });
    } finally {
      payBillInFlightRef.current = false;
    }
  };

  /**
   * Upgrade Plan. Native (:327-329) runs validateBeforeFofiBoxReg FIRST and
   * only opens the plan list when it comes back err_code 0 — the same gate is
   * used by the not-opted CTA, which is why both buttons land here.
   */
  const handleUpgradeClick = async () => {
    if (upgradeLoading) return;
    setUpgradeLoading(true);
    try {
      const loginuname = getUser()?.username || "";
      // `username` carries the CUSTOMER id here — that inversion is native's,
      // not a typo (checkUserStatus() sets username=userid, loginuname=operator).
      const check = await checkVoiceUpgradeAllowed({ username: userid, loginuname });
      if (check?.status?.err_code !== 0) {
        toast.add(check?.status?.err_msg || "This customer cannot be upgraded right now.", { type: "error" });
        return;
      }

      const plansResp = await getVoicePlanCatalog({ userid, logUname: loginuname });
      if (plansResp?.status?.err_code !== 0) {
        toast.add(plansResp?.status?.err_msg || "Could not load voice plans.", { type: "error" });
        return;
      }

      const plans = extractVoicePlans(plansResp);
      if (plans.length === 0) {
        toast.add("No voice plans are available for this operator.", { type: "info" });
        return;
      }
      setUpgradePlans(plans);
      setPlanSearch("");
      setView("upgrade-plans");
    } catch (err) {
      console.error("Voice: upgrade plan load failed", err);
      toast.add("Could not load voice plans. Please try again.", { type: "error" });
    } finally {
      setUpgradeLoading(false);
    }
  };

  /**
   * Tapping a plan row. Native, ServicePlansListAdapter (:299-314), does NOT
   * pay from here — it starts ServiceSubscriptionsActivity with the plan on
   * the intent. So this only records the choice and opens that screen; the
   * network happens at Submit, exactly as it does natively.
   */
  const handleSelectUpgradePlan = (plan) => {
    const nextServid = String(plan?.servid || servid || "");
    if (!nextServid) {
      toast.add("This plan is missing its service id. Please contact support.", { type: "error" });
      return;
    }
    setChosenPlan({ ...plan, servid: nextServid });
    setView("subscription");
  };

  /**
   * SUBMIT on the subscription screen — native's onViewClicked / btn_submit
   * for the isupgrade + isvoicecallreq case (ServiceSubscriptionsActivity
   * :715-726), reproduced branch for branch:
   *
   *     if (intent_voip != "" && intent_fofi_id != "")  GotoUpgradePayment();
   *     else                                            requesrServerPlanUpgradation();
   *
   * and on that call's success (:1242-1246):
   *
   *     intent_voip = response.body.voipno;  GotoUpgradePayment();
   *
   * Note what the first branch requires: BOTH ids. `intent_fofi_id` is fed
   * from getUserAssignedItems, which hardcodes `fofi: []` for servkey
   * "voicecall" (CustomerServiceItems.php:27-29) — so on this screen the
   * condition is false for every customer and native ALWAYS takes the
   * register branch. That is not a corner case; it is the normal path, and
   * upgradeRegistration is idempotent (Voip_model::addCustomer only inserts
   * when voipDetails() is empty, and the response reads voipDetails() back
   * either way), so a customer who already has a number simply gets it
   * returned.
   *
   * The ONE thing not copied: native's requesrServerPlanUpgradation() wraps
   * the request in `if (fofi field visible) … else if (intent_fofi_id != "")`,
   * so with neither present it reaches no branch and Submit silently does
   * nothing. Sending the request unconditionally is what makes the button
   * work; the backend asks for no box on a voicecall-only service list
   * (CustomerUpgradeRegistration.php:66-74).
   */
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitSubscription = async () => {
    if (submitting || !chosenPlan) return;
    setSubmitting(true);
    try {
      const loginuname = getUser()?.username || "";
      let voipnumber = effectiveVoipId;

      if (!(voipnumber && effectiveFofiId)) {
        const reg = await provisionVoiceNumber({
          username: userid,
          loginuname,
          services: resolveVoicePlanServices(chosenPlan),
          fofiboxid: effectiveFofiId,
        });

        // Native toasts err_msg and only proceeds on err_code 0 (:1239-1246).
        // The extra check is `body.voipno` actually being there: err_code 0
        // with an empty body means the `services` list matched no branch of
        // _checkGroupRegistrations, so nothing was registered and the payment
        // call would fail on a blank number two screens later.
        const allocated = reg?.status?.err_code === 0 ? (reg?.body?.voipno || "") : "";
        if (!allocated) {
          toast.add(
            describeVoiceError(
              reg?.status?.err_msg,
              "Could not register a voice line for this customer."
            ),
            { type: "error", duration: 7000 }
          );
          return;
        }

        voipnumber = String(allocated);
        setSelectedVoipId(voipnumber);
        // The overview is now stale in two places: the VOIP list and the plan
        // row. Drop both so returning here reloads against the line that now
        // exists.
        try {
          lsRemove(`uai_${VOICE_SERVICE_KEY}_${userid}`);
          lsRemove(`plandets_${VOICE_SERVICE_KEY}_${userid}_`);
        } catch (_) { /* best-effort */ }
      }

      await quoteThenNavigate({
        planid: chosenPlan?.planid,
        priceid: chosenPlan?.priceid,
        servid: chosenPlan?.servid,
        planName: chosenPlan?.planname || "",
        mode: "upgrade",
        voipnumber,
      });
    } catch (err) {
      console.error("Voice: subscription submit failed", err);
      toast.add("Could not complete the request. Please try again.", { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleServiceSelect = (service) => {
    setShowServiceModal(false);
    if (!service) return;
    const serviceId = (service.id || "").toLowerCase();
    const serviceName2 = (service.name || "").toLowerCase();
    const go = (path) => navigate(path, { replace: true, state: { customer: customerData, services: servicesFromState } });

    if (serviceId === "iptv" || serviceName2.includes("cable") || serviceName2.includes("iptv")) {
      go(`/customer/${customerId}/service/iptv`);
    } else if (serviceId === "internet" || serviceName2.includes("internet")) {
      go(`/customer/${customerId}/service/internet`);
    } else if (serviceId === "fofi-smart-box" || serviceName2.includes("fofi") || serviceName2.includes("fo-fi") || serviceName2.includes("smart box")) {
      go(`/customer/${customerId}/service/fofi-smart-box`);
    }
  };

  const handleOrderHistory = () => {
    navigate("/payment-history", {
      state: { customer: customerData, cableDetails, serviceType: "voice" },
    });
  };

  const uploadRequestInFlightRef = useRef(false);
  const handleUploadDocument = async () => {
    if (uploadRequestInFlightRef.current) return;
    uploadRequestInFlightRef.current = true;
    setUploadLoading(true);
    try {
      const cid = customerData?.customer_id || userid;
      const response = await loadKycWithRetry({ cid, reqtype: "update" });
      if (response?.status?.err_code === 0) {
        navigate("/upload-documents", { state: { customer: customerData, kycData: response.body } });
      } else {
        toast.add("Failed to load documents: " + (response?.status?.err_msg || "Unknown error"), { type: "error" });
      }
    } catch (err) {
      console.error("Voice: document preview failed", err);
      toast.add("Failed to load documents. Please try again.", { type: "error" });
    } finally {
      setUploadLoading(false);
      uploadRequestInFlightRef.current = false;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!customerData) {
    return (
      <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
        <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
          <button onClick={() => navigate(-1)} className="p-1 mr-3"><ArrowLeftIcon className="h-6 w-6 text-white" /></button>
          <h1 className="text-lg font-medium text-white">Customer OverView</h1>
        </header>
        <div className="flex-1 px-3 py-4">
          <div className="text-center text-gray-500 dark:text-gray-400 py-10">
            No customer data available. Please select a customer from the customer list.
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  // ── ServiceSubscriptionsActivity, voicecall subset ────────────────────
  //
  // Native's layout (activity_service_subscriptions.xml) for this case is:
  //   "Plan Type    : " + selectedServiceType   → "Voice Plan" (:362)
  //   "Plan Name  : "   + selectedPlan          → planname     (:365)
  //   voip_upgrade block, shown by handleViews("voicecall") (:540-545) ONLY
  //     when isupgrade && intent_voip != "" — a read-only "VOIP Number" field
  //     (android:editable="false"), never an input
  //   Submit
  // Nothing else on that screen applies to a voice-only plan: the fofi and
  // internet blocks are driven by `subscriptions`, which for these plans is
  // ["voicecall"].
  if (view === "subscription") {
    return (
      <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
        <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
          <button onClick={() => setView("upgrade-plans")} className="p-1 mr-3" aria-label="Back">
            <ArrowLeftIcon className="h-6 w-6 text-white" />
          </button>
          <h1 className="text-lg font-medium text-white">Services Subscription</h1>
        </header>

        <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 space-y-2 text-sm">
            <div className="flex">
              <span className="w-28 shrink-0 text-gray-700 dark:text-gray-300">Plan Type</span>
              <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: Voice Plan</span>
            </div>
            <div className="flex">
              <span className="w-28 shrink-0 text-gray-700 dark:text-gray-300">Plan Name</span>
              <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {chosenPlan?.planname || "N/A"}</span>
            </div>
            <div className="flex">
              <span className="w-28 shrink-0 text-gray-700 dark:text-gray-300">Plan Rate</span>
              <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: ₹{chosenPlan?.planrate ?? "0"}</span>
            </div>
          </div>

          {/* The voip_upgrade block: present only when the customer already
              has a number, read-only, exactly as native has it. When there is
              none, native shows nothing here — the number does not exist yet,
              and Submit is what brings it into being. */}
          {effectiveVoipId ? (
            <div className="space-y-2">
              <h3 className="text-orange-500 font-semibold text-sm">VOIP</h3>
              <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">VOIP Number</p>
                <p className="text-gray-800 dark:text-gray-200 text-base break-all">{effectiveVoipId}</p>
              </div>
            </div>
          ) : null}

          <button
            onClick={handleSubmitSubscription}
            disabled={submitting}
            className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-lg text-sm shadow-md"
          >
            {submitting ? "Please wait..." : "SUBMIT"}
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  if (view === "upgrade-plans") {
    const filtered = upgradePlans.filter((p) =>
      String(p?.planname || "").toLowerCase().includes(planSearch.toLowerCase())
    );
    return (
      <div className="min-h-dvh flex flex-col bg-white dark:bg-gray-900 pb-safe">
        <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
          <button onClick={() => setView("overview")} className="p-1 mr-3"><ArrowLeftIcon className="h-6 w-6 text-white" /></button>
          <h1 className="text-lg font-medium text-white">Voice Plans</h1>
        </header>

        <div className="px-4 pt-4 pb-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search Plans"
              value={planSearch}
              onChange={(e) => setPlanSearch(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md py-2.5 pl-4 pr-12 text-gray-800 dark:text-white text-base bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-indigo-600 text-base font-semibold">All Plans</h2>
        </div>

        <div className="flex-1 pb-24">
          {filtered.length > 0 ? filtered.map((plan, idx) => (
            <button
              type="button"
              key={`${plan?.planid || idx}_${plan?.priceid || ""}`}
              onClick={() => handleSelectUpgradePlan(plan)}
              className="w-full text-left flex items-center px-4 py-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
            >
              <div className="flex-1 min-w-0 pr-4">
                <div className="text-indigo-600 font-semibold text-base break-words mb-1">{plan?.planname || "Voice Plan"}</div>
                <div className="text-gray-700 dark:text-gray-300 text-base">₹{plan?.planrate ?? "0"}</div>
              </div>
              <svg width="10" height="16" fill="none" stroke="#ff6f00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 10 16" className="shrink-0">
                <path d="M2 2l6 6-6 6" />
              </svg>
            </button>
          )) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-gray-500 text-base">No plans found</p>
            </div>
          )}
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
      <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
        <button onClick={() => navigate(-1)} className="p-1 mr-3"><ArrowLeftIcon className="h-6 w-6 text-white" /></button>
        <h1 className="text-lg font-medium text-white">Customer OverView</h1>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
        {/* User Details */}
        <div className="space-y-3">
          <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
            User Details
          </h3>
          <div className="space-y-1 text-sm">
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Username</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {formatCustomerId(customerData.customer_id)}</span>
            </div>
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Customer Name</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {customerData.name || "-"}</span>
            </div>
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Ph Number</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {customerData.mobile || "-"}</span>
            </div>
            <div className="flex">
              <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Email Id</span>
              <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {customerData.email || "-"}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleUploadDocument}
            disabled={uploadLoading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadLoading ? "Loading..." : "Upload Document"}
          </button>
          <button
            onClick={handleOrderHistory}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm shadow-md hover:shadow-lg"
          >
            Order History
          </button>
        </div>

        {/* Filter badge */}
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 -mx-4">
          <div className="flex items-center gap-2">
            <span className="text-base text-indigo-600 font-semibold">Filtered by :</span>
            <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-md">
              Voice Call
            </span>
          </div>
          <button onClick={() => setShowServiceModal(true)} className="text-indigo-600 hover:text-indigo-700">
            <FunnelIcon className="w-6 h-6" />
          </button>
        </div>

        {/* VOIP number — a dropdown only when the customer has more than one,
            mirroring native's populateSpinner enable/disable rule. */}
        {voipNumbers.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
              <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
              VOIP Number
            </h3>
            {voipNumbers.length === 1 ? (
              <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-none dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700">
                <p className="text-indigo-600 font-semibold text-base break-all">{voipNumbers[0]}</p>
              </div>
            ) : (
              <select
                value={effectiveVoipId}
                onChange={(e) => setSelectedVoipId(e.target.value)}
                className="w-full bg-white dark:bg-gray-800 border border-indigo-200 dark:border-gray-700 rounded-xl px-4 py-3 text-indigo-600 font-semibold text-base"
              >
                {voipNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Linked FoFi box — part of the plan lookup and of the payment
            payload (`fofi_box_id`), so the operator must be able to see and
            change which one is in play when there is more than one. */}
        {fofiBoxes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
              <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
              FoFi Box ID
            </h3>
            {fofiBoxes.length === 1 ? (
              <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-none dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700">
                <p className="text-indigo-600 font-semibold text-base break-all">{fofiBoxes[0]}</p>
              </div>
            ) : (
              <select
                value={effectiveFofiId}
                onChange={(e) => setSelectedFofiId(e.target.value)}
                className="w-full bg-white dark:bg-gray-800 border border-indigo-200 dark:border-gray-700 rounded-xl px-4 py-3 text-indigo-600 font-semibold text-base"
              >
                <option value="">Select box id</option>
                {fofiBoxes.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Plan section */}
        {planLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-gray-500 dark:text-gray-400 text-sm">Loading plan details...</span>
          </div>
        ) : (connectionsFailed || error) ? (
          /* Checked BEFORE `notOpted`. A failed getUserAssignedItems leaves us
             with zero VOIP numbers, which is indistinguishable from a customer
             who genuinely has none — telling the operator "no voice connection"
             after a network error would be a lie they'd act on, and offering
             ADD VOICE PLAN on top of it would have them register a line for a
             customer who may already have one. */
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 space-y-4">
            <p className="text-center text-red-500 text-sm">
              {error || "Failed to load the customer's voice connections."}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg text-sm shadow-md"
            >
              Retry
            </button>
          </div>
        ) : notOpted ? (
          /* Native's notOptedMulti view: the backend's message plus
             `upgradeNonMultiBtn` (CustomerCompleteOverviewFragment:1450-1452).
             ONE message, and it is the server's — the sentence we used to add
             underneath it ("a voice plan needs a Fo-Fi Box…") stated a
             prerequisite the backend does not have, and the Fo-Fi hand-off
             beside it sent the operator to a page that could not help.
             The CTA is unconditional: this state is precisely the one the
             operator is meant to resolve, and whether the customer can be
             billed is settled by the backend on plan select, not guessed
             here. */
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 space-y-4">
            <div className="flex items-start gap-3">
              <PhoneIcon className="h-10 w-10 text-indigo-400 shrink-0" />
              <p className="text-sm text-gray-600 dark:text-gray-300">{notOptedMessage}</p>
            </div>
            <button
              onClick={handleUpgradeClick}
              disabled={upgradeLoading}
              className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-lg text-sm shadow-md"
            >
              {upgradeLoading ? "Loading plans..." : "ADD VOICE PLAN"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
              <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
              Current Plan
            </h3>
            <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md border border-gray-100 dark:border-gray-700">
              <div className="flex items-start gap-3">
                <PhoneIcon className="h-12 w-12 text-gray-700 dark:text-gray-300 shrink-0" />
                <div className="flex-1 min-w-0 space-y-2 text-sm">
                  <div className="flex">
                    <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Service Name</span>
                    <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {serviceName}</span>
                  </div>
                  <div className="flex">
                    <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Plan Name</span>
                    <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {planName}</span>
                  </div>
                  <div className="flex">
                    <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Expiry Date</span>
                    <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {expiryDate}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 mt-4">
                <button
                  onClick={handlePayBill}
                  disabled={isRenewalDisabled}
                  className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg text-sm shadow-md"
                >
                  PAY BILL
                </button>
                {/* Native hides Pay Bill when btn_status is "disable" and
                    leaves the card actionable via Upgrade. We keep the button
                    visible but disabled and say why, so a disabled operator
                    account reads as an explanation rather than a missing UI. */}
                {renewalStatusReady && renewalStatus === "disable" && renewalDisabledReason && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 text-center">{renewalDisabledReason}</p>
                )}
                <button
                  onClick={handleUpgradeClick}
                  disabled={upgradeLoading}
                  className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-lg text-sm shadow-md"
                >
                  {upgradeLoading ? "Loading plans..." : "UPGRADE PLAN"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ServiceSelectionModal
        isOpen={showServiceModal}
        onClose={() => setShowServiceModal(false)}
        onSelectService={handleServiceSelect}
        customer={customerData}
        services={servicesFromState}
        currentServiceKey="voice"
        cableDetails={cableDetails}
      />
      <BottomNav />
    </div>
  );
}
