// Shared helpers for opening the native camera / file picker safely
// across devices.
//
// The problem: on low-tier Android phones (especially MIUI / Redmi /
// Xiaomi, and some Samsung A-series budget variants) the OS can kill
// the browser tab while the native camera is open in order to free
// memory. When the tab is recreated, the File object captured by the
// <input> element is gone, and the user has to re-capture.
//
// There is no API that prevents Android from killing the tab. What we
// CAN do is minimize the memory pressure at the moment the camera
// launches so the OS picks some other process to kill first.
//
// This module exposes:
//   - isLowMemoryDevice(): best-effort detection of MIUI / low-RAM
//   - prepareForCameraCapture(): clears transient caches, asks for
//     persistent storage, and hints the GC
//   - SESSION_FLAG_KEY: sessionStorage key for the camera-open flag
//     used by the kill-detection effect in Register / UploadDocuments

import { lsClearAll } from "../services/lsCache";

export const SESSION_FLAG_KEY = "app_camera_open";

/**
 * Best-effort detection of devices that are likely to kill the tab
 * while the camera is open. Matches MIUI / Xiaomi / Redmi user agents
 * and any device reporting <= 3 GB RAM via the Device Memory API.
 *
 * The flag is used only for softer UX (warning toasts, extra GC hints);
 * it is NOT a gate — every device takes the same code path.
 */
export function isLowMemoryDevice() {
    try {
        const ua = (navigator.userAgent || "").toLowerCase();
        if (/miui|xiaomi|redmi|poco/.test(ua)) return true;
        // Some Samsung A-series and J-series run the same aggressive memory
        // manager as MIUI in practice — flag them too.
        if (/sm-a[0-9]{3}|sm-j[0-9]{3}|sm-m[0-9]{3}/i.test(ua)) return true;
        const mem = navigator.deviceMemory;
        if (typeof mem === "number" && mem > 0 && mem <= 3) return true;
    } catch (_) {}
    return false;
}

/**
 * Runs right before the native camera input is clicked. Drops every
 * piece of state we can safely rebuild, so the OS has no reason to
 * pick this tab for termination.
 *
 * - Clears the `_c:*` lsCache (API response cache — rebuilds on next fetch).
 * - Asks for persistent storage (best-effort; browser may deny).
 * - Suggests a GC pass (only works in some debug builds but harmless).
 */
export async function prepareForCameraCapture() {
    // 1. Clear the API response cache — this is the biggest localStorage
    //    payload and often the biggest in-memory JSON graph too.
    try { lsClearAll(); } catch (_) {}

    // 2. Ask the browser to keep our storage so an accidental quota
    //    eviction during the camera session doesn't compound the problem.
    try {
        if (navigator.storage && typeof navigator.storage.persist === "function") {
            // Fire-and-forget — we don't want to await and delay camera open.
            navigator.storage.persist().catch(() => {});
        }
    } catch (_) {}

    // 3. Some Chromium builds expose window.gc in debug; nudge it.
    try { if (typeof window.gc === "function") window.gc(); } catch (_) {}
}

/**
 * Set the "camera was open" flag so a post-reload effect can tell
 * whether the tab was killed mid-capture.
 */
export function markCameraOpen() {
    try { sessionStorage.setItem(SESSION_FLAG_KEY, "true"); } catch (_) {}
}

/**
 * Clear the "camera was open" flag after the camera returns normally.
 */
export function clearCameraOpen() {
    try { sessionStorage.removeItem(SESSION_FLAG_KEY); } catch (_) {}
}

/**
 * Returns true if the previous page-load was killed while the camera
 * was open. Also clears the flag (idempotent).
 */
export function consumeCameraKillFlag() {
    try {
        const was = sessionStorage.getItem(SESSION_FLAG_KEY) === "true";
        if (was) sessionStorage.removeItem(SESSION_FLAG_KEY);
        return was;
    } catch (_) { return false; }
}
