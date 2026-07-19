/**
 * Customer profile — port of Android's ProfileFragment.
 *
 * Two endpoints, both under ServiceApis/ with the MAIN header profile:
 *   custViewProfile   GET   ?username=      → {status, body:{...}}
 *   custeEditProfile  POST  form-urlencoded → {status}
 *
 * The endpoint name really is "custeEditProfile" (typo is server-side).
 *
 * Deliberately NOT wrapped: uploadCustProfile/. The photo is display-only
 * here — the customer app in the field offers no way to change it.
 */
import { apiFetch, getBaseUrl, getHeaders, readEnvelope } from "../apiCore";

const GROUP = "Customer";

/** Load the logged-in customer's profile. */
export async function getProfile(username) {
  const url = `${getBaseUrl()}ServiceApis/custViewProfile?username=${encodeURIComponent(username)}`;
  const resp = await apiFetch(url, { method: "GET", headers: getHeaders() }, "custViewProfile", { group: GROUP });
  return (await readEnvelope(resp, "custViewProfile")).body || {};
}

/**
 * Save edited profile fields.
 * Android sends all five fields every time, changed or not — mirrored here.
 */
export async function editProfile({ username, mobileno, emailid, firstname, lastname }) {
  const url = `${getBaseUrl()}ServiceApis/custeEditProfile`;
  const body = new URLSearchParams({ username, mobileno, emailid, firstname, lastname });
  const resp = await apiFetch(url, {
    method: "POST",
    headers: getHeaders({ contentType: "application/x-www-form-urlencoded" }),
    body,
  }, "custeEditProfile", { group: GROUP });
  return readEnvelope(resp, "custeEditProfile");
}
