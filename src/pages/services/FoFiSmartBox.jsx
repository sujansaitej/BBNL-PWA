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
    validateDeviceByQR,
    fetchMACBySerial,
    registerFoFiDevice,
    getFoFiDeviceDetails,
    changeFoFiPlan,
    createFoFiPaymentOrder,
    verifyFoFiPayment,
} from "../../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails } from "../../services/generalApis";

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
                    console.log('✅ All fields in first plan:', plans[0]);
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

            // Validate the scanned QR code with backend
            const response = await validateDeviceByQR({
                qrData: qrData,
                customerId: customerData.customer_id
            });

            if (response.success && response.data) {
                setMacAddress(response.data.macAddress);
                setDeviceInfo(response.data);
                setDeviceValidated(true);
                setView('payment');
            } else {
                setValidationError(response.message || 'Failed to validate device via QR code');
            }
        } catch (error) {
            console.error('QR validation error:', error);
            setValidationError('Failed to validate device. Please try manual entry.');

            // Fallback to mock for development
            setTimeout(() => {
                setDeviceValidated(true);
                setMacAddress('AA:BB:CC:DD:EE:FF');
                setDeviceInfo({
                    multicastDeviceId: 'MC123456789',
                    unicastDeviceId: 'UC987654321',
                    macAddress: 'AA:BB:CC:DD:EE:FF',
                    serialNumber: 'SN_QR_SCAN'
                });
                setView('payment');
            }, 500);
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

            if (response?.status?.err_code === 0 && response?.body) {
                const { mac_addr, serial_number } = response.body;
                
                if (!mac_addr) {
                    setValidationError('MAC address not found for this Box ID');
                    setIsLoading(false);
                    return;
                }

                // Device is available
                setMacAddress(mac_addr);
                setSerialNumber(serial_number || serialNumber);
                setDeviceInfo({
                    macAddress: mac_addr,
                    serialNumber: serial_number || serialNumber,
                    boxId: boxId
                });
                setDeviceValidated(true);
                setValidationMethod('manual');
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

            if (!selectedPlan) {
                setValidationError('Please select a plan first');
                setIsLoading(false);
                return;
            }

            if (!deviceValidated || !macAddress || !deviceInfo) {
                setValidationError('Please validate device first');
                setIsLoading(false);
                return;
            }

            const user = JSON.parse(localStorage.getItem('user'));
            const loginuname = user?.username || 'superadmin';
            const username = customerData?.username || loginuname;

            // First, get customer details
            const cableDetails = await getCableCustomerDetails(username);
            const primaryDetails = await getPrimaryCustomerDetails(username);

            console.log('🟢 Cable Customer Details:', cableDetails);
            console.log('🟢 Primary Customer Details:', primaryDetails);

            const linkResponse = await linkFoFiBox({
                fofiboxid: deviceInfo.boxId,
                fofimac: macAddress,
                fofiserailnumber: deviceInfo.serialNumber,
                loginuname: loginuname,
                plan_id: selectedPlan.id || selectedPlan.plan_id,
                services: ["ott"],
                username: username
            });

            console.log('🟢 Link FoFi Box Response:', linkResponse);

            if (linkResponse?.status?.err_code === 0) {
                alert('FoFi Box linked successfully!');
                setCustomerDetails(cableDetails);
                setPrimaryCustomerDetails(primaryDetails);
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
                <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-teal-500">
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

            {/* Teal Header */}
            <header className="sticky top-0 z-40 flex items-center px-4 py-4 bg-[#1abc9c] shadow-md">
                <button onClick={() => navigate(-1)} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-xl font-medium text-white">Link FO-FI Box</h1>
            </header>

            <div className="flex-1 px-6 py-6 space-y-5 pb-24 max-w-md mx-auto w-full bg-gray-50">
                {/* FOFI Heading */}
                <h2 className="text-xl font-semibold text-[#ff7733]">FOFI</h2>

                {/* Scan From TV Button */}
                <div className="flex justify-center">
                    <button
                        onClick={handleQRScan}
                        disabled={isLoading}
                        className="bg-[#26d0b0] hover:bg-[#1abc9c] disabled:bg-gray-400 text-white font-medium py-2.5 px-5 rounded-md flex items-center gap-2 transition-colors shadow-sm"
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

                {/* FOFI BOX ID Input */}
                <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#ff7733] uppercase tracking-wide">
                        FOFI BOX ID
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={boxId}
                            onChange={(e) => setBoxId(e.target.value)}
                            placeholder=""
                            className="w-full px-3 py-2.5 pr-11 border-2 border-[#ff9966] rounded-md focus:outline-none focus:border-[#ff7733] text-gray-800 bg-white text-sm"
                        />
                        <button className="absolute right-2.5 top-1/2 transform -translate-y-1/2 pointer-events-none">
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* GET MAC ID Button */}
                <div className="flex justify-center py-1">
                    <button
                        onClick={handleFetchMAC}
                        disabled={isLoading || !boxId}
                        className={`bg-[#ff7733] hover:bg-[#ff6622] text-white font-semibold py-2.5 px-8 rounded-md transition-colors uppercase text-sm border-4 border-[#ff7733] shadow-lg ${isLoading || !boxId ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                        {isLoading ? 'Getting MAC...' : 'GET MAC ID'}
                    </button>
                </div>

                {/* Error Message */}
                {validationError && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-red-600">{validationError}</p>
                    </div>
                )}

                {/* FOFI MAC ID Input */}
                <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#26d0b0] uppercase tracking-wide">
                        FOFI MAC ID
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={macAddress}
                            readOnly
                            placeholder=""
                            className="w-full px-3 py-2.5 pr-11 border-2 border-gray-300 rounded-md bg-white text-gray-800 text-sm"
                        />
                        <button className="absolute right-2.5 top-1/2 transform -translate-y-1/2 pointer-events-none">
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Select a Plan Dropdown */}
                <div className="space-y-1.5">
                    <select
                        value={selectedPlan?.srvid || selectedPlan?.plan_id || selectedPlan?.id || ''}
                        onChange={(e) => {
                            const planId = e.target.value;
                            const plan = fofiPlans.find(p => 
                                String(p.srvid) === String(planId) ||
                                String(p.plan_id) === String(planId) || 
                                String(p.id) === String(planId)
                            );
                            console.log('🔵 Selected Plan ID:', planId);
                            console.log('🟢 Found Plan:', plan);
                            setSelectedPlan(plan);
                        }}
                        disabled={isLoading}
                        className="w-full px-3 py-2.5 border-2 border-gray-300 rounded-md focus:outline-none focus:border-[#26d0b0] text-gray-500 bg-white appearance-none cursor-pointer text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                        style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%234b5563'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2.5' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 0.75rem center',
                            backgroundSize: '1.25em 1.25em',
                            paddingRight: '2.5rem'
                        }}
                    >
                        <option value="" disabled>{isLoading ? 'Loading plans...' : 'Select a Plan'}</option>
                        {fofiPlans.map((plan, index) => {
                            // API uses: srvid, serv_name, and possibly rate/price fields
                            const planId = plan.srvid || plan.plan_id || plan.id;
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

                {/* Success Message */}
                {deviceValidated && macAddress && (
                    <div className="bg-green-50 border border-green-200 rounded-md p-3">
                        <p className="text-sm text-green-800 font-medium">✓ Device validated successfully</p>
                        <p className="text-xs text-green-700 mt-1">MAC: {macAddress}</p>
                        {deviceInfo?.serialNumber && (
                            <p className="text-xs text-green-700">Serial: {deviceInfo.serialNumber}</p>
                        )}
                    </div>
                )}

                {/* LINK FO-FI BOX Button */}
                <div className="flex justify-center pt-8">
                    <button
                        onClick={handleLinkFoFiBox}
                        disabled={isLoading || !deviceValidated || !macAddress || !selectedPlan}
                        className={`bg-[#ff7733] hover:bg-[#ff6622] text-white font-bold py-3.5 px-12 rounded-lg transition-colors uppercase text-sm border-4 border-[#ff7733] shadow-lg tracking-wide ${isLoading || !deviceValidated || !macAddress || !selectedPlan ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                        {isLoading ? 'Linking...' : 'LINK FO-FI BOX'}
                    </button>
                </div>
            </div>

            <BottomNav />
        </div>
    );
}

export default FoFiSmartBox;

