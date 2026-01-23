import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { mockCustomerServices, fofiPlans as mockFofiPlans, mockDeviceDatabase } from "../../data";
import BottomNav from "../../components/BottomNav";
import { ServiceSelectionModal } from "@/components/ui";
import QRScanner from "../../components/QRScanner";
import {
    getFoFiPlans,
    getSpecialInternetPlans,
    validateFoFiAsset,
    linkFoFiBox,
    fetchMACBySerial,
    registerFoFiDevice,
    getFoFiDeviceDetails,
    changeFoFiPlan,
    createFoFiPaymentOrder,
    verifyFoFiPayment,
} from "../../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails, getMyPlanDetails } from "../../services/generalApis";

function FoFiSmartBox() {
    const location = useLocation();
    const navigate = useNavigate();

    // Use actual customer data from API (passed from customer list)
    const customerData = location.state?.customer;
    const fromInternet = location.state?.fromInternet;
    const internetId = location.state?.internetId;

    // Use mock data ONLY for service details (new feature)
    const mockServiceData = mockCustomerServices[customerData?.customer_id];
    const fofiService = mockServiceData?.services?.fofi;
    const isExistingUser = fofiService?.active;

    // State management
    const [showServiceModal, setShowServiceModal] = useState(false);
    const [view, setView] = useState(fromInternet ? 'plans' : 'overview'); // Auto navigate to plans if from Internet
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [deviceValidated, setDeviceValidated] = useState(false);
    const [validationMethod, setValidationMethod] = useState(null); // 'qr' or 'manual'
    const [serialNumber, setSerialNumber] = useState('');
    const [boxId, setBoxId] = useState('');
    const [macAddress, setMacAddress] = useState('');
    const [validationError, setValidationError] = useState('');
    const [deviceInfo, setDeviceInfo] = useState(null);
    const [fofiPlans, setFofiPlans] = useState(mockFofiPlans); // Initialize with mock data
    const [isLoading, setIsLoading] = useState(false);
    const [paymentOrderId, setPaymentOrderId] = useState(null);
    const [showQRScanner, setShowQRScanner] = useState(false);
    const [customerDetails, setCustomerDetails] = useState(null);
    const [primaryCustomerDetails, setPrimaryCustomerDetails] = useState(null);
    const [customerInternetPlanId, setCustomerInternetPlanId] = useState(null);

    // Fetch FoFi plans on component mount
    useEffect(() => {
        const loadFoFiPlans = async () => {
            try {
                setIsLoading(true);
                const user = JSON.parse(localStorage.getItem('user'));
                const logUname = user?.username || 'superadmin';

                console.log('🔵 Fetching FoFi Plans with logUname:', logUname);

                const response = await getSpecialInternetPlans({
                    logUname: logUname,
                    isKiranastore: "no"
                });

                console.log('🟢 FoFi Plans API Response:', response);
                console.log('🟢 Response Status:', response?.status);
                console.log('🟢 Response Body (Plans Array):', response?.body);

                // response.body is directly the array of plans, not response.body.planlist
                if (response?.status?.err_code === 0 && Array.isArray(response?.body) && response.body.length > 0) {
                    const plans = response.body;
                    console.log('✅ Setting FoFi Plans from API. Total plans:', plans.length);
                    console.log('✅ First plan object:', plans[0]);
                    console.log('✅ All fields in first plan:', Object.keys(plans[0]));
                    console.log('✅ Plan ID fields check - srvid:', plans[0].srvid, 'plan_id:', plans[0].plan_id, 'planid:', plans[0].planid, 'id:', plans[0].id);
                    setFofiPlans(plans);
                } else {
                    console.warn('⚠️ API response invalid, using mock data');
                    console.log('Response status:', response?.status);
                    setFofiPlans(mockFofiPlans);
                }
            } catch (error) {
                console.error('❌ Failed to fetch FoFi plans:', error);
                console.error('Error details:', error.message);
                console.log('Using mock data as fallback');
                setFofiPlans(mockFofiPlans);
            } finally {
                setIsLoading(false);
            }
        };

        loadFoFiPlans();
    }, []);

    // Fetch customer's current internet plan ID (needed for freeOTAService API)
    useEffect(() => {
        const fetchCustomerInternetPlan = async () => {
            try {
                const user = JSON.parse(localStorage.getItem('user'));
                const userid = customerData?.username || user?.username;
                
                if (!userid) return;

                console.log('🔵 Fetching customer internet plan for userid:', userid);
                
                const planDetails = await getMyPlanDetails({
                    servicekey: "internet",
                    userid: userid,
                    fofiboxid: "",
                    voipnumber: ""
                });

                console.log('🟢 Customer Plan Details:', planDetails);

                // Extract internet plan ID from the response
                if (planDetails?.body?.subscribed_services) {
                    const internetService = planDetails.body.subscribed_services.find(
                        s => s.servicekey === 'internet'
                    );
                    if (internetService?.srvid || internetService?.planid) {
                        const planId = internetService.srvid || internetService.planid;
                        console.log('✅ Found customer internet plan ID:', planId);
                        setCustomerInternetPlanId(planId);
                    }
                }
            } catch (error) {
                console.warn('⚠️ Could not fetch customer internet plan:', error);
            }
        };

        fetchCustomerInternetPlan();
    }, [customerData]);

    // Fetch existing customer's FoFi device details (OPTIONAL - endpoint may not exist)
    useEffect(() => {
        const loadDeviceDetails = async () => {
            if (isExistingUser && customerData?.customer_id) {
                try {
                    // Skip this API call as the endpoint doesn't exist yet
                    // Uncomment when backend implements this endpoint
                    /*
                    const response = await getFoFiDeviceDetails({
                        customerId: customerData.customer_id
                    });
                    if (response.success && response.data) {
                        setDeviceInfo(response.data);
                    }
                    */
                    console.log('ℹ️ Skipping device details fetch - endpoint not yet implemented');
                } catch (error) {
                    console.error('Failed to fetch device details:', error);
                    // Continue with mock data if API fails
                }
            }
        };

        loadDeviceDetails();
    }, [isExistingUser, customerData?.customer_id]);

    // Service navigation handler
    const handleServiceSelect = (service) => {
        if (service) {
            if (service.id === 'voice') {
                navigate(`/customer/${customerData.customer_id}/service/voice`, {
                    state: { customer: customerData }
                });
            } else if (service.id === 'internet') {
                navigate(`/customer/${customerData.customer_id}/service/internet`, {
                    state: { customer: customerData }
                });
            } else if (service.id === 'iptv') {
                navigate(`/customer/${customerData.customer_id}/service/iptv`, {
                    state: { customer: customerData }
                });
            }
            setShowServiceModal(false);
        }
    };

    // Handle Order History button click
    const handleOrderHistory = () => {
        navigate('/payment-history', {
            state: {
                customer: customerData
            }
        });
    };

    // Open QR scanner
    const handleQRScan = () => {
        setShowQRScanner(true);
    };

    // Handle QR code scan result
    const handleQRCodeScanned = async (qrData) => {
        try {
            setShowQRScanner(false);
            setIsLoading(true);
            setValidationError('');
            setValidationMethod('qr');

            console.log('QR Code scanned:', qrData);

            // QR data is base64 encoded JSON: {"emacid":"11:1D:EF:1A:13:9F","firmware":"","serialno":"FOFI201010180020039"}
            let parsedQRData;
            try {
                const decodedData = atob(qrData);
                parsedQRData = JSON.parse(decodedData);
                console.log('Parsed QR data:', parsedQRData);
            } catch (parseError) {
                console.error('Failed to parse QR data:', parseError);
                setValidationError('Invalid QR code format. Please scan a valid FoFi device QR code.');
                setIsLoading(false);
                return;
            }

            // Extract MAC address and serial number from QR data
            const qrMacAddress = parsedQRData.emacid || parsedQRData.macid || '';
            const qrSerialNumber = parsedQRData.serialno || parsedQRData.serial || '';

            if (!qrMacAddress && !qrSerialNumber) {
                setValidationError('QR code does not contain device information.');
                setIsLoading(false);
                return;
            }

            // Validate the asset using existing API
            const response = await validateFoFiAsset({
                mac_addr: qrMacAddress,
                serialno: qrSerialNumber,
                userid: customerData.customer_id,
                boxid: ''
            });

            console.log('validateFoFiAsset response:', response);

            // Extract device data from API response (handle empty array case)
            let deviceData = {};
            if (Array.isArray(response.body) && response.body.length > 0) {
                deviceData = response.body[0];
            } else if (response.body && typeof response.body === 'object' && !Array.isArray(response.body)) {
                deviceData = response.body;
            }

            // Use QR data as primary source since it contains valid device info
            // API validation may fail but QR data is still usable
            const finalMacAddress = qrMacAddress || deviceData?.mac_addr || deviceData?.macAddress || '';
            const finalSerialNumber = qrSerialNumber || deviceData?.serialno || deviceData?.serialNumber || '';
            // Box ID: use API value if available, otherwise use serial number as box ID
            const finalBoxId = deviceData?.boxid || deviceData?.box_id || qrSerialNumber || '';

            console.log('Device info extracted:', {
                macAddress: finalMacAddress,
                serialNumber: finalSerialNumber,
                boxId: finalBoxId,
                apiSuccess: response.status?.err_code === 0
            });

            if (!finalMacAddress || !finalSerialNumber) {
                setValidationError('Could not extract device information from QR code.');
                setIsLoading(false);
                return;
            }

            // Set all device states
            setMacAddress(finalMacAddress);
            setSerialNumber(finalSerialNumber);
            setBoxId(finalBoxId);
            setDeviceInfo({
                multicastDeviceId: deviceData?.multicast_id || deviceData?.multicastDeviceId || '',
                unicastDeviceId: deviceData?.unicast_id || deviceData?.unicastDeviceId || '',
                macAddress: finalMacAddress,
                serialNumber: finalSerialNumber,
                boxId: finalBoxId
            });
            setDeviceValidated(true);
            setView('payment');
        } catch (error) {
            console.error('QR validation error:', error);
            setValidationError('Failed to validate device: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Handle QR scanner error
    const handleQRScanError = (error) => {
        console.error('QR scanner error:', error);
        setValidationError('QR scanner error: ' + error);
    };

    // Handle QR scanner close
    const handleQRScannerClose = () => {
        setShowQRScanner(false);
    };

    // MAC fetch handler with backend integration using validateFoFiAsset API
    const handleFetchMAC = async () => {
        try {
            setValidationError('');
            setIsLoading(true);

            if (!boxId.trim()) {
                setValidationError('Please enter a Box ID');
                setIsLoading(false);
                return;
            }

            const user = JSON.parse(localStorage.getItem('user'));
            const userid = user?.username || customerData?.username || 'superadmin';

            const response = await validateFoFiAsset({
                mac_addr: "",
                serialno: serialNumber || "",
                userid: userid,
                boxid: boxId
            });

            console.log('🟢 Validate Asset Response:', response);
            console.log('🟢 Response Body:', response?.body);
            console.log('🟢 Response Status:', response?.status);

            if (response?.status?.err_code === 0) {
                let extractedMac = '';
                let extractedSerial = '';

                // Try to get MAC from response body first
                if (response?.body) {
                    // Handle both array and object responses
                    const bodyData = Array.isArray(response.body) ? response.body[0] : response.body;
                    extractedMac = bodyData?.mac_addr || bodyData?.macAddress || bodyData?.mac || '';
                    extractedSerial = bodyData?.serial_number || bodyData?.serialNumber || bodyData?.serial || '';
                }

                // If MAC not in body, try to extract from success message
                // Message format: "Fo-Fi device(11:1D:EF:1A:13:9F) belongs to BBNL_OP49 & available"
                if (!extractedMac && response?.status?.err_msg) {
                    const macMatch = response.status.err_msg.match(/\(([0-9A-Fa-f:]{17})\)/);
                    if (macMatch && macMatch[1]) {
                        extractedMac = macMatch[1];
                        console.log('✅ Extracted MAC from message:', extractedMac);
                    }
                }

                if (!extractedMac) {
                    setValidationError('MAC address not found for this Box ID');
                    setIsLoading(false);
                    return;
                }

                // Device is available
                setMacAddress(extractedMac);
                setSerialNumber(extractedSerial || serialNumber);
                setDeviceInfo({
                    macAddress: extractedMac,
                    serialNumber: extractedSerial || serialNumber,
                    boxId: boxId
                });
                setDeviceValidated(true);
                setValidationMethod('manual');

                console.log('✅ Device validated successfully');
                console.log('✅ MAC Address:', extractedMac);
                console.log('✅ Serial Number:', extractedSerial || serialNumber);
            } else {
                setValidationError(response?.status?.err_msg || 'Device not found or invalid Box ID');
            }
        } catch (error) {
            console.error('MAC fetch error:', error);
            setValidationError('Failed to validate device. Please check the Box ID and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Link FoFi Box handler
    const handleLinkFoFiBox = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            // Validate all requirements before proceeding
            if (!selectedPlan) {
                setValidationError('Please select one internet plan from the selection');
                setIsLoading(false);
                return;
            }

            if (!deviceValidated || !macAddress || !deviceInfo) {
                setValidationError('Please get MAC ID first by clicking "GET MAC ID" button');
                setIsLoading(false);
                return;
            }

            if (!boxId) {
                setValidationError('Please enter FO-FI Box ID');
                setIsLoading(false);
                return;
            }

            const user = JSON.parse(localStorage.getItem('user'));
            const loginuname = user?.username || 'superadmin';
            const username = customerData?.username || loginuname;

            // Extract plan_id properly - API expects string format
            // Priority: Use selected plan's srvid, or customer's internet plan ID as fallback
            const planId = String(selectedPlan.srvid || selectedPlan.planid || selectedPlan.plan_id || selectedPlan.id);
            
            console.log('🔵 Selected Plan Object:', selectedPlan);
            console.log('🔵 All plan fields:', Object.keys(selectedPlan));
            console.log('🔵 Extracted Plan ID for API:', planId);
            console.log('🔵 Customer Internet Plan ID:', customerInternetPlanId);

            const linkPayload = {
                fofiboxid: deviceInfo.boxId,
                fofimac: macAddress,
                fofiserailnumber: deviceInfo.serialNumber,
                loginuname: loginuname,
                plan_id: planId,
                services: ["ott"],
                username: username
            };

            console.log('🔵 Link FoFi Box Payload:', JSON.stringify(linkPayload, null, 2));

            // Call linkFoFiBox API first
            const linkResponse = await linkFoFiBox(linkPayload);

            console.log('🟢 Link FoFi Box Response:', linkResponse);

            if (linkResponse?.status?.err_code === 0) {
                // Success - now fetch customer details (optional, don't fail if these fail)
                try {
                    const cableDetails = await getCableCustomerDetails(username);
                    const primaryDetails = await getPrimaryCustomerDetails(username);
                    console.log('🟢 Cable Customer Details:', cableDetails);
                    console.log('🟢 Primary Customer Details:', primaryDetails);
                    setCustomerDetails(cableDetails);
                    setPrimaryCustomerDetails(primaryDetails);
                } catch (detailsError) {
                    console.warn('⚠️ Could not fetch customer details:', detailsError);
                }

                alert('FoFi Box linked successfully!');
                setView('overview');
                // Refresh device details
                setDeviceValidated(false);
                setMacAddress('');
                setSerialNumber('');
                setBoxId('');
                setDeviceInfo(null);
            } else {
                setValidationError(linkResponse?.status?.err_msg || 'Failed to link FoFi box');
            }
        } catch (error) {
            console.error('Link FoFi box error:', error);
            setValidationError('Failed to link FoFi box. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePlanSelect = (plan) => {
        setSelectedPlan(plan);
        // For existing users, skip device validation
        if (isExistingUser) {
            setView('payment');
        } else {
            setView('device-validation');
        }
    };

    // Handle payment for new registration
    const handlePayment = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            // Step 1: Create payment order
            const orderResponse = await createFoFiPaymentOrder({
                customerId: customerData.customer_id,
                planId: selectedPlan.id,
                amount: selectedPlan.price,
                deviceId: deviceInfo?.serialNumber,
                orderType: isExistingUser ? 'renewal' : 'new_registration'
            });

            if (!orderResponse.success) {
                setValidationError(orderResponse.message || 'Failed to create payment order');
                setIsLoading(false);
                return;
            }

            setPaymentOrderId(orderResponse.data.orderId);

            // Step 2: For new users, register the device first
            if (!isExistingUser && deviceInfo) {
                const registerResponse = await registerFoFiDevice({
                    customerId: customerData.customer_id,
                    planId: selectedPlan.id,
                    serialNumber: deviceInfo.serialNumber,
                    macAddress: macAddress,
                    multicastDeviceId: deviceInfo.multicastDeviceId,
                    unicastDeviceId: deviceInfo.unicastDeviceId,
                    validationMethod: validationMethod
                });

                if (!registerResponse.success) {
                    setValidationError(registerResponse.message || 'Failed to register device');
                    setIsLoading(false);
                    return;
                }
            }

            // Step 3: Redirect to payment gateway or handle payment
            // In production, this would redirect to payment gateway
            console.log('Payment order created:', orderResponse.data);

            // For demo: simulate successful payment after 2 seconds
            setTimeout(async () => {
                try {
                    const verifyResponse = await verifyFoFiPayment({
                        orderId: orderResponse.data.orderId,
                        paymentId: 'DEMO_PAYMENT_' + Date.now(),
                        customerId: customerData.customer_id
                    });

                    if (verifyResponse.success && verifyResponse.verified) {
                        alert('Payment successful! Your FoFi Smart Box has been activated.');
                        // Navigate back to customer overview
                        navigate('/customers');
                    } else {
                        setValidationError('Payment verification failed');
                    }
                } catch (verifyError) {
                    console.error('Payment verification error:', verifyError);
                    setValidationError('Failed to verify payment');
                } finally {
                    setIsLoading(false);
                }
            }, 2000);

        } catch (error) {
            console.error('Payment error:', error);
            setValidationError('Failed to process payment. Please try again.');
            setIsLoading(false);
        }
    };

    // Handle plan change for existing users
    const handlePlanChange = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            const response = await changeFoFiPlan({
                customerId: customerData.customer_id,
                currentPlanId: fofiService?.planId,
                newPlanId: selectedPlan.id,
                action: 'change'
            });

            if (response.success) {
                alert('Plan changed successfully!');
                navigate('/customers');
            } else {
                setValidationError(response.message || 'Failed to change plan');
            }
        } catch (error) {
            console.error('Plan change error:', error);
            setValidationError('Failed to change plan. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!customerData) {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50">
                <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                </header>
                <div className="flex-1 px-3 py-4">
                    <div className="text-center text-gray-500 dark:text-gray-400 py-10">
                        No customer data available. Please select a customer from the customer list.
                    </div>
                </div>
                <BottomNav />
            </div>
        );
    }

    // MAIN LINK FO-FI BOX VIEW - Single streamlined page
    return (
        <div className="min-h-screen flex flex-col bg-gray-50">
            {/* QR Scanner Modal */}
            {showQRScanner && (
                <QRScanner
                    onScan={handleQRCodeScanned}
                    onClose={handleQRScannerClose}
                    onError={handleQRScanError}
                />
            )}

            {/* Blue Gradient Header */}
            <header className="sticky top-0 z-40 flex items-center px-4 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                <button onClick={() => navigate(-1)} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-xl font-medium text-white">Link FO-FI Box</h1>
            </header>

            <div className="flex-1 px-6 py-6 space-y-6 pb-24 max-w-md mx-auto w-full bg-gray-50">
                {/* FOFI Heading with gradient accent */}
                <div className="flex items-center gap-3">
                    <div className="w-1 h-8 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                    <h2 className="text-2xl font-bold text-indigo-600">FOFI</h2>
                </div>

                {/* Scan From TV Button with gradient */}
                <div className="flex justify-center">
                    <button
                        onClick={handleQRScan}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 text-white font-semibold py-3 px-6 rounded-lg flex items-center gap-2 transition-all duration-200 shadow-md hover:shadow-lg"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Scan From TV
                    </button>
                </div>

                {/* OR Divider */}
                <div className="flex items-center justify-center py-1">
                    <span className="text-gray-400 font-normal text-sm">OR</span>
                </div>

                {/* FOFI BOX ID Input with enhanced styling */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-indigo-600">
                        FOFI BOX ID
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={boxId}
                            onChange={(e) => setBoxId(e.target.value)}
                            placeholder="Enter FO-FI Box ID"
                            className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 bg-white transition-all duration-200"
                        />
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* GET MAC ID Button - Blue gradient matching UI design */}
                <div className="flex justify-center py-2">
                    <button
                        onClick={handleFetchMAC}
                        disabled={isLoading || !boxId}
                        className={`bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-3 px-12 rounded-xl transition-all duration-200 uppercase text-sm shadow-md hover:shadow-lg ${isLoading || !boxId ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isLoading ? 'Getting MAC...' : 'GET MAC ID'}
                    </button>
                </div>

                {/* Instructions Card - Show when plan not selected */}
                {!selectedPlan && !validationError && (
                    <div className="bg-blue-50 border-l-4 border-blue-500 rounded-lg p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                            <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="text-sm font-semibold text-blue-800">Steps to link your FO-FI Box:</p>
                                <ol className="text-xs text-blue-700 mt-2 space-y-1 list-decimal list-inside">
                                    <li>Enter your FO-FI Box ID or scan QR from TV</li>
                                    <li>Click "GET MAC ID" to fetch device details</li>
                                    <li><strong>Select an internet plan from the dropdown</strong></li>
                                    <li>Click "LINK FO-FI BOX" to complete</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error Message with better styling */}
                {validationError && (
                    <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <p className="text-sm font-medium text-red-700">{validationError}</p>
                        </div>
                    </div>
                )}

                {/* FOFI MAC ID Input with enhanced styling */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-indigo-600">
                        FOFI MAC ID
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={macAddress}
                            readOnly
                            placeholder="MAC address will appear here"
                            className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg bg-gray-50 text-gray-700 font-mono text-sm"
                        />
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* Select a Plan Dropdown with enhanced styling */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-indigo-600">
                        Select a Plan <span className="text-red-500">*</span>
                        {selectedPlan && (
                            <span className="ml-2 text-xs font-normal text-green-600">✓ Plan selected</span>
                        )}
                    </label>
                    <select
                        value={selectedPlan?.srvid || selectedPlan?.plan_id || selectedPlan?.id || ''}
                        onChange={(e) => {
                            const planId = e.target.value;
                            const plan = fofiPlans.find(p =>
                                String(p.planid) === String(planId) ||
                                String(p.plan_id) === String(planId) ||
                                String(p.srvid) === String(planId) ||
                                String(p.id) === String(planId)
                            );
                            console.log('🔵 Selected Plan ID:', planId);
                            console.log('🟢 Found Plan:', plan);
                            console.log('🟢 Plan fields - srvid:', plan?.srvid, 'planid:', plan?.planid, 'plan_id:', plan?.plan_id);
                            setSelectedPlan(plan);
                            // Clear validation error when plan is selected
                            if (plan && validationError === 'Please select one internet plan from the selection') {
                                setValidationError('');
                            }
                        }}
                        disabled={isLoading}
                        className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700 bg-white appearance-none cursor-pointer disabled:bg-gray-100 disabled:cursor-not-allowed transition-all duration-200 ${
                            !selectedPlan ? 'border-orange-400 focus:border-orange-500' : 'border-gray-300 focus:border-indigo-500'
                        }`}
                        style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%234f46e5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2.5' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 0.75rem center',
                            backgroundSize: '1.5em 1.5em',
                            paddingRight: '2.5rem'
                        }}
                    >
                        <option value="" disabled>{isLoading ? 'Loading plans...' : 'Select a Plan'}</option>
                        {fofiPlans.map((plan, index) => {
                            // Try multiple possible ID fields - planid is often the correct one for API calls
                            const planId = plan.planid || plan.plan_id || plan.srvid || plan.id;
                            const planName = plan.serv_name || plan.planname || plan.name;
                            const planPrice = plan.rate || plan.planrate || plan.price || '';

                            return (
                                <option key={planId || index} value={planId}>
                                    {planName}{planPrice ? ` - ₹${planPrice}` : ''}
                                </option>
                            );
                        })}
                    </select>
                </div>

                {/* Success Message with enhanced styling */}
                {deviceValidated && macAddress && (
                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-l-4 border-green-500 rounded-lg p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="text-sm font-semibold text-green-800">Device validated successfully</p>
                                <p className="text-xs text-green-700 mt-1 font-mono">MAC: {macAddress}</p>
                                {deviceInfo?.serialNumber && (
                                    <p className="text-xs text-green-700 font-mono">Serial: {deviceInfo.serialNumber}</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* LINK FO-FI BOX Button with gradient */}
                <div className="flex justify-center pt-4">
                    <button
                        onClick={handleLinkFoFiBox}
                        disabled={isLoading || !deviceValidated || !macAddress || !selectedPlan}
                        className={`bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-4 px-16 rounded-lg transition-all duration-200 uppercase text-sm shadow-lg hover:shadow-xl tracking-wide ${isLoading || !deviceValidated || !macAddress || !selectedPlan ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!selectedPlan ? 'Please select a plan first' : !deviceValidated ? 'Please get MAC ID first' : 'Click to link FO-FI Box'}
                    >
                        {isLoading ? 'Linking...' : 'LINK FO-FI BOX'}
                    </button>
                </div>
                
                {/* Status indicators below button */}
                {(!deviceValidated || !macAddress || !selectedPlan) && (
                    <div className="text-center text-xs text-gray-500 space-y-1">
                        <p className="flex items-center justify-center gap-2">
                            {boxId ? '✓' : '○'} <span>Enter Box ID</span>
                        </p>
                        <p className="flex items-center justify-center gap-2">
                            {deviceValidated && macAddress ? '✓' : '○'} <span>Get MAC ID</span>
                        </p>
                        <p className="flex items-center justify-center gap-2">
                            {selectedPlan ? '✓' : '○'} <span>Select Plan</span>
                        </p>
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
}

export default FoFiSmartBox;

