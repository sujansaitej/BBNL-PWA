import { describe, test, expect } from "vitest";
import {
  buildRegistrationPlans,
  planHasVoice,
  planNeedsBox,
  planNeedsInternet,
  registrationServices,
  serviceLabels,
} from "./registrationPlans";

// Shapes taken from the real registrationNecessities body — internet_plans use
// serv_* / serv_rates, the bundle buckets use plan* / reg_serv_keys.
const RESP = {
  status: { err_code: 0, err_msg: "" },
  body: {
    client_id: "BBNL_OP49",
    internet_plans: [
      {
        servid: "812",
        serv_name: "100MB UNLIMITED",
        serv_desc: "100 Mbps unlimited",
        serv_rates: { labels: ["1 Month"], prices: ["590.00"] },
      },
    ],
    fofi_plans: [
      {
        planid: "51",
        priceid: "77",
        planname: "FOFI-Box + FTA ONLY",
        planrate: "300.00",
        payuri: "",
        servid: "3",
        reg_serv_keys: ["fofi", "cabletv"],
      },
    ],
    multi_plans: [
      {
        planid: "60",
        priceid: "88",
        planname: "TRIPLE PLAY",
        planrate: "999.00",
        payuri: "http://pay",
        servid: "11",
        reg_serv_keys: ["internet", "fofi", "voicecall"],
      },
    ],
    // Present in the response, deliberately NOT listed at registration —
    // Android's registration constructor omits this bucket.
    voicecall_plans: [
      { planid: "35", priceid: "81", planname: "UNLIMITED CALLING", planrate: "100.00", servid: "5" },
    ],
  },
};

describe("buildRegistrationPlans", () => {
  const plans = buildRegistrationPlans(RESP);

  test("lists fofi, multi and internet plans — in that order", () => {
    expect(plans.map((p) => p.kind)).toEqual(["fofi", "multi", "internet"]);
  });

  test("does NOT list voicecall_plans (Android registration omits the bucket)", () => {
    // A standalone voice plan is an UPGRADE-only path. Listing it here would
    // send a registration payload the backend has no branch for.
    expect(plans.some((p) => p.planid === "35")).toBe(false);
  });

  test("an internet plan maps to internet_servid with blank plan ids", () => {
    const p = plans.find((x) => x.kind === "internet");
    expect(p.internet_servid).toBe("812");
    expect(p.planid).toBe("");
    expect(p.priceid).toBe("");
    expect(p.planname).toBe("");
    expect(p.payurl).toBe("");
    expect(p.services).toEqual(["internet"]);
    expect(p.price).toBe("590.00");
  });

  test("a bundle plan maps to plan ids with internet_servid zeroed", () => {
    const p = plans.find((x) => x.planid === "60");
    expect(p.internet_servid).toBe("0");
    expect(p.priceid).toBe("88");
    expect(p.planname).toBe("TRIPLE PLAY");
    expect(p.payurl).toBe("http://pay");
    expect(p.servid_pay).toBe("11");
    expect(p.services).toEqual(["internet", "fofi", "voicecall"]);
  });

  test("every id is a string — the payload is JSON and the backend is loosely typed", () => {
    for (const p of plans) {
      expect(typeof p.internet_servid).toBe("string");
      expect(typeof p.planid).toBe("string");
      expect(typeof p.priceid).toBe("string");
    }
  });

  test("rows without an identifier are dropped rather than rendered blank", () => {
    const out = buildRegistrationPlans({
      body: {
        internet_plans: [{ serv_name: "no servid" }],
        fofi_plans: [{ planname: "no planid" }],
        multi_plans: [null, undefined, "nonsense"],
      },
    });
    expect(out).toEqual([]);
  });

  test("a missing or malformed body yields an empty list, never a throw", () => {
    expect(buildRegistrationPlans(undefined)).toEqual([]);
    expect(buildRegistrationPlans({})).toEqual([]);
    expect(buildRegistrationPlans({ body: {} })).toEqual([]);
  });

  test("falls back to `subscriptions` when a bucket omits reg_serv_keys", () => {
    const out = buildRegistrationPlans({
      body: { fofi_plans: [{ planid: "9", subscriptions: ["fofi", "voicecall"] }] },
    });
    expect(out[0].services).toEqual(["fofi", "voicecall"]);
  });
});

describe("plan capability predicates", () => {
  const plans = buildRegistrationPlans(RESP);
  const internet = plans.find((p) => p.kind === "internet");
  const fofi = plans.find((p) => p.planid === "51");
  const multi = plans.find((p) => p.planid === "60");

  test("planHasVoice is true only for a plan carrying voicecall", () => {
    expect(planHasVoice(multi)).toBe(true);
    expect(planHasVoice(fofi)).toBe(false);
    expect(planHasVoice(internet)).toBe(false);
  });

  test("planNeedsBox covers both fofi and cabletv", () => {
    expect(planNeedsBox(fofi)).toBe(true);
    expect(planNeedsBox(multi)).toBe(true);
    expect(planNeedsBox(internet)).toBe(false);
  });

  test("planNeedsInternet is true for the internet bucket and for bundles including it", () => {
    expect(planNeedsInternet(internet)).toBe(true);
    expect(planNeedsInternet(multi)).toBe(true);
    expect(planNeedsInternet(fofi)).toBe(false);
  });

  test("registrationServices returns the wire list, defaulting to internet", () => {
    expect(registrationServices(multi)).toEqual(["internet", "fofi", "voicecall"]);
    expect(registrationServices(internet)).toEqual(["internet"]);
    expect(registrationServices(null)).toEqual(["internet"]);
  });

  test("registrationServices returns a copy, so callers cannot mutate the plan", () => {
    const out = registrationServices(multi);
    out.push("games");
    expect(multi.services).toEqual(["internet", "fofi", "voicecall"]);
  });

  test("serviceLabels renders voicecall as a human string", () => {
    expect(serviceLabels(multi)).toEqual(["Internet", "FoFi Box", "Voice / VOIP"]);
  });

  test("an unknown service key falls through as its raw value", () => {
    expect(serviceLabels({ services: ["quantum"] })).toEqual(["quantum"]);
  });
});
