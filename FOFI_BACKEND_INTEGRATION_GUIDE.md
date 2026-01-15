# FoFi Smart Box Backend Integration Guide

## Overview

This document provides comprehensive details about the FoFi Smart Box backend integration implemented in the CRM PWA application.

## Table of Contents

1. [Architecture](#architecture)
2. [API Endpoints](#api-endpoints)
3. [Flow Diagrams](#flow-diagrams)
4. [Implementation Details](#implementation-details)
5. [Testing Guide](#testing-guide)
6. [Error Handling](#error-handling)
7. [Deployment Checklist](#deployment-checklist)

---

## Architecture

### Components

1. **Frontend Component**: `src/pages/services/FoFiSmartBox.jsx`
   - React component handling UI and user interactions
   - Manages state for device validation, plan selection, and payment

2. **API Service Layer**: `src/services/fofiApis.js`
   - Centralized API calls for all FoFi Smart Box operations
   - Handles authentication headers and error responses

3. **Backend APIs**: To be implemented on the server
   - Device validation and inventory management
   - Plan management and subscription
   - Payment processing and verification

---

## API Endpoints

### 1. Get FoFi Plans

**Endpoint**: `GET /ServiceApis/getFoFiPlans`

**Purpose**: Fetch all available FoFi Smart Box plans (FTA-only and FTA+DPO)

**Request**: No body required

**Response**:
```json
{
  "success": true,
  "message": "Plans fetched successfully",
  "data": {
    "plans": [
      {
        "id": "plan_fta_basic",
        "name": "FTA Basic Pack",
        "type": "FTA-only",
        "price": 99,
        "validity": "30 days",
        "features": [
          "Free-to-Air channels",
          "HD quality",
          "No subscription required"
        ]
      },
      {
        "id": "plan_fta_dpo_premium",
        "name": "FTA + DPO Premium",
        "type": "FTA + DPO",
        "price": 299,
        "validity": "90 days",
        "features": [
          "All FTA channels",
          "Premium DPO channels",
          "HD & 4K quality",
          "Multi-device support"
        ]
      }
    ]
  }
}
```

---

### 2. Validate Device by QR Code

**Endpoint**: `POST /ServiceApis/validateDeviceByQR`

**Purpose**: Validate FoFi Smart Box device by scanning QR code displayed on TV

**Request**:
```json
{
  "qrData": "FOFI_DEVICE_QR_CODE_DATA",
  "customerId": "CUST001"
}
```

**Response**:
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
    "isRegistered": false
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "message": "Device is already registered to another customer"
}
```

---

### 3. Fetch MAC Address by Serial Number

**Endpoint**: `POST /ServiceApis/fetchMACBySerial`

**Purpose**: Fetch device MAC address and details using inventory serial number

**Request**:
```json
{
  "serialNumber": "SN123456",
  "customerId": "CUST001"
}
```

**Response**:
```json
{
  "success": true,
  "message": "MAC address fetched successfully",
  "data": {
    "serialNumber": "SN123456",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "multicastDeviceId": "MC123456789",
    "unicastDeviceId": "UC987654321",
    "deviceModel": "FoFi Box Pro",
    "status": "available"
  }
}
```

**Status Values**:
- `available`: Device can be registered
- `registered`: Device already registered to another customer
- `inactive`: Device is inactive/decommissioned

---

### 4. Validate Device Availability

**Endpoint**: `POST /ServiceApis/validateDeviceAvailability`

**Purpose**: Check if device is available for registration before proceeding

**Request**:
```json
{
  "serialNumber": "SN123456",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "customerId": "CUST001"
}
```

**Response**:
```json
{
  "success": true,
  "available": true,
  "message": "Device is available for registration",
  "data": {
    "deviceStatus": "available",
    "lastUsedBy": null,
    "canProceed": true
  }
}
```

---

### 5. Register FoFi Device

**Endpoint**: `POST /ServiceApis/registerFoFiDevice`

**Purpose**: Register new FoFi device with selected plan for a customer

**Request**:
```json
{
  "customerId": "CUST001",
  "planId": "plan_fta_dpo_premium",
  "serialNumber": "SN123456",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "multicastDeviceId": "MC123456789",
  "unicastDeviceId": "UC987654321",
  "validationMethod": "manual"
}
```

**Validation Method**: `"qr"` or `"manual"`

**Response**:
```json
{
  "success": true,
  "message": "Device registered successfully",
  "data": {
    "registrationId": "REG123456",
    "customerId": "CUST001",
    "deviceId": "DEV123",
    "planId": "plan_fta_dpo_premium",
    "activationDate": "2025-01-09T10:30:00Z",
    "expiryDate": "2025-04-09T10:30:00Z"
  }
}
```

---

### 6. Get FoFi Device Details

**Endpoint**: `POST /ServiceApis/getFoFiDeviceDetails`

**Purpose**: Fetch device and plan details for existing FoFi customer

**Request**:
```json
{
  "customerId": "CUST001"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "customerId": "CUST001",
    "deviceInfo": {
      "multicastDeviceId": "MC123456789",
      "unicastDeviceId": "UC987654321",
      "serialNumber": "SN123456",
      "macAddress": "AA:BB:CC:DD:EE:FF",
      "deviceModel": "FoFi Box Pro"
    },
    "planDetails": {
      "planId": "plan_fta_dpo_premium",
      "planName": "FTA + DPO Premium",
      "planType": "FTA + DPO",
      "price": 299,
      "validity": "90 days",
      "activationDate": "2025-01-09",
      "expiryDate": "2025-04-09"
    },
    "subscriptionStatus": "active"
  }
}
```

**Subscription Status**: `"active"`, `"expired"`, `"suspended"`

---

### 7. Change FoFi Plan

**Endpoint**: `POST /ServiceApis/changeFoFiPlan`

**Purpose**: Renew or change plan for existing FoFi customer

**Request**:
```json
{
  "customerId": "CUST001",
  "currentPlanId": "plan_fta_basic",
  "newPlanId": "plan_fta_dpo_premium",
  "action": "change"
}
```

**Action Values**: `"renew"` or `"change"`

**Response**:
```json
{
  "success": true,
  "message": "Plan changed successfully",
  "data": {
    "transactionId": "TXN123456",
    "customerId": "CUST001",
    "oldPlanId": "plan_fta_basic",
    "newPlanId": "plan_fta_dpo_premium",
    "effectiveDate": "2025-01-09",
    "newExpiryDate": "2025-04-09",
    "amountCharged": 299
  }
}
```

---

### 8. Create FoFi Payment Order

**Endpoint**: `POST /ServiceApis/createFoFiPaymentOrder`

**Purpose**: Create payment order for FoFi plan purchase/renewal

**Request**:
```json
{
  "customerId": "CUST001",
  "planId": "plan_fta_dpo_premium",
  "amount": 299,
  "deviceId": "SN123456",
  "orderType": "new_registration"
}
```

**Order Types**: `"new_registration"`, `"renewal"`, `"plan_change"`

**Response**:
```json
{
  "success": true,
  "message": "Payment order created successfully",
  "data": {
    "orderId": "ORD123456",
    "customerId": "CUST001",
    "amount": 299,
    "currency": "INR",
    "paymentGatewayUrl": "https://payment.gateway.com/checkout",
    "paymentToken": "TOKEN123",
    "expiresAt": "2025-01-09T11:30:00Z"
  }
}
```

---

### 9. Verify FoFi Payment

**Endpoint**: `POST /ServiceApis/verifyFoFiPayment`

**Purpose**: Verify payment status after customer completes payment

**Request**:
```json
{
  "orderId": "ORD123456",
  "paymentId": "PAY123456",
  "customerId": "CUST001"
}
```

**Response**:
```json
{
  "success": true,
  "verified": true,
  "message": "Payment verified successfully",
  "data": {
    "orderId": "ORD123456",
    "paymentId": "PAY123456",
    "paymentStatus": "success",
    "amount": 299,
    "paidAt": "2025-01-09T10:45:00Z",
    "transactionId": "TXN123456"
  }
}
```

**Payment Status**: `"success"`, `"failed"`, `"pending"`

---

### 10. Process FoFi Bill Payment

**Endpoint**: `POST /ServiceApis/processFoFiBillPayment`

**Purpose**: Process bill payment for existing FoFi customers

**Request**:
```json
{
  "customerId": "CUST001",
  "amount": 299,
  "billId": "BILL123",
  "paymentMethod": "online"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Bill payment processed successfully",
  "data": {
    "paymentId": "PAY123456",
    "billId": "BILL123",
    "amount": 299,
    "paymentDate": "2025-01-09",
    "receiptUrl": "https://api.example.com/receipts/123456.pdf"
  }
}
```

---

### 11. Get FoFi Payment History

**Endpoint**: `GET /ServiceApis/getFoFiPaymentHistory?customerId=CUST001&limit=10&offset=0`

**Purpose**: Fetch payment history for a customer

**Query Parameters**:
- `customerId` (required): Customer ID
- `limit` (optional): Number of records (default: 10)
- `offset` (optional): Pagination offset (default: 0)

**Response**:
```json
{
  "success": true,
  "data": {
    "customerId": "CUST001",
    "totalRecords": 25,
    "payments": [
      {
        "paymentId": "PAY123",
        "orderId": "ORD123",
        "amount": 299,
        "paymentDate": "2025-01-09",
        "paymentType": "new_registration",
        "status": "success",
        "receiptUrl": "https://api.example.com/receipts/123.pdf"
      }
    ]
  }
}
```

---

## Flow Diagrams

### New User Registration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: User Accesses FoFi Smart Box                            │
│ - Component loads and fetches available plans via getFoFiPlans  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Plan Selection                                           │
│ - User views FTA-only and FTA+DPO plans                         │
│ - User selects a plan                                            │
│ - System navigates to device validation view                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Device Validation (Two Options)                         │
│                                                                   │
│ Option A: QR Code Scan                                          │
│ - Operator scans QR from TV screen                              │
│ - Call validateDeviceByQR API                                   │
│ - System validates device availability                           │
│                                                                   │
│ Option B: Manual Entry                                          │
│ - Operator enters inventory serial number                        │
│ - Call fetchMACBySerial API                                     │
│ - System validates device status                                 │
│ - System checks: available/registered/inactive                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Payment Processing                                       │
│ - Create payment order via createFoFiPaymentOrder               │
│ - Register device via registerFoFiDevice                        │
│ - Redirect to payment gateway (or simulate in demo)             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Payment Verification                                     │
│ - Verify payment via verifyFoFiPayment                          │
│ - Activate device and plan subscription                          │
│ - Show success message                                           │
│ - Navigate to customer overview                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Existing User Renewal/Change Plan Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Load Customer Details                                   │
│ - Component fetches device details via getFoFiDeviceDetails    │
│ - Display Multicast and Unicast Device IDs                      │
│ - Display current plan and expiry date                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: User Clicks "RENEW / CHANGE PLAN"                      │
│ - Navigate to plan selection view                               │
│ - Fetch available plans via getFoFiPlans                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Plan Selection                                          │
│ - User selects new plan                                         │
│ - Skip device validation (already registered)                   │
│ - Navigate directly to payment                                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Payment Processing                                       │
│ - Call changeFoFiPlan API with new plan details                │
│ - Create payment order via createFoFiPaymentOrder               │
│ - Process payment                                                │
│ - Verify payment via verifyFoFiPayment                          │
│ - Update subscription with new plan                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### Frontend Component Structure

**File**: `src/pages/services/FoFiSmartBox.jsx`

**Key State Variables**:
```javascript
const [view, setView] = useState('overview'); // Current view
const [selectedPlan, setSelectedPlan] = useState(null); // Selected plan object
const [deviceValidated, setDeviceValidated] = useState(false); // Validation status
const [validationMethod, setValidationMethod] = useState(null); // 'qr' or 'manual'
const [serialNumber, setSerialNumber] = useState(''); // Device serial number
const [macAddress, setMacAddress] = useState(''); // Device MAC address
const [validationError, setValidationError] = useState(''); // Error messages
const [deviceInfo, setDeviceInfo] = useState(null); // Complete device information
const [fofiPlans, setFofiPlans] = useState(mockFofiPlans); // Available plans
const [isLoading, setIsLoading] = useState(false); // Loading state
const [paymentOrderId, setPaymentOrderId] = useState(null); // Payment order ID
```

**Views**:
1. `overview` - Customer overview with device info (existing users)
2. `plans` - Plan selection view
3. `device-validation` - Device validation via QR or manual entry (new users)
4. `payment` - Payment processing view

### API Service Layer

**File**: `src/services/fofiApis.js`

**Headers Configuration**:
```javascript
function getHeadersJson() {
    return {
        Authorization: import.meta.env.VITE_API_AUTH_KEY,
        username: import.meta.env.VITE_API_USERNAME,
        password: import.meta.env.VITE_API_PASSWORD,
        appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
        appversion: import.meta.env.VITE_API_APP_VERSION,
        "Content-Type": "application/json",
    };
}
```

**Error Handling**:
- All API functions throw errors with descriptive messages
- Frontend catches errors and falls back to mock data in development
- User-friendly error messages displayed in UI

---

## Testing Guide

### Manual Testing Steps

#### Test 1: New User Registration with QR Code

1. Navigate to FoFi Smart Box service for a new customer
2. Verify plans are loaded and displayed
3. Select any plan
4. Click "Scan QR Code" button
5. Verify loading state is shown
6. Verify device is validated and payment view is shown
7. Click "Proceed to Payment"
8. Verify success message after 2 seconds (demo mode)

#### Test 2: New User Registration with Manual Entry

1. Navigate to FoFi Smart Box service for a new customer
2. Select any plan
3. Enter serial number: `SN123456` (valid in mock DB)
4. Click "Fetch MAC Address"
5. Verify MAC address is fetched and displayed
6. Verify navigation to payment view
7. Complete payment process

#### Test 3: Invalid Serial Number

1. Follow steps 1-2 from Test 2
2. Enter serial number: `SN999999` (invalid)
3. Click "Fetch MAC Address"
4. Verify error message: "Invalid serial number"

#### Test 4: Already Registered Device

1. Follow steps 1-2 from Test 2
2. Enter serial number: `SN654321` (registered in mock DB)
3. Click "Fetch MAC Address"
4. Verify error message: "Device is already in use"

#### Test 5: Existing User Renewal

1. Navigate to FoFi Smart Box for existing customer
2. Verify device information is displayed (Multicast/Unicast IDs)
3. Verify current plan details are shown
4. Click "RENEW / CHANGE PLAN"
5. Select a new plan
6. Verify direct navigation to payment (skip device validation)
7. Complete payment

### API Testing with cURL

#### Test getFoFiPlans:
```bash
curl -X GET "https://your-api-url/ServiceApis/getFoFiPlans" \
  -H "Authorization: YOUR_AUTH_KEY" \
  -H "username: YOUR_USERNAME" \
  -H "password: YOUR_PASSWORD" \
  -H "appkeytype: YOUR_APP_TYPE" \
  -H "appversion: YOUR_APP_VERSION"
```

#### Test fetchMACBySerial:
```bash
curl -X POST "https://your-api-url/ServiceApis/fetchMACBySerial" \
  -H "Authorization: YOUR_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "serialNumber": "SN123456",
    "customerId": "CUST001"
  }'
```

---

## Error Handling

### Frontend Error Handling Strategy

1. **Try-Catch Blocks**: All API calls wrapped in try-catch
2. **User Feedback**: Clear error messages displayed to users
3. **Fallback to Mock Data**: In development, falls back to mock data on API failure
4. **Loading States**: Shows spinners during API calls
5. **Disabled Buttons**: Prevents multiple submissions

### Common Error Scenarios

| Error | Cause | User Message | Action |
|-------|-------|--------------|--------|
| Device not found | Invalid serial number | "Device not found in inventory" | Ask user to verify serial number |
| Device registered | Device already in use | "This device is already registered" | Contact support to unregister |
| Device inactive | Device decommissioned | "This device is inactive" | Contact support |
| Payment failed | Payment gateway error | "Failed to process payment" | Retry payment |
| API timeout | Network/server issue | "Connection error. Please try again" | Retry operation |

---

## Deployment Checklist

### Backend Development

- [ ] Implement all 11 API endpoints as documented
- [ ] Set up device inventory database
- [ ] Implement device validation logic
- [ ] Integrate payment gateway
- [ ] Set up authentication and authorization
- [ ] Implement rate limiting
- [ ] Add API logging and monitoring
- [ ] Create database backup strategy

### Frontend Configuration

- [ ] Update environment variables:
  - `VITE_API_BASE_URL` - Production API URL
  - `VITE_API_AUTH_KEY` - API authentication key
  - `VITE_API_USERNAME` - API username
  - `VITE_API_PASSWORD` - API password
  - `VITE_API_APP_USER_TYPE` - App user type
  - `VITE_API_APP_VERSION` - App version

### Testing

- [ ] Unit tests for API service functions
- [ ] Integration tests for complete flows
- [ ] End-to-end testing with real devices
- [ ] Payment gateway testing (sandbox)
- [ ] Load testing for concurrent users
- [ ] Security testing (penetration testing)

### Monitoring

- [ ] Set up API monitoring (uptime, response times)
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Create dashboards for key metrics
- [ ] Set up alerts for critical failures
- [ ] Monitor payment success/failure rates

### Documentation

- [ ] Update API documentation with actual endpoints
- [ ] Create backend developer guide
- [ ] Document database schema
- [ ] Create deployment runbook
- [ ] Document troubleshooting procedures

---

## Support and Maintenance

### Troubleshooting Common Issues

**Issue**: Plans not loading
- Check API endpoint availability
- Verify authentication headers
- Check browser console for errors
- Verify CORS configuration

**Issue**: Device validation failing
- Check device inventory database
- Verify serial number format
- Check device status in database
- Review API logs for errors

**Issue**: Payment not processing
- Check payment gateway status
- Verify payment credentials
- Check order creation logs
- Review payment gateway webhooks

### Contact Information

For technical support or questions about this integration:
- Backend API: Contact backend team
- Frontend Issues: Contact frontend team
- Payment Gateway: Contact payment provider support

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-09 | Initial implementation with all APIs |

---

## License

This documentation is part of the BBNL CRM PWA project.
