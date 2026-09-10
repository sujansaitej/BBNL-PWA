// Client-side Easebuzz web checkout — the browser equivalent of the native
// app's in-app SDK flow (CommonPaymentInfoFragment → PWECouponsActivity).
//
// Native computes the SHA-512 hash on-device from the salt that paymentinfo
// returns, then hands off to the Easebuzz Android SDK. The web equivalent:
// compute the hash here, POST payment/initiateLink to get an access_key, then
// drive easebuzz-checkout-v2.js (modal — user never leaves the PWA).
//
// CROSS-ORIGIN SEAM. initiateLink is a server-to-server endpoint that sends no
// CORS headers, so a direct browser fetch is blocked. We route it through a
// SAME-ORIGIN proxy path — the vite dev proxy locally (see vite.config.js), and
// a host reverse-proxy in prod. The read-only PHP backend is never touched.
//
// HASH SEQUENCE. We use Easebuzz's OFFICIAL sequence (verified against the docs
// and the backend's easebuzz-lib), NOT native's `…|udf5|||||salt|key` string —
// native's Android SDK tolerated its variant; a direct initiateLink call will
// reject anything but the official order:
//   key|txnid|amount|productinfo|firstname|email|udf1|…|udf10|salt

const EZ_CHECKOUT_SRC =
  "https://ebz-static.s3.ap-south-1.amazonaws.com/easecheckout/v2.0.0/easebuzz-checkout-v2.min.js";

// Only a PRODUCTION-mode build hits live Easebuzz; dev and `--mode test` builds
// use the sandbox, so a test deployment can never fire a real charge. Override
// per-build with VITE_EASEBUZZ_ENV=test|prod.
export const EZ_ENV = String(
  import.meta.env.VITE_EASEBUZZ_ENV || (import.meta.env.MODE === "production" ? "prod" : "test")
).toLowerCase();

// Server-team creds — used when paymentinfo omits the creds block (Internet's
// makepayment never returns one; FoFi/IPTV paymentinfo does).
export const EZ_FALLBACK = {
  test: { key: "2PBP7IABZ2", salt: "DAH88E3UWQ" },
  prod: { key: "P0O87KRJ4R", salt: "PM1XH32XM4" },
};

/**
 * Resolve {key,salt} for the current env from a paymentinfo easebuzzpay_cred
 * block (test → easebuzztest, prod → fofieasebuzz), falling back to the
 * server-team values when the block is absent.
 */
export function resolveCreds(block) {
  const b = EZ_ENV === "test" ? block?.easebuzztest : block?.fofieasebuzz;
  return {
    key: b?.key || EZ_FALLBACK[EZ_ENV].key,
    salt: b?.salt || EZ_FALLBACK[EZ_ENV].salt,
  };
}

// In-flight transaction ids — native's tid_in_hashmap. If a payment-info call
// hands back a tid we started but never finished, kill it before reusing.
const TID_KEY = "ez_inflight_tids";
export function readTids() {
  try { return JSON.parse(localStorage.getItem(TID_KEY) || "[]"); } catch { return []; }
}
export function addTid(t) {
  try { const s = new Set(readTids()); s.add(t); localStorage.setItem(TID_KEY, JSON.stringify([...s])); } catch { /* quota */ }
}
export function removeTid(t) {
  try { localStorage.setItem(TID_KEY, JSON.stringify(readTids().filter((x) => x !== t))); } catch { /* quota */ }
}

/**
 * Same-origin proxy URL for initiateLink, per env. The path lives UNDER the app
 * base (import.meta.env.BASE_URL, e.g. /smartphone/crm/) so it is routed exactly
 * like the rest of the app — the vite dev proxy in dev, and server.js in prod
 * both forward it to (test)pay.easebuzz.in. A root-relative path would escape
 * the app's routing and 404 in production. Single seam — nothing else knows the host.
 */
export function getInitiateUrl(env) {
  const base = import.meta.env.BASE_URL || "/"; // ends with "/"
  return `${base}ezpay-${env === "test" ? "test" : "prod"}/payment/initiateLink`;
}

/** SHA-512 lowercase hex via Web Crypto — no dependency, matches PHP hash('sha512'). */
export async function sha512Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the Easebuzz payment hash. udf6..udf10 are always empty (native only
 * fills udf1..5). Every field is used verbatim — callers must pass the SAME
 * `amount` string here and to initiateLink or Easebuzz rejects the hash.
 */
export async function buildPaymentHash({
  key, txnid, amount, productinfo, firstname, email,
  udf1, udf2, udf3, udf4, udf5, salt,
}) {
  const seq = [
    key, txnid, amount, productinfo, firstname, email,
    udf1 || "", udf2 || "", udf3 || "", udf4 || "", udf5 || "",
    "", "", "", "", "",            // udf6..udf10
    salt,
  ].join("|");
  return sha512Hex(seq);
}

/**
 * POST the payment params (incl. hash) to initiateLink via the proxy seam.
 * @returns {string} access_key
 */
export async function initiateLink({ env, params }) {
  const body = new URLSearchParams(params).toString();
  const resp = await fetch(getInitiateUrl(env), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (resp.status === 502) {
    // The .htaccess rule fires this when mod_proxy is missing, rather than
    // letting the SPA fallback answer with an HTML shell.
    throw new Error(
      "Payments are not reachable: the ezpay proxy is not enabled on this server " +
      "(needs mod_proxy + SSLProxyEngine)."
    );
  }
  if (resp.status === 500) {
    // THE SPECIFIC SHAPE OF A HALF-WIRED SEAM.
    // `RewriteRule [P]` to an https backend without `SSLProxyEngine On` makes
    // Apache answer 500 — the rule matched, the proxy could not be opened.
    // Easebuzz itself never answers this endpoint with a 500 (a refusal comes
    // back as HTTP 200 with status:0), so a 500 here is our own deployment.
    throw new Error(
      "Payments are not reachable: the server matched the ezpay route but could not " +
      "open the connection. Enable SSLProxyEngine On in the vhost (Easebuzz is " +
      "https-only), or add a ProxyPass there as production does."
    );
  }
  if (!resp.ok) throw new Error(`Could not start payment (HTTP ${resp.status}).`);

  // THE SPA SHELL COMES BACK AT HTTP 200, so resp.ok does not catch it.
  // When the deployed .htaccess has no ezpay rule the POST is just an
  // unmatched path: neither a file nor a directory, so the SPA fallback
  // rewrites it to index.html. resp.json() then threw
  // "Unexpected token '<'" into a toast, which tells the operator nothing and
  // points at Easebuzz rather than at our own deployment.
  // Measured 2026-08-31: netmontest answered this POST with 10462 bytes of
  // text/html. Same trap the qr-api seam had — see services/qrAuth.js.
  const text = await resp.text();
  if (/^\s*<(?:!doctype|html)/i.test(text)) {
    throw new Error(
      "Payments are not reachable: this deployment is missing the ezpay proxy rule, " +
      "so the request was answered with the app itself. Re-deploy including the " +
      ".htaccess from this build, and make sure SSLProxyEngine is on."
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(
      `Payments returned an unexpected response: "${text.trim().replace(/\s+/g, " ").slice(0, 80)}"`
    );
  }

  // Success: { status: 1, data: "<access_key>" }. Failure: { status: 0, data: <msg> }.
  if (Number(data?.status) !== 1 || !data?.data) {
    throw new Error(typeof data?.data === "string" ? data.data : "Could not start payment.");
  }
  return data.data;
}

let _scriptPromise = null;
/** Load easebuzz-checkout-v2.js once (idempotent across calls and mounts). */
export function loadCheckout() {
  if (typeof window !== "undefined" && window.EasebuzzCheckout) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = EZ_CHECKOUT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { _scriptPromise = null; reject(new Error("Could not load the payment module.")); };
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

/**
 * Open the Easebuzz checkout modal and resolve with its response object.
 * The response shape mirrors the native SDK: { result, payment_response, … }.
 */
export async function openCheckout({ key, env, accessKey }) {
  await loadCheckout();
  return new Promise((resolve) => {
    const checkout = new window.EasebuzzCheckout(key, env === "test" ? "test" : "prod");
    checkout.initiatePayment({
      access_key: accessKey,
      onResponse: (response) => resolve(response),
      theme: "#4f46e5",
    });
  });
}
