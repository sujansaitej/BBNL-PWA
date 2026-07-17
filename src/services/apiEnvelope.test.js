// Run: npx vitest run
//
// Guards the response discriminator — the one piece of logic every backend
// call in the app depends on.

import { test, expect } from "vitest";
import { isEnvelopeOk, envelopeError } from "./apiEnvelope.js";

test("err_code 0 is success", () => {
  expect(isEnvelopeOk({ status: { err_code: 0 }, body: {} })).toBe(true);
});

test("string '0' is success — employee models type err_code as String", () => {
  // Regression guard: a strict `=== 0` here would break every endpoint
  // backed by model.employeeModels.GenStatusModel. Gson coerced silently, so
  // Android never had to notice; JS does.
  expect(isEnvelopeOk({ status: { err_code: "0" }, body: {} })).toBe(true);
});

test("err_code 1 is failure", () => {
  expect(isEnvelopeOk({ status: { err_code: 1, err_msg: "nope" } })).toBe(false);
});

test("non-zero codes other than 1 are failures", () => {
  // Login.jsx used to gate on `err_code === 1`, so a 2 fell through as success.
  expect(isEnvelopeOk({ status: { err_code: 2 } })).toBe(false);
  expect(isEnvelopeOk({ status: { err_code: "2" } })).toBe(false);
});

test("missing envelope fails closed", () => {
  // Number(undefined) is NaN; NaN === 0 is false.
  expect(isEnvelopeOk(undefined)).toBe(false);
  expect(isEnvelopeOk({})).toBe(false);
  expect(isEnvelopeOk({ status: {} })).toBe(false);
});

test("null status fails closed", () => {
  // Guard against a `== 0` regression: Number(null) is 0, which would
  // otherwise read a null status as success.
  expect(isEnvelopeOk({ status: null })).toBe(false);
  expect(isEnvelopeOk({ status: { err_code: null } })).toBe(false);
});

test("real webads payload is correctly NOT ok — it has no envelope", () => {
  // Verified live 2026-07-17: apis/webads returns exactly {count, imglist}.
  // isEnvelopeOk failing closed here is CORRECT, and is precisely why ads()
  // must use readEnvelopeRaw rather than readEnvelope.
  expect(isEnvelopeOk({ count: 2, imglist: [] })).toBe(false);
});

test("envelopeError surfaces err_msg, falls back when absent", () => {
  expect(envelopeError({ status: { err_code: 1, err_msg: "Invalid user" } })).toBe("Invalid user");
  expect(envelopeError({ status: { err_code: 1 } })).toBe("Something went wrong!");
  expect(envelopeError(undefined)).toBe("Something went wrong!");
});
