/**
 * Retrying a load-balancer 404 — and never retrying anything that writes.
 *
 * QA, Aug 2026: "some of the time in customer dashboard we are getting this
 * issue" — a random scattering of API calls returning 404 while the app itself
 * loaded fine.
 *
 * WHY IT HAPPENS. netmon sits behind a load balancer that pins a client to one
 * node with a `SERVERUSED` cookie. Proven against netmontest on 2026-08-26:
 * send a valid `SERVERUSED` and the LB honours it and does not re-set it; send
 * an unknown value or none and the LB picks a node and sets the cookie. Every
 * call from apiCore goes out `credentials: "omit"` (to keep the ci_session
 * cookie off the wire, because PHP locks the session file per request), which
 * also drops `SERVERUSED` — so each API request is routed afresh while the
 * page and its assets stay pinned. One bad pool member therefore shows up as
 * an app that loads and then fails a random subset of its calls.
 *
 * Timing confirms those 404s never reached PHP: QA saw 87-108ms, whereas on
 * the same host a REAL application 404 costs ~440ms and a success ~940ms.
 *
 * A retry helps precisely BECAUSE there is no affinity — the second attempt
 * gets its own routing decision. It is a mitigation; the cure is the pool
 * member. What must not happen is a retry re-running something that writes.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.stubEnv("PROD", true);
vi.stubEnv("VITE_API_BASE_URL", "https://test.example/netmon/");

vi.mock("./navigationController", () => ({
  getServiceSignal: () => ({ aborted: false, addEventListener() {}, removeEventListener() {} }),
  isBackgroundMode: () => false,
}));

let fetchMock;
const ok = () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) });
const status = (s) => ({ ok: false, status: s, text: async () => "", json: async () => ({}) });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(ok());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

/** Drive the retry's setTimeout without waiting 250ms of real time. */
async function settle(promise) {
  await vi.runAllTimersAsync();
  return promise;
}

async function call(cfg, first, second) {
  const { apiFetch } = await import("./apiCore.js");
  fetchMock.mockResolvedValueOnce(first);
  if (second) fetchMock.mockResolvedValueOnce(second);
  return settle(apiFetch("https://test.example/netmon/x", { method: "POST" }, "t", cfg));
}

describe("a read marked idempotent survives one bad node", () => {
  test("a 404 is retried and the second answer is returned", async () => {
    const resp = await call({ idempotent: true }, status(404), ok());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resp.status).toBe(200);
  });

  test.each([[502], [503], [504]])("a %i is retried too", async (code) => {
    await call({ idempotent: true }, status(code), ok());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("the retry is bounded to one — a dead pool is not hammered", async () => {
    const resp = await call({ idempotent: true }, status(404), status(404));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resp.status).toBe(404);
  });

  test("a status that means the request itself is wrong is never retried", async () => {
    for (const code of [400, 401, 403, 500]) {
      fetchMock.mockClear();
      const resp = await call({ idempotent: true }, status(code));
      expect(fetchMock, `HTTP ${code}`).toHaveBeenCalledTimes(1);
      expect(resp.status).toBe(code);
    }
  });

  test("a success is never retried", async () => {
    await call({ idempotent: true }, ok());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// THE PROPERTY THAT MATTERS MOST.
//
// The obvious design was "GET is idempotent, retry it automatically". That is
// wrong in this codebase: a complaint is filed with
// `GET apis/raiseTicket/?...`. Retrying it would lodge duplicate tickets — the
// exact thing the pending-ticket guard exists to prevent — and the same shape
// of mistake on a payment endpoint would charge someone twice. So nothing is
// inferred from the verb: retry is opt-in per call site.
describe("nothing is retried unless a human declared it safe", () => {
  test.each([["POST"], ["GET"], ["PUT"], ["DELETE"]])(
    "an unmarked %s is sent exactly once, even on a 404",
    async (method) => {
      const { apiFetch } = await import("./apiCore.js");
      fetchMock.mockResolvedValueOnce(status(404));
      const resp = await settle(apiFetch("https://test.example/netmon/x", { method }, "t"));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(resp.status).toBe(404);
    }
  );

  test("idempotent:false is honoured as explicitly as omitting it", async () => {
    const resp = await call({ idempotent: false }, status(404));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resp.status).toBe(404);
  });

  // A truthy-but-not-true value must not switch retrying on by accident.
  test("only a literal true opts in", async () => {
    await call({ idempotent: 1 }, status(404));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// The runtime tests above prove the mechanism obeys the flag. This proves
// nobody has since put the flag on a call that spends money or files a record
// — the failure mode the opt-in design exists to prevent, and one that would
// otherwise only show up as a duplicate charge in production.
describe("no state-changing endpoint is marked retryable", () => {
  test("the known writes carry no idempotent flag", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const SERVICES = path.dirname(fileURLToPath(import.meta.url));

    const WRITES = [
      "raiseTicket",        // GET — files a complaint
      "closeTicket",
      "savePaymentApi",
      "makepayment",
      "generateorder",
      "generateOrder",
      "submitKYC",
      "upgradeRegistration",
      "killTxn",
    ];

    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(full);
      }
    })(SERVICES);

    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // Each apiFetch(...) call, from the call through to its cfg object.
      for (const m of src.matchAll(/apiFetch\(([\s\S]{0,600}?)\)\s*;/g)) {
        const site = m[1];
        if (!/idempotent:\s*true/.test(site)) continue;
        const hit = WRITES.find((w) => site.includes(w));
        if (hit) offenders.push(`${path.basename(file)} → ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
