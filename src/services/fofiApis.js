// FoFi Smart Box API services

function getBaseUrl() {
    if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL;
    return '/api/';
}

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

function getHeadersForm() {
    return {
        Authorization: import.meta.env.VITE_API_AUTH_KEY,
        username: import.meta.env.VITE_API_USERNAME,
        password: import.meta.env.VITE_API_PASSWORD,
        appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
        appversion: import.meta.env.VITE_API_APP_VERSION,
    };
}

function getBasicAuthHeader() {
    return {
        Authorization: "Basic Zm9maWxhYkBnbWFpbC5jb206MTIzNDUtNTQzMjE=",
        "Content-Type": "application/json",
    };
}

/**
 * Generate FoFi Payment Order - Called when user clicks "PROCEED TO PAY"
 * @param {Object} payload - Payment order details
 * @param {string} payload.fofiboxid - FoFi Box ID
 * @param {string} payload.planid - Plan ID
 * @param {string} payload.priceid - Price ID
 * @param {string} payload.servid - Service ID
 * @param {string} payload.userid - User ID
 * @param {string} payload.username - Login username
 * @param {string} payload.paidamount - Amount to be paid
 * @param {string} payload.transactionid - Transaction ID
 * @param {string} payload.paytype - Payment type (upgrade/new)
 * @returns {Promise<Object>} Response containing order generation status
 */
export async function generateFofiOrder(payload) {
    const url = `${getBaseUrl()}ServiceApis/cabletv/generateorder`;
    const headers = getHeadersJson();

    // Build the complete payload with defaults
    const orderPayload = {
        bankname: payload.bankname || "",
        banktxnid: payload.banktxnid || "",
        fofiboxid: payload.fofiboxid || "",
        gateway: payload.gateway || "",
        gatewaytxnid: payload.gatewaytxnid || "",
        orderedbytype: payload.orderedbytype || "crmapp",
        paidamount: String(payload.paidamount || "0"),
        paymentmode: payload.paymentmode || "offline",
        payresponse: payload.payresponse || "",
        paytype: payload.paytype || "upgrade",
        planid: String(payload.planid || ""),
        priceid: String(payload.priceid || "99"),
        servid: String(payload.servid || "3"),
        transactionid: payload.transactionid || "",
        txnstatus: payload.txnstatus || "success",
        userid: payload.userid || "",
        username: payload.username || "",
        voipnumber: payload.voipnumber || ""
    };

    console.log('🔵 [generateFofiOrder] Calling API:', url);
    console.log('🔵 [generateFofiOrder] Payload:', orderPayload);

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(orderPayload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to generate FoFi order: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    console.log('🟢 [generateFofiOrder] Response:', data);
    return data;
}

/**
 * Get special internet plans for FoFi Box
 * @param {Object} payload - { logUname: string, isKiranastore: string }
 * @returns {Promise<Object>} Response containing special internet plans
 */
export async function getSpecialInternetPlans(payload) {
    const url = `${getBaseUrl()}ServiceApis/specialInternetPlans`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to fetch special internet plans: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return data;
}

/**
 * Validate before FoFi Box registration/upgrade
 * @param {Object} payload - { username: string, loginuname: string }
 * @returns {Promise<Object>} Response containing validation status
 */
export async function validateBeforeFofiBoxReg(payload) {
    const url = `${getBaseUrl()}ServiceApis/validateBeforeFofiBoxReg`;
    const headers = getHeadersJson();

    console.log('🔵 [validateBeforeFofiBoxReg] Calling API:', url);
    console.log('🔵 [validateBeforeFofiBoxReg] Payload:', payload);

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to validate before FoFi Box registration: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    console.log('🟢 [validateBeforeFofiBoxReg] Response:', data);
    return data;
}

/**
 * Get registration necessities for FoFi upgrade plans
 * @param {Object} payload - { logUname: string, moduletype: string, userid: string }
 * @returns {Promise<Object>} Response containing upgrade plans and service details
 */
export async function getFofiUpgradePlans(payload) {
    const url = `${getBaseUrl()}ServiceApis/registrationNecessities`;
    const headers = getHeadersJson();

    console.log('🔵 [getFofiUpgradePlans] Calling API:', url);
    console.log('🔵 [getFofiUpgradePlans] Payload:', payload);

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to fetch FoFi upgrade plans: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    console.log('🟢 [getFofiUpgradePlans] Response:', data);
    return data;
}

/**
 * Upgrade Registration - Submit FoFi upgrade registration for new users
 * @param {Object} payload - { fofiboxid: string, fofimac: string, fofiserailnumber: string, loginuname: string, services: array, username: string }
 * @returns {Promise<Object>} Response containing upgrade registration status
 */
export async function upgradeRegistration(payload) {
    const url = `${getBaseUrl()}ServiceApis/upgradeRegistration`;
    const headers = getHeadersJson();

    console.log('🔵 [upgradeRegistration] Calling API:', url);
    console.log('🔵 [upgradeRegistration] Payload:', payload);

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to submit upgrade registration: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    console.log('🟢 [upgradeRegistration] Response:', data);
    return data;
}

/**
 * FoFi Payment Info - Get payment info after upgrade registration
 * @param {Object} payload - { fofi_box_id: string, planid: string, priceid: string, servapptype: string, servid: string, userid: string, username: string, voipnumber: string }
 * @returns {Promise<Object>} Response containing payment information
 */
export async function getFofiPaymentInfo(payload) {
    const url = `${getBaseUrl()}service/paymentinfo/fofi`;
    const headers = getHeadersJson();

    console.log('🔵 [getFofiPaymentInfo] Calling API:', url);
    console.log('🔵 [getFofiPaymentInfo] Payload:', payload);

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to get FoFi payment info: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    console.log('🟢 [getFofiPaymentInfo] Response:', data);
    return data;
}

/**
 * Validate FoFi Asset (Get MAC ID)
 * @param {Object} payload - { mac_addr: string, serialno: string, userid: string, boxid: string }
 * @returns {Promise<Object>} Response containing validated asset details with MAC address
 */
export async function validateFoFiAsset(payload) {
    const url = `${getBaseUrl()}fofi/fofiapis/validateAsset`;
    const headers = getBasicAuthHeader();

    console.log('🔵 [validateFoFiAsset] Calling API:', url);
    console.log('🔵 [validateFoFiAsset] Payload:', payload);

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to validate FoFi asset: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return data;
}

/**
 * Link FoFi Box to customer (First time linking)
 * @param {Object} payload - { fofiboxid: string, fofimac: string, fofiserailnumber: string, loginuname: string, plan_id: string, services: array, username: string }
 * @returns {Promise<Object>} Response containing link status
 */
export async function linkFoFiBox(payload) {
    const url = `${getBaseUrl()}ServiceApis/freeOTAService`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to link FoFi box: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return data;
}

/**
 * Get all available FoFi plans
 * @returns {Promise<Object>} Response containing FTA-only and FTA+DPO plans
 */
export async function getFoFiPlans() {
    const url = `${getBaseUrl()}ServiceApis/getFoFiPlans`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "GET",
        headers,
    });

    if (!resp.ok) {
        throw new Error(`Failed to fetch FoFi plans: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return data;
}

/**
 * Validate device by scanning QR code
 * @param {Object} payload - QR code data from the TV screen
 * @param {string} payload.qrData - QR code string from the device
 * @param {string} payload.customerId - Customer ID
 * @returns {Promise<Object>} Device information including MAC address and device IDs
 */
export async function validateDeviceByQR(payload) {
    const url = `${getBaseUrl()}ServiceApis/validateDeviceByQR`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to validate device by QR: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     message: "Device validated successfully",
    //     data: {
    //         serialNumber: "SN123456",
    //         macAddress: "AA:BB:CC:DD:EE:FF",
    //         multicastDeviceId: "MC123456789",
    //         unicastDeviceId: "UC987654321",
    //         deviceModel: "FoFi Box Pro",
    //         isRegistered: false
    //     }
    // }

    return data;
}

/**
 * Fetch MAC address by inventory serial number
 * @param {Object} payload - Serial number from device inventory
 * @param {string} payload.serialNumber - Device inventory serial number
 * @param {string} payload.customerId - Customer ID
 * @returns {Promise<Object>} Device information including MAC address
 */
export async function fetchMACBySerial(payload) {
    const url = `${getBaseUrl()}ServiceApis/fetchMACBySerial`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to fetch MAC address: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     message: "MAC address fetched successfully",
    //     data: {
    //         serialNumber: "SN123456",
    //         macAddress: "AA:BB:CC:DD:EE:FF",
    //         multicastDeviceId: "MC123456789",
    //         unicastDeviceId: "UC987654321",
    //         deviceModel: "FoFi Box Pro",
    //         status: "available" | "registered" | "inactive"
    //     }
    // }

    return data;
}

/**
 * Validate device availability before registration
 * @param {Object} payload - Device validation data
 * @param {string} payload.serialNumber - Device serial number
 * @param {string} payload.macAddress - Device MAC address
 * @param {string} payload.customerId - Customer ID
 * @returns {Promise<Object>} Validation result
 */
export async function validateDeviceAvailability(payload) {
    const url = `${getBaseUrl()}ServiceApis/validateDeviceAvailability`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to validate device availability: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     available: true,
    //     message: "Device is available for registration",
    //     data: {
    //         deviceStatus: "available",
    //         lastUsedBy: null,
    //         canProceed: true
    //     }
    // }

    return data;
}

/**
 * Register new FoFi device with plan
 * @param {Object} payload - Registration data
 * @param {string} payload.customerId - Customer ID
 * @param {string} payload.planId - Selected plan ID
 * @param {string} payload.serialNumber - Device serial number
 * @param {string} payload.macAddress - Device MAC address
 * @param {string} payload.multicastDeviceId - Multicast device ID
 * @param {string} payload.unicastDeviceId - Unicast device ID
 * @param {string} payload.validationMethod - 'qr' or 'manual'
 * @returns {Promise<Object>} Registration result
 */
export async function registerFoFiDevice(payload) {
    const url = `${getBaseUrl()}ServiceApis/registerFoFiDevice`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to register FoFi device: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     message: "Device registered successfully",
    //     data: {
    //         registrationId: "REG123456",
    //         customerId: "CUST001",
    //         deviceId: "DEV123",
    //         planId: "PLAN001",
    //         activationDate: "2025-01-09T10:30:00Z",
    //         expiryDate: "2025-04-09T10:30:00Z"
    //     }
    // }

    return data;
}

/**
 * Get FoFi device and plan details for existing customer
 * @param {Object} payload - Customer information
 * @param {string} payload.customerId - Customer ID
 * @returns {Promise<Object>} Device and plan details
 */
export async function getFoFiDeviceDetails(payload) {
    const url = `${getBaseUrl()}ServiceApis/getFoFiDeviceDetails`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to fetch FoFi device details: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     data: {
    //         customerId: "CUST001",
    //         deviceInfo: {
    //             multicastDeviceId: "MC123456789",
    //             unicastDeviceId: "UC987654321",
    //             serialNumber: "SN123456",
    //             macAddress: "AA:BB:CC:DD:EE:FF",
    //             deviceModel: "FoFi Box Pro"
    //         },
    //         planDetails: {
    //             planId: "PLAN001",
    //             planName: "FTA+SUPER SAVER PACK",
    //             planType: "FTA + DPO",
    //             price: 299,
    //             validity: "90 days",
    //             activationDate: "2025-01-09",
    //             expiryDate: "2025-04-09"
    //         },
    //         subscriptionStatus: "active" | "expired" | "suspended"
    //     }
    // }

    return data;
}

/**
 * Renew or change FoFi plan for existing customer
 * @param {Object} payload - Renewal/change plan data
 * @param {string} payload.customerId - Customer ID
 * @param {string} payload.currentPlanId - Current plan ID
 * @param {string} payload.newPlanId - New plan ID
 * @param {string} payload.action - 'renew' or 'change'
 * @returns {Promise<Object>} Plan change result
 */
export async function changeFoFiPlan(payload) {
    const url = `${getBaseUrl()}ServiceApis/changeFoFiPlan`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to change FoFi plan: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     message: "Plan changed successfully",
    //     data: {
    //         transactionId: "TXN123456",
    //         customerId: "CUST001",
    //         oldPlanId: "PLAN001",
    //         newPlanId: "PLAN002",
    //         effectiveDate: "2025-01-09",
    //         newExpiryDate: "2025-04-09",
    //         amountCharged: 399
    //     }
    // }

    return data;
}

/**
 * Create payment order for FoFi plan
 * @param {Object} payload - Payment order data
 * @param {string} payload.customerId - Customer ID
 * @param {string} payload.planId - Plan ID
 * @param {number} payload.amount - Payment amount
 * @param {string} payload.deviceId - Device ID (for new registration)
 * @param {string} payload.orderType - 'new_registration' | 'renewal' | 'plan_change'
 * @returns {Promise<Object>} Payment order details
 */
export async function createFoFiPaymentOrder(payload) {
    const url = `${getBaseUrl()}ServiceApis/createFoFiPaymentOrder`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to create payment order: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     message: "Payment order created successfully",
    //     data: {
    //         orderId: "ORD123456",
    //         customerId: "CUST001",
    //         amount: 299,
    //         currency: "INR",
    //         paymentGatewayUrl: "https://payment.gateway.com/checkout",
    //         paymentToken: "TOKEN123",
    //         expiresAt: "2025-01-09T11:30:00Z"
    //     }
    // }

    return data;
}

/**
 * Verify payment status after payment completion
 * @param {Object} payload - Payment verification data
 * @param {string} payload.orderId - Order ID
 * @param {string} payload.paymentId - Payment ID from gateway
 * @param {string} payload.customerId - Customer ID
 * @returns {Promise<Object>} Payment verification result
 */
export async function verifyFoFiPayment(payload) {
    const url = `${getBaseUrl()}ServiceApis/verifyFoFiPayment`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to verify payment: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     verified: true,
    //     message: "Payment verified successfully",
    //     data: {
    //         orderId: "ORD123456",
    //         paymentId: "PAY123456",
    //         paymentStatus: "success" | "failed" | "pending",
    //         amount: 299,
    //         paidAt: "2025-01-09T10:45:00Z",
    //         transactionId: "TXN123456"
    //     }
    // }

    return data;
}

/**
 * Process FoFi bill payment for existing customers
 * @param {Object} payload - Bill payment data
 * @param {string} payload.customerId - Customer ID
 * @param {number} payload.amount - Bill amount
 * @param {string} payload.billId - Bill ID
 * @param {string} payload.paymentMethod - Payment method
 * @returns {Promise<Object>} Payment processing result
 */
export async function processFoFiBillPayment(payload) {
    const url = `${getBaseUrl()}ServiceApis/processFoFiBillPayment`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Failed to process bill payment: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     message: "Bill payment processed successfully",
    //     data: {
    //         paymentId: "PAY123456",
    //         billId: "BILL123",
    //         amount: 299,
    //         paymentDate: "2025-01-09",
    //         receiptUrl: "https://api.example.com/receipts/123456.pdf"
    //     }
    // }

    return data;
}

/**
 * Get customer's FoFi payment history
 * @param {Object} payload - Query parameters
 * @param {string} payload.customerId - Customer ID
 * @param {number} [payload.limit] - Number of records to fetch
 * @param {number} [payload.offset] - Offset for pagination
 * @returns {Promise<Object>} Payment history
 */
export async function getFoFiPaymentHistory(payload) {
    const query = new URLSearchParams({
        customerId: payload.customerId,
        limit: payload.limit || 10,
        offset: payload.offset || 0
    }).toString();

    const url = `${getBaseUrl()}ServiceApis/getFoFiPaymentHistory?${query}`;
    const headers = getHeadersJson();

    const resp = await fetch(url, {
        method: "GET",
        headers,
    });

    if (!resp.ok) {
        throw new Error(`Failed to fetch payment history: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Expected response format:
    // {
    //     success: true,
    //     data: {
    //         customerId: "CUST001",
    //         totalRecords: 25,
    //         payments: [
    //             {
    //                 paymentId: "PAY123",
    //                 orderId: "ORD123",
    //                 amount: 299,
    //                 paymentDate: "2025-01-09",
    //                 paymentType: "new_registration" | "renewal" | "bill_payment",
    //                 status: "success",
    //                 receiptUrl: "https://..."
    //             }
    //         ]
    //     }
    // }

    return data;
}
