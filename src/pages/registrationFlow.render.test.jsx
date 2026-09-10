/** @vitest-environment jsdom */
/**
 * Plans → Subscribe — the new-customer registration flow.
 *
 * Why component tests and not just unit tests on registrationPlans.js: this
 * repo's vitest config says it outright — it "had NO component tests at all,
 * which is precisely how a broken dropdown shipped twice: the build is green
 * whether or not the thing actually renders." Plans.jsx and Subscribe.jsx were
 * both rewritten here, and the thing that matters (does the registration
 * payload carry the right plan fields, and is body.voipno captured) is only
 * observable by driving the real components.
 *
 * FIXTURES ARE REAL. Captured 2026-08-18 from staging
 * (https://netmontest.bbnl.in/netmon/, superadmin) via
 * tools/registration-plans-smoke.cjs:
 *   - the plain registration call returns fofi_plans:[] multi_plans:[]
 *     internet_plans:183 voicecall_plans:1
 *   - fofi_plans only populates for moduletype:"upgradation" (10 rows)
 *   - internet_plans rows have NO reg_serv_keys field at all
 *   - internet_plans contains "100MB_Tripleplay" (servid 2135)
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const submitRegistrationNecessities = vi.fn();
const registerCustomer = vi.fn();
const getOnuHwDets = vi.fn();
vi.mock("../services/registrationApis", () => ({
  submitRegistrationNecessities: (...a) => submitRegistrationNecessities(...a),
  registerCustomer: (...a) => registerCustomer(...a),
  getOnuHwDets: (...a) => getOnuHwDets(...a),
}));

vi.mock("../services/lsCache", () => ({ lsRemove: () => {} }));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

// Layout drags in Header → AuthContext → the IPTV prefetch chain. None of that
// is under test here.
vi.mock("../layout/Layout", () => ({
  default: ({ children }) => <div data-testid="layout">{children}</div>,
}));

import { ToastProvider } from "../components/ui/Toast";
import Plans from "./Plans";
import Subscribe from "./Subscribe";

// ── Real staging shapes ───────────────────────────────────────────────
const INTERNET_ROW = {
  servid: "2135",
  serv_name: "100MB_Tripleplay",
  serv_desc: "100MB Tripleplay",
  serv_rates: { labels: ["1 Month"], prices: ["699.00"] },
  // NOTE: no reg_serv_keys — internet_plans genuinely omit the field.
};
const VOICE_ROW = {
  priceid: "81", planid: "35", planname: "UNLIMITED CALLING", planrate: "100.00",
  reg_serv_keys: ["voicecall"], subscriptions: ["voicecall"],
  packages: [], showelements: null, payuri: "voicecall", servid: "5",
};
// Shape taken from the moduletype:"upgradation" response, which is where
// fofi_plans actually populate on staging.
const FOFI_ROW = {
  planid: "51", priceid: "77", planname: "FOFI-Box + FTA ONLY", planrate: "300.00",
  payuri: "", servid: "3", reg_serv_keys: ["fofi", "cabletv"],
};
const MULTI_ROW = {
  planid: "60", priceid: "88", planname: "TRIPLE PLAY BUNDLE", planrate: "999.00",
  payuri: "http://pay", servid: "11", reg_serv_keys: ["internet", "fofi", "voicecall"],
};

function necessities({ fofi = [], multi = [], internet = [INTERNET_ROW] } = {}) {
  return {
    status: { err_code: 0, err_msg: "" },
    body: {
      client_id: "BBNL_OP49",
      groups: [{ group_id: "1", group_name: "DEFAULT" }],
      internet_plans: internet,
      fofi_plans: fofi,
      multi_plans: multi,
      voicecall_plans: [VOICE_ROW],
      zones: [],
    },
  };
}

const renderWith = (ui) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  navigate.mockReset();
  submitRegistrationNecessities.mockReset();
  registerCustomer.mockReset();
  getOnuHwDets.mockReset();
  localStorage.setItem("user", JSON.stringify({ username: "superadmin", op_id: "BBNL_OP49" }));
});
afterEach(cleanup);

/* ══════════════════════ Plans ══════════════════════ */

describe("Plans — the registration plan list", () => {
  test("renders internet plans (the staging reality: 183 of them, no bundles)", async () => {
    submitRegistrationNecessities.mockResolvedValue(necessities());
    renderWith(<Plans />);
    expect(await screen.findByText("100MB_Tripleplay")).toBeTruthy();
    expect(screen.getByText(/699\.00/)).toBeTruthy();
  });

  test("lists fofi and multi plans alongside internet when the operator has them", async () => {
    submitRegistrationNecessities.mockResolvedValue(
      necessities({ fofi: [FOFI_ROW], multi: [MULTI_ROW] })
    );
    renderWith(<Plans />);
    // The regression: this screen used to read internet_plans ONLY, so neither
    // of these could ever appear — and with them, no route to a VOIP line.
    expect(await screen.findByText("FOFI-Box + FTA ONLY")).toBeTruthy();
    expect(screen.getByText("TRIPLE PLAY BUNDLE")).toBeTruthy();
    expect(screen.getByText("100MB_Tripleplay")).toBeTruthy();
  });

  test("a voice-carrying plan is flagged, and says the number is server-allocated", async () => {
    submitRegistrationNecessities.mockResolvedValue(necessities({ multi: [MULTI_ROW] }));
    renderWith(<Plans />);
    expect(await screen.findByText("Voice / VOIP")).toBeTruthy();
    expect(screen.getByText(/allocated automatically on registration/i)).toBeTruthy();
  });

  test("does NOT list the standalone voicecall plan (registration is not the upgrade path)", async () => {
    submitRegistrationNecessities.mockResolvedValue(necessities());
    renderWith(<Plans />);
    await screen.findByText("100MB_Tripleplay");
    // voicecall_plans IS in the live body, but Android's registration adapter
    // omits the bucket — a standalone voice plan is upgrade-only.
    expect(screen.queryByText("UNLIMITED CALLING")).toBeNull();
  });

  test("selecting an internet plan stores internet_servid and blanks the plan ids", async () => {
    submitRegistrationNecessities.mockResolvedValue(necessities());
    renderWith(<Plans />);
    fireEvent.click(await screen.findByText("100MB_Tripleplay"));

    const reg = JSON.parse(localStorage.getItem("registrationData"));
    expect(reg.internet_servid).toBe("2135");
    expect(reg.planid).toBe("");
    expect(reg.priceid).toBe("");
    expect(navigate).toHaveBeenCalledWith("/subscribe");
  });

  test("selecting a bundle plan stores the plan ids and zeroes internet_servid", async () => {
    submitRegistrationNecessities.mockResolvedValue(necessities({ multi: [MULTI_ROW] }));
    renderWith(<Plans />);
    fireEvent.click(await screen.findByText("TRIPLE PLAY BUNDLE"));

    const reg = JSON.parse(localStorage.getItem("registrationData"));
    expect(reg.internet_servid).toBe("0");
    expect(reg.planid).toBe("60");
    expect(reg.priceid).toBe("88");
    expect(reg.servid_pay).toBe("11");
    expect(reg.payurl).toBe("http://pay");
  });

  test("a backend error is shown with a retry, not a silent empty list", async () => {
    submitRegistrationNecessities.mockResolvedValue({
      status: { err_code: 2, err_msg: "Invalid operator" },
    });
    renderWith(<Plans />);
    expect(await screen.findByText("Invalid operator")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  test("a thrown request is caught and surfaced", async () => {
    submitRegistrationNecessities.mockRejectedValue(new Error("Network error"));
    renderWith(<Plans />);
    expect(await screen.findByText("Network error")).toBeTruthy();
  });

  test("search filters across name, description and service labels", async () => {
    submitRegistrationNecessities.mockResolvedValue(necessities({ multi: [MULTI_ROW] }));
    renderWith(<Plans />);
    await screen.findByText("100MB_Tripleplay");

    fireEvent.change(screen.getByPlaceholderText("Search plans..."), {
      target: { value: "voice" },
    });
    // Matched via its "Voice / VOIP" service label.
    expect(screen.getByText("TRIPLE PLAY BUNDLE")).toBeTruthy();
    expect(screen.queryByText("100MB_Tripleplay")).toBeNull();
  });
});

/* ══════════════════════ Subscribe ══════════════════════ */

function seedPlan(plan) {
  localStorage.setItem("selectedPlan", JSON.stringify(plan));
  localStorage.setItem("groups", JSON.stringify([{ group_id: "1", group_name: "DEFAULT" }]));
  localStorage.setItem(
    "registrationData",
    JSON.stringify({ username: "newcust01", termsAccepted: true })
  );
}

const INTERNET_PLAN = {
  kind: "internet", key: "internet:2135", name: "100MB_Tripleplay", description: "",
  price: "699.00", label: "1 Month", internet_servid: "2135",
  planid: "", priceid: "", planname: "", payurl: "", servid_pay: "",
  services: ["internet"],
};
const VOICE_BUNDLE_PLAN = {
  kind: "multi", key: "multi:60", name: "TRIPLE PLAY BUNDLE", description: "",
  price: "999.00", label: "", internet_servid: "0",
  planid: "60", priceid: "88", planname: "TRIPLE PLAY BUNDLE",
  payurl: "http://pay", servid_pay: "11",
  services: ["internet", "fofi", "voicecall"],
};
const FOFI_ONLY_PLAN = {
  kind: "fofi", key: "fofi:51", name: "FOFI-Box + FTA ONLY", description: "",
  price: "300.00", label: "", internet_servid: "0",
  planid: "51", priceid: "77", planname: "FOFI-Box + FTA ONLY",
  payurl: "", servid_pay: "3",
  services: ["fofi", "cabletv"],
};

describe("Subscribe — sections follow the plan's services", () => {
  test("an internet plan shows ONU + group, and no FoFi box fields", () => {
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    expect(screen.getByText("Internet Group")).toBeTruthy();
    expect(screen.getByText("ONU Details")).toBeTruthy();
    expect(screen.queryByText("FoFi Box")).toBeNull();
  });

  test("a fofi-only plan shows the box fields and NO internet fields", () => {
    seedPlan(FOFI_ONLY_PLAN);
    renderWith(<Subscribe />);
    expect(screen.getByText("FoFi Box")).toBeTruthy();
    expect(screen.queryByText("Internet Group")).toBeNull();
    expect(screen.queryByText("ONU Details")).toBeNull();
  });

  test("a bundle carrying voice shows both, plus the server-allocation notice", () => {
    seedPlan(VOICE_BUNDLE_PLAN);
    renderWith(<Subscribe />);
    expect(screen.getByText("Internet Group")).toBeTruthy();
    expect(screen.getByText("FoFi Box")).toBeTruthy();
    expect(screen.getByText(/allocated by the\s+server/i)).toBeTruthy();
  });

  test("the plan summary lists the services being registered", () => {
    seedPlan(VOICE_BUNDLE_PLAN);
    renderWith(<Subscribe />);
    expect(screen.getByText("Internet, FoFi Box, Voice / VOIP")).toBeTruthy();
  });
});

describe("Subscribe — validation is scoped to the plan", () => {
  test("an internet plan blocks submit without an ONU MAC", async () => {
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));
    expect(await screen.findByText("Enter ONU MAC")).toBeTruthy();
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  test("a fofi plan blocks submit without box id + MAC — and does NOT demand an ONU", async () => {
    seedPlan(FOFI_ONLY_PLAN);
    renderWith(<Subscribe />);
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));
    expect(await screen.findByText("Enter the FoFi Box ID")).toBeTruthy();
    expect(screen.getByText("Enter the FoFi Box MAC")).toBeTruthy();
    // The old screen validated ONU unconditionally, which made a box-only
    // registration impossible to submit at all.
    expect(screen.queryByText("Enter ONU MAC")).toBeNull();
    expect(registerCustomer).not.toHaveBeenCalled();
  });
});

describe("Subscribe — the registration payload", () => {
  async function submitInternet() {
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/ONU MAC/i), {
      target: { name: "onumacid", value: "AA:BB:CC:DD:EE:FF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));
    await waitFor(() => expect(registerCustomer).toHaveBeenCalled());
    return registerCustomer.mock.calls[0][0];
  }

  test("an internet registration sends services:[internet] and the servid", async () => {
    registerCustomer.mockResolvedValue({ status: { err_code: 0 }, body: {} });
    const payload = await submitInternet();
    expect(payload.services).toEqual(["internet"]);
    expect(payload.internet_servid).toBe("2135");
    expect(payload.planid).toBe("");
    expect(payload.fofiboxid).toBe("");
    expect(payload.loginuname).toBe("superadmin");
    expect(payload.op_id).toBe("BBNL_OP49");
    // termsAccepted is a UI-only field and must not reach the backend.
    expect(payload.termsAccepted).toBeUndefined();
  });

  test("a bundle registration sends the plan's own service list and ids", async () => {
    registerCustomer.mockResolvedValue({ status: { err_code: 0 }, body: {} });
    seedPlan(VOICE_BUNDLE_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/ONU MAC/i), {
      target: { name: "onumacid", value: "AA:BB:CC:DD:EE:FF" },
    });
    fireEvent.change(screen.getByLabelText(/FoFi Box ID/i), {
      target: { name: "fofiboxid", value: "BBNL-ANDBOX-02200089" },
    });
    fireEvent.change(screen.getByLabelText(/FoFi Box MAC/i), {
      target: { name: "fofimac", value: "11:1D:EF:1A:12:3F" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));
    await waitFor(() => expect(registerCustomer).toHaveBeenCalled());

    const payload = registerCustomer.mock.calls[0][0];
    // The old screen hardcoded services:["internet"] and blanked every plan
    // id, so a bundled registration was silently downgraded to internet-only.
    expect(payload.services).toEqual(["internet", "fofi", "voicecall"]);
    expect(payload.planid).toBe("60");
    expect(payload.priceid).toBe("88");
    expect(payload.servid_pay).toBe("11");
    expect(payload.internet_servid).toBe("0");
    expect(payload.fofiboxid).toBe("BBNL-ANDBOX-02200089");
    expect(payload.fofimac).toBe("11:1D:EF:1A:12:3F");
  });
});

describe("Subscribe — VOIP allocation (the point of the exercise)", () => {
  test("body.voipno is captured, announced and persisted", async () => {
    registerCustomer.mockResolvedValue({
      status: { err_code: 0, err_msg: "" },
      body: { voipno: "90555100079" },
    });
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/ONU MAC/i), {
      target: { name: "onumacid", value: "AA:BB:CC:DD:EE:FF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));

    // Android reads exactly this field (ServiceSubscriptionsActivity:1218-1220);
    // the PWA used to discard the whole response body.
    expect(await screen.findByText(/VOIP number allocated: 90555100079/)).toBeTruthy();
    await waitFor(() => {
      const reg = JSON.parse(localStorage.getItem("registrationData"));
      expect(reg.voipnumber).toBe("90555100079");
      expect(reg.isRegistered).toBe(true);
    });
  });

  test("no voipno → ordinary success message, and voipnumber stays empty", async () => {
    registerCustomer.mockResolvedValue({ status: { err_code: 0 }, body: {} });
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/ONU MAC/i), {
      target: { name: "onumacid", value: "AA:BB:CC:DD:EE:FF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));

    expect(await screen.findByText("Registered successfully!")).toBeTruthy();
    const reg = JSON.parse(localStorage.getItem("registrationData"));
    expect(reg.voipnumber).toBe("");
  });

  test("a registration carrying internet goes to the internet payment leg", async () => {
    registerCustomer.mockResolvedValue({ status: { err_code: 0 }, body: { voipno: "9055" } });
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/ONU MAC/i), {
      target: { name: "onumacid", value: "AA:BB:CC:DD:EE:FF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/paynow"));
  });

  test("a non-internet registration does NOT go to the internet payment leg", async () => {
    registerCustomer.mockResolvedValue({ status: { err_code: 0 }, body: {} });
    seedPlan(FOFI_ONLY_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/FoFi Box ID/i), {
      target: { name: "fofiboxid", value: "BBNL-ANDBOX-02200089" },
    });
    fireEvent.change(screen.getByLabelText(/FoFi Box MAC/i), {
      target: { name: "fofimac", value: "11:1D:EF:1A:12:3F" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    // Billing a cable/fofi plan through apis/savePaymentApi is the internet
    // RENEWAL endpoint — the exact confusion behind the Aug 2026 Cable-TV
    // regression. It must never be the destination here.
    expect(navigate).not.toHaveBeenCalledWith("/paynow");
    expect(navigate.mock.calls[0][0]).toContain("/services");
  });

  test("a failed registration does not mark the draft registered", async () => {
    registerCustomer.mockResolvedValue({
      status: { err_code: 3, err_msg: "Username already exists" },
    });
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/ONU MAC/i), {
      target: { name: "onumacid", value: "AA:BB:CC:DD:EE:FF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^register$/i }));

    expect(await screen.findByText(/Username already exists/)).toBeTruthy();
    const reg = JSON.parse(localStorage.getItem("registrationData"));
    expect(reg.isRegistered).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("Subscribe — ONU hardware lookup", () => {
  test("Get MAC fills the hardware id from the response", async () => {
    getOnuHwDets.mockResolvedValue({ status: { err_code: 0 }, body: { hardwareid: "HW-99" } });
    seedPlan(INTERNET_PLAN);
    renderWith(<Subscribe />);
    fireEvent.change(screen.getByLabelText(/ONU MAC/i), {
      target: { name: "onumacid", value: "AA:BB:CC:DD:EE:FF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /get mac/i }));

    // The old code assigned straight to the `form` object, which React never
    // re-rendered from — the field only appeared to fill when an unrelated
    // render happened to follow.
    await waitFor(() =>
      expect(screen.getByLabelText(/ONU Box\(Hardware\) ID/i).value).toBe("HW-99")
    );
  });
});
