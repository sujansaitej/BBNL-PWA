import { useState, useRef, useEffect } from 'react';
import jsQR from 'jsqr';

/**
 * QR Scanner Component using the device camera
 * Uses the native browser QR scanner API when available, falls back to jsQR library
 * v2.0 - Fixed canvas performance and CDN blocking issues
 */
export default function QRScanner({ onScan, onClose, onError }) {
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState('');
    const [hasCamera, setHasCamera] = useState(true);
    const [scanStatus, setScanStatus] = useState('ready'); // ready, scanning, processing
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const scanIntervalRef = useRef(null);
    const isProcessingRef = useRef(false); // Prevent multiple simultaneous scans

    // Check if browser supports camera API
    useEffect(() => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setHasCamera(false);
            setError('Camera not supported on this device');
            onError?.('Camera not supported');
        }
    }, [onError]);

    // Start camera and scanning
    const startScanning = async () => {
        try {
            setScanning(true);
            setScanStatus('scanning');
            setError('');

            // Request camera access with optimal settings for QR scanning
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Use rear camera
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 30, max: 30 } // Limit frame rate for better performance
                }
            });

            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();

                // Wait for video to be ready
                videoRef.current.onloadedmetadata = () => {
                    console.log('✅ Camera ready, starting QR detection');
                    // Start scanning for QR codes
                    startQRDetection();
                };
            }
        } catch (err) {
            console.error('Camera access error:', err);
            setError('Failed to access camera. Please allow camera permissions.');
            setScanning(false);
            setScanStatus('ready');
            onError?.(err.message);
        }
    };

    // Stop camera and scanning
    const stopScanning = () => {
        setScanning(false);
        setScanStatus('ready');
        isProcessingRef.current = false;

        // Stop scan interval
        if (scanIntervalRef.current) {
            clearInterval(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }

        // Stop video stream
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // Clear video element
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    };

    // QR code detection using BarcodeDetector API or canvas-based detection
    const startQRDetection = async () => {
        // Check if BarcodeDetector is supported (Chrome, Edge, etc.)
        if ('BarcodeDetector' in window) {
            try {
                const formats = await window.BarcodeDetector.getSupportedFormats();
                console.log('✅ BarcodeDetector supported. Formats:', formats);
                
                const barcodeDetector = new window.BarcodeDetector({
                    formats: ['qr_code']
                });

                scanIntervalRef.current = setInterval(async () => {
                    if (isProcessingRef.current) return; // Skip if already processing
                    
                    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                        try {
                            isProcessingRef.current = true;
                            const barcodes = await barcodeDetector.detect(videoRef.current);
                            if (barcodes.length > 0) {
                                const qrCode = barcodes[0].rawValue;
                                console.log('✅ QR Code detected via BarcodeDetector:', qrCode);
                                handleQRCodeDetected(qrCode);
                            }
                            isProcessingRef.current = false;
                        } catch (err) {
                            isProcessingRef.current = false;
                            console.error('QR detection error:', err);
                        }
                    }
                }, 150); // Scan every 150ms for good balance
            } catch (err) {
                console.error('BarcodeDetector initialization error:', err);
                console.warn('⚠️ Falling back to canvas-based detection');
                startCanvasQRDetection();
            }
        } else {
            console.warn('⚠️ BarcodeDetector not supported, using canvas fallback');
            startCanvasQRDetection();
        }
    };

    // Canvas-based QR code detection (fallback for browsers without BarcodeDetector)
    const startCanvasQRDetection = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        console.log('🔄 Starting canvas-based QR detection');
        
        // Get canvas context with performance optimization
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // Adaptive scanning: start fast, then slow down to save CPU
        let scanInterval = 250; // Start with 250ms
        let consecutiveFailures = 0;
        
        const scan = () => {
            if (isProcessingRef.current) return; // Skip if already processing
            
            if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                try {
                    isProcessingRef.current = true;
                    
                    // Set canvas size to video size (only if changed)
                    if (canvas.width !== videoRef.current.videoWidth) {
                        canvas.width = videoRef.current.videoWidth;
                        canvas.height = videoRef.current.videoHeight;
                        console.log(`📐 Canvas size: ${canvas.width}x${canvas.height}`);
                    }
                    
                    // Draw video frame to canvas
                    ctx.drawImage(videoRef.current, 0, 0);
                    
                    // Get image data from center region only (optimization)
                    const centerX = Math.floor(canvas.width * 0.2);
                    const centerY = Math.floor(canvas.height * 0.2);
                    const regionWidth = Math.floor(canvas.width * 0.6);
                    const regionHeight = Math.floor(canvas.height * 0.6);
                    
                    const imageData = ctx.getImageData(centerX, centerY, regionWidth, regionHeight);
                    
                    // Decode QR code using jsQR
                    const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: 'dontInvert', // Faster
                    });
                    
                    if (qrCode && qrCode.data) {
                        console.log('✅ QR Code detected via jsQR:', qrCode.data);
                        handleQRCodeDetected(qrCode.data);
                    } else {
                        consecutiveFailures++;
                        
                        // Slow down scanning if no QR code found (save CPU/battery)
                        if (consecutiveFailures > 10 && scanInterval < 400) {
                            scanInterval = 400;
                            clearInterval(scanIntervalRef.current);
                            scanIntervalRef.current = setInterval(scan, scanInterval);
                            console.log('⏱️ Reduced scan frequency to save CPU');
                        }
                    }
                    
                    isProcessingRef.current = false;
                } catch (err) {
                    isProcessingRef.current = false;
                    console.error('Canvas scan error:', err);
                }
            }
        };
        
        scanIntervalRef.current = setInterval(scan, scanInterval);
    };

    // Handle QR code detection
    const handleQRCodeDetected = (qrData) => {
        console.log('🎯 QR Code detected:', qrData);
        
        setScanStatus('processing');

        // Stop scanning immediately to prevent multiple detections
        stopScanning();

        // Callback with QR data
        if (onScan) {
            onScan(qrData);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopScanning();
        };
    }, []);

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Header */}
            <div className="bg-teal-500 text-white px-4 py-3 flex items-center justify-between">
                <h2 className="text-lg font-medium">Scan QR Code</h2>
                <button
                    onClick={() => {
                        stopScanning();
                        onClose();
                    }}
                    className="p-2 hover:bg-teal-600 rounded-full transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Camera View */}
            <div className="flex-1 relative flex items-center justify-center bg-black">
                {hasCamera && !scanning && !error && (
                    <div className="text-center text-white p-4">
                        <p className="mb-4">Point your camera at the QR code displayed on your TV screen</p>
                        <button
                            onClick={startScanning}
                            className="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                        >
                            Start Scanning
                        </button>
                    </div>
                )}

                {error && (
                    <div className="text-center text-white p-4 max-w-md">
                        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 mb-4">
                            <p className="text-sm">{error}</p>
                        </div>
                        <button
                            onClick={() => {
                                stopScanning();
                                onClose();
                            }}
                            className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                )}

                {scanning && (
                    <>
                        {/* Video element for camera feed */}
                        <video
                            ref={videoRef}
                            className="w-full h-full object-cover"
                            playsInline
                            muted
                        />

                        {/* QR code frame overlay */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="relative w-64 h-64">
                                {/* Corner brackets */}
                                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-teal-500"></div>
                                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-teal-500"></div>
                                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-teal-500"></div>
                                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-teal-500"></div>

                                {/* Center line animation */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-full h-0.5 bg-teal-500 animate-pulse"></div>
                                </div>
                            </div>
                        </div>

                        {/* Instructions */}
                        <div className="absolute bottom-20 left-0 right-0 text-center text-white">
                            <div className="bg-black/60 inline-block px-6 py-3 rounded-full">
                                {scanStatus === 'scanning' && (
                                    <p className="text-sm flex items-center gap-2">
                                        <span className="inline-block w-2 h-2 bg-teal-500 rounded-full animate-pulse"></span>
                                        Align QR code within the frame
                                    </p>
                                )}
                                {scanStatus === 'processing' && (
                                    <p className="text-sm text-teal-400">
                                        ✓ QR Code detected!
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Cancel button */}
                        <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                            <button
                                onClick={() => {
                                    stopScanning();
                                    onClose();
                                }}
                                className="bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-6 rounded-full transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </>
                )}

                {/* Hidden canvas for image processing */}
                <canvas ref={canvasRef} className="hidden" />
            </div>
        </div>
    );
}
