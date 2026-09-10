// New Connection — the guest funnel, ported from the Android customer app.
//
// WHAT THE ANDROID SOURCE ACTUALLY HAS.
// The screen is `employee/java/.../Activity/NewConnectionFragment.java` (645
// lines, `AppCompatActivity implements OnMapReadyCallback`, layout
// activity_add_location). NOTE THE PATH: it sits under the *employee* source
// dir despite being the customer-facing screen, and there is a second,
// unrelated `Fragments/NewConnectionFragment.java` which is the operator's
// ticket queue. They are different files with the same name.
//
// LIVE in that source: the map, my-location, the GPS-disabled prompt, the
// centre-pin (onCameraChange takes the map centre as lat/lng — "mark the spot
// by moving the map"), zoom 14, ReverseGeocodingTask -> the Confirm Address
// dialog.
//
// NOT in that source: the submit itself. `requestNewConnection(...)` is called
// twice (lines 373, 420) but BOTH calls sit inside block comments, and the
// method is defined nowhere in the repo. The service picker, the operator
// markers and the Ticket Status screen are absent too. The shipped APK is ahead
// of this snapshot (v1.52 / versionCode 36), so the wire contract below comes
// from the BACKEND, read from Apis.php and verified live 2026-09-01.
//
// THE FUNNEL IS FIVE ENDPOINTS, gated together in Apis.php:51 on their own
// credential set (see PROFILE.NEW_CONNECTION — anything else answers
// "Header Authorization Failed!"):
//
//   registerNewConnection   seeds `newconn_info`      <- the missing step
//   loginNewCustomer        mobile -> is it known?
//   getAvailableServices    the SELECT SERVICE list
//   requestNewConnection    mobile, services, lat, lng
//   getNewConnectionStatus  mobile -> ticket list
//
// *** WHY THE APK SAYS "Mobile no. not exists" ***
// requestNewConnection calls Ticket_model::newConnUserExists($mob), which reads
// the `newconn_info` table — and ONLY registerNewConnection writes to it. The
// APK calls the submit without ever seeding that row, so it fails for every
// customer, on test and prod alike. Reproduced exactly. It is a MISSING
// PREREQUISITE CALL, not a broken endpoint — which is why submitRequest() below
// registers first and then submits.

import { getBaseUrl, getHeaders, apiFetch, PROFILE } from "../apiCore";

const headers = () =>
  getHeaders({ profile: PROFILE.NEW_CONNECTION, contentType: "application/x-www-form-urlencoded" });

/** Every endpoint here answers the standard {status:{err_code,err_msg}, body}. */
async function post(path, fields, label, { idempotent = false } = {}) {
  const resp = await apiFetch(
    `${getBaseUrl()}Apis/${path}`,
    { method: "POST", headers: headers(), body: new URLSearchParams(fields).toString() },
    label,
    { group: "Customer", idempotent }
  );
  if (!resp.ok) throw new Error(`${label} failed (HTTP ${resp.status}).`);
  const data = await resp.json();
  return {
    ok: Number(data?.status?.err_code) === 0,
    message: String(data?.status?.err_msg || ""),
    body: data?.body ?? null,
  };
}

/**
 * The SELECT SERVICE list.
 *
 * Returns `{list_type:"multi", list:[{id,title,description,keyword}]}` —
 * `list_type` is why the picker is CHECKBOXES rather than radio buttons. Live
 * on test it returns exactly the list in the app: Cable TV (1), Fo-Fi Smart Box
 * (3), Voice Call (5), Internet (7), Games, Multi Service, IP Camera.
 */
export async function getAvailableServices() {
  // A read, so a load-balancer retry is safe here (unlike everything else in
  // this file, which writes).
  const { ok, message, body } = await post("getAvailableServices", {}, "getAvailableServices", { idempotent: true });
  return {
    ok,
    message,
    multi: String(body?.list_type || "multi") === "multi",
    services: Array.isArray(body?.list) ? body.list : [],
  };
}

/** Is this mobile already known to the funnel? */
export async function loginNewCustomer(mobile) {
  return post("loginNewCustomer", { mobile: String(mobile || "").trim() }, "loginNewCustomer", { idempotent: true });
}

/** Seed `newconn_info`. Without this, requestNewConnection cannot succeed. */
export async function registerNewConnection({
  fname, lname, mobile, email, address, pincode, username, password, doSignup = "0",
}) {
  return post("registerNewConnection", {
    fname: String(fname || "").trim(),
    lname: String(lname || "").trim(),
    mobile: String(mobile || "").trim(),
    email: String(email || "").trim(),
    address: String(address || "").trim(),
    pincode: String(pincode || "").trim(),
    username: String(username || "").trim(),
    password: String(password || ""),
    // The signed-in customer already has an account; this funnel only needs the
    // newconn_info row, not a second signup.
    do_signup: String(doSignup),
  }, "registerNewConnection");
}

/**
 * Raise the request. `services` is a CSV of service ids from
 * getAvailableServices; lat/lng come from the map centre.
 *
 * A duplicate answers err_code 0 with "Request already made" — success-shaped,
 * because the customer's request IS on file. Treated as ok, with the backend's
 * own wording shown.
 */
export async function requestNewConnection({ mobile, services, lat, lng }) {
  return post("requestNewConnection", {
    mobile: String(mobile || "").trim(),
    services: Array.isArray(services) ? services.join(",") : String(services || ""),
    lat: String(lat ?? ""),
    lng: String(lng ?? ""),
  }, "requestNewConnection");
}

/** The Ticket Status screen. Keyed on MOBILE, not username. */
export async function getNewConnectionStatus(mobile) {
  const { ok, message, body } = await post(
    "getNewConnectionStatus", { mobile: String(mobile || "").trim() },
    "getNewConnectionStatus", { idempotent: true }
  );
  return { ok, message, tickets: Array.isArray(body) ? body : [] };
}

/**
 * The whole submit, in the order the backend requires.
 *
 * THE FIX FOR "Mobile no. not exists": seed newconn_info first, then request.
 * Registration is best-effort — if the row already exists it answers
 * "Request already made"/duplicate, which is fine and must not stop the submit.
 * Only the request's own verdict is returned.
 */
export async function submitRequest({ profile, services, lat, lng }) {
  try {
    await registerNewConnection(profile);
  } catch (_) {
    // A registration failure is not necessarily fatal — the row may already be
    // there from a previous attempt. Let requestNewConnection be the judge.
  }
  return requestNewConnection({ mobile: profile.mobile, services, lat, lng });
}

// ── Validation ──────────────────────────────────────────────────────
// requestNewConnection runs validateEmptyFields() over exactly
// {mobile, services, lat, lng} and reports the FIRST missing one as
// "Missed field <name>".
export function validateRequest({ mobile, services, lat, lng }) {
  const e = {};
  const m = String(mobile || "").trim();
  if (!m) e.mobile = "Mobile number is required.";
  else if (!/^\d{10}$/.test(m)) e.mobile = "Enter a valid 10-digit mobile number.";
  if (!services || !services.length) e.services = "Select at least one service.";
  if (lat == null || lng == null || lat === "" || lng === "") {
    e.location = "Mark your location on the map.";
  }
  return e;
}

/**
 * Nearby operators — the green map pins and the Operator Details popup.
 *
 * `POST apis/cust/clientlatlong/` with lat/lng. Found in the CUSTOMER app
 * (bbnlcustomerapp-master), where ServerManager exposes it under the
 * thoroughly misleading name `submitFeedback_And_Rating(lat, lng, tag)` —
 * it has nothing to do with feedback; it returns OperatorsIn500mModel.
 *
 * THIS USES THE `apis/*` CREDENTIAL SET, not the funnel's own — the two live
 * side by side on the same screen.
 *
 * A THIRD ENVELOPE SHAPE: `{result: [...], msg: "success"}`. Not
 * `status.err_code` (the main API) and not `status.errcode` (webnewConnection).
 * Verified live 2026-09-01: 6 operators around 13.0296,77.5906, each with
 * opr_name / cnum / optrAddr / latitude / longitude / distance — exactly the
 * fields the Operator Details dialog shows.
 */
export async function getNearbyOperators({ lat, lng }) {
  const resp = await apiFetch(
    `${getBaseUrl()}apis/cust/clientlatlong/`,
    {
      method: "POST",
      headers: getHeaders({ profile: PROFILE.APIS, contentType: "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({ lat: String(lat ?? ""), lng: String(lng ?? "") }).toString(),
    },
    "getNearbyOperators",
    { group: "Customer", idempotent: true }
  );
  if (!resp.ok) throw new Error(`Could not load nearby operators (HTTP ${resp.status}).`);
  const data = await resp.json();
  const rows = Array.isArray(data?.result) ? data.result : [];
  return {
    ok: String(data?.msg || "").toLowerCase() === "success",
    operators: rows
      // Rows without coordinates cannot be placed; dropping them beats a pin at 0,0.
      .filter((o) => o?.latitude && o?.longitude)
      .map((o) => ({
        id: o.opt_id || o.sno,
        name: o.opr_name || "",
        phone: o.cnum || "",
        address: o.optrAddr || "",
        lat: Number(o.latitude),
        lng: Number(o.longitude),
        distance: Number(o.distance),
      })),
  };
}

/**
 * Eligibility gate — `POST Apis/noofconnection/` with `mobile`.
 *
 * The app calls this on entry (`getConnReqCount`) and again after every
 * successful submit, and uses it to ENABLE OR DISABLE the SELECT SERVICE
 * button. Without it the customer gets to fill the whole form and is only told
 * at the end that a request is already open.
 *
 * *** err_code IS MEANINGLESS HERE, AND INVERTED. *** Verified live:
 *   err_code 0 + "Request already made"                  -> BLOCKED
 *   err_code 1 + "no pending ticket for new connection"   -> ALLOWED
 * Android matches this exactly: both err_code branches run the same code and
 * compare only `err_msg`. So do we. Apis.php:5061 has four possible messages —
 * "limit exceeded" (more than 4 requests ever), "Request already made" (an
 * available/pending ticket exists), "please enter required fields", and the
 * one that means yes.
 *
 * Uses the `apis/*` credential set, like the operator pins and unlike the rest
 * of the funnel.
 */
export const CAN_REQUEST = "no pending ticket for new connection";

export async function checkRequestAllowed(mobile) {
  const resp = await apiFetch(
    `${getBaseUrl()}Apis/noofconnection/`,
    {
      method: "POST",
      headers: getHeaders({ profile: PROFILE.APIS, contentType: "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({ mobile: String(mobile || "").trim() }).toString(),
    },
    "noofconnection",
    { group: "Customer", idempotent: true }
  );
  if (!resp.ok) throw new Error(`Could not check your request status (HTTP ${resp.status}).`);
  const data = await resp.json();
  const reason = String(data?.status?.err_msg || "");
  return { allowed: reason === CAN_REQUEST, reason };
}
