// FO-Fi Cloud — photo album upload for a customer's FO-Fi / OTT box.
//
// PWA port of Android's UploadImagesToCloudStorage fragment (customer flavour),
// reached from the cloud icon on the box selector bar of the service home
// screen. The photos land in the box's cloud album and become the screen-saver
// / gallery on the TV.
//
// ── THE ENDPOINT ────────────────────────────────────────────────────
//
//   POST {base}fofi/fofiapis/cloudUpload/     (multipart/form-data)
//     cid          — the service user id  (user_info.cid)
//     mac_address  — the box SERIAL NUMBER (see below)
//     files[]      — one part per image, repeated
//
// A FOURTH CREDENTIAL POSTURE. Every other customer endpoint sends the
// {Authorization, username, password, appkeytype} quartet. This one sends a
// SINGLE `Authorization: Basic …` header and nothing else — the backend
// compares it byte-for-byte against Fofiapis::$authkey and answers "Failed to
// authenticate!" on any mismatch. Sending the usual quartet fails; sending
// this key on any other endpoint fails. Do not route this through
// apiCore's PROFILE builders — it is deliberately outside them.
// (Verified in the backend source: application/controllers/fofi/Fofiapis.php.)
//
// ── mac_address IS THE SERIAL NUMBER, NOT A MAC ─────────────────────
//
// The backend resolves the customer with
//     select … from user_info where cid=? and fofi_mac_address=?
// and `user_info.fofi_mac_address` does not hold a MAC. Registration swaps the
// two columns on the way in:
//
//     $reg['fofi_mac_address'] = $reg['fofi_serialno'];   // Fofiapis::register
//     $reg['mac']              = $reg['fofi_mac_address'];
//
// So the value to send is `fserialno` from getUserAssignedItems — the same
// field Android passes (`selectedBox_serialNum`). Sending the box id
// (BBNL-ANDBOX-…) or the real MAC returns "Invalid User ID". The real MAC is
// used only server-side, as the destination folder name.
//
// ── PRIMARY BOXES ONLY ──────────────────────────────────────────────
//
// checkuser() reads `user_info` alone. A secondary/linked box lives in
// `linkeddevices`, so its serial never matches and the upload is rejected with
// "Invalid User ID" no matter how valid the images are. Android carries an
// `isSelectedBoxPrimary` argument into the fragment and then never reads it,
// so it shows that bare backend string. `isPrimaryBox` below exists so the UI
// can say something true instead.
//
// ── THE RESPONSE ────────────────────────────────────────────────────
//
//   { body: [ {filename, filesize, status:"success"|"failed"}, … ],
//     status: { err_code: 0|1, err_msg: "…" } }
//
// err_code is 0 ONLY when every file succeeded; ANY failure makes it 1 while
// `body` still lists each file's individual outcome. Android gates its result
// list on `errCode == 0`, so a partial upload — the exact case the per-file
// list was built for — renders nothing at all and the customer is told
// nothing. We always surface `rows`.

import { apiFetch, getBaseUrl } from "../apiCore";
import logger from "../../utils/logger";
import { isFofiAndroidBoxId } from "../../utils/boxId";

const GROUP = "CustCloudUpload";

/** Fofiapis::$authkey, verbatim. Base64 of `fofilab@gmail.com:12345-54321`. */
const CLOUD_AUTH = "Basic Zm9maWxhYkBnbWFpbC5jb206MTIzNDUtNTQzMjE=";

/** Android's own cap: `if (mClipData.getItemCount() <= 20)`. */
export const MAX_FILES = 20;

/**
 * The backend's whitelist, verbatim:
 *   $alwdformats = array("image/jpeg", "image/jpg", "image/png");
 * It matches on the browser-reported MIME type, not the extension. Anything
 * else is counted as failed with "Wrong file format" — notably HEIC/HEIF,
 * which is what an iPhone hands over by default, and WebP.
 */
export const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

/**
 * Per-image cap: 2 MB. A PRODUCT rule, set 2 Sep 2026.
 *
 * Neither the Android app nor the backend enforces a size: the fragment posts
 * the gallery original untouched, and Fofiapis::cloudUpload has no size check
 * at all — its ">100MB" wording is just text in an error string. So this is
 * the only place the limit lives; do not go looking for a server-side echo of
 * it.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Human-readable size, matching the backend's calculateFileSize() (base 1000). */
export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = n;
  let i = 0;
  while (size > 1000 && i < units.length - 1) {
    size = Math.round((size / 1000) * 100) / 100;
    i++;
  }
  return `${size} ${units[i]}`;
}

/**
 * Split a picked file list into what the backend will accept and what it will
 * not, BEFORE anything is uploaded.
 *
 * Android skips this entirely: it posts whatever the gallery returned and lets
 * the server reject it, so a customer who picked HEIC photos waits out the
 * whole upload to be told "Wrong file format/file size >100MB" — a message
 * that names two possible causes and commits to neither. Filtering here costs
 * nothing and lets us name the actual file.
 *
 * The 20-file cap is applied to the ACCEPTED files, not the raw selection, so
 * unsupported picks do not silently consume slots.
 *
 * @returns {{accepted: File[], rejected: {file: File, reason: string}[], overflow: File[]}}
 */
export function partitionFiles(fileList) {
  const files = Array.from(fileList || []);
  const accepted = [];
  const rejected = [];

  for (const file of files) {
    const type = String(file?.type || "").toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) {
      rejected.push({
        file,
        reason: type
          ? `${type.replace(/^image\//, "").toUpperCase()} isn't supported — use JPG or PNG.`
          : "Unrecognised file type — use JPG or PNG.",
      });
    } else if (file.size > MAX_FILE_BYTES) {
      rejected.push({ file, reason: `Larger than ${formatSize(MAX_FILE_BYTES)}.` });
    } else {
      accepted.push(file);
    }
  }

  return {
    accepted: accepted.slice(0, MAX_FILES),
    rejected,
    overflow: accepted.slice(MAX_FILES),
  };
}

/**
 * A linked (secondary) box cannot receive uploads — see the note at the top.
 * getUserAssignedItems marks the primary with `primarybox: "yes"`.
 */
export function isPrimaryBox(conn) {
  return String(conn?.primarybox ?? "").toLowerCase() !== "no";
}

/**
 * Can THIS row receive cloud-album uploads at all? Decided from the data, up
 * front, instead of letting the backend answer "Invalid User ID" after the
 * whole upload — which is what QA hit on production (2 Sep 2026) with a
 * "TV-e118a9…" device.
 *
 * getAllFofiBoxesofCustomer (Fofi_model.php:1207) builds the connection list
 * from FOUR sources, and cloudUpload's checkuser() reads exactly ONE of them
 * (`user_info`). The other three can never match:
 *
 *   user_info           real FoFi box, fofi_serialno as fserialno    -> OK
 *   linkeddevices       secondary box, primarybox "no"               -> rejected
 *   unicast_users_new   Android-TV / unicast app, `TV-<hash>` id,
 *                       and *deviceid* copied into fserialno         -> rejected
 *   cbl_linkeddevices   cable STB, devid as fserialno                -> rejected
 *
 * The unicast row is the nasty one: it says `primarybox: "yes"`, so the
 * primary check passes, and it has a non-empty fserialno, so the icon is
 * enabled — yet it is not a FoFi box and has no user_info row. Android shows
 * the very same icon for it and fails the very same way; the difference in
 * QA's test was the DEVICE, not the app.
 *
 * The tell is the box id: the backend's own chk__fofiboxid gate (AUG-ANDBOX- /
 * BBNL-ANDBOX-) is what isFofiAndroidBoxId mirrors.
 *
 * @returns {{ok: boolean, reason: string}}
 */
export function cloudUploadEligibility(conn) {
  const boxid = String(conn?.product_name || "");
  const serial = String(conn?.fserialno || "");
  if (!serial) {
    return { ok: false, reason: "This connection has no box serial number, so its album cannot be addressed." };
  }
  if (!isFofiAndroidBoxId(boxid)) {
    return {
      ok: false,
      reason: "Photo albums are only available on a FO-Fi Smart Box. This connection is a TV app or cable device, which has no album to upload to.",
    };
  }
  if (!isPrimaryBox(conn)) {
    return { ok: false, reason: "This is a linked box. Photos can only be uploaded to your primary box." };
  }
  return { ok: true, reason: "" };
}

/**
 * Upload timeout.
 *
 * The 60s UPLOAD_TIMEOUT is sized for one profile photo. This request carries
 * up to 20 originals AND the backend re-posts each one, ONE AT A TIME, over a
 * blocking curl to the cloud storage host before it answers — so wall time
 * grows with the file count on the server side too, not just on the wire.
 * A fixed cap aborts a perfectly healthy 15-photo upload; a per-file budget
 * does not. Capped at five minutes so a genuinely stuck request still ends.
 */
export function uploadTimeout(count) {
  return Math.min(30000 + Math.max(1, count) * 20000, 300000);
}

/**
 * Send images to the box's cloud album.
 *
 * @param {object}  args
 * @param {string}  args.cid          service user id (account.userid)
 * @param {string}  args.macAddress   box serial number (connection.fserialno)
 * @param {File[]}  args.files        JPG/PNG files, already partitioned
 * @returns {Promise<{ok, message, rows, succeeded, failed, raw}>}
 *
 * `rows` is populated on partial failure too — that is the whole point of it.
 * Transport and parse failures throw; a rejected upload does not.
 */
export async function uploadImagesToCloud({ cid, macAddress, files }) {
  const list = Array.from(files || []);
  if (!list.length) throw new Error("Choose at least one image to upload.");
  if (!cid || !macAddress) {
    throw new Error("This connection is missing its box details. Go back and reselect it.");
  }

  const form = new FormData();
  form.append("cid", cid);
  form.append("mac_address", macAddress);
  // `files[]`, WITH the brackets. PHP only builds $_FILES['files'] as parallel
  // ARRAYS when the field name ends in []; plain `files` gives scalars, and the
  // controller's `foreach ($filenames as …)` then walks a string.
  for (const file of list) form.append("files[]", file, file.name || "image.jpg");

  const url = `${getBaseUrl()}fofi/fofiapis/cloudUpload/`;
  const resp = await apiFetch(
    url,
    {
      method: "POST",
      // No Content-Type — the browser must set the multipart boundary itself.
      headers: { Authorization: CLOUD_AUTH },
      body: form,
    },
    "cloudUpload",
    { group: GROUP, timeout: uploadTimeout(list.length), linkNavigation: false }
  );

  if (!resp.ok) throw new Error(`Upload failed (HTTP ${resp.status}).`);

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_e) {
    logger.error("cloudUpload", `Invalid JSON response (HTTP ${resp.status})`);
    throw new Error("Server returned an invalid response. Please try again.");
  }

  const rows = Array.isArray(data?.body) ? data.body : [];
  const succeeded = rows.filter((r) => String(r?.status).toLowerCase() === "success").length;

  return {
    ok: Number(data?.status?.err_code) === 0,
    message: data?.status?.err_msg || "",
    rows,
    succeeded,
    failed: rows.length - succeeded,
    raw: data,
  };
}
