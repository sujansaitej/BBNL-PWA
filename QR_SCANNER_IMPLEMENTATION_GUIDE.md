# QR Scanner Implementation Guide

## Overview

This document provides comprehensive details about the QR Scanner implementation for the FoFi Smart Box device validation in the CRM PWA application.

## Table of Contents

1. [Features](#features)
2. [Browser Compatibility](#browser-compatibility)
3. [How It Works](#how-it-works)
4. [Component Structure](#component-structure)
5. [Integration](#integration)
6. [Testing Guide](#testing-guide)
7. [Troubleshooting](#troubleshooting)
8. [Security Considerations](#security-considerations)

---

## Features

### ✅ Implemented Features

1. **Native Camera Access**
   - Uses device's rear camera (environment-facing)
   - Requests camera permissions from user
   - Supports HD video (1280x720)

2. **Modern QR Detection**
   - Uses BarcodeDetector API (Chrome, Edge, Samsung Internet)
   - Real-time QR code scanning (100ms intervals)
   - Automatic detection without manual capture

3. **User-Friendly Interface**
   - Visual frame overlay for alignment
   - Animated scanning indicator
   - Clear instructions
   - Cancel button
   - Error handling with user feedback

4. **Backend Integration**
   - Validates scanned QR with backend API
   - Fetches device details (MAC address, device IDs)
   - Fallback to mock data for development

5. **Responsive Design**
   - Full-screen scanner interface
   - Works on mobile and desktop
   - Touch-friendly controls

---

## Browser Compatibility

### ✅ Fully Supported

| Browser | Version | Features |
|---------|---------|----------|
| **Chrome** | 83+ | Full support with BarcodeDetector API |
| **Edge** | 83+ | Full support with BarcodeDetector API |
| **Samsung Internet** | 14+ | Full support with BarcodeDetector API |

### ⚠️ Limited Support

| Browser | Version | Notes |
|---------|---------|-------|
| **Safari (iOS)** | 14+ | Camera works, but needs polyfill for BarcodeDetector |
| **Firefox** | All | Camera works, but needs polyfill for BarcodeDetector |

### ❌ Not Supported

- Internet Explorer (all versions)
- Older mobile browsers without camera API

### Checking Browser Support

```javascript
// Check if BarcodeDetector is supported
if ('BarcodeDetector' in window) {
    console.log('BarcodeDetector supported');
} else {
    console.log('BarcodeDetector NOT supported - needs polyfill');
}

// Check if camera is supported
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    console.log('Camera API supported');
} else {
    console.log('Camera API NOT supported');
}
```

---

## How It Works

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: User Clicks "Scan QR Code" Button                       │
│ - Opens QR Scanner component                                    │
│ - Shows camera permission prompt                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Camera Access Granted                                   │
│ - Activates rear camera (environment-facing)                    │
│ - Starts video stream at 1280x720 resolution                   │
│ - Displays live camera feed                                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: QR Code Detection (Loop)                                │
│ - BarcodeDetector scans video frame every 100ms                │
│ - Looks for QR code patterns                                    │
│ - Shows visual frame and scanning indicator                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: QR Code Detected                                        │
│ - Extracts QR data string                                       │
│ - Stops camera stream                                            │
│ - Closes scanner interface                                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Backend Validation                                      │
│ - Sends QR data to validateDeviceByQR API                      │
│ - API validates against device inventory                        │
│ - Returns device details (MAC, Multicast ID, Unicast ID)       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Success                                                  │
│ - Displays device information                                    │
│ - Proceeds to payment view                                       │
│ - Device is ready for registration                              │
└─────────────────────────────────────────────────────────────────┘
```

### Technical Implementation

#### 1. Camera Initialization

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
    video: {
        facingMode: 'environment', // Use rear camera
        width: { ideal: 1280 },
        height: { ideal: 720 }
    }
});
```

#### 2. QR Code Detection

```javascript
const barcodeDetector = new BarcodeDetector({
    formats: ['qr_code']
});

// Scan every 100ms
setInterval(async () => {
    const barcodes = await barcodeDetector.detect(videoElement);
    if (barcodes.length > 0) {
        const qrData = barcodes[0].rawValue;
        handleQRCodeDetected(qrData);
    }
}, 100);
```

#### 3. Backend Validation

```javascript
const response = await validateDeviceByQR({
    qrData: qrData,
    customerId: customerData.customer_id
});

if (response.success && response.data) {
    // Device validated successfully
    setDeviceInfo(response.data);
    // Proceed to payment
}
```

---

## Component Structure

### QRScanner Component (`src/components/QRScanner.jsx`)

```
QRScanner/
├── Props
│   ├── onScan(qrData)         - Callback when QR is scanned
│   ├── onClose()               - Callback when scanner is closed
│   └── onError(error)          - Callback when error occurs
│
├── State
│   ├── scanning               - Boolean: camera active
│   ├── error                  - String: error message
│   └── hasCamera             - Boolean: camera supported
│
├── Refs
│   ├── videoRef              - Video element for camera
│   ├── canvasRef             - Canvas for processing (hidden)
│   ├── streamRef             - MediaStream object
│   └── scanIntervalRef       - Interval ID for scanning
│
└── Methods
    ├── startScanning()        - Activate camera and start scanning
    ├── stopScanning()         - Stop camera and clean up
    ├── startQRDetection()     - Initialize BarcodeDetector
    └── handleQRCodeDetected() - Process detected QR code
```

### Integration in FoFiSmartBox.jsx

```javascript
// State
const [showQRScanner, setShowQRScanner] = useState(false);

// Handlers
const handleQRScan = () => {
    setShowQRScanner(true);
};

const handleQRCodeScanned = async (qrData) => {
    setShowQRScanner(false);
    // Validate with backend
    const response = await validateDeviceByQR({
        qrData: qrData,
        customerId: customerData.customer_id
    });
    // Process response
};

const handleQRScannerClose = () => {
    setShowQRScanner(false);
};

const handleQRScanError = (error) => {
    console.error('QR scanner error:', error);
};

// JSX
{showQRScanner && (
    <QRScanner
        onScan={handleQRCodeScanned}
        onClose={handleQRScannerClose}
        onError={handleQRScanError}
    />
)}
```

---

## Testing Guide

### Manual Testing on Mobile Device

#### Prerequisites
- Modern smartphone (Android 8+ or iOS 14+)
- Chrome, Edge, or Samsung Internet browser
- Test QR codes (see below)

#### Test Steps

1. **Basic QR Scan Test**
   ```
   Step 1: Navigate to FoFi Smart Box service
   Step 2: Select a plan
   Step 3: Click "Scan QR Code" button
   Step 4: Allow camera permissions when prompted
   Step 5: Point camera at test QR code
   Step 6: Verify QR code is detected automatically
   Step 7: Verify device details are displayed
   Step 8: Verify navigation to payment view
   ```

2. **Camera Permission Test**
   ```
   Step 1: Deny camera permission
   Step 2: Verify error message is displayed
   Step 3: Verify "Close" button works
   Step 4: Re-test with permission granted
   ```

3. **Cancel Test**
   ```
   Step 1: Start QR scan
   Step 2: Click "Cancel" button during scan
   Step 3: Verify camera stops
   Step 4: Verify return to device validation view
   ```

4. **Invalid QR Code Test**
   ```
   Step 1: Scan non-device QR code
   Step 2: Verify backend validation fails
   Step 3: Verify error message is shown
   Step 4: Verify user can try again
   ```

5. **Network Error Test**
   ```
   Step 1: Turn off internet connection
   Step 2: Scan valid QR code
   Step 3: Verify fallback to mock data
   Step 4: Verify functionality continues
   ```

### Test QR Codes

#### Valid Test QR Code
Generate a QR code with this data:
```
FOFI_DEVICE_SN123456_MAC_AABBCCDDEEFF
```

#### Expected Backend Response
```json
{
  "success": true,
  "data": {
    "serialNumber": "SN123456",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "multicastDeviceId": "MC123456789",
    "unicastDeviceId": "UC987654321",
    "deviceModel": "FoFi Box Pro",
    "isRegistered": false
  }
}
```

### Testing on Desktop

1. **Chrome DevTools Device Simulation**
   ```
   Step 1: Open Chrome DevTools (F12)
   Step 2: Click "Toggle device toolbar" (Ctrl+Shift+M)
   Step 3: Select mobile device
   Step 4: Allow virtual camera access
   Step 5: Use webcam to test QR scanning
   ```

2. **Generate Test QR Codes**
   - Use online QR generator: https://www.qr-code-generator.com/
   - Use command line: `qrencode -o test.png "FOFI_DEVICE_DATA"`

### Browser Compatibility Testing

| Browser | Version | Test Result | Notes |
|---------|---------|-------------|-------|
| Chrome Mobile | 120+ | ✅ Pass | Full support |
| Samsung Internet | 23+ | ✅ Pass | Full support |
| Safari iOS | 16+ | ⚠️ Limited | Needs polyfill |
| Firefox Mobile | 120+ | ⚠️ Limited | Needs polyfill |

---

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Camera Permission Denied

**Symptom**: Error message "Failed to access camera"

**Causes**:
- User denied camera permission
- Browser doesn't have camera permission
- Device doesn't have camera

**Solution**:
1. Check browser site settings
2. Clear site data and retry
3. Ensure HTTPS connection (camera requires secure context)
4. Try different browser

**Code Fix**:
```javascript
// Better error messages
try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
} catch (err) {
    if (err.name === 'NotAllowedError') {
        setError('Camera permission denied. Please allow camera access.');
    } else if (err.name === 'NotFoundError') {
        setError('No camera found on this device.');
    } else {
        setError('Camera error: ' + err.message);
    }
}
```

#### Issue 2: QR Code Not Detected

**Symptom**: Camera works but QR code not recognized

**Causes**:
- QR code too small or too far
- Poor lighting conditions
- QR code damaged or low quality
- BarcodeDetector not supported

**Solution**:
1. Move camera closer to QR code
2. Ensure good lighting
3. Clean camera lens
4. Try different QR code

**Code Fix**:
```javascript
// Add timeout fallback
setTimeout(() => {
    if (!qrDetected) {
        setError('QR code not detected. Please ensure good lighting and hold camera steady.');
    }
}, 10000); // 10 second timeout
```

#### Issue 3: Browser Not Supported

**Symptom**: "QR scanner not supported" error

**Causes**:
- BarcodeDetector API not available
- Old browser version
- Unsupported browser

**Solution**:
1. Update browser to latest version
2. Use Chrome or Edge browser
3. Implement jsQR polyfill (see below)

**Polyfill Implementation**:
```javascript
// Install jsQR: npm install jsqr

import jsQR from 'jsqr';

// Fallback to canvas-based detection
const detectQRFromCanvas = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code) {
        handleQRCodeDetected(code.data);
    }
};
```

#### Issue 4: Camera Freezes or Stops

**Symptom**: Video feed stops responding

**Causes**:
- Memory leak
- Browser tab backgrounded
- Device resource constraints

**Solution**:
1. Restart scanner
2. Close other browser tabs
3. Restart browser
4. Clear browser cache

**Code Fix**:
```javascript
// Proper cleanup
useEffect(() => {
    return () => {
        // Clean up on unmount
        stopScanning();
    };
}, []);

// Handle visibility change
useEffect(() => {
    const handleVisibilityChange = () => {
        if (document.hidden && scanning) {
            stopScanning();
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
}, [scanning]);
```

#### Issue 5: HTTPS Required Error

**Symptom**: "getUserMedia requires secure context"

**Causes**:
- Site not using HTTPS
- Camera API requires secure context

**Solution**:
1. Deploy site with HTTPS
2. For development: use localhost (automatically secure)
3. Use ngrok for HTTPS tunnel: `ngrok http 3000`

---

## Security Considerations

### 1. Camera Permission

**Risk**: Unauthorized camera access

**Mitigation**:
- Request permission only when needed
- Stop camera immediately after scan
- Clear explanation to users

```javascript
// Good practice: Request and explain
const requestCameraPermission = async () => {
    alert('Camera access is needed to scan the QR code on your TV');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    return stream;
};
```

### 2. QR Data Validation

**Risk**: Malicious QR codes

**Mitigation**:
- Validate QR data format before processing
- Sanitize input before sending to backend
- Backend must verify device ownership

```javascript
// Validate QR format
const isValidFoFiQR = (qrData) => {
    const pattern = /^FOFI_DEVICE_[A-Z0-9]+/;
    return pattern.test(qrData);
};

if (!isValidFoFiQR(qrData)) {
    throw new Error('Invalid FoFi device QR code');
}
```

### 3. Backend API Security

**Risk**: Unauthorized device registration

**Mitigation**:
- Authenticate API requests
- Verify customer-device association
- Log all scan attempts

```javascript
// Include authentication
const response = await validateDeviceByQR({
    qrData: qrData,
    customerId: customerData.customer_id,
    timestamp: Date.now(),
    signature: generateSignature(qrData, customerData.customer_id)
});
```

### 4. Data Privacy

**Risk**: Video stream data exposure

**Mitigation**:
- Process video locally (no upload)
- Clear video stream after scan
- Don't store camera frames

```javascript
// Ensure no data persistence
const stopScanning = () => {
    // Stop all tracks
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
            track.stop();
            track.enabled = false;
        });
    }

    // Clear video element
    if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.load(); // Reset video element
    }
};
```

---

## Future Enhancements

### 1. Multi-QR Support
- Scan multiple devices in sequence
- Batch device registration

### 2. QR Code Generation
- Generate QR codes for device pairing
- Print QR labels for inventory

### 3. Enhanced Detection
- Better low-light performance
- Support for damaged QR codes
- Faster detection algorithm

### 4. Offline Support
- Cache device database locally
- Validate QR codes offline
- Sync when online

### 5. Analytics
- Track scan success rate
- Measure scan time
- Identify problematic devices

---

## API Integration

### Backend Endpoint: validateDeviceByQR

**Request**:
```http
POST /ServiceApis/validateDeviceByQR
Content-Type: application/json
Authorization: Bearer <token>

{
  "qrData": "FOFI_DEVICE_SN123456",
  "customerId": "CUST001",
  "timestamp": 1704812345678,
  "scanLocation": {
    "latitude": 12.9716,
    "longitude": 77.5946
  }
}
```

**Success Response**:
```json
{
  "success": true,
  "message": "Device validated successfully",
  "data": {
    "serialNumber": "SN123456",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "multicastDeviceId": "MC123456789",
    "unicastDeviceId": "UC987654321",
    "deviceModel": "FoFi Box Pro",
    "firmwareVersion": "2.1.0",
    "manufacturingDate": "2024-01-01",
    "status": "available",
    "lastScanDate": null,
    "warranty": {
      "active": true,
      "expiryDate": "2026-01-01"
    }
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "DEVICE_ALREADY_REGISTERED",
  "message": "This device is already registered to another customer",
  "data": {
    "serialNumber": "SN123456",
    "registeredTo": "CUST002",
    "registrationDate": "2024-12-01"
  }
}
```

---

## Support

For technical support or questions:
- Frontend Issues: Contact frontend team
- Backend API: Contact backend team
- Device Issues: Contact hardware team

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-09 | Initial QR scanner implementation |

---

## License

This documentation is part of the BBNL CRM PWA project.
