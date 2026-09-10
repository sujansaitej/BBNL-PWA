/**
 * notifications.js — Notification History, ported from the Android CRM app's
 * dashboard overflow menu (NotificationHistory.java).
 *
 * Contract read from the BACKEND SOURCE, not inferred from the Android models:
 * application/controllers/Notification.php::AppNotificationHistory(), routed
 * from `notification/history` (config/routes.php:586).
 *
 *   $appDet  = json_decode(file_get_contents('php://input'), true);
 *   $auth    = $this->input->get_request_header('Authorization');
 *   if ($appDet['fcmkey'] == 'APPFCM' && $auth == $this->authkey) { … }
 *   else  err_code 1, "Failed to authenticate"
 *
 * Three consequences, each verified live 2026-08-18:
 *
 * 1. THE BODY MUST BE RAW JSON. The controller reads php://input directly and
 *    never touches $_POST, so a form-encoded body leaves every field null and
 *    the response is "Failed to authenticate" — an auth error for what is
 *    really an encoding mistake. That misleading message cost a full round of
 *    credential guessing before the source settled it.
 *
 * 2. NO OTHER AUTH HEADERS. Only Authorization is compared, against a
 *    hardcoded literal. username/password/appkeytype are ignored, and Android
 *    sends none of them (ApiInterface.java:933).
 *
 * 3. `cid` IS THE OPERATOR'S ADMIN LOGIN, not a customer id. With
 *    app_type "crm" the server looks it up as `admin.user`
 *    (Notification_model::getCustDetails). Android passes the stored
 *    `app_username` (NotificationHistory.java:57). `fcmkey` is the literal
 *    string "APPFCM" — a constant, NOT a Firebase token
 *    (NotificationHistory.java:37), so this needs no push registration.
 *
 * ── BACKEND HISTORY ─────────────────────────────────────────────────
 * On 2026-08-18 every request that reached the database returned HTTP 500
 * with an empty body, on both hosts and both branches. Re-checked 2026-08-19:
 * FIXED — the test backend now answers
 * {"err_code":0,"err_msg":"Notification listed successfully"} with real rows.
 * The 500 handling below is kept deliberately: it is how this screen tells an
 * operator the truth if it regresses, instead of showing an empty list. The
 * Android app has no such handling — its requestFailed() only logs
 * (NotificationHistory.java:107), so the screen just stays blank.
 */

import { getBaseUrl, apiFetch } from "./apiCore";

/** The server's literal, not a Firebase token. */
const FCM_KEY = "APPFCM";

/**
 * app_type accepted by the backend: 'crm' (operator) | 'customer_app'.
 *
 * THIS SELECTS THE FEED — it is not a label. The same cid returns different
 * rows for each, verified live 2026-08-31:
 *   cid=superadmin app_type=crm          → "Transaction success!!" …
 *   cid=superadmin app_type=customer_app → "Welcome" …
 * Sending 'crm' for a customer looks them up as an `admin.user`, so they can
 * only ever be told they have nothing. Callers must pass the one that matches
 * the signed-in portal; the default below is the operator feed.
 *
 * Any other value is rejected outright — the backend answers "No Records
 * found" for 'employee'/'customer', which reads exactly like an empty inbox.
 */
export const APP_TYPE_CRM = "crm";
export const APP_TYPE_CUSTOMER = "customer_app";

/**
 * Fetch the notification history for one app user.
 *
 * @param {object}  params
 * @param {string}  params.cid      operator admin login (or customer CID)
 * @param {string} [params.appType] APP_TYPE_CRM by default
 * @returns {Promise<{ok: boolean, items: Array, empty: boolean, message: string}>}
 *   `ok:false` is a real failure worth showing; `ok:true, empty:true` is the
 *   legitimate "nothing to show" state.
 */
export async function getNotificationHistory({ cid, appType = APP_TYPE_CRM }) {
    const url = `${getBaseUrl()}notification/history`;
    const resp = await apiFetch(
        url,
        {
            method: "POST",
            // Authorization ONLY — see note 2 above.
            headers: {
                Authorization: import.meta.env.VITE_NOTIFICATION_AUTH_KEY,
                "Content-Type": "application/json",
            },
            // Raw JSON — see note 1. Never URLSearchParams here.
            body: JSON.stringify({ fcmkey: FCM_KEY, cid: String(cid || ""), app_type: appType }),
        },
        "getNotificationHistory"
    );

    if (!resp.ok) {
        // The documented 500 lands here. Say what is actually wrong rather
        // than rendering an empty list that reads as "no notifications".
        throw new Error(
            resp.status >= 500
                ? "Notifications are unavailable right now (server error)."
                : `Could not load notifications (HTTP ${resp.status}).`
        );
    }

    const data = await resp.json();
    const code = Number(data?.status?.err_code);
    const message = String(data?.status?.err_msg || "");
    const items = Array.isArray(data?.body) ? data.body : [];

    // err_code 0 = listed successfully. err_code 1 covers BOTH the benign
    // "No Records found" and genuine failures, so the message has to be read
    // to tell them apart — treating every 1 as an error would show a scary
    // banner to an operator who simply has no notifications yet.
    if (code === 0) return { ok: true, items, empty: items.length === 0, message };
    if (/no records/i.test(message)) return { ok: true, items: [], empty: true, message };
    return { ok: false, items: [], empty: true, message: message || "Could not load notifications." };
}

/**
 * Tags kept when rendering a notification body.
 *
 * `message` arrives as HTML — real payload, captured 2026-08-19:
 *
 *   "<div><p><b>Dear superadmin,</b><p>Your transaction for renewing…
 *    with amount <b>Rs:220</b> is <b>success!!</b>…</p></div>"
 *
 * Android renders it with HtmlCompat.fromHtml (NotificationAdapter.java:47,
 * NotificationHistory.java:135), so showing the raw tags would be wrong. But
 * Android's parser is a TEXT renderer with no script engine — a browser is
 * not, and these templates are authored in an admin console. Injecting the
 * string straight into innerHTML would therefore turn a compromised or
 * careless template into stored XSS in the operator's session.
 *
 * So: render the formatting, drop everything else. Only these tags survive,
 * and they survive WITHOUT attributes — which removes onclick/onerror,
 * javascript: hrefs and style-based vectors in one stroke, rather than trying
 * to enumerate and block them.
 */
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "P", "DIV", "BR", "SPAN", "UL", "OL", "LI"]);

/**
 * Reduce notification HTML to a safe formatting-only subset.
 *
 * Uses DOMParser rather than regex: regex cannot reliably parse HTML, and the
 * cases it gets wrong are exactly the ones an attacker picks. Anything not on
 * the allowlist is replaced by its own text content, so no wording is ever
 * lost — only markup.
 *
 * @param {string} html
 * @returns {string} sanitised HTML, safe for dangerouslySetInnerHTML
 */
export function sanitiseNotificationHtml(html) {
    const raw = String(html || "");
    if (!raw) return "";
    if (typeof DOMParser === "undefined") {
        // No DOM (SSR/tests): degrade to plain text rather than emit markup.
        return raw.replace(/<[^>]*>/g, "");
    }

    const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
    const root = doc.body.firstChild;

    const clean = (node) => {
        // Text passes through; the DOM API escapes it on write.
        if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
        if (node.nodeType !== 1) return null;

        const children = Array.from(node.childNodes).map(clean).filter(Boolean);

        if (!ALLOWED_TAGS.has(node.tagName)) {
            // Disallowed element → keep its text, discard the element.
            // <script>/<style> contribute nothing because their text is
            // dropped here too rather than being surfaced as visible content.
            if (node.tagName === "SCRIPT" || node.tagName === "STYLE") return null;
            const frag = doc.createDocumentFragment();
            children.forEach((c) => frag.appendChild(c));
            return frag;
        }

        // Rebuilt from the tag name only — every attribute is dropped.
        const el = doc.createElement(node.tagName.toLowerCase());
        children.forEach((c) => el.appendChild(c));
        return el;
    };

    const out = doc.createElement("div");
    Array.from(root.childNodes).map(clean).filter(Boolean).forEach((c) => out.appendChild(c));
    return out.innerHTML;
}

/**
 * Normalise one history row for rendering.
 * Server shape: {title, file_type, message, media, time, icon}
 * (`media` is null unless the template had an attachment; `time` is already a
 * human string from the server's timeago(), not a timestamp.)
 */
export function normaliseNotification(row) {
    const rawMessage = row?.message || "";
    return {
        title: row?.title || "",
        // Kept for previews/search where markup would be noise.
        message: rawMessage,
        messageHtml: sanitiseNotificationHtml(rawMessage),
        // Absolute URLs built server-side via site_url()/base_url().
        media: row?.media || "",
        fileType: String(row?.file_type || "").toLowerCase(),
        icon: row?.icon || "",
        time: row?.time || "",
    };
}

/** Plain-text form of a notification body, for list previews. */
export function notificationPlainText(html) {
    const stripped = String(html || "").replace(/<[^>]*>/g, " ");
    // Decode the handful of entities these templates actually use.
    return stripped
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}
