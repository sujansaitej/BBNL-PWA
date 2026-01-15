# API Integration Strategy - CRM PWA

## Overview

The CRM PWA uses a **hybrid approach** for data management:
- **Existing features** continue to use real API calls
- **New service features** use mock data until backend APIs are ready

---

## API Endpoints Status Summary

### ✅ Connected & Working (15 endpoints)
1. **Authentication APIs** (3)
2. **Customer Management APIs** (2)
3. **Wallet APIs** (1)
4. **Ticket Management APIs** (5)
5. **Registration APIs** (4)

### 🔶 Pending Backend Integration (25+ endpoints)
1. **Service Management APIs** (4)
2. **Internet Service APIs** (4)
3. **Voice Service APIs** (3)
4. **FoFi Smart Box APIs** (9)
5. **IPTV Service APIs** (9)
6. **Payment Integration APIs** (3)

---

## Detailed API Endpoints Documentation

### ✅ **CONNECTED APIs** (Currently Working)

#### 1. Authentication APIs

##### 1.1 Customer Login
- **Endpoint**: `POST /ServiceApis/custlogin`
- **Method**: POST (FormData)
- **File**: `src/services/generalApis.js` - `UserLogin()`
- **Used In**: `src/pages/Login.jsx`
- **Parameters**:
  - `username`: string
  - `password`: string
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": {
      "username": "string",
      "firstname": "string",
      "lastname": "string",
      "emailid": "string",
      "mobileno": "string",
      "op_id": "string",
      "photo": "string",
      "otprefid": "string",
      "otpstatus": "yes|no"
    }
  }
  ```

##### 1.2 OTP Verification
- **Endpoint**: `POST /ServiceApis/custLoginVerification`
- **Method**: POST (FormData)
- **File**: `src/services/generalApis.js` - `OTPauth()`
- **Used In**: `src/pages/VerifyOTP.jsx`
- **Parameters**:
  - `username`: string
  - `otprefid`: string
  - `otpcode`: string
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": { "verified": true }
  }
  ```

##### 1.3 Resend OTP
- **Endpoint**: `POST /ServiceApis/custLoginResendOtp?username={username}`
- **Method**: POST
- **File**: `src/services/generalApis.js` - `resendOTP()`
- **Used In**: `src/pages/VerifyOTP.jsx`
- **Parameters**: Query param - `username`
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": { "otprefid": "string" }
  }
  ```

---

#### 2. Customer Management APIs

##### 2.1 Get Customer List
- **Endpoint**: `POST /ServiceApis/customersList?status={status}`
- **Method**: POST (JSON)
- **File**: `src/services/generalApis.js` - `getCustList()`
- **Used In**: `src/pages/Customerlist.jsx`
- **Parameters**:
  - Body: `{ loginuname: "string" }` (or similar payload)
  - Query: `status` (optional filter)
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": [
      {
        "customer_id": "string",
        "name": "string",
        "mobile": "string",
        "email": "string",
        "address": "string"
      }
    ]
  }
  ```

##### 2.2 Get Wallet Balance
- **Endpoint**: `POST /ServiceApis/mywallet`
- **Method**: POST (JSON)
- **File**: `src/services/generalApis.js` - `getWalBal()`
- **Used In**: `src/pages/Dashboard.jsx`, `src/components/Dashboard.jsx`
- **Parameters**:
  - `loginuname`: string
  - `servicekey`: "internet" | "fofi" | "iptv"
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": {
      "wallet_balance": number
    }
  }
  ```

---

#### 3. Ticket Management APIs

##### 3.1 Get Departments
- **Endpoint**: `GET /apis/getDepartments`
- **Method**: GET
- **File**: `src/services/generalApis.js` - `getTktDepartments()`
- **Used In**: `src/pages/Tickets.jsx`
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": [
      { "id": "string", "name": "string" }
    ]
  }
  ```

##### 3.2 Get Tickets
- **Endpoint**: `GET /apis/{endpoint}?{params}`
- **Method**: GET
- **File**: `src/services/generalApis.js` - `getTickets()`
- **Used In**: `src/pages/Tickets.jsx`
- **Dynamic Endpoints Based on Tab**:
  - **OPEN**: `/apis/getavailableticket?apiopid={op_id}&newcon={dept}`
  - **PENDING**: `/apis/pendingtickets?apiopid={op_id}&loginid={user}&newcon={dept}`
  - **NEW CONNECTIONS**: `/apis/getNewConnectionTicket?apiopid=raghav`
  - **DISCONNECTIONS**: `/apis/disconnection?apiopid={op_id}`
  - **JOB DONE**: `/apis/jobDoneList?apiopid={op_id}&userid={user}`
- **Response**: Array of ticket objects

##### 3.3 Pick Ticket
- **Endpoint**: `POST /apis/pickTicket?{params}`
- **Method**: POST
- **File**: `src/services/generalApis.js` - `pickTicket()`
- **Used In**: `src/pages/Tickets.jsx`
- **Parameters**: Query params (apiopid, ticket info, etc.)
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": { "success": true }
  }
  ```

##### 3.4 Close Ticket
- **Endpoint**: `POST /apis/crmCloseTicket?{params}`
- **Method**: POST
- **File**: `src/services/generalApis.js` - `pickTicket(action='close')`
- **Used In**: `src/pages/Tickets.jsx`
- **Parameters**: Query params
- **Response**: Success/error status

##### 3.5 Transfer Ticket
- **Endpoint**: `POST /apis/transferTicket?{params}`
- **Method**: POST
- **File**: `src/services/generalApis.js` - `pickTicket(action='transfer')`
- **Used In**: `src/pages/Tickets.jsx`
- **Parameters**: Query params
- **Response**: Success/error status

---

#### 4. Registration & Validation APIs

##### 4.1 General Validation (Username/Email/Mobile)
- **Endpoint**: `POST /ServiceApis/generalValidation`
- **Method**: POST (JSON)
- **File**: `src/services/registrationApis.js` - `checkUsernameAvailability()`, `checkEmailAvailability()`, `checkMobileAvailability()`
- **Used In**: `src/pages/Register.jsx`
- **Parameters** (one of):
  - `{ userid: "string", deviceid: "string" }` - for username check
  - `{ email: "string" }` - for email check
  - `{ mobile: "string" }` - for mobile check
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Available" }
  }
  ```

##### 4.2 Upload KYC Documents
- **Endpoint**: `POST /ServiceApis/custKYC`
- **Method**: POST (FormData)
- **File**: `src/services/registrationApis.js` - `uploadKycFile()`
- **Used In**: `src/pages/Register.jsx`
- **Parameters**:
  - `username`: string
  - File fields: `photo1`, `addrproof1`, `idcard1`, `signature`
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": { "fileId": "string" }
  }
  ```

##### 4.3 Get Registration Necessities (Plans & Groups)
- **Endpoint**: `POST /ServiceApis/registrationNecessities`
- **Method**: POST (JSON)
- **File**: `src/services/registrationApis.js` - `submitRegistrationNecessities()`
- **Used In**: `src/pages/Plans.jsx`
- **Parameters**: `{ logUname: "string" }`
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": {
      "internet_plans": [...],
      "groups": [...]
    }
  }
  ```

##### 4.4 Get ONU Hardware Details
- **Endpoint**: `POST /ServiceApis/getonuhardwaredetails`
- **Method**: POST (JSON)
- **File**: `src/services/registrationApis.js` - `getOnuHwDets()`
- **Used In**: `src/pages/Subscribe.jsx`
- **Parameters**:
  - `client_id`: string (op_id)
  - `macid`: string (ONU MAC address)
- **Response**: ONU hardware details

##### 4.5 Customer Service Registration
- **Endpoint**: `POST /ServiceApis/custservregistration`
- **Method**: POST (JSON)
- **File**: `src/services/registrationApis.js` - `registerCustomer()`
- **Used In**: `src/pages/Subscribe.jsx`
- **Parameters**: Complete registration payload
- **Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": { "customer_id": "string" }
  }
  ```

---

#### 5. Payment APIs

##### 5.1 Get Payment Details
- **Endpoint**: `POST /apis/makepayment`
- **Method**: POST (URL-encoded)
- **File**: `src/services/registrationApis.js` - `getPayDets()`
- **Used In**: `src/pages/Paynow.jsx`
- **Parameters**:
  - `apiopid`: string
  - `apiuserid`: string
  - `apptype`: string
  - `othamt`: number
  - `othreason`: string
- **Response**:
  ```json
  {
    "error": 0,
    "result": {
      "planname": "string",
      "wallet": { "avlbal": number },
      "planrates_android": [...]
    }
  }
  ```

##### 5.2 Save Payment
- **Endpoint**: `POST /apis/savepaymentapi`
- **Method**: POST (URL-encoded)
- **File**: `src/services/registrationApis.js` - `payNow()`
- **Used In**: `src/pages/Paynow.jsx`
- **Parameters**:
  - `apiopid`, `apiuserid`, `applicationname`, `paymode`
  - `noofmonth`, `cashpaid`, `transstatus`, `renewstatus`
  - `usagecompleted`, `services_app`, `paydoneby`
  - `payreceivedby`, `receivedremark`
- **Response**:
  ```json
  {
    "error": 0,
    "result": "Payment successful"
  }
  ```

---

### 🔶 **PENDING APIs** (Need Backend Integration)

#### 6. Service Management APIs

##### 6.1 Get Customer Service Status
- **Endpoint**: `GET /api/customer/:customerId/services` ⚠️ **NOT CONNECTED**
- **Purpose**: Get which services are active for a customer
- **Required For**: `src/pages/Services.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "" },
    "body": {
      "internet": { "active": true },
      "voice": { "active": true },
      "fofi": { "active": true },
      "iptv": { "active": false }
    }
  }
  ```

##### 6.2 Get Internet Service Details
- **Endpoint**: `GET /api/customer/:customerId/internet` ⚠️ **NOT CONNECTED**
- **Purpose**: Get customer's internet plan details
- **Required For**: `src/pages/services/InternetService.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": {
      "active": true,
      "internetId": "string",
      "planName": "string",
      "expiryDate": "2026-03-14T11:59:59",
      "serviceName": "internet"
    }
  }
  ```

##### 6.3 Get Voice Service Details
- **Endpoint**: `GET /api/customer/:customerId/voice` ⚠️ **NOT CONNECTED**
- **Purpose**: Get customer's voice plan details
- **Required For**: `src/pages/services/VoiceService.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": {
      "active": true,
      "voiceId": "string",
      "planName": "UNLIMITED CALLING",
      "expiryDate": "2026-03-14T11:59:59",
      "serviceName": "voice"
    }
  }
  ```

##### 6.4 Get All Services Overview
- **Endpoint**: `GET /api/customer/:customerId/all-services` ⚠️ **NOT CONNECTED**
- **Purpose**: Get overview of all services for a customer
- **Required For**: `src/pages/Services.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": {
      "customerId": "string",
      "services": {
        "internet": { "active": true, "planName": "...", "expiryDate": "..." },
        "voice": { "active": true, "planName": "...", "expiryDate": "..." },
        "fofi": { "active": true, "deviceId": "...", "planName": "..." },
        "iptv": { "active": false }
      }
    }
  }
  ```

---

#### 7. Internet Service APIs

##### 7.1 Get Data Usage
- **Endpoint**: `GET /api/customer/:customerId/internet/usage` ⚠️ **NOT CONNECTED**
- **Purpose**: Get customer's internet data usage
- **Required For**: `src/components/iptv/DataUsage.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": {
      "totalData": "100 GB",
      "usedData": "45.5 GB",
      "remainingData": "54.5 GB",
      "usagePercentage": 45.5,
      "validityDays": 15,
      "lastUpdated": "2026-01-09T10:30:00Z"
    }
  }
  ```

##### 7.2 Reset MAC Address
- **Endpoint**: `POST /api/customer/:customerId/internet/reset-mac` ⚠️ **NOT CONNECTED**
- **Purpose**: Reset customer's MAC address
- **Required For**: `src/components/iptv/ResetMac.jsx`
- **Parameters**: `{ customerId: "string" }`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "MAC reset successful" },
    "body": { "success": true }
  }
  ```

##### 7.3 Reset Password
- **Endpoint**: `POST /api/customer/:customerId/internet/reset-password` ⚠️ **NOT CONNECTED**
- **Purpose**: Reset customer's internet service password
- **Required For**: `src/components/iptv/ResetPassword.jsx`
- **Parameters**:
  - `customerId`: string
  - `newPassword`: string
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Password reset successful" }
  }
  ```

##### 7.4 Reset PPPoE
- **Endpoint**: `POST /api/customer/:customerId/internet/reset-pppoe` ⚠️ **NOT CONNECTED**
- **Purpose**: Reset customer's PPPoE connection
- **Required For**: `src/components/iptv/ResetPPPoE.jsx`
- **Parameters**: `{ customerId: "string" }`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "PPPoE reset successful" }
  }
  ```

---

#### 8. Voice Service APIs

##### 8.1 Get Voice Plan Details
- **Endpoint**: `GET /api/customer/:customerId/voice/plan` ⚠️ **NOT CONNECTED**
- **Purpose**: Get voice service plan details
- **Required For**: `src/pages/services/VoiceService.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": {
      "planName": "UNLIMITED CALLING",
      "validity": "30 days",
      "expiryDate": "2026-02-09",
      "price": 100
    }
  }
  ```

##### 8.2 Renew Voice Plan
- **Endpoint**: `POST /api/customer/:customerId/voice/renew` ⚠️ **NOT CONNECTED**
- **Purpose**: Renew voice service plan
- **Required For**: `src/pages/services/VoiceService.jsx`
- **Parameters**:
  - `customerId`: string
  - `planId`: string
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Plan renewed successfully" },
    "body": { "newExpiryDate": "2026-03-09" }
  }
  ```

##### 8.3 Change Voice Plan
- **Endpoint**: `POST /api/customer/:customerId/voice/change-plan` ⚠️ **NOT CONNECTED**
- **Purpose**: Change voice service plan
- **Required For**: `src/pages/services/VoiceService.jsx`
- **Parameters**:
  - `customerId`: string
  - `oldPlanId`: string
  - `newPlanId`: string
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Plan changed successfully" }
  }
  ```

---

#### 9. FoFi Smart Box APIs

##### 9.1 Get FoFi Plans
- **Endpoint**: `GET /ServiceApis/getFoFiPlans` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: GET
- **File**: `src/services/fofiApis.js` - `getFoFiPlans()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Expected Response**:
  ```json
  {
    "success": true,
    "data": {
      "ftaOnlyPlans": [...],
      "ftaPlusDpoPlans": [...]
    }
  }
  ```

##### 9.2 Validate Device by QR Code
- **Endpoint**: `POST /ServiceApis/validateDeviceByQR` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `validateDeviceByQR()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**:
  - `qrData`: string (QR code from TV screen)
  - `customerId`: string
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "Device validated successfully",
    "data": {
      "serialNumber": "string",
      "macAddress": "string",
      "multicastDeviceId": "string",
      "unicastDeviceId": "string",
      "deviceModel": "string",
      "isRegistered": false
    }
  }
  ```

##### 9.3 Fetch MAC by Serial Number
- **Endpoint**: `POST /ServiceApis/fetchMACBySerial` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `fetchMACBySerial()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**:
  - `serialNumber`: string
  - `customerId`: string
- **Expected Response**:
  ```json
  {
    "success": true,
    "data": {
      "serialNumber": "string",
      "macAddress": "string",
      "multicastDeviceId": "string",
      "unicastDeviceId": "string",
      "deviceModel": "string",
      "status": "available|registered|inactive"
    }
  }
  ```

##### 9.4 Validate Device Availability
- **Endpoint**: `POST /ServiceApis/validateDeviceAvailability` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `validateDeviceAvailability()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**:
  - `serialNumber`: string
  - `macAddress`: string
  - `customerId`: string
- **Expected Response**:
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

##### 9.5 Register FoFi Device
- **Endpoint**: `POST /ServiceApis/registerFoFiDevice` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `registerFoFiDevice()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**:
  - `customerId`, `planId`, `serialNumber`, `macAddress`
  - `multicastDeviceId`, `unicastDeviceId`, `validationMethod`
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "Device registered successfully",
    "data": {
      "registrationId": "string",
      "customerId": "string",
      "deviceId": "string",
      "planId": "string",
      "activationDate": "2025-01-09T10:30:00Z",
      "expiryDate": "2025-04-09T10:30:00Z"
    }
  }
  ```

##### 9.6 Get FoFi Device Details
- **Endpoint**: `POST /ServiceApis/getFoFiDeviceDetails` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `getFoFiDeviceDetails()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**: `{ customerId: "string" }`
- **Expected Response**:
  ```json
  {
    "success": true,
    "data": {
      "customerId": "string",
      "deviceInfo": {
        "multicastDeviceId": "string",
        "unicastDeviceId": "string",
        "serialNumber": "string",
        "macAddress": "string",
        "deviceModel": "string"
      },
      "planDetails": {
        "planId": "string",
        "planName": "string",
        "planType": "FTA + DPO",
        "price": 299,
        "validity": "90 days",
        "activationDate": "2025-01-09",
        "expiryDate": "2025-04-09"
      },
      "subscriptionStatus": "active|expired|suspended"
    }
  }
  ```

##### 9.7 Change FoFi Plan
- **Endpoint**: `POST /ServiceApis/changeFoFiPlan` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `changeFoFiPlan()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**:
  - `customerId`, `currentPlanId`, `newPlanId`, `action` (renew/change)
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "Plan changed successfully",
    "data": {
      "transactionId": "string",
      "customerId": "string",
      "oldPlanId": "string",
      "newPlanId": "string",
      "effectiveDate": "2025-01-09",
      "newExpiryDate": "2025-04-09",
      "amountCharged": 399
    }
  }
  ```

##### 9.8 Create FoFi Payment Order
- **Endpoint**: `POST /ServiceApis/createFoFiPaymentOrder` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `createFoFiPaymentOrder()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**:
  - `customerId`, `planId`, `amount`, `deviceId`
  - `orderType`: 'new_registration' | 'renewal' | 'plan_change'
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "Payment order created successfully",
    "data": {
      "orderId": "string",
      "customerId": "string",
      "amount": 299,
      "currency": "INR",
      "paymentGatewayUrl": "string",
      "paymentToken": "string",
      "expiresAt": "2025-01-09T11:30:00Z"
    }
  }
  ```

##### 9.9 Verify FoFi Payment
- **Endpoint**: `POST /ServiceApis/verifyFoFiPayment` ⚠️ **DEFINED BUT NOT TESTED**
- **Method**: POST (JSON)
- **File**: `src/services/fofiApis.js` - `verifyFoFiPayment()`
- **Required For**: `src/pages/services/FoFiSmartBox.jsx`
- **Parameters**:
  - `orderId`, `paymentId`, `customerId`
- **Expected Response**:
  ```json
  {
    "success": true,
    "verified": true,
    "message": "Payment verified successfully",
    "data": {
      "orderId": "string",
      "paymentId": "string",
      "paymentStatus": "success|failed|pending",
      "amount": 299,
      "paidAt": "2025-01-09T10:45:00Z",
      "transactionId": "string"
    }
  }
  ```

---

#### 10. IPTV Service APIs

##### 10.1 Get IPTV Subscription
- **Endpoint**: `GET /api/customer/:customerId/iptv` ⚠️ **NOT CONNECTED**
- **Purpose**: Get customer's IPTV subscription details
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": {
      "active": true,
      "iptvId": "string",
      "basePack": "fta-super-saver",
      "addOnPackages": ["sports-pack"],
      "alacarteChannels": ["Sony HD"],
      "expiryDate": "2026-03-14T11:59:59"
    }
  }
  ```

##### 10.2 Get FTA Base Packs
- **Endpoint**: `GET /api/iptv/base-packs` ⚠️ **NOT CONNECTED**
- **Purpose**: Get available FTA base packs
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": [
      {
        "id": "fta-super-saver",
        "name": "FTA Super Saver Pack",
        "price": 154,
        "channelCount": 290,
        "validity": "30 days"
      }
    ]
  }
  ```

##### 10.3 Get Add-on Packages
- **Endpoint**: `GET /api/iptv/addons` ⚠️ **NOT CONNECTED**
- **Purpose**: Get available add-on packages
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": [
      {
        "id": "sports-pack",
        "name": "Sports Premium Pack",
        "price": 50,
        "channelCount": 15,
        "validity": "30 days"
      }
    ]
  }
  ```

##### 10.4 Get A-la-carte Channels
- **Endpoint**: `GET /api/iptv/channels` ⚠️ **NOT CONNECTED**
- **Purpose**: Get available a-la-carte channels
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0 },
    "body": [
      {
        "id": "sony-hd",
        "name": "Sony HD",
        "price": 19,
        "category": "Entertainment"
      }
    ]
  }
  ```

##### 10.5 Validate IPTV Device
- **Endpoint**: `POST /api/iptv/validate-device` ⚠️ **NOT CONNECTED**
- **Purpose**: Validate IPTV device (MAC/Serial)
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Parameters**:
  - `customerId`: string
  - `deviceType`: "mac" | "serial"
  - `deviceValue`: string
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Device valid" },
    "body": {
      "valid": true,
      "deviceId": "string",
      "status": "available"
    }
  }
  ```

##### 10.6 Subscribe to IPTV
- **Endpoint**: `POST /api/iptv/subscribe` ⚠️ **NOT CONNECTED**
- **Purpose**: Create new IPTV subscription
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Parameters**:
  - `customerId`, `basePack`, `addOnPackages[]`
  - `alacarteChannels[]`, `deviceId`, `validationMethod`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Subscription successful" },
    "body": {
      "subscriptionId": "string",
      "activationDate": "2026-01-09",
      "expiryDate": "2026-02-09"
    }
  }
  ```

##### 10.7 Change IPTV Pack
- **Endpoint**: `POST /api/iptv/change-pack` ⚠️ **NOT CONNECTED**
- **Purpose**: Change IPTV base pack or add-ons
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Parameters**:
  - `customerId`, `newBasePack`
  - `addPackages[]`, `removePackages[]`
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Pack changed successfully" }
  }
  ```

##### 10.8 Add A-la-carte Channels
- **Endpoint**: `POST /api/iptv/add-channels` ⚠️ **NOT CONNECTED**
- **Purpose**: Add a-la-carte channels to subscription
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Parameters**:
  - `customerId`
  - `channels[]`: array of channel IDs
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Channels added successfully" }
  }
  ```

##### 10.9 Remove A-la-carte Channels
- **Endpoint**: `POST /api/iptv/remove-channels` ⚠️ **NOT CONNECTED**
- **Purpose**: Remove a-la-carte channels from subscription
- **Required For**: `src/pages/services/IPTVService.jsx`
- **Parameters**:
  - `customerId`
  - `channels[]`: array of channel IDs
- **Expected Response**:
  ```json
  {
    "status": { "err_code": 0, "err_msg": "Channels removed successfully" }
  }
  ```

---

## Quick Reference: API Files

### API Service Files

1. **`src/services/generalApis.js`**
   - Authentication (Login, OTP, Resend OTP)
   - Customer List
   - Wallet Balance
   - Ticket Management (Get Departments, Get Tickets, Pick/Close/Transfer Ticket)

2. **`src/services/registrationApis.js`**
   - Validation (Username, Email, Mobile)
   - KYC Upload
   - Registration Necessities (Plans & Groups)
   - ONU Hardware Details
   - Customer Service Registration
   - Payment (Get Payment Details, Pay Now)

3. **`src/services/fofiApis.js`**
   - FoFi Plans
   - Device Validation (QR, Serial, Availability)
   - Device Registration
   - FoFi Device Details
   - Plan Change/Renewal
   - Payment Orders & Verification

4. **`src/services/helpers.js`**
   - Utility functions for formatting

---

## Pages Using APIs

### Currently Connected to Backend

| Page | File | APIs Used | Status |
|------|------|-----------|--------|
| Login | `src/pages/Login.jsx` | UserLogin, OTPauth | ✅ Connected |
| Verify OTP | `src/pages/VerifyOTP.jsx` | OTPauth, resendOTP | ✅ Connected |
| Dashboard | `src/pages/Dashboard.jsx` | getWalBal | ✅ Connected |
| Customer List | `src/pages/Customerlist.jsx` | getCustList | ✅ Connected |
| Tickets | `src/pages/Tickets.jsx` | getTktDepartments, getTickets, pickTicket | ✅ Connected |
| Register | `src/pages/Register.jsx` | checkUsername, checkEmail, checkMobile, uploadKycFile | ✅ Connected |
| Plans | `src/pages/Plans.jsx` | submitRegistrationNecessities | ✅ Connected |
| Subscribe | `src/pages/Subscribe.jsx` | getOnuHwDets, registerCustomer | ✅ Connected |
| Pay Now | `src/pages/Paynow.jsx` | getPayDets, payNow | ✅ Connected |

### Using Mock Data (Pending Backend)

| Page | File | Mock Data Used | APIs Needed |
|------|------|----------------|-------------|
| Services Hub | `src/pages/Services.jsx` | mockCustomerServices | Get Customer Service Status |
| Internet Service | `src/pages/services/InternetService.jsx` | mockCustomerServices | Get Internet Service Details |
| Voice Service | `src/pages/services/VoiceService.jsx` | mockCustomerServices | Get Voice Service Details |
| FoFi Smart Box | `src/pages/services/FoFiSmartBox.jsx` | mockCustomerServices, fofiPlans | All FoFi APIs (9 endpoints) |
| IPTV Service | `src/pages/services/IPTVService.jsx` | mockCustomerServices, iptvFTABasePacks, iptvAddonPackages, iptvAlacarteChannels | All IPTV APIs (9 endpoints) |
| Data Usage | `src/components/iptv/DataUsage.jsx` | Mock usage data | Get Data Usage API |
| Reset MAC | `src/components/iptv/ResetMac.jsx` | None | Reset MAC API |
| Reset Password | `src/components/iptv/ResetPassword.jsx` | None | Reset Password API |
| Reset PPPoE | `src/components/iptv/ResetPPPoE.jsx` | None | Reset PPPoE API |

---

## Mock Data Structure Location

**File**: `src/data.js`

Contains:
- `mockCustomerServices` - Service details for test customers
- `fofiPlans` - FoFi plan options (FTA-only and FTA+DPO)
- `iptvFTABasePacks` - IPTV base pack options
- `iptvAddonPackages` - IPTV add-on packages
- `iptvAlacarteChannels` - Individual IPTV channels
- `featuredAds` - Dashboard promotional content
- `transactions` - Sample transaction history

---

## Implementation Priority

### Phase 1: Core Service Management (High Priority)
1. ✅ **Get Customer Service Status** - Required for Services Hub
2. ✅ **Get Internet Service Details** - Most used service
3. ✅ **Get Voice Service Details** - Second most used service

### Phase 2: Internet Service Features (High Priority)
4. ✅ **Get Data Usage** - Frequently requested by users
5. ✅ **Reset MAC Address** - Common support operation
6. ✅ **Reset Password** - Common support operation
7. ✅ **Reset PPPoE** - Support operation

### Phase 3: FoFi Smart Box (Medium Priority)
8. ✅ **Get FoFi Plans** - Essential for onboarding
9. ✅ **Validate Device by QR** - Preferred device validation method
10. ✅ **Fetch MAC by Serial** - Alternative device validation
11. ✅ **Register FoFi Device** - Core functionality
12. ✅ **Get FoFi Device Details** - View existing subscriptions
13. ✅ **Change FoFi Plan** - Plan management

### Phase 4: IPTV Service (Medium Priority)
14. ✅ **Get IPTV Subscription** - View current subscription
15. ✅ **Get FTA Base Packs** - Essential for onboarding
16. ✅ **Get Add-on Packages** - Additional content
17. ✅ **Get A-la-carte Channels** - Individual channel selection
18. ✅ **Validate IPTV Device** - Device registration
19. ✅ **Subscribe to IPTV** - Core functionality

### Phase 5: Advanced Features (Lower Priority)
20. ✅ FoFi Payment Integration (3 APIs)
21. ✅ IPTV Pack Management (3 APIs)

---

## Backend Integration Checklist

### Step-by-Step Migration Guide

#### For Each API Endpoint:

1. **Backend Implementation**
   - Create endpoint with expected URL pattern
   - Implement request/response format as documented
   - Test with sample data
   - Deploy to development environment

2. **Frontend Integration**
   - Create API function in appropriate service file
   - Update component to use API instead of mock data
   - Handle loading states
   - Handle error cases
   - Test with real backend

3. **Testing**
   - Unit test the API function
   - Integration test the component
   - User acceptance testing

4. **Cleanup**
   - Remove mock data imports (keep mock data file for reference)
   - Update comments
   - Remove development-only code

---

## Environment Configuration

### API Base URLs

**Development**:
```javascript
// vite.config.js proxy
'/api/' → Backend development server
```

**Production**:
```javascript
// Uses VITE_API_BASE_URL environment variable
```

### Required Environment Variables

```env
VITE_API_BASE_URL=https://api.example.com/
VITE_API_AUTH_KEY=your_auth_key
VITE_API_USERNAME=api_username
VITE_API_PASSWORD=api_password
VITE_API_APP_USER_TYPE=crm
VITE_API_APP_VERSION=1.0.0
VITE_API_APP_DEFAULT_CURRENCY_SYMBOL=₹
```

---

## Error Handling Standard

All APIs follow consistent error response:

```json
{
  "status": {
    "err_code": 1,
    "err_msg": "Error description"
  }
}
```

**Error Codes**:
- `0` - Success
- `1` - General error
- `401` - Unauthorized
- `404` - Not found
- `500` - Server error

---

## Data Flow Architecture

### 1. Customer List (Existing Feature - Uses API)

**File**: `src/pages/Customerlist.jsx`

**API Call**: `getCustList(payload, status)`
- Endpoint: `POST /ServiceApis/customersList`
- Returns: Array of customer objects with:
  - `customer_id`
  - `name`
  - `mobile`
  - `email`
  - `address`

**Flow**:
```
User clicks "All Users" 
  → API call to getCustList()
  → Display customer list from API response
  → User clicks customer
  → Navigate to Services page with customer data
```

### 2. Services Hub (New Feature - Hybrid)

**File**: `src/pages/Services.jsx`

**Data Sources**:
- ✅ **Customer info** (name, email, phone): From API via `location.state.customer`
- 🔶 **Service availability** (which services are active): From mock data

**Why Mock for Service Availability?**
The API response from `getCustList` doesn't include service subscription details. Until the backend provides service status, we use mock data to determine which services (Internet, Voice, FoFi, IPTV) are active for each customer.

### 3. Individual Service Pages (New Features - Hybrid)

#### Internet Service
**File**: `src/pages/services/InternetService.jsx`

**Data Sources**:
- ✅ Customer details: From API (`location.state.customer`)
- 🔶 Internet plan details: From mock data (`mockCustomerServices[customerId].services.internet`)

#### Voice Service
**File**: `src/pages/services/VoiceService.jsx`

**Data Sources**:
- ✅ Customer details: From API
- 🔶 Voice plan details: From mock data

#### FoFi Smart Box
**File**: `src/pages/services/FoFiSmartBox.jsx`

**Data Sources**:
- ✅ Customer details: From API
- 🔶 FoFi subscription & device info: From mock data
- 🔶 Available plans: From mock data (`fofiPlans`)
- 🔶 Device validation: Mock implementation

#### IPTV Service
**File**: `src/pages/services/IPTVService.jsx`

**Data Sources**:
- ✅ Customer details: From API
- 🔶 IPTV subscription: From mock data
- 🔶 FTA base packs: From mock data (`iptvFTABasePacks`)
- 🔶 Add-on packages: From mock data (`iptvAddonPackages`)
- 🔶 A-la-carte channels: From mock data (`iptvAlacarteChannels`)
- 🔶 Device validation: Mock implementation

---

## Mock Data Structure

**File**: `src/data.js`

### Mock Customer Services
```javascript
mockCustomerServices = {
  'testus1': {
    customerId: 'testus1',
    name: 'MohanRaj',      // ← This comes from API in real flow
    mobile: '8433544736',   // ← This comes from API in real flow
    email: 'dghddh@email.com', // ← This comes from API in real flow
    services: {             // ← Service details are mocked
      internet: { active: true, planName: '300MB_Tripleplay', ... },
      voice: { active: true, planName: 'UNLIMITED CALLING', ... },
      fofi: { active: true, deviceInfo: {...}, ... },
      iptv: { active: true, basePack: 'fta-super-saver', ... }
    }
  }
}
```

**Important**: In production, customer name/email/phone will come from the API. Only the `services` object needs to be fetched from backend.

---

## Backend Integration Checklist

When backend APIs are ready, replace mock data with API calls:

### Step 1: Customer Service Status API
**Endpoint**: `GET /api/customer/:customerId/services`

**Response**:
```json
{
  "status": { "err_code": 0, "err_msg": "" },
  "body": {
    "internet": { "active": true },
    "voice": { "active": true },
    "fofi": { "active": true },
    "iptv": { "active": false }
  }
}
```

**Update**: `src/pages/Services.jsx`
```javascript
// Replace:
const mockServices = mockCustomerServices[customerId];

// With:
const [services, setServices] = useState(null);
useEffect(() => {
  async function fetchServices() {
    const data = await getCustomerServices(customerId);
    setServices(data.body);
  }
  fetchServices();
}, [customerId]);
```

### Step 2: Internet Service API
**Endpoint**: `GET /api/customer/:customerId/internet`

**Response**:
```json
{
  "status": { "err_code": 0 },
  "body": {
    "active": true,
    "internetId": "testus1",
    "planName": "300MB_Tripleplay",
    "expiryDate": "2026-03-14T11:59:59",
    "serviceName": "internet"
  }
}
```

**Update**: `src/pages/services/InternetService.jsx`

### Step 3: Voice Service API
**Endpoint**: `GET /api/customer/:customerId/voice`

### Step 4: FoFi Smart Box APIs
**Endpoints**:
- `GET /api/customer/:customerId/fofi` - Get subscription
- `GET /api/fofi/plans` - Get available plans
- `POST /api/fofi/validate-device` - Validate device
- `POST /api/fofi/subscribe` - Create subscription

### Step 5: IPTV Service APIs
**Endpoints**:
- `GET /api/customer/:customerId/iptv` - Get subscription
- `GET /api/iptv/base-packs` - Get FTA packs
- `GET /api/iptv/addons` - Get add-on packages
- `GET /api/iptv/channels` - Get a-la-carte channels
- `POST /api/iptv/validate-device` - Validate device
- `POST /api/iptv/subscribe` - Create subscription

---

## Code Comments

All mock data usage is clearly marked:

```javascript
// Use actual customer data from API (passed from customer list)
const customerData = location.state?.customer;

// Use mock data ONLY for service details (new feature)
const mockServiceData = mockCustomerServices[customerId];
```

---

## Testing with Current Setup

### Test with API Customer Data
1. Login to CRM
2. Navigate to "All Users" (uses API)
3. Click on any customer from the API response
4. Customer details (name, email, phone) will be from API
5. Service details will be from mock data

### Mock Customers for Testing New Features
- `testus1` - Has all services active
- `customer2` - Has only Internet active

---

## Summary

### ✅ **APIs Currently Connected & Working** (15 endpoints)

**Authentication & User Management** (3):
1. POST `/ServiceApis/custlogin` - Customer Login
2. POST `/ServiceApis/custLoginVerification` - OTP Verification
3. POST `/ServiceApis/custLoginResendOtp` - Resend OTP

**Customer Management** (2):
4. POST `/ServiceApis/customersList` - Get Customer List
5. POST `/ServiceApis/mywallet` - Get Wallet Balance

**Ticket Management** (5):
6. GET `/apis/getDepartments` - Get Departments
7. GET `/apis/getavailableticket` - Get Open Tickets
8. GET `/apis/pendingtickets` - Get Pending Tickets
9. GET `/apis/getNewConnectionTicket` - Get New Connection Tickets
10. GET `/apis/disconnection` - Get Disconnection Tickets
11. GET `/apis/jobDoneList` - Get Job Done Tickets
12. POST `/apis/pickTicket` - Pick Ticket
13. POST `/apis/crmCloseTicket` - Close Ticket
14. POST `/apis/transferTicket` - Transfer Ticket

**Registration & Validation** (5):
15. POST `/ServiceApis/generalValidation` - Validate Username/Email/Mobile
16. POST `/ServiceApis/custKYC` - Upload KYC Documents
17. POST `/ServiceApis/registrationNecessities` - Get Plans & Groups
18. POST `/ServiceApis/getonuhardwaredetails` - Get ONU Hardware Details
19. POST `/ServiceApis/custservregistration` - Register Customer

**Payment** (2):
20. POST `/apis/makepayment` - Get Payment Details
21. POST `/apis/savepaymentapi` - Save Payment

---

### 🔶 **APIs Pending Backend Integration** (34 endpoints)

**Service Management** (4):
1. ❌ GET `/api/customer/:customerId/services` - Get Service Status
2. ❌ GET `/api/customer/:customerId/internet` - Get Internet Service Details
3. ❌ GET `/api/customer/:customerId/voice` - Get Voice Service Details
4. ❌ GET `/api/customer/:customerId/all-services` - Get All Services Overview

**Internet Service Management** (4):
5. ❌ GET `/api/customer/:customerId/internet/usage` - Get Data Usage
6. ❌ POST `/api/customer/:customerId/internet/reset-mac` - Reset MAC Address
7. ❌ POST `/api/customer/:customerId/internet/reset-password` - Reset Password
8. ❌ POST `/api/customer/:customerId/internet/reset-pppoe` - Reset PPPoE

**Voice Service Management** (3):
9. ❌ GET `/api/customer/:customerId/voice/plan` - Get Voice Plan Details
10. ❌ POST `/api/customer/:customerId/voice/renew` - Renew Voice Plan
11. ❌ POST `/api/customer/:customerId/voice/change-plan` - Change Voice Plan

**FoFi Smart Box** (14):
12. ⚠️ GET `/ServiceApis/getFoFiPlans` - Get FoFi Plans (Defined, not tested)
13. ⚠️ POST `/ServiceApis/validateDeviceByQR` - Validate Device by QR (Defined, not tested)
14. ⚠️ POST `/ServiceApis/fetchMACBySerial` - Fetch MAC by Serial (Defined, not tested)
15. ⚠️ POST `/ServiceApis/validateDeviceAvailability` - Validate Device Availability (Defined, not tested)
16. ⚠️ POST `/ServiceApis/registerFoFiDevice` - Register FoFi Device (Defined, not tested)
17. ⚠️ POST `/ServiceApis/getFoFiDeviceDetails` - Get FoFi Device Details (Defined, not tested)
18. ⚠️ POST `/ServiceApis/changeFoFiPlan` - Change FoFi Plan (Defined, not tested)
19. ⚠️ POST `/ServiceApis/createFoFiPaymentOrder` - Create Payment Order (Defined, not tested)
20. ⚠️ POST `/ServiceApis/verifyFoFiPayment` - Verify Payment (Defined, not tested)
21. ⚠️ POST `/ServiceApis/processFoFiBillPayment` - Process Bill Payment (Defined, not tested)
22. ⚠️ GET `/ServiceApis/getFoFiPaymentHistory` - Get Payment History (Defined, not tested)

**IPTV Service** (9):
23. ❌ GET `/api/customer/:customerId/iptv` - Get IPTV Subscription
24. ❌ GET `/api/iptv/base-packs` - Get FTA Base Packs
25. ❌ GET `/api/iptv/addons` - Get Add-on Packages
26. ❌ GET `/api/iptv/channels` - Get A-la-carte Channels
27. ❌ POST `/api/iptv/validate-device` - Validate IPTV Device
28. ❌ POST `/api/iptv/subscribe` - Subscribe to IPTV
29. ❌ POST `/api/iptv/change-pack` - Change IPTV Pack
30. ❌ POST `/api/iptv/add-channels` - Add A-la-carte Channels
31. ❌ POST `/api/iptv/remove-channels` - Remove A-la-carte Channels

---

### Legend:
- ✅ **Connected & Working** - Fully integrated and tested
- ⚠️ **Defined But Not Tested** - API function exists in code but hasn't been connected to real backend
- ❌ **Not Connected** - No API function exists, using mock data

---

### What Uses API vs Mock Data

**✅ Using Real API Data**:
- Customer list (`getCustList`)
- Customer details (name, email, phone, address)
- Wallet balance (`getWalBal`)
- Tickets (`getTickets`)
- Authentication (login, OTP)
- Registration flow
- Payment processing
- All existing CRM features

**🔶 Using Mock Data** (Temporary):
- Service availability (Internet, Voice, FoFi, IPTV active status)
- Service plan details
- Device information
- Available plans/packages/channels
- Device validation
- IPTV subscription details
- FoFi subscription details
- Data usage statistics

---

### Next Steps for Backend Team

1. **Implement Priority 1 APIs** (Service Management - 4 endpoints)
   - Essential for Services Hub functionality
   - Enables customers to view their active services

2. **Implement Priority 2 APIs** (Internet Service - 4 endpoints)
   - Most frequently used support operations
   - Reset MAC, Password, PPPoE
   - Data usage monitoring

3. **Implement Priority 3 APIs** (FoFi - Test existing + implement missing)
   - Test the 11 already-defined FoFi API functions
   - Connect to real backend for device validation and registration

4. **Implement Priority 4 APIs** (IPTV - 9 endpoints)
   - Enable IPTV subscription management
   - Package and channel selection

5. **Implement Priority 5 APIs** (Voice Service - 3 endpoints)
   - Voice plan management
   - Plan renewal and changes

---

### Frontend Integration Notes

- **No major code changes required** when APIs are ready
- Frontend is designed for easy transition from mock to real data
- Simply swap data source in component:
  ```javascript
  // Before (mock data)
  const services = mockCustomerServices[customerId];
  
  // After (API data)
  const services = await getCustomerServices(customerId);
  ```

- All API response formats are documented in this file
- Error handling structure is consistent across all APIs
- Loading states and error messages already implemented

---

🎯 **Goal**: Seamless transition from mock to real APIs without frontend code changes (just swap data source).
