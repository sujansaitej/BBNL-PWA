/**
 * Customer profile — port of Android's ProfileFragment.
 *
 * Three endpoints, all under ServiceApis/ with the MAIN header profile:
 *   custViewProfile   GET   ?username=            → {status, body:{...}}
 *   custeEditProfile  POST  form-urlencoded       → {status}
 *   uploadCustProfile POST  multipart (part "photo") → {status, body:{photo}}
 *
 * The endpoint name really is "custeEditProfile" (typo is server-side).
 */
import { apiFetch, getBaseUrl, getHeaders, getHeadersForm, readEnvelope, UPLOAD_TIMEOUT } from "../apiCore";

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

/** Upload a new profile photo. Returns the new absolute photo URL. */
export async function uploadProfilePhoto({ username, file }) {
  const url = `${getBaseUrl()}ServiceApis/uploadCustProfile/`;
  const form = new FormData();
  form.append("username", username);
  form.append("photo", file, file.name || "profile.jpg");
  const resp = await apiFetch(url, { method: "POST", headers: getHeadersForm(), body: form },
    "uploadCustProfile", { group: GROUP, timeout: UPLOAD_TIMEOUT });
  return (await readEnvelope(resp, "uploadCustProfile")).body?.photo || "";
}
