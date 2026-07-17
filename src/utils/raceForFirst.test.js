import { describe, test, expect, vi } from "vitest";
import { raceForFirstMatch } from "./raceForFirst.js";

const deferred = (value, ms) => () => new Promise((res) => setTimeout(() => res(value), ms));

describe("raceForFirstMatch", () => {
    test("resolves as soon as a FAST task yields an accepted value — does not wait for the slow one", async () => {
        vi.useFakeTimers();
        // Mirrors the live case: cabletv fast (4s), fofi slow (41s), same box.
        const tasks = [
            deferred({ key: "fofi", box: "" }, 41000),    // slow, no box
            deferred({ key: "cabletv", box: "B1" }, 4000), // fast, HAS box
        ];
        const p = raceForFirstMatch(tasks, (v) => !!v.box);
        await vi.advanceTimersByTimeAsync(4000); // only the fast task has settled
        const results = await p;
        expect(results[1]).toEqual({ status: "fulfilled", value: { key: "cabletv", box: "B1" } });
        // The slow task had NOT settled at win-time → its slot is empty.
        expect(results[0]).toBeUndefined();
        vi.useRealTimers();
    });

    test("when the slow task is the one with the box, still waits for it (no early false-negative)", async () => {
        vi.useFakeTimers();
        const tasks = [
            deferred({ box: "B9" }, 30000), // slow, HAS box
            deferred({ box: "" }, 2000),    // fast, no box
        ];
        const p = raceForFirstMatch(tasks, (v) => !!v.box);
        await vi.advanceTimersByTimeAsync(30000);
        const results = await p;
        expect(results[0]).toEqual({ status: "fulfilled", value: { box: "B9" } });
        vi.useRealTimers();
    });

    test("when NO task is accepted, resolves only after ALL settle", async () => {
        vi.useFakeTimers();
        const order = [];
        const tasks = [
            () => new Promise((r) => setTimeout(() => { order.push("a"); r({ box: "" }); }, 1000)),
            () => new Promise((r) => setTimeout(() => { order.push("b"); r({ box: "" }); }, 5000)),
        ];
        const p = raceForFirstMatch(tasks, (v) => !!v.box);
        await vi.advanceTimersByTimeAsync(1000);
        // First settled but not accepted — must NOT resolve yet.
        let done = false;
        p.then(() => { done = true; });
        await Promise.resolve();
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(4000);
        const results = await p;
        expect(order).toEqual(["a", "b"]);
        expect(results.every((r) => r.status === "fulfilled")).toBe(true);
        vi.useRealTimers();
    });

    test("a throwing task is captured as rejected, and a sibling's box still wins", async () => {
        const tasks = [
            () => Promise.reject(new Error("boom")),
            () => Promise.resolve({ box: "B2" }),
        ];
        const results = await raceForFirstMatch(tasks, (v) => !!v.box);
        expect(results[1]).toEqual({ status: "fulfilled", value: { box: "B2" } });
    });

    test("empty task list resolves immediately to an empty array", async () => {
        const results = await raceForFirstMatch([], () => true);
        expect(results).toEqual([]);
    });
});
