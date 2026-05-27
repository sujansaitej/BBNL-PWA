import { useRef, useState, useEffect, useCallback } from "react";

(function installLegacyGetUserMediaShim() {
    try {
        if (typeof navigator === "undefined") return;
        if (!navigator.mediaDevices) {
            try { navigator.mediaDevices = {}; } catch (_) {}
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
    } catch (_) {}
})();

const CAMERA_TIMEOUT_MS = 12000;
const READY_TIMEOUT_MS = 8000;

export default function useCamera({
    facingMode = "environment",
    active = true,
    idealWidth = 1280,
    idealHeight = 720,
} = {}) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const requestIdRef = useRef(0);
    const readyPollRef = useRef(null);
    const readyTimeoutRef = useRef(null);
    const isMountedRef = useRef(true);

    const [status, setStatus] = useState("idle");
    const [error, setError] = useState("");
    const [facing, setFacing] = useState(facingMode);

    const clearTimers = useCallback(() => {
        if (readyPollRef.current) {
            clearInterval(readyPollRef.current);
            readyPollRef.current = null;
        }
        if (readyTimeoutRef.current) {
            clearTimeout(readyTimeoutRef.current);
            readyTimeoutRef.current = null;
        }
    }, []);

    const stop = useCallback(() => {
        requestIdRef.current += 1;
        clearTimers();

        const stream = streamRef.current;
        if (stream) {
            try {
                stream.getTracks().forEach((track) => {
                    try { track.onended = null; } catch (_) {}
                    try { track.stop(); } catch (_) {}
                });
            } catch (_) {}
            streamRef.current = null;
        }

        const video = videoRef.current;
        if (video) {
            video.oncanplay = null;
            video.onloadedmetadata = null;
            video.onloadeddata = null;
            video.onplaying = null;
            try { video.pause(); } catch (_) {}
            try { video.srcObject = null; } catch (_) {}
        }

        if (isMountedRef.current) setStatus("idle");
    }, [clearTimers]);

    const getUserMediaWithTimeout = useCallback((constraints, timeoutMs = CAMERA_TIMEOUT_MS) => {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                const err = new Error(`Camera request timed out after ${timeoutMs}ms`);
                err.name = "TimeoutError";
                reject(err);
            }, timeoutMs);

            navigator.mediaDevices.getUserMedia(constraints)
                .then((stream) => {
                    if (settled) {
                        try { stream.getTracks().forEach((track) => track.stop()); } catch (_) {}
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    resolve(stream);
                })
                .catch((err) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }, []);

    const buildAttempts = useCallback((preferredFacing) => {
        const fallbackFacing = preferredFacing === "environment" ? "user" : "environment";
        return [
            {
                facing: preferredFacing,
                constraints: {
                    video: {
                        facingMode: { ideal: preferredFacing },
                        width: { ideal: idealWidth },
                        height: { ideal: idealHeight },
                    },
                    audio: false,
                },
            },
            {
                facing: preferredFacing,
                constraints: {
                    video: { facingMode: preferredFacing },
                    audio: false,
                },
            },
            {
                facing: fallbackFacing,
                constraints: {
                    video: {
                        facingMode: { ideal: fallbackFacing },
                        width: { ideal: idealWidth },
                        height: { ideal: idealHeight },
                    },
                    audio: false,
                },
            },
            {
                facing: fallbackFacing,
                constraints: {
                    video: { facingMode: fallbackFacing },
                    audio: false,
                },
            },
            {
                facing: preferredFacing,
                constraints: { video: true, audio: false },
            },
        ];
    }, [idealWidth, idealHeight]);

    const waitForVideoReady = useCallback((video, requestId) => {
        return new Promise((resolve, reject) => {
            let done = false;

            const finish = (fn) => {
                if (done) return;
                done = true;
                clearTimers();
                video.oncanplay = null;
                video.onloadedmetadata = null;
                video.onloadeddata = null;
                video.onplaying = null;
                fn();
            };

            const markReady = () => {
                if (!isMountedRef.current) return finish(() => reject(new Error("unmounted")));
                if (requestId !== requestIdRef.current) return finish(() => reject(new Error("stale")));
                if ((video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0) {
                    finish(resolve);
                }
            };

            video.oncanplay = markReady;
            video.onloadedmetadata = markReady;
            video.onloadeddata = markReady;
            video.onplaying = markReady;

            readyPollRef.current = setInterval(markReady, 150);
            readyTimeoutRef.current = setTimeout(() => {
                finish(() => {
                    const err = new Error("Camera started but no video frames arrived.");
                    err.name = "TimeoutError";
                    reject(err);
                });
            }, READY_TIMEOUT_MS);
        });
    }, [clearTimers]);

    const start = useCallback(async (overrideFacing) => {
        if (!isMountedRef.current) return;

        const requestedFacing = overrideFacing || facing;
        const currentRequestId = requestIdRef.current + 1;
        requestIdRef.current = currentRequestId;

        clearTimers();
        const priorStream = streamRef.current;
        if (priorStream) {
            try {
                priorStream.getTracks().forEach((track) => {
                    try { track.onended = null; } catch (_) {}
                    try { track.stop(); } catch (_) {}
                });
            } catch (_) {}
            streamRef.current = null;
        }

        const video = videoRef.current;
        if (video) {
            video.oncanplay = null;
            video.onloadedmetadata = null;
            video.onloadeddata = null;
            video.onplaying = null;
            try { video.pause(); } catch (_) {}
            try { video.srcObject = null; } catch (_) {}
            try {
                video.setAttribute("playsinline", "true");
                video.setAttribute("webkit-playsinline", "true");
                video.muted = true;
                video.autoplay = true;
            } catch (_) {}
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const insecure = window.location.protocol !== "https:" && window.location.hostname !== "localhost";
            setError(
                insecure
                    ? "Camera requires HTTPS. Open the app over a secure connection and retry."
                    : "Camera is not supported on this device or browser."
            );
            setStatus("error");
            return;
        }

        setStatus("initializing");
        setError("");

        const attempts = buildAttempts(requestedFacing);
        let lastError = null;
        let liveStream = null;
        let resolvedFacing = requestedFacing;

        for (const attempt of attempts) {
            try {
                const stream = await getUserMediaWithTimeout(attempt.constraints);
                if (currentRequestId !== requestIdRef.current || !isMountedRef.current) {
                    try { stream.getTracks().forEach((track) => track.stop()); } catch (_) {}
                    return;
                }
                const hasLiveVideo = stream.getVideoTracks().some((track) => track.readyState === "live");
                if (!hasLiveVideo) {
                    try { stream.getTracks().forEach((track) => track.stop()); } catch (_) {}
                    continue;
                }
                liveStream = stream;
                resolvedFacing = attempt.facing;
                break;
            } catch (err) {
                lastError = err;
                if (isFatalCameraError(err)) break;
            }
        }

        if (!liveStream) {
            if (currentRequestId !== requestIdRef.current || !isMountedRef.current) return;
            setError(mapCameraError(lastError));
            setStatus("error");
            return;
        }

        streamRef.current = liveStream;
        setFacing(resolvedFacing);

        try {
            liveStream.getVideoTracks().forEach((track) => {
                track.onended = () => {
                    if (!isMountedRef.current) return;
                    if (currentRequestId !== requestIdRef.current) return;
                    stop();
                    setError("Camera stopped unexpectedly. Please tap Retry.");
                    setStatus("error");
                };
            });
        } catch (_) {}

        if (!videoRef.current) {
            stop();
            return;
        }

        const liveVideo = videoRef.current;
        liveVideo.srcObject = liveStream;

        try {
            const playPromise = liveVideo.play();
            if (playPromise && typeof playPromise.then === "function") {
                await playPromise.catch((err) => {
                    if (err?.name !== "AbortError") throw err;
                });
            }
            await waitForVideoReady(liveVideo, currentRequestId);
            if (!isMountedRef.current || currentRequestId !== requestIdRef.current) return;
            setStatus("scanning");
        } catch (err) {
            if (!isMountedRef.current || currentRequestId !== requestIdRef.current) return;
            stop();
            setError(mapCameraError(err));
            setStatus("error");
        }
    }, [buildAttempts, clearTimers, facing, getUserMediaWithTimeout, stop, waitForVideoReady]);

    const flipFacing = useCallback(() => {
        const nextFacing = facing === "environment" ? "user" : "environment";
        setFacing(nextFacing);
        start(nextFacing);
    }, [facing, start]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            stop();
        };
    }, [stop]);

    useEffect(() => {
        if (!isMountedRef.current) return;
        if (active) start();
        else stop();
        // `start` changes identity when facing changes; we do not want
        // that alone to auto-restart the camera while the modal is open.
        // Facing changes are handled explicitly by `flipFacing()`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    return { status, error, start, stop, videoRef, flipFacing, facing };
}

function isFatalCameraError(err) {
    const name = err?.name || "";
    return name === "NotAllowedError"
        || name === "PermissionDeniedError"
        || name === "SecurityError";
}

function mapCameraError(err) {
    const name = err?.name || "";

    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return "Camera permission was denied. Allow camera access for this app and tap Retry.";
    }
    if (name === "NotFoundError") {
        return "No camera was found. If this phone has multiple cameras, tap Retry. You can also use Media picker.";
    }
    if (name === "NotReadableError") {
        return "Camera is busy in another app. Close Camera, video call, or scanner apps and tap Retry.";
    }
    if (name === "OverconstrainedError") {
        return "Back camera could not be started with the preferred settings. Tap Retry to try again.";
    }
    if (name === "SecurityError") {
        return "Camera access is blocked. Open the app over HTTPS and allow camera permission, then tap Retry.";
    }
    if (name === "TimeoutError") {
        return "Camera did not start in time. Tap Retry. If it still fails, use Media picker.";
    }
    return err?.message || "Camera access failed. Tap Retry.";
}
