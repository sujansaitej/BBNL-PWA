import { useRef, useState, useEffect, useCallback } from "react";

// One-time polyfill for the legacy/vendor-prefixed getUserMedia.
// Older Samsung Internet (5.x, 6.x), Android 4.x WebView, and a few
// Tizen-derived embedded browsers expose `navigator.getUserMedia`
// (callback-based) or vendor-prefixed equivalents but NOT the modern
// `navigator.mediaDevices.getUserMedia`. Without this shim those
// devices fall through to "Camera not supported on this device" even
// though they CAN access the camera. We bridge to the modern Promise
// API so the rest of the hook works unchanged.
//
// Run-once: the polyfill is installed at import time so any code path
// that touches `navigator.mediaDevices` after this module loads gets
// the bridged implementation.
(function installLegacyGetUserMediaShim() {
    try {
        if (typeof navigator === "undefined") return;
        if (!navigator.mediaDevices) {
            try { navigator.mediaDevices = {}; } catch (_) { /* read-only on some browsers */ }
        }
        if (navigator.mediaDevices && !navigator.mediaDevices.getUserMedia) {
            const legacy = navigator.getUserMedia
                || navigator.webkitGetUserMedia
                || navigator.mozGetUserMedia
                || navigator.msGetUserMedia;
            if (legacy) {
                navigator.mediaDevices.getUserMedia = function (constraints) {
                    return new Promise((resolve, reject) => {
                        legacy.call(navigator, constraints, resolve, reject);
                    });
                };
            }
        }
    } catch (_) { /* polyfill is best-effort */ }
})();

// Shared camera-lifecycle hook for in-page capture. Used by the QR
// scanner (upstream hardening) and the document/photo capture modal.
//
// Contract:
//   const { status, error, start, stop, videoRef, flipFacing, facing }
//     = useCamera({ facingMode: 'environment', active: true });
//
//   status is one of: 'idle' | 'initializing' | 'scanning' | 'error'
//   'scanning' means the video stream is live and drawing frames.
//
// Notes on device compatibility — the approach matches the fix we
// landed for Bug 1 (QR scanner camera stuck on Redmi / Samsung A51):
//   - Listen to four readiness events (oncanplay, onloadedmetadata,
//     onloadeddata, onplaying). Different Android WebViews fire
//     different subsets first; whichever wins promotes to 'scanning'.
//   - A 1.5 s soft fallback checks if the underlying video track is
//     still live and, if so, declares the stream ready anyway.
//   - An 8 s hard fallback tears the stream down and surfaces an
//     actionable error instead of locking the UI on "Starting camera".
//   - On unmount we detach all four event handlers so a late-firing
//     event on a stale <video> element doesn't call back into state.

export default function useCamera({
    facingMode = "environment",
    active = true,
    // Optional constraints override — defaults tuned for cross-device
    // KYC capture. We start at 1280x720 (was 1920x1080) because some
    // Samsung A-series and budget Redmi phones return an immediately-
    // ended track when 1080p is requested, surfacing as the
    // "Starting Camera... forever" state operators reported.
    idealWidth = 1280,
    idealHeight = 720,
} = {}) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const softTimeoutRef = useRef(null);
    const hardTimeoutRef = useRef(null);
    // Init-stage timeout — fires if we never even get past
    // getUserMedia (permission popup hidden behind the modal, MIUI
    // PWA WebView holding the call, etc.). The existing hardTimeout
    // only catches "got a stream but no frames", so without this the
    // operator could be stuck on "Starting camera…" forever.
    const initTimeoutRef = useRef(null);
    // Probe-poll interval handle — must survive across the start →
    // stop boundary so a Samsung-style early teardown can clear it.
    const probeIntervalRef = useRef(null);
    // Re-entry guard. The flow start() → stop() → start() can be
    // triggered rapidly by facing-flip / Retry button / React strict
    // mode double-mount. Without this guard two getUserMedia calls
    // can be in flight simultaneously, causing "NotReadableError —
    // Could not start video source" on devices that single-track
    // their camera handle (Samsung, OnePlus, some Realme builds).
    const inFlightRef = useRef(false);
    const isMountedRef = useRef(true);

    const [status, setStatus] = useState("idle");
    const [error, setError] = useState("");
    const [facing, setFacing] = useState(facingMode);

    const stop = useCallback(() => {
        if (softTimeoutRef.current) { clearTimeout(softTimeoutRef.current); softTimeoutRef.current = null; }
        if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
        if (initTimeoutRef.current) { clearTimeout(initTimeoutRef.current); initTimeoutRef.current = null; }
        if (probeIntervalRef.current) { clearInterval(probeIntervalRef.current); probeIntervalRef.current = null; }

        if (streamRef.current) {
            try {
                streamRef.current.getTracks().forEach(t => t.stop());
            } catch (_) {}
            streamRef.current = null;
        }

        const v = videoRef.current;
        if (v) {
            // Detach event handlers so a late-firing event on a stale
            // element cannot resurrect the overlay after teardown.
            v.oncanplay = null;
            v.onloadedmetadata = null;
            v.onloadeddata = null;
            v.onplaying = null;
            try { v.srcObject = null; } catch (_) {}
        }

        if (isMountedRef.current) setStatus("idle");
    }, []);

    // Try a sequence of getUserMedia constraints until one yields a
    // LIVE track. This is the same progressive-fallback strategy used
    // by react-camera-pro / html5-qrcode / WebRTC samples — different
    // Android skins / browser engines accept different constraint
    // shapes, and a single one-shot getUserMedia often returns an
    // immediately-ended track on Samsung A-series and some MIUI
    // devices.
    const tryGetStream = useCallback(async (wantFacing) => {
        // Wake the device subsystem and collect every camera deviceId
        // we can see. On Samsung One UI 4.x (Galaxy M51 / A-series)
        // and a few Tizen-derived WebViews, the first getUserMedia
        // call after a cold WebView start returns NotFoundError as if
        // no camera existed. Calling enumerateDevices first warms the
        // permissions / device-list pipeline; we also keep the
        // resulting deviceIds so we can fall back to per-device
        // attempts when facingMode-based attempts all fail.
        let videoDeviceIds = [];
        try {
            if (navigator.mediaDevices.enumerateDevices) {
                const list = await navigator.mediaDevices.enumerateDevices();
                videoDeviceIds = list.filter(d => d.kind === "videoinput")
                    .map(d => d.deviceId).filter(Boolean);
                console.log(`📷 [useCamera] enumerateDevices → ${videoDeviceIds.length} videoinput device(s)`);
            }
        } catch (_) { /* warm-up only */ }

        const attempts = [
            // Attempt 1: preferred facing + lower-bounded resolution.
            // 1280x720 reliably starts on every device we've seen.
            { video: { facingMode: { ideal: wantFacing }, width: { ideal: idealWidth }, height: { ideal: idealHeight } }, audio: false, _name: "ideal-facing+720p" },
            // Attempt 2: preferred facing, no resolution constraint.
            { video: { facingMode: { ideal: wantFacing } }, audio: false, _name: "ideal-facing-only" },
            // Attempt 3: use plain string facingMode (older browser
            // syntax — some Samsung Internet versions only honour this).
            { video: { facingMode: wantFacing }, audio: false, _name: "string-facing" },
            // Attempt 4: completely unconstrained — accept any camera.
            // Last resort to ensure we get SOMETHING.
            { video: true, audio: false, _name: "video-true" },
            // Attempt 5..N: try EACH known videoinput by explicit
            // deviceId. On Samsung M51 the facingMode-based attempts
            // can all fail with NotFoundError when Knox / power-saver
            // restricts metadata, but explicit deviceId queries
            // sometimes succeed because they bypass the facing
            // resolution path entirely. Generated dynamically from
            // enumerateDevices above — empty when the permission
            // pre-grant doesn't expose any deviceIds.
            ...videoDeviceIds.map((id, i) => ({
                video: { deviceId: { exact: id } },
                audio: false,
                _name: `deviceId-${i}`,
            })),
        ];

        // Per-attempt timeout. On some Android PWA WebViews (MIUI 13,
        // Samsung One UI on installed PWAs) the permission popup can
        // be hidden behind the standalone-mode chrome, so the user
        // never grants permission and getUserMedia never settles. The
        // hard 8s frames-timeout below only starts after a stream
        // binds, so without this the operator was stuck on "Starting
        // camera…" with no error and no recovery path. 6s is enough
        // for a real prompt to surface and a reasonable user to tap
        // Allow on a slow device.
        const gumWithTimeout = (constraint, timeoutMs = 6000) => {
            return new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    const e = new Error(`getUserMedia did not respond within ${timeoutMs}ms`);
                    e.name = "TimeoutError";
                    reject(e);
                }, timeoutMs);
                navigator.mediaDevices.getUserMedia(constraint)
                    .then(s => { if (settled) { try { s.getTracks().forEach(t => t.stop()); } catch (_) {} return; } settled = true; clearTimeout(timer); resolve(s); })
                    .catch(e => { if (settled) return; settled = true; clearTimeout(timer); reject(e); });
            });
        };

        const runAttempts = async () => {
            let lastErr = null;
            for (const cs of attempts) {
                try {
                    console.log(`📷 [useCamera] Trying ${cs._name}...`);
                    // eslint-disable-next-line no-unused-vars
                    const { _name, ...constraint } = cs;
                    const s = await gumWithTimeout(constraint);
                    const tracks = s.getVideoTracks();
                    const live = tracks.some(t => t.readyState === "live");
                    console.log(`📷 [useCamera] ${cs._name} → tracks=${tracks.length}, live=${live}`);
                    // If we got a stream but no live track, dispose and try next.
                    if (!live) {
                        try { tracks.forEach(t => t.stop()); } catch (_) {}
                        continue;
                    }
                    return s;
                } catch (e) {
                    lastErr = e;
                    console.warn(`📷 [useCamera] ${cs._name} threw: ${e?.name} ${e?.message}`);
                    // Permission / security errors are definitive — don't
                    // keep retrying. NotFoundError used to be in this list
                    // but Samsung One UI sometimes returns it transiently
                    // even when the camera DOES exist — handled below.
                    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError" ||
                        e.name === "SecurityError") {
                        throw e;
                    }
                }
            }
            return lastErr;
        };

        const firstResult = await runAttempts();
        // If runAttempts returned a stream, hand it back.
        if (firstResult && typeof firstResult === "object" && firstResult.getTracks) {
            return firstResult;
        }
        // All attempts failed — firstResult is the last Error. If it's
        // NotFoundError, the Samsung "device subsystem cold-start"
        // quirk may have caused a transient miss. Wait 500 ms (lets
        // the camera service finish initialising) and retry the
        // whole ladder ONCE. If it still fails, surface the error.
        const lastErr = firstResult instanceof Error ? firstResult : null;
        if (lastErr && lastErr.name === "NotFoundError") {
            console.warn("📷 [useCamera] NotFoundError on cold start — retrying after 500ms warm-up");
            await new Promise(r => setTimeout(r, 500));
            try {
                if (navigator.mediaDevices.enumerateDevices) {
                    await navigator.mediaDevices.enumerateDevices();
                }
            } catch (_) {}
            const second = await runAttempts();
            if (second && typeof second === "object" && second.getTracks) {
                return second;
            }
            throw (second instanceof Error ? second : lastErr);
        }
        throw lastErr || new Error("All camera-start attempts failed");
    }, [idealWidth, idealHeight]);

    const start = useCallback(async (overrideFacing) => {
        if (!isMountedRef.current) return;
        // Re-entry guard: if a start() is already in flight, drop this
        // one. Without this, rapid Retry / facing-flip clicks can
        // overlap two getUserMedia calls and the second one fails with
        // NotReadableError on devices that single-track the camera
        // handle (most Samsung / OnePlus / Realme builds).
        if (inFlightRef.current) {
            console.warn("📷 [useCamera] start() called while another start() is in flight — ignoring");
            return;
        }
        inFlightRef.current = true;
        stop();

        const wantFacing = overrideFacing || facing;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const isInsecure = window.location.protocol !== "https:" && window.location.hostname !== "localhost";
            setError(isInsecure
                ? "Camera requires a secure (HTTPS) connection."
                : "Camera not supported on this device or browser.");
            setStatus("error");
            inFlightRef.current = false;
            return;
        }

        setStatus("initializing");
        setError("");

        // Overall init guard. tryGetStream walks ~5 fallback constraints
        // and each has its own 6s ceiling, so the worst-case wall time is
        // ~30s. That feels indistinguishable from "broken" to the
        // operator. This 12s outer guard surfaces an error early when
        // every attempt is timing out (e.g. installed PWA where the
        // permission popup never reaches the user). Cleared the moment
        // markReady promotes us to "scanning" or an explicit error
        // surfaces below; the hard-frames-timeout takes over after.
        if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = setTimeout(() => {
            if (!isMountedRef.current) return;
            // Only fire if we never even acquired a stream — once
            // srcObject binds, hardTimeoutRef takes over.
            if (streamRef.current) return;
            console.warn("📷 [useCamera] init-timeout: getUserMedia never resolved within 12s");
            inFlightRef.current = false;
            const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
            const isStandalone = (typeof window !== "undefined") && (
                window.matchMedia?.("(display-mode: standalone)").matches ||
                window.navigator?.standalone === true
            );
            const where = isStandalone
                ? "Settings → Apps → this app → Permissions → Camera (set to Allow)"
                : "the lock icon in the address bar (set Camera to Allow)";
            setError(
                "Camera didn't start. The browser may be waiting for a permission prompt that didn't appear. " +
                "Check " + where + ", then tap Retry."
            );
            setStatus("error");
        }, 12000);

        let stream;
        try {
            stream = await tryGetStream(wantFacing);
        } catch (e) {
            if (initTimeoutRef.current) { clearTimeout(initTimeoutRef.current); initTimeoutRef.current = null; }
            if (isMountedRef.current) {
                setError(mapCameraError(e));
                setStatus("error");
            }
            inFlightRef.current = false;
            return;
        }
        // tryGetStream returned a stream — clear the init guard. From
        // here the hard-frames-timeout (8s) is the safety net.
        if (initTimeoutRef.current) { clearTimeout(initTimeoutRef.current); initTimeoutRef.current = null; }

        if (!isMountedRef.current) {
            stream.getTracks().forEach(t => t.stop());
            inFlightRef.current = false;
            return;
        }

        streamRef.current = stream;

        // Mid-stream track-loss handler. If the camera goes away while
        // we're previewing (another app grabs it, OS revokes
        // permission, low-power mode kills the sensor), the readyState
        // flips to "ended" and the user sees a black frozen frame
        // forever. Detecting `ended` lets us surface a clear error
        // and a Retry button instead of a silent black box.
        try {
            stream.getVideoTracks().forEach(t => {
                t.onended = () => {
                    if (!isMountedRef.current) return;
                    if (streamRef.current !== stream) return; // already replaced
                    console.warn("📷 [useCamera] video track ended unexpectedly — surfacing error");
                    stop();
                    setError("Camera was disconnected (another app may have taken it). Tap Retry.");
                    setStatus("error");
                };
            });
        } catch (_) {}

        const v = videoRef.current;
        if (!v) return;
        // Belt-and-braces: set attributes that some Samsung Internet
        // versions need explicitly even with the JSX equivalents,
        // because the React-set values can be deferred to after
        // srcObject is bound.
        try {
            v.setAttribute("playsinline", "true");
            v.setAttribute("webkit-playsinline", "true");
            v.muted = true;
            v.autoplay = true;
        } catch (_) {}

        // CRITICAL: bind readiness listeners BEFORE setting srcObject.
        // Samsung Internet (and some One UI WebView builds) fires
        // `loadedmetadata` SYNCHRONOUSLY when an already-live MediaStream
        // is attached via srcObject. If we bind listeners after that
        // assignment, the event has already fired and been missed —
        // the spinner then stays up until the 8s hard-timeout kicks in
        // and shows "Camera didn't start". On Chrome / iOS Safari the
        // event is dispatched asynchronously, so the old order worked
        // there. Reordering covers Samsung without affecting the rest.
        //
        // Clear any leftover probe timer from a previous start() call
        // — start() may be invoked twice on Retry / facing-flip.
        if (probeIntervalRef.current) { clearInterval(probeIntervalRef.current); probeIntervalRef.current = null; }
        let probeAttempts = 0;

        let videoReady = false;
        const markReady = () => {
            if (videoReady) return;
            if (!isMountedRef.current || !streamRef.current) return;
            videoReady = true;
            if (softTimeoutRef.current) { clearTimeout(softTimeoutRef.current); softTimeoutRef.current = null; }
            if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
            if (probeIntervalRef.current) { clearInterval(probeIntervalRef.current); probeIntervalRef.current = null; }
            setStatus("scanning");
            console.log("📷 [useCamera] markReady — stream is live");
        };

        v.oncanplay = markReady;
        v.onloadedmetadata = markReady;
        v.onloadeddata = markReady;
        v.onplaying = markReady;

        // Now safe to bind the stream — listeners will catch the
        // loadedmetadata fire whether it's sync (Samsung) or async.
        v.srcObject = stream;

        // 100 ms videoWidth poll — Samsung can deliver frames without
        // ever firing the readiness events at all. Poll for ≤ 2 s and
        // promote the moment we see a non-zero videoWidth (means the
        // first frame has been decoded). Cheap, low-overhead, only
        // runs until markReady is called or the 2 s window expires.
        probeIntervalRef.current = setInterval(() => {
            if (videoReady) { clearInterval(probeIntervalRef.current); probeIntervalRef.current = null; return; }
            probeAttempts += 1;
            if ((v.videoWidth || 0) > 0) {
                console.log(`📷 [useCamera] probe-timer: videoWidth=${v.videoWidth} after ${probeAttempts*100}ms`);
                markReady();
            } else if (probeAttempts >= 20) {
                clearInterval(probeIntervalRef.current); probeIntervalRef.current = null;
            }
        }, 100);

        // Soft timeout — last-resort promote at 800ms IF we already have
        // video dimensions (frames are decoding). Trace from a Galaxy
        // M51 user showed the previous "trackLive OR dim" rule
        // promoted on trackLive alone — track was reported live but
        // no frames were arriving yet. The "initializing" overlay
        // then disappeared and the user saw a permanent black <video>
        // with no overlay or error. Requiring dim (videoWidth > 0)
        // ensures we only flip to "scanning" once a real frame has
        // been decoded. trackLive without dim is meaningless to the
        // user — they need to see frames.
        softTimeoutRef.current = setTimeout(() => {
            if (videoReady) return;
            const trackLive = stream.getVideoTracks().some(t => t.readyState === "live");
            const dim = (v.videoWidth || 0) > 0;
            console.log(`📷 [useCamera] soft-timeout: trackLive=${trackLive}, videoWidth=${v.videoWidth}`);
            if (dim) markReady();
        }, 800);

        hardTimeoutRef.current = setTimeout(() => {
            if (videoReady || !isMountedRef.current) return;
            stop();
            // Hard timeout — getUserMedia returned a stream but no
            // frames decoded within 8 s. On Samsung One UI this
            // typically means power-saver / battery-optimisation /
            // Knox is holding back the sensor. Surface device-aware
            // guidance so the operator knows what to actually fix
            // (the previous message blamed "other camera apps" which
            // is rarely the real cause).
            const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
            const isSamsung = /SamsungBrowser|SM-[A-Z]\d|Galaxy/i.test(ua);
            const isStandalone = (typeof window !== "undefined") && (
                window.matchMedia?.("(display-mode: standalone)").matches ||
                window.navigator?.standalone === true
            );
            const permissionHint = isStandalone
                ? "Settings → Apps → this app → Permissions → Camera (set to Allow)"
                : "the lock icon in the address bar";
            const message = isSamsung
                ? "Camera started but no video. On Samsung:\n" +
                  "1. Disable Power-saving / Battery-saver for this app.\n" +
                  "2. Close Bixby Vision and any open Camera apps.\n" +
                  "3. Check " + permissionHint + ".\n" +
                  "Then tap Retry."
                : "Camera didn't start. Close other camera apps and tap Retry, or check " + permissionHint + " for camera permission.";
            setError(message);
            setStatus("error");
        }, 8000);

        try {
            const p = v.play();
            if (p && typeof p.then === "function") {
                // Race against a 3s timeout. On some Samsung / Vivo /
                // Realme builds, play() can hang indefinitely while
                // still delivering frames — the readiness events and
                // the videoWidth probe still promote the spinner, but
                // the await would block the catch from running and
                // leak the in-flight guard. Treating "play() hasn't
                // resolved in 3s" as non-fatal lets the rest of the
                // flow finish cleanly.
                await Promise.race([
                    p,
                    new Promise((_, reject) => setTimeout(() => {
                        const e = new Error("play() did not resolve within 3s");
                        e.name = "PlayTimeout";
                        reject(e);
                    }, 3000)),
                ]);
            }
        } catch (playErr) {
            if (playErr.name === "PlayTimeout") {
                // Don't fail — soft timeout / probe will take over.
                console.warn("📷 [useCamera] play() didn't resolve in 3s — relying on readiness events / probe");
            } else if (playErr.name === "NotAllowedError") {
                // Samsung Internet sometimes rejects play() with
                // NotAllowed even after permission grant — retry once
                // after a tick; many times the second attempt succeeds
                // because the user-gesture token has propagated.
                await new Promise(r => setTimeout(r, 100));
                try { await v.play(); } catch (_) {}
            } else if (playErr.name !== "AbortError") {
                if (softTimeoutRef.current) { clearTimeout(softTimeoutRef.current); softTimeoutRef.current = null; }
                if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
                if (isMountedRef.current) {
                    setError(mapCameraError(playErr));
                    setStatus("error");
                }
            }
        }

        // Always clear the re-entry guard, regardless of how we exit.
        inFlightRef.current = false;
    }, [facing, tryGetStream, stop]);

    const flipFacing = useCallback(() => {
        const next = facing === "environment" ? "user" : "environment";
        setFacing(next);
        // Re-start with the new facing mode
        start(next);
    }, [facing, start]);

    // Auto-start on mount if `active` is true; tear down on unmount.
    useEffect(() => {
        isMountedRef.current = true;
        if (active) start();
        return () => {
            isMountedRef.current = false;
            stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Toggle the stream on/off if `active` changes at runtime.
    useEffect(() => {
        if (!isMountedRef.current) return;
        if (active && status === "idle") start();
        if (!active && (status === "scanning" || status === "initializing")) stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    return { status, error, start, stop, videoRef, flipFacing, facing };
}

function mapCameraError(err) {
    const name = err?.name || "";
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    const isSamsung = /SamsungBrowser|SM-[A-Z]\d|Galaxy/i.test(ua);
    const isStandalone = (typeof window !== "undefined") && (
        window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator?.standalone === true
    );
    // Where to find the permission depends on the runtime:
    //   • Standalone PWA → installed-app permissions panel
    //   • Samsung Internet browser tab → address-bar lock icon
    const permissionLocation = isStandalone
        ? "Settings → Apps → this app → Permissions → Camera (set to Allow)"
        : "the lock icon in the address bar (set Camera to Allow)";

    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return `Camera permission denied. Open ${permissionLocation}, then tap Retry.`;
    }
    if (name === "NotFoundError") {
        // Samsung One UI returns NotFoundError in three distinct
        // scenarios; the literal "no camera found" message is
        // misleading on a phone that obviously has cameras.
        //
        // The most pernicious sub-case (verified live on a Galaxy
        // M51 / One UI 4.x): the PWA was installed via "Add to Home
        // Screen" from Samsung Internet, and the resulting
        // standalone PWA WebView has its OWN permission scope that
        // is NEVER initialised. Settings → Apps → PWA → Permissions
        // shows BOTH "No permissions allowed" AND "No permissions
        // denied" — there is literally no permission policy, so the
        // WebView returns NotFoundError instead of triggering the
        // normal prompt. This cannot be fixed from JavaScript; the
        // operator must grant the permission via Samsung Internet
        // first or fall back to the gallery picker.
        if (isSamsung && isStandalone) {
            return "Camera blocked by the installed PWA's permission scope (Samsung One UI quirk).\n" +
                "Fix on this device:\n" +
                "1. Open Samsung Internet and load the same app URL.\n" +
                "2. Tap the camera button — when the prompt appears, tap Allow.\n" +
                "3. Either keep using the browser tab, or remove this app icon and re-add via Samsung Internet → menu → 'Add page to' → 'Home screen'.\n" +
                "Or tap Close and use the 'Files' option on the previous screen to pick a photo from gallery.";
        }
        if (isSamsung) {
            return "Camera couldn't open. On Samsung devices, check:\n" +
                "1. Settings → Apps → this app → Permissions → Camera (must be Allow).\n" +
                "2. Close Bixby Vision and any open Camera apps.\n" +
                "3. Disable Power-saving / Battery-saver mode.\n" +
                "Then tap Retry. Or tap Close and use the 'Files' option to pick from gallery.";
        }
        return "Camera not available. Check that camera permission is granted and no other app is using it. Then tap Retry. Or tap Close and use the 'Files' option to pick from gallery.";
    }
    if (name === "NotReadableError") {
        return "Camera is in use by another app. Close the other app (Camera, Bixby Vision, video calls) and tap Retry.";
    }
    if (name === "OverconstrainedError") return "Camera configuration not supported on this device. Tap Retry.";
    if (name === "SecurityError") return "Camera access blocked. Ensure HTTPS is in use and camera permissions are enabled.";
    if (name === "TimeoutError") {
        // Per-attempt or overall timeout — most common cause is a
        // permission prompt that never reached the user (installed
        // PWA where the popup hides behind the standalone chrome,
        // or MIUI's "background activity restricted" gating).
        return "Camera didn't respond. The permission prompt may not have appeared — open " +
            permissionLocation + " then tap Retry.";
    }
    return err?.message || "Camera access failed.";
}
