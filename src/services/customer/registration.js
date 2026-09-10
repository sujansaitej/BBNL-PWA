// Customer self sign-up — the "New Connection" funnel.
//
// Ported from the Android CUSTOMER flavour: LoginActivity's "Sign Up" link
// (login_activity.xml `register_tv`) opens RegistrationActivity, a single form
// that POSTs ServiceApis/custRegistration and returns to the login screen.
//
// DISAMBIGUATION, because the name is overloaded in this codebase. The
// OPERATOR app also has a "New Connection" screen, and it is a different
// feature: a ticket queue (Apis/getNewConnectionTicket, filtering tickets whose
// subject and group1 are both the literal 'new Connection'). Those tickets are
// created by the netmon web console / call centre (route ticket/newconn ->
// Callcenter/managenewConnection) and NEVER by the customer app. This module is
// the customer-side funnel only: it creates a service-app customer account.
//
// WHAT THE BACKEND DOES ON SUCCESS
// (controllers/ServicesModules/ServiceAppRegistration.php::_registration)
//   - re-validates everything below, server side
//   - md5()s the password and inserts via saveServCust with status=1,
//     modifiedby='self'
//   - EMAILS AND SMSes THE USERNAME AND PASSWORD IN CLEARTEXT to the customer.
//     Nothing here can change that; it is noted so it is not a surprise.
//
// There is no OTP step, no auto-login, no plan choice and no document upload —
// Android has none of those on this screen either.

import { getBaseUrl, getHeadersForm, apiFetch } from "../apiCore";

/**
 * The response carries NO body — success and failure are both
 * `{status:{err_code, err_msg}}` — and the backend returns only `$error[0]`,
 * the FIRST validation failure. That is why validateSignUp() below mirrors the
 * rules client-side: without it the customer fixes one field per round trip.
 */
export async function registerCustomer({
  firstname, lastname, mobileno, emailid, username, password, address, pincode,
  latitude = "", longitude = "",
}) {
  const url = `${getBaseUrl()}ServiceApis/custRegistration`;

  // Form-urlencoded, exactly as Android's @FormUrlEncoded @POST declares it.
  // The controller reads $this->input->post(), which never sees a JSON body.
  const body = new URLSearchParams({
    firstname: String(firstname || "").trim(),
    lastname: String(lastname || "").trim(),
    mobileno: String(mobileno || "").trim(),
    emailid: String(emailid || "").trim(),
    username: String(username || "").trim(),
    password: String(password || ""),
    // Android hardcodes both to "" (RegistrationActivity:189-190) — the form
    // has no map or geolocation. Kept as parameters so a later screen can
    // supply them without touching the wire contract.
    latitude: String(latitude || ""),
    longitude: String(longitude || ""),
    address: String(address || "").trim(),
    pincode: String(pincode || "").trim(),
  }).toString();

  const resp = await apiFetch(
    url,
    {
      method: "POST",
      headers: getHeadersForm(),
      body,
    },
    "registerCustomer",
    {
      group: "Customer",
      // NOT idempotent — this creates an account and fires an email + SMS.
      // Must never be picked up by the load-balancer retry in apiCore.
      idempotent: false,
    }
  );

  if (!resp.ok) throw new Error(`Could not create the account (HTTP ${resp.status}).`);

  const data = await resp.json();
  const ok = Number(data?.status?.err_code) === 0;
  return {
    ok,
    message: String(data?.status?.err_msg || (ok ? "Registration successful." : "Could not create the account.")),
  };
}

// ── Client-side validation ──────────────────────────────────────────
//
// Every rule below is the backend's own, read from _registration() and then
// CONFIRMED against the live backend by submitting deliberately invalid
// payloads (each failed validation, so nothing was created):
//
//   ""                     -> "Please enter first name."
//   firstname=123          -> "First name should contain only alphabets."
//   mobileno=123456789     -> "Mobile-no is invalid."
//   username=ab            -> "Username length should be at least 5 characters."
//   password=x             -> "Password length should be at least 8 characters."
//   pincode=1234           -> "Please enter valid pincode."
//   password=Pass{word1    -> "Password is not allowed ... don't use (", ~, +, |, {, }, [, ], ;, ')"
//   username=namich        -> "Username already exists, enter different username."
//
// Uniqueness (mobile / email / username) can only be answered by the server, so
// those stay server-only and surface as a field error when it replies.

/** Characters the backend rejects outright in a password. */
export const FORBIDDEN_PASSWORD_CHARS = ['"', "~", "+", "|", "{", "}", "[", "]", ";", "'"];

export const SIGNUP_LIMITS = {
  usernameMin: 5,
  passwordMin: 8,
  mobileLength: 10,
  pincodeLength: 6,
};

/**
 * @returns {Record<string,string>} field -> message. Empty object = valid.
 */
export function validateSignUp(form) {
  const e = {};
  const val = (k) => String(form?.[k] ?? "").trim();

  // Names: required AND alphabets-only. The backend's check is
  // preg_match("/[A-Za-z]+/") — which only requires SOME letter — but it
  // rejects "123" outright, so a stricter letters-and-spaces rule here matches
  // intent without ever passing something the server would refuse.
  for (const [field, label] of [["firstname", "First name"], ["lastname", "Last name"]]) {
    const v = val(field);
    if (!v) e[field] = `${label} is required.`;
    else if (!/^[A-Za-z][A-Za-z\s.'-]*$/.test(v)) e[field] = `${label} should contain only letters.`;
  }

  const mobile = val("mobileno");
  if (!mobile) e.mobileno = "Mobile number is required.";
  else if (!/^\d+$/.test(mobile)) e.mobileno = "Mobile number should contain only digits.";
  else if (mobile.length !== SIGNUP_LIMITS.mobileLength) {
    e.mobileno = `Mobile number should be ${SIGNUP_LIMITS.mobileLength} digits.`;
  }

  const email = val("emailid");
  if (!email) e.emailid = "Email is required.";
  // Deliberately permissive — the server runs FILTER_VALIDATE_EMAIL and is the
  // authority. This only catches the obviously-wrong before a round trip.
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.emailid = "Enter a valid email address.";

  const username = val("username");
  if (!username) e.username = "Username is required.";
  else if (username.length < SIGNUP_LIMITS.usernameMin) {
    e.username = `Username should be at least ${SIGNUP_LIMITS.usernameMin} characters.`;
  } else if (!/^[A-Za-z0-9_]+$/.test(username)) {
    e.username = "Username can use only letters, numbers and underscore.";
  }

  const password = String(form?.password ?? "");
  if (!password) e.password = "Password is required.";
  else if (password.length < SIGNUP_LIMITS.passwordMin) {
    e.password = `Password should be at least ${SIGNUP_LIMITS.passwordMin} characters.`;
  } else {
    const bad = FORBIDDEN_PASSWORD_CHARS.filter((c) => password.includes(c));
    if (bad.length) e.password = `Password cannot contain ${bad.join(" ")}`;
  }

  if (!val("address")) e.address = "Address is required.";

  const pincode = val("pincode");
  if (!pincode) e.pincode = "Pincode is required.";
  else if (!/^\d+$/.test(pincode)) e.pincode = "Pincode should contain only digits.";
  else if (pincode.length !== SIGNUP_LIMITS.pincodeLength) {
    e.pincode = `Pincode should be ${SIGNUP_LIMITS.pincodeLength} digits.`;
  }

  return e;
}

/**
 * Map the backend's single error message back onto a field, so it lands under
 * the input the customer has to fix instead of only in a toast.
 *
 * Only the server can know these — they are uniqueness checks and blocklists.
 * Anything unrecognised returns null and is shown as a form-level message.
 */
export function fieldForServerError(message) {
  const m = String(message || "").toLowerCase();
  if (/username/.test(m)) return "username";
  if (/password/.test(m)) return "password";
  if (/mobile/.test(m)) return "mobileno";
  if (/email/.test(m)) return "emailid";
  if (/pincode/.test(m)) return "pincode";
  if (/address/.test(m)) return "address";
  if (/first name/.test(m)) return "firstname";
  if (/last name/.test(m)) return "lastname";
  return null;
}
