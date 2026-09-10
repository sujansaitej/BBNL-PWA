// "New Connection" — a signed-in customer requesting an additional connection.
//
// WHY THIS IS NOT A LINE-FOR-LINE PORT.
// The Android APK has this as the third bottom-nav tab ("New Connection", a "+"
// icon). The source snapshot in crmapp-new-master is OLDER than that build: its
// third tab is `bottom_menu_info`, titled "Info", and the handler is a
// `Toast("Coming soon!")` with the fragment commented out
// (customer/.../MainActivity.java). So there is no Android implementation here
// to copy — this is written against the BACKEND the feature has to reach.
//
// WHERE THE REQUEST LANDS, which is the actual requirement: the operator
// portal's Tickets page has a New Connection section, fed by
// `Apis/getNewConnectionTicket`, which selects tickets whose `subject` AND
// `group1` are both the literal 'new Connection'.
//
// The only public pathway that produces such a ticket is this endpoint. Read
// from application/modules/WebModule/controllers/WebMod/Sections.php
// ::newConnection() — it validates, then calls Complaints/newComplaint with
// `subject: 'new connection'`, which is what the operator queue matches
// (MySQL's default collation is case-insensitive).
//
// THREE BACKEND QUIRKS THIS HAS TO LIVE WITH. All three are in their code, none
// is fixable from here, and one is worked around below.
//
//  1. `operatorid` is HARDCODED to 'BBNL_OP49' (Sections.php:345). Every
//     request goes to that operator regardless of who the customer is.
//  2. THE ADDRESS IS SILENTLY DROPPED. The wrapper sets
//     `$reqArvar['address']` (:426) but Complaints/newComplaint reads
//     `custAddress` (:347). The names do not match, so the address never
//     reaches the ticket. WORKED AROUND: we also put the address and pincode
//     into `comments`, which does survive — see below.
//  3. The comment is mangled by an operator-precedence bug (:347):
//         'raised from new bbnl website' . $comments != '' ? ", $comments" : ""
//     `.` binds tighter than `!=`, so the left side is always a non-empty
//     string, the condition is always true, and the result is always
//     `", $comments"`. The upside is that whatever we send in `comments` DOES
//     reach the ticket — which is what makes the workaround in (2) possible.

import { getBaseUrl, apiFetch } from "../apiCore";

/**
 * Fields the endpoint requires, in the order it validates them — established
 * by walking the validation live on 2026-09-01 with deliberately incomplete
 * payloads, so nothing was created:
 *
 *   {}                                   -> "Please enter name"
 *   {name}                               -> "Please enter email"
 *   {name,email}                         -> "Please enter username"   (field is `uname`)
 *   {name,email,uname}                   -> "Please enter address"
 *   {name,email,uname,address}           -> "Please enter mobile"     (field is `mobileno`)
 *   {name,email,uname,address,mobileno}  -> "Please enter pincode"
 *   pincode too short                    -> "Pincode must be 6"
 *
 * NOTE THE FIELD NAMES. `uname` not `username`, `mobileno` not `mobile` —
 * the error messages say "username" and "mobile", which is how a reasonable
 * guess sends the wrong key and gets the same error back forever.
 */
export async function requestNewConnection({
  name, email, uname, address, mobileno, pincode, comments = "",
}) {
  const url = `${getBaseUrl()}webmodapi/webnewConnection`;

  // The address never reaches the ticket through its own field (quirk 2), so
  // it is repeated here where it does survive. Without this the operator opens
  // a new-connection request with no idea where to send an engineer.
  const trail = [
    `New connection requested from the BBNL app by ${uname}`,
    `Address: ${address}`,
    `Pincode: ${pincode}`,
    comments ? `Notes: ${comments}` : "",
  ].filter(Boolean).join(" | ");

  const resp = await apiFetch(
    url,
    {
      method: "POST",
      // JSON, not form-urlencoded. The controller reads _POSTVAR, which is
      // populated from the raw input stream; a form body leaves every field
      // empty and it answers "Please enter name" whatever you send.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(name || "").trim(),
        email: String(email || "").trim(),
        uname: String(uname || "").trim(),
        address: String(address || "").trim(),
        mobileno: String(mobileno || "").trim(),
        pincode: String(pincode || "").trim(),
        comments: trail,
      }),
    },
    "requestNewConnection",
    {
      group: "Customer",
      // Raises a ticket. Must never be replayed by the load-balancer retry in
      // apiCore, or the operator gets the same request twice.
      idempotent: false,
    }
  );

  if (!resp.ok) throw new Error(`Could not send the request (HTTP ${resp.status}).`);

  const data = await resp.json();

  // A DIFFERENT ENVELOPE FROM THE REST OF THE API. This one is
  // `{result, status:{errcode, message}}` with a NUMERIC HTTP-style code —
  // 200 success, 400 validation — not the usual
  // `{status:{err_code, err_msg}, body}` where 0 means success. Reading it with
  // the normal envelope helper would treat every success as a failure.
  const code = Number(data?.status?.errcode);
  const message = String(data?.status?.message || "");

  return {
    ok: code === 200,
    // On success the backend answers "Thank you, Our callcenter team will soon
    // connect you" — but only after string-matching its own inner response, so
    // it can also answer "Something went wrong, please try again later" at
    // errcode 200. Surface whatever it said rather than inventing a message.
    message: message || (code === 200 ? "Request sent." : "Could not send the request."),
  };
}

// ── Client-side validation ──────────────────────────────────────────
// Mirrors Sections.php::newConnection(). The endpoint returns only `$emsg[0]`,
// the first failure, so without this the customer fixes one field per round
// trip.
export const NEW_CONNECTION_LIMITS = { pincodeLength: 6, mobileMin: 10, mobileMax: 15 };

/** Mobile numbers the backend rejects outright (Sections.php:394). */
const BLOCKED_MOBILES = ["0000000000", "1111111111", "3333333333"];

export function validateNewConnection(form) {
  const e = {};
  const val = (k) => String(form?.[k] ?? "").trim();

  const name = val("name");
  if (!name) e.name = "Name is required.";
  else if (!/[A-Za-z]/.test(name)) e.name = "Name should contain letters.";

  const email = val("email");
  if (!email) e.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email address.";

  if (!val("uname")) e.uname = "Username is required.";
  if (!val("address")) e.address = "Address is required.";

  const mobileno = val("mobileno");
  if (!mobileno) e.mobileno = "Mobile number is required.";
  else if (!/^\d+$/.test(mobileno)) e.mobileno = "Mobile number should contain only digits.";
  else if (BLOCKED_MOBILES.includes(mobileno)) e.mobileno = "Enter a valid mobile number.";
  else if (mobileno.length < NEW_CONNECTION_LIMITS.mobileMin) {
    e.mobileno = `Mobile number should be at least ${NEW_CONNECTION_LIMITS.mobileMin} digits.`;
  } else if (mobileno.length > NEW_CONNECTION_LIMITS.mobileMax) {
    e.mobileno = `Mobile number should be at most ${NEW_CONNECTION_LIMITS.mobileMax} digits.`;
  }

  const pincode = val("pincode");
  if (!pincode) e.pincode = "Pincode is required.";
  else if (!/^\d+$/.test(pincode)) e.pincode = "Pincode should contain only digits.";
  else if (pincode.length !== NEW_CONNECTION_LIMITS.pincodeLength) {
    e.pincode = `Pincode must be ${NEW_CONNECTION_LIMITS.pincodeLength} digits.`;
  }

  return e;
}
