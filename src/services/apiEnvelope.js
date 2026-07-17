// apiEnvelope — the BBNL response contract, as pure functions.
//
// Deliberately dependency-free (no logger, no import.meta.env) so it can be
// imported by `node --test` without a bundler. apiCore re-exports these; the
// runnable check lives in apiEnvelope.test.js.
//
// Wire format, identical across both Android flavors:
//   { "status": { "err_code": 0, "err_msg": "..." }, "body": { ... } }
//
// err_code 0 = success, non-zero = failure (message in err_msg). `body` is
// omitted entirely on error. This is the ONLY success discriminator — not
// the HTTP status, not a "success" string.

/**
 * True when the envelope reports success.
 *
 * Coercion is load-bearing. Android's two status models disagree on type:
 *   model.genStatusModel              → `int err_code`
 *   model.employeeModels.GenStatusModel → `String err_code`
 * Gson coerces silently so Android never noticed. In JS, `"0" === 0` is
 * false — a strict check would treat a string "0" as a FAILURE and break
 * every endpoint backed by the employee model. Number() covers both.
 *
 * Guards against a missing envelope: `undefined` must not read as success.
 * Number(undefined) is NaN, and NaN === 0 is false, so this fails closed.
 * Do not "simplify" to == 0 — Number(null) is 0, and a null status would
 * then read as success.
 */
export function isEnvelopeOk(data) {
  const code = data?.status?.err_code;
  if (code === undefined || code === null) return false;
  return Number(code) === 0;
}

/** Error message from a failed envelope, with a sane fallback. */
export function envelopeError(data) {
  return data?.status?.err_msg || "Something went wrong!";
}
