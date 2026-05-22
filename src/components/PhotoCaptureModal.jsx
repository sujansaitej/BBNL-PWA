import { useRef, useState, useCallback, useEffect } from "react";
import useCamera from "../hooks/useCamera";

// In-page photo capture modal. Replaces the native <input capture>
// flow for KYC photos and documents so the browser tab stays
// foregrounded throughout the capture — this is what makes Redmi /
// MIUI phones stop killing the tab mid-capture (Bug 11).
//
// Props:
//   isOpen        — controls visibility
//   onCapture(file) — called with a File (jpeg blob) on Use Photo
//   onClose()     — called on X / Cancel / Retake-after-close
//   title         — header label (default "Take Photo")
//   fileName      — filename to stamp on the captured File
//                   (default "capture.jpg")

export default function PhotoCaptureModal({
    isOpen,
    onCapture,
    onClose,
    title = "Take Photo",
    fileName = "capture.jpg",
}) {
    const { status, error, start, stop, videoRef, flipFacing } = useCamera({
        facingMode: "environment",
        active: isOpen,
    });

    const canvasRef = useRef(null);
    const [previewUrl, setPreviewUrl] = useState(null); // object URL of captured blob
    const capturedBlobRef = useRef(null);
    const [converting, setConverting] = useState(false);

    // Cleanup preview URL when component unmounts / modal closes so we
    // don't leak blob URLs. React only — this is frontend hygiene.
    useEffect(() => {
        return () => {
            if (previewUrl) {
                try { URL.revokeObjectURL(previewUrl); } catch (_) {}
            }
        };
    }, [previewUrl]);

    // Reset the capture state whenever the modal is closed from outside.
    useEffect(() => {
        if (!isOpen) {
            if (previewUrl) {
                try { URL.revokeObjectURL(previewUrl); } catch (_) {}
            }
            setPreviewUrl(null);
            capturedBlobRef.current = null;
            setConverting(false);
        }
    }, [isOpen, previewUrl]);

    const handleShutter = useCallback(async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        // Guard: nothing to capture if the stream hasn't delivered frames.
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;

        setConverting(true);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);

        // 0.85 quality keeps KYC document text crisp while staying well
        // under the 2 MB server limit for the common 1080p capture.
        canvas.toBlob((blob) => {
            if (!blob) {
                setConverting(false);
                return;
            }
            if (previewUrl) {
                try { URL.revokeObjectURL(previewUrl); } catch (_) {}
            }
            capturedBlobRef.current = blob;
            setPreviewUrl(URL.createObjectURL(blob));
            setConverting(false);
            // Once we have the frame we don't need the live stream —
            // free the camera so the user / another app can use it.
            stop();
        }, "image/jpeg", 0.85);
    }, [videoRef, previewUrl, stop]);

    const handleRetake = useCallback(() => {
        if (previewUrl) {
            try { URL.revokeObjectURL(previewUrl); } catch (_) {}
        }
        setPreviewUrl(null);
        capturedBlobRef.current = null;
        // Restart the camera for another shot.
        start();
    }, [previewUrl, start]);

    const handleUsePhoto = useCallback(() => {
        const blob = capturedBlobRef.current;
        if (!blob) return;
        const file = new File([blob], fileName, { type: "image/jpeg" });
        // Hand off to caller before we close — they may need the file
        // synchronously inside a user-gesture context (e.g. to trigger
        // a network upload that requires user-activation).
        onCapture?.(file);
        // Clear local state; parent will flip isOpen to false which
        // triggers the cleanup effect above.
    }, [fileName, onCapture]);

    const handleClose = useCallback(() => {
        stop();
        onClose?.();
    }, [stop, onClose]);

    if (!isOpen) return null;

    const showPreview = !!previewUrl;
    const showCamera = !showPreview;

    return (
        <div className="fixed inset-0 z-[70] bg-black flex flex-col">
            {/* Header */}
            <div
                className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-3 flex items-center justify-between shadow-lg"
                style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
            >
                <h2 className="text-lg font-medium">{title}</h2>
                <div className="flex items-center gap-2">
                    {showCamera && status === "scanning" && (
                        <button
                            onClick={flipFacing}
                            aria-label="Flip camera"
                            className="p-2 hover:bg-white/20 rounded-full transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    )}
                    <button
                        onClick={handleClose}
                        aria-label="Close"
                        className="p-2 hover:bg-white/20 rounded-full transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 relative flex items-center justify-center bg-black">
                {/* Live video — always rendered; only shown while in camera mode */}
                <video
                    ref={videoRef}
                    className={showCamera ? "w-full h-full object-contain" : "hidden"}
                    playsInline
                    muted
                    autoPlay
                />

                {/* Captured-frame preview */}
                {showPreview && (
                    <img
                        src={previewUrl}
                        alt="Captured"
                        className="w-full h-full object-contain"
                    />
                )}

                {/* Error overlay */}
                {showCamera && error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                        <div className="text-center text-white p-4 max-w-sm">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Camera Error</h3>
                            <div className="bg-white/10 rounded-xl p-4 mb-4 text-left">
                                <p className="text-sm whitespace-pre-line">{error}</p>
                            </div>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => start()}
                                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-medium py-3 px-6 rounded-xl"
                                >
                                    Retry
                                </button>
                                <button
                                    onClick={handleClose}
                                    className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-xl"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Initializing overlay */}
                {showCamera && !error && status === "initializing" && (
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

                {/* Hidden canvas used for frame -> blob conversion */}
                <canvas ref={canvasRef} className="hidden" />

                {/* ── Shutter — absolute-positioned OVER the preview.
                     Moved out of a footer bar (which was getting clipped
                     by the Android gesture bar on MIUI / OneUI) so it's
                     always visible regardless of safe-area-inset
                     support. Same layout every native camera app uses. */}
                {showCamera && !error && status === "scanning" && (
                    <div
                        className="absolute left-0 right-0 bottom-0 flex items-center justify-center pointer-events-none"
                        style={{ paddingBottom: "calc(max(1.5rem, env(safe-area-inset-bottom, 1.5rem)) + 1rem)" }}
                    >
                        <button
                            onClick={handleShutter}
                            disabled={converting}
                            aria-label="Take photo"
                            className="pointer-events-auto w-20 h-20 rounded-full bg-white shadow-2xl ring-4 ring-white/40 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-transform active:scale-95"
                        >
                            <span className="w-[4.25rem] h-[4.25rem] rounded-full border-[3px] border-gray-800 bg-white" />
                        </button>
                    </div>
                )}

                {showPreview && (
                    <div
                        className="absolute left-0 right-0 bottom-0 flex items-center justify-center gap-4 px-4 pointer-events-none"
                        style={{ paddingBottom: "calc(max(1.5rem, env(safe-area-inset-bottom, 1.5rem)) + 1rem)" }}
                    >
                        <button
                            onClick={handleRetake}
                            className="pointer-events-auto flex-1 max-w-[180px] bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white font-semibold py-3 px-6 rounded-full border border-white/40 shadow-xl"
                        >
                            Retake
                        </button>
                        <button
                            onClick={handleUsePhoto}
                            className="pointer-events-auto flex-1 max-w-[180px] bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-6 rounded-full shadow-xl"
                        >
                            Use Photo
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
