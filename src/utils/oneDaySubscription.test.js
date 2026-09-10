/**
 * One-day IPTV subscription — the rule and the wire fields.
 *
 * The backend's day-based expiry fires ONLY for à-la-carte channels with no
 * packages (ServiceApis::generateBill, `$applyDayBased`). With a package in
 * the basket the flag is ignored for expiry while the price is still
 * pro-rated to one day — the operator would pay 1/30th for a full period.
 * These pin that the option can never be sent in that state, and that the
 * default checkout's payload is untouched.
 */
import { describe, test, expect } from "vitest";
import {
  ONE_DAY_PERIOD, oneDayAllowed, oneDayBlockedReason, oneDayActive, periodFor, dayExpiryFields,
} from "./oneDaySubscription";

const CHANNELS_ONLY = { chIds: ["505", "611"], pkgIds: [] };
const WITH_PACKAGE  = { chIds: ["505"], pkgIds: ["12"] };
const PACKAGE_ONLY  = { chIds: [], pkgIds: ["12"] };
const EMPTY         = { chIds: [], pkgIds: [] };

describe("when One day may be offered — mirrors generateBill's $applyDayBased", () => {
  test("channels only → allowed", () => {
    expect(oneDayAllowed(CHANNELS_ONLY)).toBe(true);
    expect(oneDayBlockedReason(CHANNELS_ONLY)).toBe("");
  });

  test("any package in the basket → refused, and the reason names packages", () => {
    expect(oneDayAllowed(WITH_PACKAGE)).toBe(false);
    expect(oneDayAllowed(PACKAGE_ONLY)).toBe(false);
    expect(oneDayBlockedReason(WITH_PACKAGE)).toMatch(/packages/i);
  });

  test("nothing selected → refused", () => {
    expect(oneDayAllowed(EMPTY)).toBe(false);
    expect(oneDayAllowed()).toBe(false);
    expect(oneDayBlockedReason(EMPTY)).toMatch(/at least one channel/i);
  });
});

describe("what goes on the wire", () => {
  test("off → NO extra field at all, and the normal period", () => {
    expect(dayExpiryFields(false, CHANNELS_ONLY)).toEqual({});
    expect("use_day_expiry" in dayExpiryFields(false, CHANNELS_ONLY)).toBe(false);
    expect(periodFor(false, CHANNELS_ONLY, "29")).toBe("29");
  });

  test("on + channels only → use_day_expiry: 1 and cblextenperiod 1", () => {
    expect(dayExpiryFields(true, CHANNELS_ONLY)).toEqual({ use_day_expiry: 1 });
    expect(periodFor(true, CHANNELS_ONLY, "29")).toBe(ONE_DAY_PERIOD);
    expect(ONE_DAY_PERIOD).toBe("1");
  });

  // The leak: the operator toggled One day, then added a package.
  test("on + a package → falls back to the normal period and sends nothing", () => {
    expect(oneDayActive(true, WITH_PACKAGE)).toBe(false);
    expect(dayExpiryFields(true, WITH_PACKAGE)).toEqual({});
    expect(periodFor(true, WITH_PACKAGE, "29")).toBe("29");
  });

  test("the value is the literal number 1, as the backend sample shows", () => {
    expect(dayExpiryFields(true, CHANNELS_ONLY).use_day_expiry).toBe(1);
  });
});
