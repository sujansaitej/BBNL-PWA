/** @vitest-environment jsdom */
/**
 * VoiceService / VoicePayment — do they actually RENDER, and do the API calls
 * carry the right arguments?
 *
 * This repo's vitest config says it plainly: it "had NO component tests at
 * all, which is precisely how a broken dropdown shipped twice — the build is
 * green whether or not the thing actually renders." Voice is a brand-new
 * screen replacing a Coming Soon popup, so a green build proves nothing here.
 *
 * The fixtures are the REAL staging responses captured on 2026-08-17 from
 * https://netmontest.bbnl.in/netmon/ (see tools/voice-smoke.cjs), not shapes
 * invented from the Android models.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ── API layer, fully mocked ───────────────────────────────────────────
const getUserAssignedItems = vi.fn();
const getMyPlanDetails = vi.fn();
const getWalBal = vi.fn();
vi.mock("../../services/generalApis", () => ({
  getUserAssignedItems: (...a) => getUserAssignedItems(...a),
  getMyPlanDetails: (...a) => getMyPlanDetails(...a),
  getWalBal: (...a) => getWalBal(...a),
  getServiceList: vi.fn().mockResolvedValue({ status: { err_code: 0 }, body: [] }),
}));

// VoiceService now quotes BEFORE navigating (see quoteThenNavigate) so a
// backend rejection lands on the button the operator pressed. Everything else
// in voiceApis stays real — resolveVoiceServiceId resolves the servid from the
// services list in nav state with no network at all.
const getVoicePaymentInfo = vi.fn();
const provisionVoiceNumber = vi.fn();
vi.mock("../../services/voiceApis", async (orig) => ({
  ...(await orig()),
  getVoicePaymentInfo: (...a) => getVoicePaymentInfo(...a),
  provisionVoiceNumber: (...a) => provisionVoiceNumber(...a),
}));

const getFofiUpgradePlans = vi.fn();
const validateBeforeFofiBoxReg = vi.fn();
vi.mock("../../services/fofiApis", () => ({
  getFofiUpgradePlans: (...a) => getFofiUpgradePlans(...a),
  validateBeforeFofiBoxReg: (...a) => validateBeforeFofiBoxReg(...a),
  killFofiTxn: vi.fn().mockResolvedValue({ status: { err_code: 0 } }),
}));

vi.mock("../../services/lsCache", () => ({
  lsGetStale: () => null,
  lsRemove: () => {},
}));
vi.mock("../../services/navigationController", () => ({ refreshServiceController: () => {} }));
vi.mock("../../utils/kycRetry", () => ({ loadKycWithRetry: vi.fn() }));
vi.mock("../../services/prefetch", () => ({ prioritizeCustomerService: () => {} }));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

import { ToastProvider } from "../../components/ui/Toast";
import VoiceService from "./VoiceService";

// ── REAL staging fixtures (netmontest, 2026-08-17) ────────────────────
// getUserAssignedItems {servkey:"voicecall", userid:"namich"}
const ASSIGNED_WITH_VOIP = {
  status: { err_code: 0, err_msg: "success" },
  body: {
    voip: [{ product_name: "90555100079" }],
    fofi: [],
    internet: [],
  },
};
const ASSIGNED_NO_VOIP = {
  status: { err_code: 0, err_msg: "success" },
  body: { voip: [], fofi: [], internet: [] },
};

// getMyPlanDetails {servicekey:"voicecall", ...} — staging state: a VOIP line
// exists but no plan is attached, so btn_status comes back "disable".
const PLAN_NO_ACTIVE_SUB = {
  status: { err_code: 0, err_msg: "success" },
  body: {
    planid: 0,
    priceid: 0,
    subscribed_services: [
      { servicekey: "voicecall", title: "voicecall", planname: "", expirydate: "", imgurl: "" },
    ],
    other_service_renewal: { btn_status: "disable", err_msg: "Plan not active" },
  },
};

// The same call for a customer WITH an active plan (the shape staging would
// return once a voice plan is attached — planname/expiry populated, renewal
// enabled). Field names are the ones staging already returns above.
const PLAN_ACTIVE = {
  status: { err_code: 0, err_msg: "success" },
  body: {
    planid: "35",
    priceid: "81",
    subscribed_services: [
      {
        servicekey: "voicecall",
        title: "Voice Call",
        planname: "UNLIMITED CALLING",
        expirydate: "15-09-2026 11:59:59 pm",
        imgurl: "",
      },
    ],
    other_service_renewal: { btn_status: "enable", err_msg: "" },
  },
};

// registrationNecessities {moduletype:"upgradation"} — real staging body,
// trimmed to the arrays the adapter reads.
const NECESSITIES = {
  status: { err_code: 0, err_msg: "Success" },
  body: {
    internet_plans: [],
    fofi_plans: [],
    multi_plans: [],
    // `reg_serv_keys` deliberately holds a LABEL here, as in the sample
    // captured on RegistrationNecessityResponseModel:62. netmontest staging
    // currently returns ["voicecall"] for both fields (probed 2026-08-19), so
    // this fixture is the AWKWARD deployment, on purpose — it is the only way
    // to exercise resolveVoicePlanServices() preferring `subscriptions`.
    voicecall_plans: [
      {
        planid: "35", priceid: "81", servid: "5",
        planrate: "100.00", planname: "UNLIMITED CALLING",
        reg_serv_keys: ["Unlimited calls"],
        subscriptions: ["voicecall"],
        payuri: "voicecall",
      },
    ],
  },
};

const CUSTOMER = {
  customer_id: "namich",
  name: "namich sup",
  mobile: "4545667892",
  email: "namchii@gmail.com",
  op_id: "BBNL_AG01",
};

const SERVICES = [
  { id: "1", title: "Cable TV", keyword: "cabletv" },
  { id: "5", title: "Voice Call", keyword: "voicecall" },
];

// ToastProvider is deliberately part of the tree: main.jsx wraps the whole
// router in it, so `useToast()` is never null in the app. Rendering without it
// makes toast.add() throw inside a catch block and turns a handled error path
// into an unhandled rejection — a test-harness artefact, not a product bug.
function show(state = { customer: CUSTOMER, services: SERVICES }) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[{ pathname: "/customer/namich/service/voice", state }]}>
        <Routes>
          <Route path="/customer/:customerId/service/voice" element={<VoiceService />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("user", JSON.stringify({ username: "superadmin", op_id: "BBNL_OP49" }));
  navigate.mockReset();
  getUserAssignedItems.mockReset().mockResolvedValue(ASSIGNED_WITH_VOIP);
  getMyPlanDetails.mockReset().mockResolvedValue(PLAN_ACTIVE);
  getFofiUpgradePlans.mockReset().mockResolvedValue(NECESSITIES);
  validateBeforeFofiBoxReg.mockReset().mockResolvedValue({ status: { err_code: 0, err_msg: "all fields are available" } });
  // Shape from UpgradePlanResponse's own javadoc / CustomerUpgradeRegistration
  // :245-248 — err_code 0 plus the allocated (or pre-existing) number.
  provisionVoiceNumber.mockReset().mockResolvedValue({
    status: { err_code: 0, err_msg: "Registered successfully!" },
    body: { voipno: "08024489123" },
  });
  // Real staging quote body, trimmed (netmontest, plan 35 / price 81).
  getVoicePaymentInfo.mockReset().mockResolvedValue({
    status: { err_code: 0, err_msg: "Success!." },
    body: {
      planname: "UNLIMITED CALLING", planrate: "100.00", total_amt: 118,
      other_amt: 0, balance_amt: "0",
      tax_details: [{ title: "SGST", amt: 9 }, { title: "CGST", amt: 9 }],
      final_split_data: { OPERATOR: { amount: 39.2 } },
      transactionid: "SERV-2608-5-0000200",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VoiceService — it renders (no more Coming Soon)", () => {
  test("renders the overview and never shows a Coming Soon popup", async () => {
    show();
    expect(await screen.findByText("Voice Call")).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  test("queries assigned items with the SERVICE key 'voicecall'", async () => {
    show();
    await waitFor(() => expect(getUserAssignedItems).toHaveBeenCalled());
    // Not "voip" — that is the RESPONSE bucket name, not the servkey.
    expect(getUserAssignedItems.mock.calls[0][0]).toBe("voicecall");
    expect(getUserAssignedItems.mock.calls[0][1]).toBe("namich");
  });

  test("shows the VOIP number from body.voip[].product_name", async () => {
    show();
    expect(await screen.findByText("90555100079")).toBeTruthy();
  });

  test("plan lookup is keyed on the voip number, exactly as native does", async () => {
    show();
    await waitFor(() => expect(getMyPlanDetails).toHaveBeenCalled());
    expect(getMyPlanDetails.mock.calls[0][0]).toEqual({
      servicekey: "voicecall",
      userid: "namich",
      fofiboxid: "",
      voipnumber: "90555100079",
    });
  });

  test("renders the active plan card", async () => {
    show();
    expect(await screen.findByText(/UNLIMITED CALLING/)).toBeTruthy();
    expect(screen.getByText(/15-09-2026/)).toBeTruthy();
    expect(screen.getByText("PAY BILL")).toBeTruthy();
    expect(screen.getByText("UPGRADE PLAN")).toBeTruthy();
  });
});

describe("VoiceService — the renewal gate", () => {
  test("PAY BILL is enabled when other_service_renewal.btn_status is 'enable'", async () => {
    show();
    const btn = await screen.findByText("PAY BILL");
    expect(btn.disabled).toBe(false);
  });

  test("staging's real state (no plan attached) disables PAY BILL and says why", async () => {
    getMyPlanDetails.mockResolvedValue(PLAN_NO_ACTIVE_SUB);
    show();
    const btn = await screen.findByText("PAY BILL");
    expect(btn.disabled).toBe(true);
    // Never a dead end: the reason is visible and UPGRADE PLAN still works.
    expect(screen.getByText("Plan not active")).toBeTruthy();
    expect(screen.getByText("UPGRADE PLAN").disabled).toBe(false);
  });

  test("the reason field is `message`, not `err_msg` — LIVE staging shape", async () => {
    // Captured 2026-08-17 straight after a real renewal on netmontest. Reading
    // err_msg here yields undefined and the operator gets a greyed-out button
    // with no explanation — exactly the dead end this screen exists to avoid.
    getMyPlanDetails.mockResolvedValue({
      status: { err_code: 0, err_msg: "success" },
      body: {
        planid: "35",
        priceid: "81",
        subscribed_services: [{
          servicekey: "voicecall", title: "voicecall",
          planname: "UNLIMITED CALLING", expirydate: "16-09-2026 11:59:59 pm",
        }],
        other_service_renewal: {
          btn_status: "disable",
          message: "Your plan has still 30 more no of days to expire, you can renew before 10 days",
          // note: NO err_msg key at all
        },
      },
    });
    show();
    expect(await screen.findByText(/30 more no of days to expire/)).toBeTruthy();
    expect((await screen.findByText("PAY BILL")).disabled).toBe(true);
  });

  test("PAY BILL re-verifies, then navigates with the full payment context", async () => {
    show();
    fireEvent.click(await screen.findByText("PAY BILL"));
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    const [path, opts] = navigate.mock.calls.at(-1);
    expect(path).toBe("/voice-payment");
    expect(opts.state).toMatchObject({
      userid: "namich",
      servicekey: "voicecall",
      voipnumber: "90555100079",
      fofi_box_id: "",
      planid: "35",
      priceid: "81",
      // Resolved from the services list row (keyword voicecall → id 5),
      // never hardcoded.
      servid: "5",
    });
  });
});

describe("VoiceService — the not-opted branch", () => {
  // Real staging response for `testrag4` (voip:[] fofi:[] internet:[]) —
  // captured 2026-08-18. err_code is 0; the useful part is the message.
  const PLAN_NO_LINE = {
    status: { err_code: 0, err_msg: "success" },
    body: {
      planid: 0,
      priceid: 0,
      subscribed_services: [
        { servicekey: "voicecall", title: "voicecall", planname: "", expirydate: "" },
      ],
      chnls_pkgs_selection: { btn_status: "disable", message: "" },
      multi_service_renewal: { btn_status: "disable", message: "" },
      other_service_renewal: {
        btn_status: "disable",
        message: "Please contact operator to upgrade voicecall services plan",
      },
    },
  };

  test("shows the BACKEND's explanation, not one of our own sentences", async () => {
    getUserAssignedItems.mockResolvedValue(ASSIGNED_NO_VOIP);
    getMyPlanDetails.mockResolvedValue(PLAN_NO_LINE);
    show();
    expect(await screen.findByText("Please contact operator to upgrade voicecall services plan")).toBeTruthy();
  });

  test("plan details ARE fetched with an empty voipnumber (that is where the message lives)", async () => {
    getUserAssignedItems.mockResolvedValue(ASSIGNED_NO_VOIP);
    getMyPlanDetails.mockResolvedValue(PLAN_NO_LINE);
    show();
    await waitFor(() => expect(getMyPlanDetails).toHaveBeenCalled());
    expect(getMyPlanDetails.mock.calls[0][0]).toEqual({
      servicekey: "voicecall", userid: "namich", fofiboxid: "", voipnumber: "",
    });
  });

  test("no voip AND no fofi box → the operator still gets ADD VOICE PLAN", async () => {
    // The regression this replaces: `canQuoteVoice` hid the CTA whenever the
    // customer had neither a VOIP number nor a FoFi box. Because
    // getUserAssignedItems hardcodes `fofi: []` for servkey "voicecall"
    // (CustomerServiceItems.php:27-29), that was EVERY line-less customer —
    // so the one person who could act on "contact operator to upgrade" was
    // the one being locked out.
    getUserAssignedItems.mockResolvedValue(ASSIGNED_NO_VOIP);
    getMyPlanDetails.mockResolvedValue(PLAN_NO_LINE);
    show();
    await screen.findByText(/Please contact operator/);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText("ADD VOICE PLAN")).toBeTruthy();
  });

  test("nothing is added to the backend's message, and no Fo-Fi hand-off is offered", async () => {
    // Both were ours, and both were wrong: upgradeRegistration takes no box
    // for a voicecall-only service list, so the Fo-Fi page could not have
    // unblocked this customer.
    getUserAssignedItems.mockResolvedValue(ASSIGNED_NO_VOIP);
    getMyPlanDetails.mockResolvedValue(PLAN_NO_LINE);
    show();
    await screen.findByText(/Please contact operator/);
    expect(screen.queryByText(/needs a Fo-Fi Box/i)).toBeNull();
    expect(screen.queryByText("GO TO FO-FI SMART BOX")).toBeNull();
  });

  test("a failed assigned-items call shows an error + Retry, NOT 'no connection'", async () => {
    getUserAssignedItems.mockRejectedValue(new Error("boom"));
    show();
    expect(await screen.findByText(/Failed to load/i)).toBeTruthy();
    expect(screen.queryByText("ADD VOICE PLAN")).toBeNull();
  });
});

describe("VoiceService — the upgrade plan list", () => {
  test("UPGRADE PLAN gates on validateBeforeFofiBoxReg, then lists voicecall_plans", async () => {
    show();
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));

    await waitFor(() => expect(validateBeforeFofiBoxReg).toHaveBeenCalled());
    // username carries the CUSTOMER id — native's inversion.
    expect(validateBeforeFofiBoxReg).toHaveBeenCalledWith({ username: "namich", loginuname: "superadmin" });
    expect(getFofiUpgradePlans).toHaveBeenCalledWith({
      userid: "namich", moduletype: "upgradation", logUname: "superadmin",
    });

    expect(await screen.findByText("Voice Plans")).toBeTruthy();
    expect(screen.getByText("₹100.00")).toBeTruthy();
  });

  test("tapping a plan opens the subscription screen and pays for NOTHING yet", async () => {
    // Native's ServicePlansListAdapter starts ServiceSubscriptionsActivity —
    // it does not quote, register or pay. All of that is behind Submit.
    show();
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));

    expect(await screen.findByText("Services Subscription")).toBeTruthy();
    expect(screen.getByText("SUBMIT")).toBeTruthy();
    expect(screen.getByText(": UNLIMITED CALLING")).toBeTruthy();
    expect(screen.getByText(": Voice Plan")).toBeTruthy();
    expect(getVoicePaymentInfo).not.toHaveBeenCalled();
    expect(provisionVoiceNumber).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("the subscription screen shows an existing VOIP number, read-only", async () => {
    // handleViews("voicecall") :540-545 — the voip block appears only when
    // the customer already has a number, and it is never an input.
    show();
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    await screen.findByText("Services Subscription");

    expect(screen.getByText("VOIP Number")).toBeTruthy();
    expect(screen.getByText("90555100079")).toBeTruthy();
    // Read-only: no editable field carries the number.
    expect(document.querySelector("input[value='90555100079']")).toBeNull();
  });

  test("Submit carries the SELECTED plan's ids into the quote and payment", async () => {
    // This customer already has a number, so the idempotent registration hands
    // the SAME one back (Voip_model::addCustomer only inserts when
    // voipDetails() is empty). Leaving the default mock here would have the
    // backend inventing a second number for an existing line, which it cannot.
    provisionVoiceNumber.mockResolvedValue({
      status: { err_code: 0, err_msg: "Registered successfully!" },
      body: { voipno: "90555100079" },
    });
    show();
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    fireEvent.click(await screen.findByText("SUBMIT"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/voice-payment", expect.anything()));
    expect(getVoicePaymentInfo.mock.calls[0][0]).toMatchObject({
      planid: "35", priceid: "81", servid: "5",
      userid: "namich", voipnumber: "90555100079", fofi_box_id: "",
    });
    expect(navigate.mock.calls.at(-1)[1].state).toMatchObject({
      planid: "35", priceid: "81", servid: "5", voipnumber: "90555100079", mode: "upgrade",
    });
  });

  test("a quote rejection keeps the operator ON the subscription screen", async () => {
    getVoicePaymentInfo.mockResolvedValue({
      status: { err_code: 1, err_msg: "Voip number is not active" },
    });
    show();
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    fireEvent.click(await screen.findByText("SUBMIT"));

    await waitFor(() => expect(getVoicePaymentInfo).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Services Subscription")).toBeTruthy();
  });

  test("a successful quote is handed forward so payment does not re-reserve", async () => {
    show();
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    fireEvent.click(await screen.findByText("SUBMIT"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/voice-payment", expect.anything()));
    const { state } = navigate.mock.calls.at(-1)[1];
    expect(state.quote?.body?.transactionid).toBe("SERV-2608-5-0000200");
  });

  test("a blocked customer never reaches the plan list", async () => {
    validateBeforeFofiBoxReg.mockResolvedValue({ status: { err_code: 1, err_msg: "not allowed" } });
    show();
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));
    await waitFor(() => expect(validateBeforeFofiBoxReg).toHaveBeenCalled());
    expect(getFofiUpgradePlans).not.toHaveBeenCalled();
    expect(screen.queryByText("Voice Plans")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Provisioning — the leg that makes a line-less customer billable.
// ─────────────────────────────────────────────────────────────────────
describe("VoiceService — Submit on the subscription screen", () => {
  const NO_LINE_QUOTE = {
    status: { err_code: 1, err_msg: "Please choose fofiboxid" },
  };

  function openSubscriptionForLinelessCustomer() {
    getUserAssignedItems.mockResolvedValue(ASSIGNED_NO_VOIP);
    getMyPlanDetails.mockResolvedValue({
      status: { err_code: 0 },
      body: {
        planid: 0, priceid: 0,
        subscribed_services: [{ servicekey: "voicecall", title: "voicecall", planname: "" }],
        other_service_renewal: {
          btn_status: "disable",
          message: "Please contact operator to upgrade voicecall services plan",
        },
      },
    });
    show();
  }

  test("registers the line, then quotes ONCE with the allocated number", async () => {
    // Native's btn_submit branch (:715-726): `intent_voip && intent_fofi_id`
    // is false, so requesrServerPlanUpgradation() runs and its response's
    // body.voipno becomes intent_voip before GotoUpgradePayment() (:1242-1246).
    openSubscriptionForLinelessCustomer();
    fireEvent.click(await screen.findByText("ADD VOICE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    fireEvent.click(await screen.findByText("SUBMIT"));

    await waitFor(() => expect(provisionVoiceNumber).toHaveBeenCalled());
    expect(provisionVoiceNumber).toHaveBeenCalledWith({
      // `username` is the CUSTOMER id — the same inversion as
      // validateBeforeFofiBoxReg.
      username: "namich",
      loginuname: "superadmin",
      // From the plan's `subscriptions`, NOT its `reg_serv_keys`
      // (["Unlimited calls"], which would register nothing).
      services: ["voicecall"],
      // No box in play, and none is required for a voicecall-only list.
      fofiboxid: "",
    });

    // Registration happens BEFORE the quote, so there is exactly one quote and
    // it already carries the number.
    await waitFor(() => expect(getVoicePaymentInfo).toHaveBeenCalledTimes(1));
    expect(getVoicePaymentInfo.mock.calls[0][0].voipnumber).toBe("08024489123");
  });

  test("payment is entered with the ALLOCATED number, not the empty one", async () => {
    openSubscriptionForLinelessCustomer();
    fireEvent.click(await screen.findByText("ADD VOICE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    fireEvent.click(await screen.findByText("SUBMIT"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/voice-payment", expect.anything()));
    expect(navigate.mock.calls.at(-1)[1].state).toMatchObject({
      voipnumber: "08024489123",
      planid: "35", priceid: "81", servid: "5", mode: "upgrade",
    });
  });

  test("a registration that allocates nothing never reaches the quote", async () => {
    // err_code 0 with an empty body is what the backend returns when the
    // `services` list matched no branch of _checkGroupRegistrations.
    provisionVoiceNumber.mockResolvedValue({ status: { err_code: 0, err_msg: "ok" }, body: null });
    openSubscriptionForLinelessCustomer();
    fireEvent.click(await screen.findByText("ADD VOICE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    fireEvent.click(await screen.findByText("SUBMIT"));

    await waitFor(() => expect(provisionVoiceNumber).toHaveBeenCalled());
    expect(getVoicePaymentInfo).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("a customer WITH a number still registers — native takes that branch too", async () => {
    // The first branch needs voip AND fofi. `fofi` is hardcoded empty for this
    // service key (CustomerServiceItems.php:27-29), so native always falls
    // through to registration. upgradeRegistration is idempotent, so the
    // existing number comes back rather than a second one being allocated.
    provisionVoiceNumber.mockResolvedValue({
      status: { err_code: 0, err_msg: "Registered successfully!" },
      body: { voipno: "90555100079" },
    });
    show(); // default fixtures: voip 90555100079 present, fofi []
    fireEvent.click(await screen.findByText("UPGRADE PLAN"));
    fireEvent.click(await screen.findByText("₹100.00"));
    fireEvent.click(await screen.findByText("SUBMIT"));

    await waitFor(() => expect(provisionVoiceNumber).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/voice-payment", expect.anything()));
    expect(navigate.mock.calls.at(-1)[1].state).toMatchObject({ voipnumber: "90555100079" });
  });

  test("Pay Bill NEVER registers — a renewal must not text the customer", async () => {
    // upgradeRegistration sends an SMS + email on every success
    // (CustomerUpgradeRegistration:225-240). Native only reaches that call on
    // the isupgrade branch; renewal goes straight to the payment fragment.
    getVoicePaymentInfo.mockResolvedValue(NO_LINE_QUOTE);
    show(); // default fixtures: active plan, renewal enabled
    fireEvent.click(await screen.findByText("PAY BILL"));

    await waitFor(() => expect(getVoicePaymentInfo).toHaveBeenCalled());
    expect(provisionVoiceNumber).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
