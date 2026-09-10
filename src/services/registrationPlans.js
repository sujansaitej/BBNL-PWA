/**
 * Registration plan list — Android parity.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `Plans.jsx` used to read `body.internet_plans` and nothing else, so the only
 * thing an operator could register a new customer on was an internet plan. A
 * VOIP line is never ordered directly: it arrives as one of the services
 * carried by a bundled plan, so with the other buckets hidden there was no
 * route to "VOIP Registration" at all.
 *
 * Android's registration list is built in ServicePlansListAdapter's
 * NEW-REGISTRATION constructor (ServicePlansListAdapter.java:46-57):
 *
 *     this.viewObject.addAll(body.getFofi_plans());
 *     this.viewObject.addAll(multiPlansBeanList);      // body.multi_plans
 *     this.viewObject.addAll(internetPlansBeans);      // body.internet_plans
 *
 * Note what is NOT there: `voicecall_plans`. Those appear only in the UPGRADE
 * constructor, under `case "voicecall"` (line 103-105). A brand-new customer
 * cannot be put on a standalone voice plan in Android either — voice is
 * reached through a fofi/multi bundle whose `reg_serv_keys` contain
 * "voicecall". Do not "fix" that by adding voicecall_plans here; it would send
 * a registration payload no backend path expects.
 *
 * HOW A VOIP NUMBER IS ACTUALLY ALLOCATED
 * ---------------------------------------
 * The operator never types one. Registration returns it:
 * ServiceSubscriptionsActivity.java:1218-1220 reads `body.voipno` off the
 * custservregistration response and carries it into the payment request as
 * `voipnumber`. See `Subscribe.jsx`.
 */

/** Services that make a plan require FoFi box hardware at registration time. */
const BOX_SERVICES = ["fofi", "cabletv"];

/**
 * Normalise one plan row from any bucket into a single shape the UI can render
 * without caring which bucket it came from.
 *
 * The two shapes differ completely, which is why Android needs an
 * `instanceof` ladder and we need this:
 *   internet_plans  → { servid, serv_name, serv_desc, serv_rates:{labels,prices} }
 *   fofi/multi      → { planid, priceid, planname, planrate, payuri, servid,
 *                       reg_serv_keys:[...] }
 */
function normalise(row, kind) {
  if (!row || typeof row !== "object") return null;

  if (kind === "internet") {
    const servid = row.servid ?? row.srvid;
    if (servid === undefined || servid === null || servid === "") return null;
    const prices = Array.isArray(row.serv_rates?.prices) ? row.serv_rates.prices : [];
    const labels = Array.isArray(row.serv_rates?.labels) ? row.serv_rates.labels : [];
    return {
      kind: "internet",
      // Row identity for React keys. Buckets can repeat a numeric id, so the
      // kind is part of it.
      key: `internet:${servid}`,
      name: row.serv_name || "",
      description: row.serv_desc || "",
      price: prices[0] ?? "",
      label: labels[0] ?? "",
      // Android: setInternet_servid(servid), everything else blank.
      internet_servid: String(servid),
      planid: "",
      priceid: "",
      planname: "",
      payurl: "",
      servid_pay: "",
      services: ["internet"],
      raw: row,
    };
  }

  // fofi_plans / multi_plans share the "special plan" shape.
  const planid = row.planid;
  if (planid === undefined || planid === null || planid === "") return null;
  const services = Array.isArray(row.reg_serv_keys)
    ? row.reg_serv_keys.filter(Boolean).map(String)
    : Array.isArray(row.subscriptions)
      ? row.subscriptions.filter(Boolean).map(String)
      : [];
  return {
    kind,
    key: `${kind}:${planid}`,
    name: row.planname || "",
    description: "",
    price: row.planrate ?? "",
    label: "",
    // Android: setInternet_servid(0) for every non-internet plan.
    internet_servid: "0",
    planid: String(planid),
    priceid: String(row.priceid ?? ""),
    planname: String(row.planname ?? ""),
    payurl: String(row.payuri ?? ""),
    servid_pay: String(row.servid ?? ""),
    services,
    raw: row,
  };
}

/**
 * Build the registration plan list from a registrationNecessities response.
 * Order matches Android's: fofi → multi → internet.
 *
 * @param {object} resp registrationNecessities response
 * @returns {Array<object>} normalised plan rows (never null entries)
 */
export function buildRegistrationPlans(resp) {
  const body = resp?.body;
  if (!body) return [];
  const take = (arr, kind) =>
    (Array.isArray(arr) ? arr : []).map((r) => normalise(r, kind)).filter(Boolean);

  return [
    ...take(body.fofi_plans, "fofi"),
    ...take(body.multi_plans, "multi"),
    ...take(body.internet_plans, "internet"),
  ];
}

/** True when this plan registers a VOIP line (so the backend will allocate one). */
export function planHasVoice(plan) {
  return !!plan?.services?.includes("voicecall");
}

/** True when this plan needs FoFi box id + MAC captured during registration. */
export function planNeedsBox(plan) {
  return !!plan?.services?.some((s) => BOX_SERVICES.includes(s));
}

/** True when this plan provisions an internet connection (ONU/group fields). */
export function planNeedsInternet(plan) {
  // Android drives the internet section off `showelements.internet` for bundle
  // plans and off the bucket itself for internet plans. `reg_serv_keys` is the
  // same list expressed on the plan row, and is what the registration payload
  // is built from, so it is the single source of truth here.
  return plan?.kind === "internet" || !!plan?.services?.includes("internet");
}

/**
 * Human-readable service chips for a plan row.
 * Keys are wire values; these labels are display only.
 */
const SERVICE_LABELS = {
  internet: "Internet",
  fofi: "FoFi Box",
  cabletv: "Cable TV",
  voicecall: "Voice / VOIP",
  games: "Games",
  ipcamera: "IP Camera",
};

export function serviceLabels(plan) {
  return (plan?.services || []).map((s) => SERVICE_LABELS[s] || s);
}

/**
 * The `services` array the registration payload must carry.
 * Kept as its own export so Subscribe.jsx never re-derives it from the UI.
 */
export function registrationServices(plan) {
  const list = plan?.services || [];
  return list.length ? [...list] : ["internet"];
}
