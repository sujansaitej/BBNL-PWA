/**
 * Order history under Voice Service.
 *
 * QA, Aug 2026: "Order history not showing under Voice Service."
 *
 * The screen and the button were both already there — VoiceService.jsx
 * navigates to /payment-history with serviceType 'voice'. What was missing was
 * one entry in a lookup table.
 *
 * getOrderHistoryFor picks the endpoint from a service id:
 *   a service WITH an id  → ServiceApis/ordersList, server-filtered by servid
 *   a service WITHOUT one → apis/custpayhistory, the generic customer ledger
 *
 * That table read `{ fofi: '3', cabletv: '1' }`. Voice was absent, so every
 * voice request fell through to custpayhistory — which does not carry voice
 * rows — and the screen was permanently empty. Worse, rows from that path
 * carry no `_authoritativeService` tag, so even a stray voice row would then
 * be dropped by the service filter.
 *
 * Service ids read live from ServiceApis/servServiceList on 2026-08-31:
 *   1 = Cable TV   3 = Fo-Fi Smart Box   5 = Voice Call   7 = Internet
 * ordersList accepts servid=5 and answers "Success!." — verified the same day.
 *
 * The ids now live once, in constants/services.js. They were previously in two
 * places that had already drifted: the registry said Cable TV had no id at all
 * while orderApis said '1'.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/netmon/");
vi.stubEnv("VITE_API_AUTH_KEY", "KEY");
vi.stubEnv("VITE_API_USERNAME", "bbnl");
vi.stubEnv("VITE_API_PASSWORD", "PASS");
vi.stubEnv("VITE_API_APP_USER_TYPE", "employee");
vi.stubEnv("VITE_API_APP_VERSION", "1.2.0");

const apiFetch = vi.fn();
vi.mock("./apiCore", async (orig) => ({
  ...(await orig()),
  apiFetch: (...a) => apiFetch(...a),
}));

import { servidForService, filterOrdersByService, resolveServiceFromOrder } from "../constants/services";
import { getOrderHistoryFor } from "./orderApis";

/** ordersList shape: { status, body: { result: [...] } }. */
const ordersListResponse = (rows) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: { err_code: 0, err_msg: "Success!." }, body: { result: rows, total_orders: rows.length } }),
  text: async () => "",
});

const VOICE_ROW = { ordernumber: "SERV-5-0001", orderdate: "2026-08-20", paymentmode: "wallet", amount: "118" };

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset().mockResolvedValue(ordersListResponse([VOICE_ROW]));
});

describe("the service ids live in one place", () => {
  test.each([
    ["voice", "5"],
    ["fofi", "3"],
    ["cabletv", "1"],
  ])("%s → servid %s", (key, servid) => {
    expect(servidForService(key)).toBe(servid);
  });

  test("aliases resolve to the same id", () => {
    // The voice API's own servicekey is 'voicecall', not 'voice'.
    expect(servidForService("voicecall")).toBe("5");
    expect(servidForService("voip")).toBe("5");
    expect(servidForService("iptv")).toBe("1");
  });

  test("Internet deliberately has none — its bills come from custpayhistory", () => {
    expect(servidForService("internet")).toBeNull();
  });
});

describe("voice order history goes to ordersList", () => {
  test("it posts to ordersList with servid 5", async () => {
    await getOrderHistoryFor("voice", { cid: "cust1", userid: "cust1", username: "superadmin" });
    const [url, opts] = apiFetch.mock.calls.at(-1);
    expect(url).toContain("ServiceApis/ordersList");
    expect(JSON.parse(opts.body).servid).toBe("5");
  });

  // THE REGRESSION: this used to hit apis/custpayhistory and return nothing.
  test("it does NOT fall through to the generic ledger", async () => {
    await getOrderHistoryFor("voice", { cid: "cust1", userid: "cust1" });
    expect(apiFetch.mock.calls.at(-1)[0]).not.toContain("custpayhistory");
  });

  test("rows come back tagged as voice, so the service filter keeps them", async () => {
    const res = await getOrderHistoryFor("voice", { cid: "cust1", userid: "cust1" });
    expect(res.body).toHaveLength(1);
    expect(res.body[0]._authoritativeService).toBe("voice");
    expect(resolveServiceFromOrder(res.body[0])).toBe("voice");
    expect(filterOrdersByService(res.body, "voice")).toHaveLength(1);
  });

  test("the servicekey the voice API itself uses also works", async () => {
    const res = await getOrderHistoryFor("voicecall", { cid: "cust1", userid: "cust1" });
    expect(JSON.parse(apiFetch.mock.calls.at(-1)[1].body).servid).toBe("5");
    // And the filter must not silently drop them on the raw key either.
    expect(filterOrdersByService(res.body, "voicecall")).toHaveLength(1);
  });

  test("a voice order is not shown under another service", async () => {
    const res = await getOrderHistoryFor("voice", { cid: "cust1", userid: "cust1" });
    expect(filterOrdersByService(res.body, "fofi")).toHaveLength(0);
    expect(filterOrdersByService(res.body, "cabletv")).toHaveLength(0);
  });
});

describe("the services that already worked are unchanged", () => {
  test.each([
    ["fofi", "3"],
    ["cabletv", "1"],
  ])("%s still uses ordersList with servid %s", async (key, servid) => {
    await getOrderHistoryFor(key, { cid: "c", userid: "c" });
    const [url, opts] = apiFetch.mock.calls.at(-1);
    expect(url).toContain("ServiceApis/ordersList");
    expect(JSON.parse(opts.body).servid).toBe(servid);
  });

  // Internet has a servid (7) but must NOT switch endpoints — its screen reads
  // the full plan/tax breakdown that only custpayhistory returns.
  test("internet still uses custpayhistory, not ordersList", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: { err_code: 0 }, body: [] }), text: async () => "" });
    await getOrderHistoryFor("internet", { apiopid: "OP1", cid: "cust1" });
    expect(apiFetch.mock.calls.at(-1)[0]).toContain("custpayhistory");
  });
});

// ── Tenancy scope on ordersList ─────────────────────────────────────
//
// `username` is the tenancy scope, and the fallback chain used to be
// `username || VITE_API_USERNAME || 'superadmin'`. Both fallbacks were wrong.
// Measured against the live backend 2026-08-31, same customer and servid:
//
//   username='namich'     (the customer)      -> 3 rows, Success
//   username='superadmin'                     -> 3 rows, Success
//   username='bbnl'       (VITE_API_USERNAME) -> "Invalid user, enter valid user."
//   username=''                               -> "Please enter username."
//   userid='iptvsub4' + username='superadmin' -> 2 rows  ← ANOTHER customer's orders
//
// So the env credential is not an app user at all, and the real fallback was an
// UNSCOPED master account. `||` fires on an empty string, and the customer
// OrderHistory path passes `getUser()?.username || ""` — so a customer with no
// stored username issued an admin-scoped query. Nothing exploits that today
// (the app only ever sends the signed-in customer's own userid) but it turns
// the backend's tenancy check off.
//
// A customer's OWN username is accepted, so falling back to `userid` scopes the
// request to exactly the caller — never wider — on either portal.
describe("ordersList is never escalated to an admin scope", () => {
  const sentUsername = () => JSON.parse(apiFetch.mock.calls.at(-1)[1].body).username;

  test("an explicit username is sent unchanged", async () => {
    await getOrderHistoryFor("voice", { cid: "c", userid: "cust1", username: "operator1" });
    expect(sentUsername()).toBe("operator1");
  });

  // THE REGRESSION, in all three of its shapes.
  test.each([
    ["missing", undefined],
    ["empty string", ""],
    ["null", null],
  ])("a %s username falls back to the caller's own id, not superadmin", async (_label, username) => {
    await getOrderHistoryFor("voice", { cid: "c", userid: "cust1", username });
    expect(sentUsername()).toBe("cust1");
    expect(sentUsername()).not.toBe("superadmin");
  });

  test("the env API credential is never used as an app username", async () => {
    // VITE_API_USERNAME is 'bbnl' here — the backend answers "Invalid user".
    await getOrderHistoryFor("voice", { cid: "c", userid: "cust1", username: "" });
    expect(sentUsername()).not.toBe("bbnl");
  });

  test("no code path can put superadmin on the wire", async () => {
    for (const args of [
      { cid: "c", userid: "cust1" },
      { cid: "c", userid: "cust1", username: "" },
      { cid: "", userid: "cust1", username: undefined },
    ]) {
      await getOrderHistoryFor("voice", args);
      expect(sentUsername()).not.toBe("superadmin");
    }
  });
});
