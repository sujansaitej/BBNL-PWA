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

    // Auto-start camera on mount
    useEffect(() => {
        isMountedRef.current = true;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setError('Camera not supported on this device');
            onError?.('Camera not supported');
            return;
        }

        // Start scanning immediately (with small delay to prevent strict mode issues)
        const timer = setTimeout(() => {
            if (isMountedRef.current) {
                startScanning();
            }
        }, 100);

        // Cleanup on unmount
        return () => {
            isMountedRef.current = false;
            clearTimeout(timer);
            stopScanning();
        };
    }, []);

    // Start camera and scanning
    const startScanning = async () => {
        // Skip if component unmounted
        if (!isMountedRef.current) return;

        try {
            setScanStatus('initializing');
            setError('');

            // Check permission status first (if supported)
            if (navigator.permissions) {
                try {
                    const permissionStatus = await navigator.permissions.query({ name: 'camera' });
                    if (permissionStatus.state === 'denied') {
                        if (isMountedRef.current) {
                            setError('Camera permission is blocked. Please enable camera access in your browser settings (tap the lock icon in the address bar).');
                        }
                        return;
                    }
                } catch (e) {
                    // Permission query not supported, continue anyway
                }
            }

            // Skip if component unmounted during permission check
            if (!isMountedRef.current) return;

            // Request camera with fallback options
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }
                });
            } catch (e) {
                // Try without facingMode constraint
                stream = await navigator.mediaDevices.getUserMedia({
                    video: true
                });
            }

            // Skip if component unmounted during camera request
            if (!isMountedRef.current) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }

            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;

                // Use oncanplay which fires when enough data is available
                videoRef.current.oncanplay = () => {
                    if (isMountedRef.current && streamRef.current) {
                        setScanStatus('scanning');
                        startQRDetection();
                    }
                };

                // Fallback: start scanning after short delay if event doesn't fire
                setTimeout(() => {
                    if (isMountedRef.current && streamRef.current) {
                        setScanStatus('scanning');
                        startQRDetection();
                    }
                }, 1500);

                try {
                    await videoRef.current.play();
                } catch (playErr) {
                    // AbortError is expected when component unmounts during play
                    if (playErr.name === 'AbortError') {
                        console.log('Video play aborted (component unmounted)');
                        return;
                    }
                    throw playErr;
                }
            }
        } catch (err) {
            // Skip error handling if component unmounted
            if (!isMountedRef.current) return;

            console.error('Camera access error:', err);

            let errorMessage = 'Camera access denied.';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                errorMessage = 'Camera permission denied. Please allow camera access:\n\n1. Tap the lock/info icon in the address bar\n2. Find "Camera" and set to "Allow"\n3. Tap "Retry" below';
            } else if (err.name === 'NotFoundError') {
                errorMessage = 'No camera found on this device.';
            } else if (err.name === 'NotReadableError') {
                errorMessage = 'Camera is in use by another app. Please close other apps using the camera.';
            } else if (err.name === 'AbortError') {
                // Ignore abort errors - they happen during normal cleanup
                return;
            }

            setError(errorMessage);
            onError?.(err.message);
        }
    };

    // Stop camera and scanning
    const stopScanning = () => {
        setScanStatus('initializing');
        isProcessingRef.current = false;

        if (scanIntervalRef.current) {
            clearInterval(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
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

                scanIntervalRef.current = setInterval(async () => {
                    if (isProcessingRef.current) return;

                    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                        try {
                            isProcessingRef.current = true;
                            const barcodes = await barcodeDetector.detect(videoRef.current);
                            if (barcodes.length > 0) {
                                handleQRCodeDetected(barcodes[0].rawValue);
                            }
                            isProcessingRef.current = false;
                        } catch (err) {
                            isProcessingRef.current = false;
                        }
                    }
                }, 150);
            } catch (err) {
                startCanvasQRDetection();
            }
        } else {
            startCanvasQRDetection();
        }
    };

    // Canvas-based QR code detection fallback
    const startCanvasQRDetection = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let scanInterval = 250;
        let consecutiveFailures = 0;

        const scan = () => {
            if (isProcessingRef.current) return;

            if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                try {
                    isProcessingRef.current = true;

                    if (canvas.width !== videoRef.current.videoWidth) {
                        canvas.width = videoRef.current.videoWidth;
                        canvas.height = videoRef.current.videoHeight;
                    }

                    ctx.drawImage(videoRef.current, 0, 0);

                    const centerX = Math.floor(canvas.width * 0.2);
                    const centerY = Math.floor(canvas.height * 0.2);
                    const regionWidth = Math.floor(canvas.width * 0.6);
                    const regionHeight = Math.floor(canvas.height * 0.6);

                    const imageData = ctx.getImageData(centerX, centerY, regionWidth, regionHeight);

                    const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: 'dontInvert',
                    });

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
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-3 flex items-center justify-between shadow-lg">
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
