import { useState, useRef, useEffect } from 'react';
import jsQR from 'jsqr';

/**
 * QR Scanner Component using the device camera
 * Uses the native browser QR scanner API when available, falls back to jsQR library
 * Auto-starts camera on mount
 */
export default function QRScanner({ onScan, onClose, onError }) {
    const [error, setError] = useState('');
    const [scanStatus, setScanStatus] = useState('initializing'); // initializing, scanning, processing
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const scanIntervalRef = useRef(null);
    const isProcessingRef = useRef(false);
    const isMountedRef = useRef(true);
    // Re-entry guard. Rapid Retry / popstate-restart can call
    // startScanning() while a previous getUserMedia() is still in
    // flight. Two simultaneous getUserMedia calls fail with
    // NotReadableError on most Samsung / OnePlus / Realme builds.
    const inFlightRef = useRef(false);
    // Readiness timers: soft = kick scan early if events don't fire
    // on this device; hard = surface an error after 8s instead of
    // leaving the "Starting camera" overlay stuck forever.
    const softTimeoutRef = useRef(null);
    const hardTimeoutRef = useRef(null);
    const startupTimeoutRef = useRef(null);
    const startRunRef = useRef(0);
    const CAMERA_REQUEST_TIMEOUT_MS = 12000;
    const CAMERA_STARTUP_TIMEOUT_MS = 15000;

    const stopStream = (stream) => {
        if (!stream) return;
        try {
            stream.getTracks().forEach((track) => {
                try { track.onended = null; } catch (_) {}
                try { track.stop(); } catch (_) {}
            });
        } catch (_) {}
    };

    const getUserMediaWithTimeout = (constraints, timeoutMs = CAMERA_REQUEST_TIMEOUT_MS) => {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                const err = new Error(`Camera request timed out after ${timeoutMs}ms`);
                err.name = 'TimeoutError';
                reject(err);
            }, timeoutMs);

            navigator.mediaDevices.getUserMedia(constraints)
                .then((stream) => {
                    if (settled) {
                        stopStream(stream);
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
    };

    // Auto-start camera on mount
    useEffect(() => {
        isMountedRef.current = true;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const isInsecure = window.location.protocol !== 'https:' && window.location.hostname !== 'localhost';
            const msg = isInsecure
                ? 'Camera requires a secure (HTTPS) connection. Please access the app via HTTPS.'
                : 'Camera not supported on this device or browser.';
            setError(msg);
            onError?.(msg);
            return;
        }

        // Start scanning immediately. Avoid deferring through a timer:
        // some mobile browsers are stricter about camera requests that
        // happen later than the user-triggered modal open.
        startScanning();

        // Cleanup on unmount
        return () => {
            isMountedRef.current = false;
            stopScanning();
        };
    }, []);

    // Start camera and scanning
    const startScanning = async () => {
        // Skip if component unmounted
        if (!isMountedRef.current) return;
        // Re-entry guard — see ref declaration above.
        if (inFlightRef.current) {
            console.warn('📷 [QRScanner] startScanning() ignored — another call is in flight');
            return;
        }
        // Stop any existing stream/interval before starting fresh (e.g. on Retry)
        stopScanning();
        inFlightRef.current = true;
        const runId = startRunRef.current + 1;
        startRunRef.current = runId;

        try {
            setScanStatus('initializing');
            setError('');
            startupTimeoutRef.current = setTimeout(() => {
                if (!isMountedRef.current || startRunRef.current !== runId) return;
                if (scanStatus === 'scanning' || scanStatus === 'processing') return;
                stopScanning();
                inFlightRef.current = false;
                const ua = navigator.userAgent || '';
                const isSamsung = /SamsungBrowser|SM-[A-Z]\d|Galaxy/i.test(ua);
                setError(
                    isSamsung
                        ? 'Camera is taking too long to start on this Samsung phone. Close Camera/Bixby Vision/video-call apps, allow Camera permission, then tap Retry.'
                        : 'Camera is taking too long to start. Close other camera apps and tap Retry.'
                );
            }, CAMERA_STARTUP_TIMEOUT_MS);

            // Note: we intentionally do NOT check navigator.permissions.query for camera.
            // On many Android devices/browsers, the Permissions API incorrectly reports
            // 'denied' even though getUserMedia would still show the permission prompt.
            // Instead, we always attempt getUserMedia and handle the actual error.

            // Skip if component unmounted during permission check
            if (!isMountedRef.current) return;

            // Wake the device subsystem and collect every videoinput
            // deviceId we can see, for the explicit-deviceId fallback
            // attempts below. On Samsung One UI 4.x (Galaxy M51 /
            // A-series) the first getUserMedia call after a cold
            // WebView start can return NotFoundError; warming
            // enumerateDevices fixes most cases, and explicit
            // deviceId attempts catch the rest.
            let videoDeviceIds = [];
            try {
                if (navigator.mediaDevices.enumerateDevices) {
                    const list = await navigator.mediaDevices.enumerateDevices();
                    videoDeviceIds = list.filter(d => d.kind === 'videoinput')
                        .map(d => d.deviceId).filter(Boolean);
                    console.log(`📷 [QRScanner] enumerateDevices → ${videoDeviceIds.length} videoinput device(s)`);
                }
            } catch (_) {}

            // Progressive constraint fallback — different Android
            // skins / browser engines accept different constraint
            // shapes and a single one-shot getUserMedia often returns
            // an immediately-ended track on Samsung A-series and some
            // MIUI devices. Iterate until we get a LIVE track.
            const csAttempts = [
                {
                    video: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        frameRate: { ideal: 24, max: 30 },
                    },
                    audio: false,
                    _name: 'ideal-env-720p',
                },
                {
                    video: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        frameRate: { ideal: 24, max: 30 },
                    },
                    audio: false,
                    _name: 'ideal-env-480p',
                },
                { video: { facingMode: { ideal: 'environment' } }, audio: false, _name: 'ideal-env-only' },
                { video: { facingMode: 'environment' }, audio: false, _name: 'string-env' },
                // Per-device explicit deviceId attempts — the Samsung
                // M51 escape hatch when facingMode resolution all
                // fails with NotFoundError.
                ...videoDeviceIds.map((id, i) => ({
                    video: {
                        deviceId: { exact: id },
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        frameRate: { ideal: 24, max: 30 },
                    },
                    audio: false,
                    _name: `deviceId-${i}`,
                })),
                {
                    video: {
                        facingMode: { ideal: 'user' },
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        frameRate: { ideal: 24, max: 30 },
                    },
                    audio: false,
                    _name: 'ideal-user-480p',
                },
                { video: { facingMode: 'user' }, audio: false, _name: 'string-user' },
                { video: true, audio: false, _name: 'video-true' },
            ];

            const runAttempts = async () => {
                let s = null;
                let last = null;
                for (const cs of csAttempts) {
                    try {
                        console.log(`📷 [QRScanner] Trying ${cs._name}...`);
                        // eslint-disable-next-line no-unused-vars
                        const { _name, ...constraint } = cs;
                        if (startRunRef.current !== runId) return { stream: null, lastErr: last };
                        const got = await getUserMediaWithTimeout(constraint);
                        if (startRunRef.current !== runId) {
                            stopStream(got);
                            return { stream: null, lastErr: last };
                        }
                        const tracks = got.getVideoTracks();
                        const live = tracks.some(t => t.readyState === 'live');
                        console.log(`📷 [QRScanner] ${cs._name} → tracks=${tracks.length}, live=${live}`);
                        if (!live) {
                            stopStream(got);
                            continue;
                        }
                        s = got;
                        break;
                    } catch (e) {
                        last = e;
                        console.warn(`📷 [QRScanner] ${cs._name} threw: ${e?.name} ${e?.message}`);
                        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' ||
                            e.name === 'SecurityError') {
                            throw e;
                        }
                    }
                }
                return { stream: s, lastErr: last };
            };

            let { stream, lastErr } = await runAttempts();
            if (startRunRef.current !== runId) {
                if (stream) stopStream(stream);
                return;
            }
            // Samsung One UI cold-start NotFoundError quirk — wait
            // 500ms, re-warm enumerateDevices, then retry the ladder
            // once. If the camera really doesn't exist (tablets, dev
            // boxes), the second pass will fail again and we surface
            // the original error.
            if (!stream && lastErr && lastErr.name === 'NotFoundError') {
                console.warn('📷 [QRScanner] NotFoundError on cold start — retrying after 500ms warm-up');
                await new Promise(r => setTimeout(r, 500));
                try {
                    if (navigator.mediaDevices.enumerateDevices) {
                        await navigator.mediaDevices.enumerateDevices();
                    }
                } catch (_) {}
                const second = await runAttempts();
                if (startRunRef.current !== runId) {
                    if (second.stream) stopStream(second.stream);
                    return;
                }
                if (second.stream) stream = second.stream;
                else lastErr = second.lastErr || lastErr;
            }
            if (!stream) {
                throw lastErr || new Error('All camera-start attempts failed');
            }
            if (startupTimeoutRef.current) { clearTimeout(startupTimeoutRef.current); startupTimeoutRef.current = null; }

            // Skip if component unmounted during camera request
            if (!isMountedRef.current) {
                stopStream(stream);
                return;
            }

            streamRef.current = stream;

            // Mid-stream track-loss handler — if another app grabs the
            // camera or the OS revokes the sensor (low-power mode,
            // Knox container switch), the track flips to "ended" and
            // the scanner shows a frozen black frame. Detect it,
            // surface a clear error, and let the user Retry.
            try {
                stream.getVideoTracks().forEach(t => {
                    t.onended = () => {
                        if (!isMountedRef.current) return;
                        if (streamRef.current !== stream) return;
                        console.warn('📷 [QRScanner] video track ended unexpectedly');
                        stopScanning();
                        setError('Camera was disconnected (another app may have taken it). Tap Retry.');
                    };
                });
            } catch (_) {}

            if (videoRef.current) {
                const v = videoRef.current;
                // Belt-and-braces video attributes — Samsung Internet
                // sometimes ignores the JSX-set values when srcObject
                // is bound first. Set them imperatively before binding.
                try {
                    v.setAttribute('playsinline', 'true');
                    v.setAttribute('webkit-playsinline', 'true');
                    v.playsInline = true;
                    v.muted = true;
                    v.autoplay = true;
                    v.setAttribute('autoplay', 'true');
                    v.setAttribute('muted', 'true');
                } catch (_) {}

                // CRITICAL: bind readiness listeners BEFORE setting
                // srcObject. Samsung Internet (and some One UI WebView
                // builds) fires `loadedmetadata` SYNCHRONOUSLY when an
                // already-live MediaStream is attached via srcObject.
                // If we bind listeners after that assignment, the
                // event has already fired and been missed — operators
                // saw "Starting camera..." spin until the 8s hard
                // timeout. Reordering covers Samsung; on Chrome / iOS
                // Safari the event is async so behaviour is unchanged.
                let probeInterval = null;
                let probeAttempts = 0;
                let videoReady = false;
                const markReady = () => {
                    if (videoReady) return;
                    if (!isMountedRef.current || !streamRef.current) return;
                    if (startRunRef.current !== runId) return;
                    videoReady = true;
                    if (softTimeoutRef.current) { clearTimeout(softTimeoutRef.current); softTimeoutRef.current = null; }
                    if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
                    if (probeInterval) { clearInterval(probeInterval); probeInterval = null; }
                    setScanStatus('scanning');
                    console.log('📷 [QRScanner] markReady — stream is live');
                    startQRDetection();
                };

                v.oncanplay = markReady;
                v.onloadedmetadata = markReady;
                v.onloadeddata = markReady;
                v.onplaying = markReady;

                // Now safe to bind the stream — listeners will catch
                // loadedmetadata whether it's sync (Samsung) or async.
                v.srcObject = stream;

                // 100 ms videoWidth poll — Samsung can deliver frames
                // without ever firing the readiness events at all.
                // Poll for ≤ 2 s and promote the moment videoWidth
                // becomes non-zero (means a frame has been decoded).
                probeInterval = setInterval(() => {
                    if (videoReady) { clearInterval(probeInterval); probeInterval = null; return; }
                    probeAttempts += 1;
                    if ((videoRef.current?.videoWidth || 0) > 0) {
                        console.log(`📷 [QRScanner] probe-timer: videoWidth=${videoRef.current?.videoWidth} after ${probeAttempts*100}ms`);
                        markReady();
                    } else if (probeAttempts >= 20) {
                        clearInterval(probeInterval); probeInterval = null;
                    }
                }, 100);

                // Soft fallback at 800ms — only promotes when video
                // dimensions are non-zero (frames are decoding). The
                // previous "trackLive OR dim" rule promoted on
                // trackLive alone — track was reported live but no
                // frames had arrived yet, so the "Starting camera"
                // overlay disappeared before the user saw any video,
                // leaving a permanent black screen on Galaxy M51 and
                // similar Samsung One UI builds. Requiring dim means
                // we only promote once a real frame has decoded.
                softTimeoutRef.current = setTimeout(() => {
                    if (videoReady) return;
                    const trackLive = stream.getVideoTracks().some(t => t.readyState === 'live');
                    const dim = (videoRef.current?.videoWidth || 0) > 0;
                    console.log(`📷 [QRScanner] soft-timeout: trackLive=${trackLive}, videoWidth=${videoRef.current?.videoWidth}`);
                    if (dim) markReady();
                }, 800);

                // Hard fallback: if we still don't have readiness after 8s,
                // tear the stream down and prompt the user to retry. This
                // prevents the "Starting camera" overlay from locking
                // forever on devices where play() stalls silently. Samsung
                // M51 / One UI 4.x typically hits this when power-saving
                // is on or Knox restricts the sensor — surface device-
                // aware guidance so the operator knows what to fix.
                hardTimeoutRef.current = setTimeout(() => {
                    if (videoReady || !isMountedRef.current) return;
                    stopScanning();
                    const ua = navigator.userAgent || '';
                    const isSamsung = /SamsungBrowser|SM-[A-Z]\d|Galaxy/i.test(ua);
                    setError(
                        isSamsung
                            ? 'Camera started but no video. On Samsung:\n1. Disable Power-saving / Battery-saver for this app.\n2. Close Bixby Vision and any open Camera apps.\n3. Settings → Apps → this app → Permissions → Camera (set to Allow).\nThen tap Retry.'
                            : "Camera didn't start. Close other apps using the camera and tap Retry. If this keeps happening, restart the app."
                    );
                }, 8000);

                try {
                    const playResult = videoRef.current.play();
                    // Older Android WebViews return undefined from play()
                    // instead of a Promise. Guard the await.
                    if (playResult && typeof playResult.then === 'function') {
                        // Race against a 3s timeout. On some Samsung /
                        // Vivo / Realme builds, play() can hang
                        // indefinitely while still delivering frames —
                        // the readiness events and the videoWidth probe
                        // still promote the spinner, but a blocked
                        // await would leak the in-flight guard. A
                        // PlayTimeout is treated as non-fatal.
                        await Promise.race([
                            playResult,
                            new Promise((_, reject) => setTimeout(() => {
                                const e = new Error('play() did not resolve within 3s');
                                e.name = 'PlayTimeout';
                                reject(e);
                            }, 3000)),
                        ]);
                    }
                } catch (playErr) {
                    if (playErr.name === 'PlayTimeout') {
                        // Don't fail — soft timeout / probe will take over.
                        console.warn('📷 [QRScanner] play() didn\'t resolve in 3s — relying on probe');
                    } else if (playErr.name === 'NotAllowedError') {
                        // Samsung Internet sometimes rejects play() with
                        // NotAllowedError even after permission grant.
                        // Retry once after a tick — many times the
                        // second attempt succeeds because the
                        // user-gesture token has propagated.
                        await new Promise(r => setTimeout(r, 100));
                        try { await videoRef.current.play(); } catch (_) {}
                    } else if (playErr.name === 'AbortError') {
                        return;
                    } else {
                        if (softTimeoutRef.current) { clearTimeout(softTimeoutRef.current); softTimeoutRef.current = null; }
                        if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
                        throw playErr;
                    }
                }
            }
        } catch (err) {
            // Skip error handling if component unmounted
            if (!isMountedRef.current) return;

            console.error('Camera access error:', err);

            // Device-aware messaging — installed-PWA vs browser-tab
            // permission location differs, and Samsung One UI returns
            // NotFoundError for permission/Knox issues that Chrome
            // would have surfaced as NotAllowedError.
            const ua = navigator.userAgent || '';
            const isSamsung = /SamsungBrowser|SM-[A-Z]\d|Galaxy/i.test(ua);
            const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches
                || window.navigator?.standalone === true;
            const permissionHint = isStandalone
                ? 'Settings → Apps → this app → Permissions → Camera (set to Allow)'
                : 'the lock icon in the address bar (set Camera to Allow)';

            let errorMessage = 'Camera access denied.';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                errorMessage = `Camera permission denied. Open ${permissionHint}, then tap Retry.`;
            } else if (err.name === 'TimeoutError') {
                errorMessage = "Camera took too long to start. Close other camera apps and tap Retry.";
            } else if (err.name === 'NotFoundError') {
                errorMessage = isSamsung
                    ? "Camera couldn't open. On Samsung devices, check:\n" +
                      "1. Settings → Apps → this app → Permissions → Camera (must be Allow).\n" +
                      "2. Close Bixby Vision and any open Camera apps.\n" +
                      "3. Disable Power-saving / Battery-saver mode.\n" +
                      "Then tap Retry."
                    : 'Camera not available. Check that camera permission is granted and no other app is using it. Then tap Retry.';
            } else if (err.name === 'NotReadableError') {
                errorMessage = 'Camera is in use by another app. Close the other app (Camera, Bixby Vision, video calls) and tap Retry.';
            } else if (err.name === 'OverconstrainedError') {
                errorMessage = 'Camera configuration not supported on this device. Tap Retry.';
            } else if (err.name === 'SecurityError') {
                errorMessage = 'Camera access blocked. Ensure HTTPS is in use and camera permissions are enabled.';
            } else if (err.name === 'AbortError') {
                // Ignore abort errors - they happen during normal cleanup
                return;
            }

            setError(errorMessage);
            onError?.(errorMessage);
        } finally {
            // Always clear the re-entry guard, regardless of how we
            // exit (success / handled error / unmount-skip / explicit
            // return). Without this, a transient failure leaves the
            // guard set, and Retry / popstate-restart silently
            // no-ops.
            if (startupTimeoutRef.current) { clearTimeout(startupTimeoutRef.current); startupTimeoutRef.current = null; }
            if (startRunRef.current === runId) inFlightRef.current = false;
        }
    };

    // Stop camera and scanning
    const stopScanning = () => {
        startRunRef.current += 1;
        setScanStatus('initializing');
        isProcessingRef.current = false;

        if (scanIntervalRef.current) {
            clearInterval(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }
        // Clear readiness timers so they can't resurrect the overlay
        // or fire a Retry prompt after the component has moved on.
        if (softTimeoutRef.current) { clearTimeout(softTimeoutRef.current); softTimeoutRef.current = null; }
        if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
        if (startupTimeoutRef.current) { clearTimeout(startupTimeoutRef.current); startupTimeoutRef.current = null; }

        if (streamRef.current) {
            stopStream(streamRef.current);
            streamRef.current = null;
        }

        if (videoRef.current) {
            // Detach the event handlers too so a late-firing event on
            // a stale element doesn't call back into markReady.
            videoRef.current.oncanplay = null;
            videoRef.current.onloadedmetadata = null;
            videoRef.current.onloadeddata = null;
            videoRef.current.onplaying = null;
            try { videoRef.current.pause(); } catch (_) {}
            videoRef.current.srcObject = null;
        }
    };

    // QR code detection
    const startQRDetection = async () => {
        if ('BarcodeDetector' in window) {
            try {
                const barcodeDetector = new window.BarcodeDetector({
                    formats: ['qr_code']
                });
                console.log('🔵 [QRScanner] using native BarcodeDetector');

                let attempts = 0;
                let detectErrors = 0;
                scanIntervalRef.current = setInterval(async () => {
                    if (isProcessingRef.current) return;

                    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                        try {
                            isProcessingRef.current = true;
                            attempts++;
                            const barcodes = await barcodeDetector.detect(videoRef.current);
                            if (barcodes.length > 0) {
                                console.log(`✅ [QRScanner] BarcodeDetector hit after ${attempts} attempts`);
                                handleQRCodeDetected(barcodes[0].rawValue);
                            } else if (attempts === 40) {
                                console.warn('[QRScanner] BarcodeDetector found no QR after 40 attempts, switching to jsQR');
                                clearInterval(scanIntervalRef.current);
                                scanIntervalRef.current = null;
                                isProcessingRef.current = false;
                                startCanvasQRDetection();
                                return;
                            } else if (attempts === 20 || attempts === 60 || attempts === 120) {
                                // Periodic heartbeat: at ~3s, ~9s, ~18s
                                console.log(`🔵 [QRScanner] BarcodeDetector ${attempts} attempts, no QR yet (errors=${detectErrors})`);
                            }
                            isProcessingRef.current = false;
                        } catch (err) {
                            detectErrors++;
                            if (detectErrors === 1) {
                                // First error — log and fall back to
                                // jsQR which doesn't share whatever the
                                // native detector is choking on.
                                console.warn('⚠️ [QRScanner] BarcodeDetector failed, falling back to jsQR:', err?.message);
                                clearInterval(scanIntervalRef.current);
                                scanIntervalRef.current = null;
                                isProcessingRef.current = false;
                                startCanvasQRDetection();
                                return;
                            }
                            isProcessingRef.current = false;
                        }
                    }
                }, 150);
            } catch (err) {
                console.warn('⚠️ [QRScanner] BarcodeDetector init failed, using jsQR:', err?.message);
                startCanvasQRDetection();
            }
        } else {
            console.log('🔵 [QRScanner] BarcodeDetector unavailable, using jsQR');
            startCanvasQRDetection();
        }
    };

    // Canvas-based QR code detection fallback
    const startCanvasQRDetection = () => {
        const canvas = canvasRef.current;
        if (!canvas) {
            console.warn('⚠️ [QRScanner] canvas ref missing — cannot start jsQR detection');
            return;
        }
        console.log('🔵 [QRScanner] using jsQR fallback (canvas-based)');

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let scanInterval = 250;
        let consecutiveFailures = 0;
        let attempts = 0;

        const scan = () => {
            if (isProcessingRef.current) return;

            if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                try {
                    isProcessingRef.current = true;
                    attempts++;
                    if (attempts === 20 || attempts === 60 || attempts === 120) {
                        console.log(`🔵 [QRScanner] jsQR ${attempts} attempts, no QR yet`);
                    }

                    if (canvas.width !== videoRef.current.videoWidth) {
                        canvas.width = videoRef.current.videoWidth;
                        canvas.height = videoRef.current.videoHeight;
                    }

                    ctx.drawImage(videoRef.current, 0, 0);

                    // Multi-region detection. Production "Scan from TV"
                    // failures were caused by holding the phone too
                    // close (QR exceeds the 60% center crop) or the QR
                    // being slightly off-centre. Try the centre crop
                    // first (cheap, fast), then the full frame, then
                    // attempt inverted detection — TV screens often
                    // render the QR with non-standard contrast (light-
                    // on-dark or with reflections) that 'dontInvert'
                    // misses.
                    const tryDetect = (imgData, label) => {
                        // Pass 1: standard
                        let qr = jsQR(imgData.data, imgData.width, imgData.height, {
                            inversionAttempts: 'dontInvert',
                        });
                        if (qr && qr.data) {
                            console.log(`✅ [QRScanner] detected (${label}, dontInvert)`);
                            return qr;
                        }
                        // Pass 2: try inverted (TV screens, reflections)
                        qr = jsQR(imgData.data, imgData.width, imgData.height, {
                            inversionAttempts: 'onlyInvert',
                        });
                        if (qr && qr.data) {
                            console.log(`✅ [QRScanner] detected (${label}, onlyInvert)`);
                            return qr;
                        }
                        return null;
                    };

                    // Centre crop first (faster — most QRs are aimed there)
                    const centerX = Math.floor(canvas.width * 0.2);
                    const centerY = Math.floor(canvas.height * 0.2);
                    const regionWidth = Math.floor(canvas.width * 0.6);
                    const regionHeight = Math.floor(canvas.height * 0.6);
                    const centerData = ctx.getImageData(centerX, centerY, regionWidth, regionHeight);
                    let qrCode = tryDetect(centerData, 'centre');

                    // Full frame fallback — covers off-centre / large QRs
                    if (!qrCode) {
                        const fullData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        qrCode = tryDetect(fullData, 'full');
                    }

                    if (qrCode && qrCode.data) {
                        handleQRCodeDetected(qrCode.data);
                    } else {
                        consecutiveFailures++;
                        if (consecutiveFailures > 10 && scanInterval < 400) {
                            scanInterval = 400;
                            clearInterval(scanIntervalRef.current);
                            scanIntervalRef.current = setInterval(scan, scanInterval);
                        }
                    }

                    isProcessingRef.current = false;
                } catch (err) {
                    isProcessingRef.current = false;
                }
            }
        };

        scanIntervalRef.current = setInterval(scan, scanInterval);
    };

    // Handle QR code detection
    const handleQRCodeDetected = (qrData) => {
        setScanStatus('processing');
        stopScanning();
        if (onScan) {
            onScan(qrData);
        }
    };

    const handleClose = () => {
        stopScanning();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-3 flex items-center justify-between shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                <h2 className="text-lg font-medium">Scan QR Code</h2>
                <button
                    onClick={handleClose}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Camera View */}
            <div className="flex-1 relative flex items-center justify-center bg-black">
                {/* Video element - always rendered */}
                <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                    autoPlay
                />

                {/* Error state */}
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                        <div className="text-center text-white p-4 max-w-sm">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Camera Access Required</h3>
                            <div className="bg-white/10 rounded-xl p-4 mb-4 text-left">
                                <p className="text-sm whitespace-pre-line">{error}</p>
                            </div>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => { setError(''); startScanning(); }}
                                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-medium py-3 px-6 rounded-xl transition-colors"
                                >
                                    Retry
                                </button>
                                <button
                                    onClick={handleClose}
                                    className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-xl transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Initializing overlay */}
                {!error && scanStatus === 'initializing' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                        <div className="text-center text-white p-4">
                            <div className="w-12 h-12 border-4 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
                            <p className="text-sm mb-6">Starting camera...</p>
                            <button
                                onClick={handleClose}
                                className="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-6 rounded-full transition-colors border border-white/30"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Scanning overlay */}
                {!error && (scanStatus === 'scanning' || scanStatus === 'processing') && (
                    <>

                        {/* QR code frame overlay */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="relative w-64 h-64">
                                {/* Corner brackets */}
                                <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-indigo-500 rounded-tl-lg"></div>
                                <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-indigo-500 rounded-tr-lg"></div>
                                <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-indigo-500 rounded-bl-lg"></div>
                                <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-indigo-500 rounded-br-lg"></div>

                                {/* Scanning line animation */}
                                {scanStatus === 'scanning' && (
                                    <div className="absolute inset-x-2 top-2 bottom-2 overflow-hidden">
                                        <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-indigo-500 to-transparent animate-[scan_2s_ease-in-out_infinite]"></div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Dark overlay around frame */}
                        <div className="absolute inset-0 pointer-events-none">
                            <div className="absolute inset-0 bg-black/50"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-transparent" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }}></div>
                        </div>

                        {/* Instructions */}
                        <div className="absolute bottom-24 left-0 right-0 text-center">
                            <div className="bg-black/70 backdrop-blur-sm inline-block px-6 py-3 rounded-full">
                                {scanStatus === 'scanning' && (
                                    <p className="text-sm text-white flex items-center gap-2">
                                        <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                                        Align QR code within the frame
                                    </p>
                                )}
                                {scanStatus === 'processing' && (
                                    <p className="text-sm text-purple-400 font-medium">
                                        QR Code detected!
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Cancel button */}
                        <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                            <button
                                onClick={handleClose}
                                className="bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white font-medium py-3 px-8 rounded-full transition-colors border border-white/30"
                            >
                                Cancel
                            </button>
                        </div>
                    </>
                )}

                {/* Hidden canvas for image processing */}
                <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Custom animation styles */}
            <style>{`
                @keyframes scan {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(248px); }
                }
            `}</style>
        </div>
    );
}
