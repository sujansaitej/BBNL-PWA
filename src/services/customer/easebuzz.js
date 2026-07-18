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

// test build → Easebuzz sandbox; prod build → live. Override with
// VITE_EASEBUZZ_ENV. Keeps dev/test from ever hitting a real charge.
export const EZ_ENV = String(
  import.meta.env.VITE_EASEBUZZ_ENV || (import.meta.env.PROD ? "prod" : "test")
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
 * Same-origin proxy URL for initiateLink, per env. The path is identical in dev
 * and prod; dev is served by the vite proxy, prod by a host reverse-proxy that
 * forwards to (test)pay.easebuzz.in. Single seam — nothing else knows the host.
 */
export function getInitiateUrl(env) {
  const base = env === "test" ? "/ezpay-test" : "/ezpay-prod";
  return `${base}/payment/initiateLink`;
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
  if (!resp.ok) throw new Error(`Could not start payment (HTTP ${resp.status}).`);
  const data = await resp.json();
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
