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
import { compressImage } from "../imageCompress";
import logger from "../../utils/logger";

const GROUP = "Customer";

/** Load the logged-in customer's profile. */
export async function getProfile(username) {
  const url = `${getBaseUrl()}ServiceApis/custViewProfile?username=${encodeURIComponent(username)}`;
  const resp = await apiFetch(url, { method: "GET", headers: getHeaders() }, "custViewProfile", { group: GROUP, idempotent: true });
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

/**
 * Server-side failures the customer cannot act on.
 *
 * `fileUpload()` (custom_helper.php) hands CodeIgniter's raw Upload-library
 * strings straight back in err_msg, and the app was showing them verbatim.
 * "The upload destination folder does not appear to be writable." describes
 * `/var/tabdata/uploads/serv_custimgs/` on the SERVER — proven 2026-08-31 by
 * posting a .txt, which can never be stored (allowed_types = jpg|png|jpeg) and
 * still produced that message, because CI checks the path before the filetype.
 * Retrying, choosing a smaller photo or a different format cannot help, so
 * saying so is the only honest response.
 */
const SERVER_SIDE_UPLOAD_FAULTS = [
  [/not\s+appear\s+to\s+be\s+writable/i,
   "Photo uploads are temporarily unavailable on the server. Please report this to support — nothing is wrong with your photo."],
  [/no\s+tmp\s+directory|unable\s+to\s+write\s+file/i,
   "The server could not store your photo. Please report this to support."],
];

function mapUploadError(err) {
  const msg = String(err?.message || "");
  for (const [pattern, friendly] of SERVER_SIDE_UPLOAD_FAULTS) {
    if (pattern.test(msg)) {
      logger.error("uploadCustProfile", `server-side upload fault: ${msg}`);
      return new Error(friendly);
    }
  }
  return err;
}

/**
 * Upload a new profile photo. Returns the new absolute photo URL.
 *
 * The file is downscaled and re-encoded to JPEG first — see imageCompress.js.
 * Android does exactly this (Zelory Compressor) and the PWA did not, which is
 * why a normal camera photo could exceed the backend's 5 MB `max_size` and why
 * low-end phones hit Chrome's own out-of-memory toast.
 *
 * The backend derives the STORED filename's extension from the part filename
 * (`pathinfo($fn)['extension']` → `profile-<username>.<ext>`), so the `.jpg`
 * rename compressImage does is load-bearing: it keeps the stored extension
 * honest about the bytes. Android leaves the original name on compressed-to-
 * JPEG data, so a picked .png is stored as .png containing JPEG.
 */
export async function uploadProfilePhoto({ username, file }) {
  const photo = await compressImage(file);
  const url = `${getBaseUrl()}ServiceApis/uploadCustProfile/`;
  const form = new FormData();
  form.append("username", username);
  form.append("photo", photo, photo.name || "profile.jpg");
  try {
    const resp = await apiFetch(url, { method: "POST", headers: getHeadersForm(), body: form },
      "uploadCustProfile", { group: GROUP, timeout: UPLOAD_TIMEOUT });
    return (await readEnvelope(resp, "uploadCustProfile")).body?.photo || "";
  } catch (err) {
    throw mapUploadError(err);
  }
}
