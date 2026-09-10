/** @vitest-environment jsdom */
/**
 * QRScanner — how long it is allowed to spend opening the camera.
 *
 * THE FIELD REPORT THIS EXISTS FOR (Aug 2026, operator's phone):
 *   ideal-env-480p threw: TimeoutError Camera request timed out after 12000ms
 *   Trying ideal-env-only...
 *   enumerateDevices → 0 videoinput device(s)      <- a whole NEW run starting
 *   ideal-env-720p → tracks=1, live=true           <- opened instantly
 * One rung burnt the entire 12s prompt budget on a device whose camera opens
 * in milliseconds, and the ladder has eight rungs against a 15s startup timer.
 * The scanner worked, eventually, long after the user had been told it had not.
 *
 * These are behavioural: getUserMedia is replaced with a controllable fake and
 * the timing is driven with fake timers, so they measure the real ladder rather
 * than asserting on source text.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import QRScanner from "./QRScanner";

// Never resolves — stands in for a rung the device will not answer.
const hang = () => new Promise(() => {});

let calls = [];
let behaviour = () => hang();

function liveStream({ focusModes = ["continuous", "manual"], applyFails = false } = {}) {
  const track = {
    readyState: "live",
    stop: vi.fn(),
    onended: null,
    getSettings: () => ({ width: 1600, height: 1024 }),
    getCapabilities: () => (focusModes ? { focusMode: focusModes } : {}),
    applyConstraints: vi.fn(() =>
      applyFails
        ? Promise.reject(Object.assign(new Error("no"), { name: "OverconstrainedError" }))
        : Promise.resolve()
    ),
  };
  return { getTracks: () => [track], getVideoTracks: () => [track], _track: track };
}

beforeEach(() => {
  calls = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn((c) => {
        calls.push({ at: Date.now(), constraints: c });
        return behaviour(calls.length, c);
      }),
      enumerateDevices: vi.fn(async () => []),
    },
  });
  // jsdom has neither of these; the component calls both on a live stream.
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const show = () => render(<QRScanner onScan={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />);

describe("QRScanner — camera acquisition budget", () => {
  test("the FIRST attempt keeps a prompt-sized budget", async () => {
    // The first call is the one that can be sitting on the OS permission
    // prompt. Cutting it short aborts a dialog the user was about to accept.
    behaviour = () => hang();
    show();
    await waitFor(() => expect(calls.length).toBe(1));

    await vi.advanceTimersByTimeAsync(11_000);
    expect(calls.length, "must not give up on the permission prompt at 11s").toBe(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(calls.length, "should have moved on once past 12s").toBeGreaterThan(1);
  });

  test("THE REPORTED BUG: one hung rung must not eat the whole startup window", async () => {
    // Reconstructed from the field log. Rung 1 (720p) failed fast, rung 2
    // (480p) HUNG, and the 15s startup timer then killed the run — so the
    // operator got "Camera is taking too long", tapped Retry, and only then did
    // 720p open instantly. Two rungs tried out of eight, ~15s wasted.
    //
    // With the short budget the hung rung costs ~3.5s instead of 12s, so the
    // ladder still has most of its window left and reaches a working rung
    // WITHOUT the user having to tap anything.
    behaviour = (n) => {
      if (n === 1) return Promise.reject(Object.assign(new Error("bad"), { name: "OverconstrainedError" }));
      if (n === 2) return hang();
      return Promise.resolve(liveStream());
    };
    show();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

    // Inside the 15s the user is promised, the hung rung must have expired and
    // a later one must have been reached.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(calls.length, "should have moved past the hung rung well inside 15s").toBeGreaterThanOrEqual(3);
    // Relative to the first attempt — the old 12s budget put this at 12s+.
    expect(calls[2].at - calls[0].at, "third rung must start long before the 15s startup timer")
      .toBeLessThan(8_000);
  });

  test("the ladder stops once the run is cancelled — no cascade behind the error", async () => {
    // The old worst case was eight rungs at 12s: 96s of the app holding the
    // camera while the user was already on the error screen tapping Retry, the
    // two runs then fighting for the device. stopScanning() bumps startRunRef,
    // and every rung re-checks it.
    behaviour = () => hang();
    show();
    await waitFor(() => expect(calls.length).toBe(1));

    await vi.advanceTimersByTimeAsync(40_000);
    const settled = calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length, "no new getUserMedia after the run was cancelled").toBe(settled);
    expect(settled, "must not have burnt through all eight rungs").toBeLessThan(8);
  });

  test("a timed-out rung does not race the next one for the camera", async () => {
    // getUserMedia has no abort: a timed-out call is still pending and still
    // claims the device. Two overlapping calls are what produce NotReadableError
    // on Samsung/OnePlus/Realme, which is why the settle delay exists.
    behaviour = () => hang();
    show();
    await waitFor(() => expect(calls.length).toBe(1));

    // Land just past the 12s timeout but inside the 400ms settle window.
    await vi.advanceTimersByTimeAsync(12_100);
    expect(calls.length, "next rung must wait out the settle delay").toBe(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(calls.length).toBe(2);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(12_000 + 400);
  });

  test("requests Android's preview size on the first rung", async () => {
    // BarcodeCaptureActivity:206 — setRequestedPreviewSize(1600, 1024), which
    // native comments as deliberate for reading small codes at distance.
    behaviour = () => hang();
    show();
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].constraints.video.width).toEqual({ ideal: 1600 });
    expect(calls[0].constraints.video.height).toEqual({ ideal: 1024 });
    expect(calls[0].constraints.video.facingMode).toEqual({ ideal: "environment" });
  });

  test("turns on continuous autofocus, like native's FOCUS_MODE_CONTINUOUS_PICTURE", async () => {
    // BarcodeCaptureActivity:211-213 with AutoFocus=true from every call site.
    // Without this the camera can hold a one-shot focus from stream start and
    // never sharpen on the code — jsQR cannot decode a blurred frame.
    const stream = liveStream();
    behaviour = () => Promise.resolve(stream);
    show();
    await waitFor(() => expect(stream._track.applyConstraints).toHaveBeenCalled());
    expect(stream._track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: "continuous" }],
    });
  });

  test("does not ask for focus the device never advertised", async () => {
    // applyConstraints REJECTS on an unsupported constraint rather than
    // degrading, so it must be capability-gated.
    const stream = liveStream({ focusModes: ["manual"] });
    behaviour = () => Promise.resolve(stream);
    show();
    await waitFor(() => expect(calls.length).toBe(1));
    await vi.advanceTimersByTimeAsync(500);
    expect(stream._track.applyConstraints).not.toHaveBeenCalled();
  });

  test("a rejected focus request never kills a working stream", async () => {
    // Focus is a nice-to-have. A device that advertises 'continuous' and then
    // refuses it must still end up scanning.
    const stream = liveStream({ applyFails: true });
    behaviour = () => Promise.resolve(stream);
    show();
    await waitFor(() => expect(stream._track.applyConstraints).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stream._track.stop, "stream must not have been torn down").not.toHaveBeenCalled();
  });

  test("a first-rung TimeoutError still reaches a working camera", async () => {
    // The exact field shape: rung 1 hangs, everything after opens fine. The old
    // code only re-warmed on NotFoundError, so a hung cold start fell through
    // to "All camera-start attempts failed".
    behaviour = (n) => (n === 1 ? hang() : Promise.resolve(liveStream()));
    show();
    await waitFor(() => expect(calls.length).toBe(1));

    await vi.advanceTimersByTimeAsync(13_000);
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    // Something after the hung rung actually got a live stream.
    expect(calls.length).toBeGreaterThan(1);
  });
});
