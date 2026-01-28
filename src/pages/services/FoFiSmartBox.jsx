import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon, ExclamationCircleIcon, MagnifyingGlassIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { mockCustomerServices, fofiPlans as mockFofiPlans, mockDeviceDatabase } from "../../data";
import BottomNav from "../../components/BottomNav";
import { ServiceSelectionModal, Badge, Loader } from "@/components/ui";
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
    validateBeforeFofiBoxReg,
    getFofiUpgradePlans,
} from "../../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails, getMyPlanDetails, getCustKYCPreview, getUserAssignedItems } from "../../services/generalApis";

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
    // View states: 'overview' (customer details), 'link-fofi' (link device form), 'upgrade-plans' (upgrade plans list)
    const [view, setView] = useState('overview'); // Always start with overview
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [deviceValidated, setDeviceValidated] = useState(false);
    const [showValidationSuccess, setShowValidationSuccess] = useState(false);
    const [validationMethod, setValidationMethod] = useState(null); // 'qr' or 'manual'
    const [serialNumber, setSerialNumber] = useState('');
    const [boxId, setBoxId] = useState('');
    const [macAddress, setMacAddress] = useState('');
    const [validationError, setValidationError] = useState('');
    const [deviceInfo, setDeviceInfo] = useState(null);
    const [fofiPlans, setFofiPlans] = useState(mockFofiPlans); // Initialize with mock data
    const [isLoading, setIsLoading] = useState(false);
    const [isOverviewLoading, setIsOverviewLoading] = useState(true); // Loading state for overview data
    const [paymentOrderId, setPaymentOrderId] = useState(null);
    const [showQRScanner, setShowQRScanner] = useState(false);
    const [customerDetails, setCustomerDetails] = useState(null);
    const [primaryCustomerDetails, setPrimaryCustomerDetails] = useState(null);
    const [customerInternetPlanId, setCustomerInternetPlanId] = useState(null);
    // FoFi service status - will be validated by API response
    const [hasFofiService, setHasFofiService] = useState(false); // false = new user, true = existing user
    const [fofiServiceDetails, setFofiServiceDetails] = useState(null); // Existing FoFi service details
    const [fofiAssignedItems, setFofiAssignedItems] = useState(null); // FoFi assigned items from API
    
    // Upgrade Plans state
    const [upgradePlans, setUpgradePlans] = useState([]);
    const [filteredUpgradePlans, setFilteredUpgradePlans] = useState([]);
    const [upgradePlansLoading, setUpgradePlansLoading] = useState(false);
    const [upgradePlansError, setUpgradePlansError] = useState('');
    const [upgradeSearchTerm, setUpgradeSearchTerm] = useState('');

    // =====================================================
    // FETCH CUSTOMER OVERVIEW DATA ON COMPONENT MOUNT
    // APIs called: getUserAssignedItems, cblCustDet, primaryCustdet
    // =====================================================
    useEffect(() => {
        const fetchCustomerOverviewData = async () => {
            if (!customerData) return;

            const userid = customerData?.username || customerData?.customer_id;
            console.log('🔵 [FoFi SmartBox] Starting to fetch customer overview data...');
            console.log('🔵 [FoFi SmartBox] Customer Data:', customerData);
            console.log('🔵 [FoFi SmartBox] User ID:', userid);

            setIsOverviewLoading(true);

            try {
                // Call all 3 APIs in parallel for better performance
                console.log('🔵 [FoFi SmartBox] Calling APIs in parallel...');
                
                const [assignedItemsResponse, cableDetailsResponse, primaryDetailsResponse] = await Promise.all([
                    // API 1: getUserAssignedItems - Check if user has FoFi service
                    getUserAssignedItems('fofi', userid).catch(err => {
                        console.error('❌ [FoFi SmartBox] getUserAssignedItems API failed:', err);
                        return null;
                    }),
                    // API 2: cblCustDet - Get cable customer details
                    getCableCustomerDetails(userid).catch(err => {
                        console.error('❌ [FoFi SmartBox] getCableCustomerDetails API failed:', err);
                        return null;
                    }),
                    // API 3: primaryCustdet - Get primary customer details
                    getPrimaryCustomerDetails(userid).catch(err => {
                        console.error('❌ [FoFi SmartBox] getPrimaryCustomerDetails API failed:', err);
                        return null;
                    })
                ]);

                // Log API responses
                console.log('🟢 [FoFi SmartBox] getUserAssignedItems Response:', assignedItemsResponse);
                console.log('🟢 [FoFi SmartBox] getCableCustomerDetails Response:', cableDetailsResponse);
                console.log('🟢 [FoFi SmartBox] getPrimaryCustomerDetails Response:', primaryDetailsResponse);

                // Process getUserAssignedItems response
                if (assignedItemsResponse) {
                    setFofiAssignedItems(assignedItemsResponse);
                    
                    // Check if user has FoFi service based on response
                    // If body contains fofi items, user has the service
                    const fofiItems = assignedItemsResponse?.body?.fofi;
                    console.log('🔵 [FoFi SmartBox] FoFi Items from API:', fofiItems);
                    
                    if (fofiItems && Array.isArray(fofiItems) && fofiItems.length > 0) {
                        // User has existing FoFi service
                        console.log('✅ [FoFi SmartBox] User has EXISTING FoFi service');
                        setHasFofiService(true);
                        setFofiServiceDetails({
                            boxId: fofiItems[0]?.fofiboxid || fofiItems[0]?.boxid || fofiItems[0]?.product_name || 'N/A',
                            planName: fofiItems[0]?.planname || fofiItems[0]?.plan_name || 'N/A',
                            expiryDate: fofiItems[0]?.expirydate || fofiItems[0]?.expiry_date || 'N/A',
                            macAddress: fofiItems[0]?.macid || fofiItems[0]?.mac_addr || 'N/A',
                            status: fofiItems[0]?.status || 'Active'
                        });
                    } else {
                        // User does not have FoFi service - NEW USER
                        console.log('ℹ️ [FoFi SmartBox] User is NEW - No FoFi service found');
                        setHasFofiService(false);
                        setFofiServiceDetails(null);
                    }
                }

                // Store cable and primary customer details
                if (cableDetailsResponse) {
                    setCustomerDetails(cableDetailsResponse);
                    console.log('✅ [FoFi SmartBox] Cable customer details stored');
                }

                if (primaryDetailsResponse) {
                    setPrimaryCustomerDetails(primaryDetailsResponse);
                    console.log('✅ [FoFi SmartBox] Primary customer details stored');
                }

            } catch (error) {
                console.error('❌ [FoFi SmartBox] Error fetching customer overview data:', error);
            } finally {
                setIsOverviewLoading(false);
                console.log('✅ [FoFi SmartBox] Finished fetching customer overview data');
            }
        };

        fetchCustomerOverviewData();
    }, [customerData]);

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

    // Auto-hide device validation success message after 3 seconds
    useEffect(() => {
        if (showValidationSuccess) {
            const timer = setTimeout(() => {
                setShowValidationSuccess(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [showValidationSuccess]);

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

    // Handle Upload Document button click
    const handleUploadDocument = async () => {
        try {
            setIsLoading(true);
            const cid = customerData?.customer_id || customerData?.username;
            const response = await getCustKYCPreview({ cid, reqtype: 'update' });

            if (response?.status?.err_code === 0) {
                navigate('/upload-documents', {
                    state: {
                        customer: customerData,
                        kycData: response.body
                    }
                });
            } else {
                alert('Failed to load documents: ' + (response?.status?.err_msg || 'Unknown error'));
            }
        } catch (err) {
            console.error('Error loading document preview:', err);
            alert('Failed to load documents. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // =====================================================
    // UPGRADE BUTTON HANDLER - Fetch upgrade plans and show services screen
    // APIs called: validateBeforeFofiBoxReg, cblCustDet, primaryCustdet, registrationNecessities
    // =====================================================
    const handleUpgradeClick = async () => {
        const userid = customerData?.username || customerData?.customer_id;
        const user = JSON.parse(localStorage.getItem('user'));
        const logUname = user?.username || 'superadmin';

        console.log('🔵 [UPGRADE] Starting upgrade flow...');
        console.log('🔵 [UPGRADE] User ID:', userid);
        console.log('🔵 [UPGRADE] Log Username:', logUname);

        setUpgradePlansLoading(true);
        setUpgradePlansError('');
        setUpgradePlans([]);
        setFilteredUpgradePlans([]);
        setUpgradeSearchTerm('');

        try {
            // API 1: validateBeforeFofiBoxReg - Validate before registration
            console.log('🔵 [UPGRADE] Step 1: Calling validateBeforeFofiBoxReg...');
            const validateResponse = await validateBeforeFofiBoxReg({
                username: userid,
                loginuname: logUname
            });
            console.log('🟢 [UPGRADE] validateBeforeFofiBoxReg Response:', validateResponse);

            // Check if validation passed
            if (validateResponse?.status?.err_code !== 0) {
                const errorMsg = validateResponse?.status?.err_msg || 'Validation failed. Please try again.';
                console.error('❌ [UPGRADE] Validation failed:', errorMsg);
                setUpgradePlansError(errorMsg);
                setUpgradePlansLoading(false);
                return;
            }

            // API 2 & 3: cblCustDet and primaryCustdet (already called on mount, but call again for fresh data)
            console.log('🔵 [UPGRADE] Step 2: Calling cblCustDet and primaryCustdet...');
            const [cableDetailsResponse, primaryDetailsResponse] = await Promise.all([
                getCableCustomerDetails(userid).catch(err => {
                    console.error('❌ [UPGRADE] getCableCustomerDetails failed:', err);
                    return null;
                }),
                getPrimaryCustomerDetails(userid).catch(err => {
                    console.error('❌ [UPGRADE] getPrimaryCustomerDetails failed:', err);
                    return null;
                })
            ]);
            console.log('🟢 [UPGRADE] cblCustDet Response:', cableDetailsResponse);
            console.log('🟢 [UPGRADE] primaryCustdet Response:', primaryDetailsResponse);

            // API 4: registrationNecessities with moduletype="upgradation"
            console.log('🔵 [UPGRADE] Step 3: Calling registrationNecessities for upgrade plans...');
            const plansResponse = await getFofiUpgradePlans({
                logUname: logUname,
                moduletype: "upgradation",
                userid: userid
            });
            console.log('🟢 [UPGRADE] registrationNecessities Response:', plansResponse);

            // Process plans from response
            if (plansResponse?.status?.err_code === 0) {
                // Plans can be in different locations based on API response structure
                const plans = plansResponse?.body?.internet_plans || 
                              plansResponse?.body?.plans || 
                              plansResponse?.body?.fofi_plans ||
                              plansResponse?.body ||
                              [];
                
                console.log('✅ [UPGRADE] Plans found:', plans.length);
                console.log('✅ [UPGRADE] Plans data:', plans);

                if (Array.isArray(plans) && plans.length > 0) {
                    setUpgradePlans(plans);
                    setFilteredUpgradePlans(plans);
                    setView('upgrade-plans');
                } else {
                    setUpgradePlansError('No upgrade plans available at the moment.');
                }
            } else {
                const errorMsg = plansResponse?.status?.err_msg || 'Failed to fetch upgrade plans.';
                console.error('❌ [UPGRADE] Plans fetch failed:', errorMsg);
                setUpgradePlansError(errorMsg);
            }
        } catch (error) {
            console.error('❌ [UPGRADE] Error in upgrade flow:', error);
            setUpgradePlansError('An error occurred while fetching upgrade plans. Please try again.');
        } finally {
            setUpgradePlansLoading(false);
        }
    };

    // Filter upgrade plans based on search term
    const handleUpgradeSearch = (term) => {
        setUpgradeSearchTerm(term);
        if (!term) {
            setFilteredUpgradePlans(upgradePlans);
            return;
        }

        const lowerTerm = term.toLowerCase();
        const filtered = upgradePlans.filter(plan =>
            plan.serv_name?.toLowerCase().includes(lowerTerm) ||
            plan.serv_desc?.toLowerCase().includes(lowerTerm) ||
            plan.plan_name?.toLowerCase().includes(lowerTerm) ||
            (plan.serv_rates?.prices && plan.serv_rates.prices.some(price => price.toString().includes(term)))
        );
        setFilteredUpgradePlans(filtered);
    };

    // Select an upgrade plan
    const handleUpgradePlanSelect = (plan) => {
        console.log('🔵 [UPGRADE] Plan selected:', plan);
        setSelectedPlan(plan);
        // Navigate to link-fofi view with selected plan
        setView('link-fofi');
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

            console.log('🔵 QR Code scanned:', qrData);

            // QR data is base64 encoded JSON: {"emacid":"11:1D:EF:1A:13:9F","firmware":"","serialno":"FOFI201010180020039"}
            let parsedQRData;
            try {
                const decodedData = atob(qrData);
                parsedQRData = JSON.parse(decodedData);
                console.log('🟢 Parsed QR data:', parsedQRData);
            } catch (parseError) {
                console.error('❌ Failed to parse QR data:', parseError);
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

            console.log('🔵 Calling validateAsset API with MAC:', qrMacAddress, 'Serial:', qrSerialNumber);

            // Get logged in user for API call
            const user = JSON.parse(localStorage.getItem('user'));
            const userid = user?.username || customerData?.username || 'superadmin';

            // Validate the asset using validateAsset API (multi-purpose API)
            // Input: MAC Address & Serial Number → Output: Box ID
            const response = await validateFoFiAsset({
                mac_addr: qrMacAddress,
                serialno: qrSerialNumber,
                userid: userid,
                boxid: ''
            });

            console.log('🟢 validateFoFiAsset response:', response);
            console.log('🟢 Response Status:', response?.status);
            console.log('🟢 Response Body:', response?.body);

            // Check if API validation was successful
            if (response?.status?.err_code !== 0) {
                // API validation failed - show error message from API
                setValidationError(response?.status?.err_msg || 'Device validation failed. Please try again.');
                setIsLoading(false);
                return;
            }

            // Extract device data from API response
            let deviceData = {};
            if (Array.isArray(response.body) && response.body.length > 0) {
                deviceData = response.body[0];
            } else if (response.body && typeof response.body === 'object' && !Array.isArray(response.body)) {
                deviceData = response.body;
            }

            console.log('🟢 Device data from API:', deviceData);

            // Extract Box ID from API response or success message
            let extractedBoxId = deviceData?.boxid || deviceData?.box_id || deviceData?.fofiboxid || '';

            // Try to extract Box ID from success message if not in body
            // Message format might contain box ID information
            if (!extractedBoxId && response?.status?.err_msg) {
                // Check if serial number can be used as box ID (common pattern)
                const msgLower = response.status.err_msg.toLowerCase();
                if (msgLower.includes('available') || msgLower.includes('belongs to')) {
                    // Device is valid, use serial number as box ID if not provided
                    extractedBoxId = qrSerialNumber;
                }
            }

            // Final values - prioritize API response, fallback to QR data
            const finalMacAddress = deviceData?.mac_addr || deviceData?.macAddress || qrMacAddress;
            const finalSerialNumber = deviceData?.serialno || deviceData?.serialNumber || deviceData?.serial_number || qrSerialNumber;
            const finalBoxId = extractedBoxId || qrSerialNumber;

            console.log('✅ Final device info:', {
                macAddress: finalMacAddress,
                serialNumber: finalSerialNumber,
                boxId: finalBoxId
            });

            if (!finalMacAddress) {
                setValidationError('Could not retrieve MAC address from device validation.');
                setIsLoading(false);
                return;
            }

            // Populate all input fields with validated data
            setBoxId(finalBoxId);
            setMacAddress(finalMacAddress);
            setSerialNumber(finalSerialNumber);
            setDeviceInfo({
                multicastDeviceId: deviceData?.multicast_id || deviceData?.multicastDeviceId || '',
                unicastDeviceId: deviceData?.unicast_id || deviceData?.unicastDeviceId || '',
                macAddress: finalMacAddress,
                serialNumber: finalSerialNumber,
                boxId: finalBoxId
            });
            setDeviceValidated(true);
            setShowValidationSuccess(true);
            // Stay on the same view so user can see populated fields and select plan
        } catch (error) {
            console.error('❌ QR validation error:', error);
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
                setShowValidationSuccess(true);
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

    // =====================================================
    // CUSTOMER OVERVIEW VIEW - Shows customer details and service status
    // Matches Internet module UI/UX exactly
    // =====================================================
    if (view === 'overview') {
        // Get customer details from API response or fallback to passed customerData
        const displayUsername = primaryCustomerDetails?.body?.username || 
                               customerDetails?.body?.username || 
                               customerData?.username || 
                               customerData?.customer_id || 'N/A';
        const displayName = primaryCustomerDetails?.body?.custname || 
                           primaryCustomerDetails?.body?.name ||
                           customerDetails?.body?.custname ||
                           customerDetails?.body?.name ||
                           customerData?.name || 
                           customerData?.customer_name || 'N/A';
        const displayPhone = primaryCustomerDetails?.body?.mobile || 
                            primaryCustomerDetails?.body?.phone ||
                            customerDetails?.body?.mobile ||
                            customerDetails?.body?.contactno ||
                            customerData?.mobile || 
                            customerData?.phone || 'N/A';
        const displayEmail = primaryCustomerDetails?.body?.email || 
                            customerDetails?.body?.email ||
                            customerData?.email || 'N/A';

        console.log('📊 [FoFi SmartBox] Overview Display Data:', {
            username: displayUsername,
            name: displayName,
            phone: displayPhone,
            email: displayEmail,
            hasFofiService: hasFofiService,
            isOverviewLoading: isOverviewLoading
        });

        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                {/* Header - Matching Internet module exactly */}
                <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                </header>

                <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
                    {/* Loading State */}
                    {isOverviewLoading ? (
                        <div className="flex flex-col items-center justify-center py-20">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
                            <p className="text-gray-500 text-sm">Loading customer details...</p>
                        </div>
                    ) : (
                        <>
                            {/* User Details - Matching Internet module */}
                            <div className="space-y-3">
                                <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                    <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                    User Details
                                </h3>
                                <div className="space-y-1 text-sm">
                                    <div className="flex">
                                        <span className="w-36 text-gray-600 dark:text-gray-400">Username</span>
                                        <span className="text-gray-600 dark:text-gray-400">: {displayUsername}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 text-gray-600 dark:text-gray-400">Customer Name</span>
                                        <span className="text-gray-600 dark:text-gray-400">: {displayName}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 text-gray-600 dark:text-gray-400">Ph Number</span>
                                        <span className="text-gray-600 dark:text-gray-400">: {displayPhone}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 text-gray-600 dark:text-gray-400">Email Id</span>
                                        <span className="text-gray-600 dark:text-gray-400">: {displayEmail}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons - Matching Internet module */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleUploadDocument}
                                    disabled={isLoading}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? 'Loading...' : 'Upload Document'}
                                </button>
                                <button
                                    onClick={handleOrderHistory}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-all duration-200 shadow-md hover:shadow-lg"
                                >
                                    Order History
                                </button>
                            </div>

                            {/* Filter Badge - Matching Internet module */}
                            <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 -mx-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-base text-indigo-600 font-semibold">Filtered by :</span>
                                    <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-md">
                                        FOFI Smart Box
                                    </span>
                                </div>
                                <button className="text-indigo-600 hover:text-indigo-700 transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                </button>
                            </div>

                            {/* Service Status Section */}
                            {!hasFofiService ? (
                                // NEW USER - Not opted for FoFi service
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <p className="text-gray-600 dark:text-gray-400 text-center text-sm mb-6">
                                        Selected Customer have not opted<br />for this Service
                                    </p>
                                    <button
                                        onClick={handleUpgradeClick}
                                        disabled={upgradePlansLoading}
                                        className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-10 rounded-lg text-sm uppercase tracking-wide transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {upgradePlansLoading ? 'Loading...' : 'UPGRADE'}
                                    </button>
                                    {upgradePlansError && (
                                        <p className="text-red-500 text-sm mt-3 text-center">{upgradePlansError}</p>
                                    )}
                                </div>
                            ) : (
                                // EXISTING USER - Has FoFi service
                                <div className="flex-1 flex flex-col py-4">
                                    {/* Active Status Banner */}
                                    <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded-lg p-4 mb-6">
                                        <div className="flex items-start gap-3">
                                            <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                            <div>
                                                <p className="text-sm font-semibold text-green-800 dark:text-green-300">FoFi Service Active</p>
                                                <p className="text-xs text-green-700 dark:text-green-400 mt-1">Your FoFi Smart Box subscription is currently active.</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Service Details Card */}
                                    {fofiServiceDetails && (
                                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-6">
                                            <div className="flex items-center gap-2 mb-4">
                                                <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                                <h3 className="text-indigo-600 dark:text-indigo-400 font-semibold text-lg">Current Plan Details</h3>
                                            </div>
                                            <div className="space-y-3">
                                                <div className="flex items-center">
                                                    <span className="w-36 text-gray-600 dark:text-gray-400 text-sm">Plan</span>
                                                    <span className="text-gray-800 dark:text-white font-medium text-sm">{fofiServiceDetails.planName || 'N/A'}</span>
                                                </div>
                                                <div className="flex items-center">
                                                    <span className="w-36 text-gray-600 dark:text-gray-400 text-sm">Box ID</span>
                                                    <span className="text-gray-800 dark:text-white font-medium text-sm">{fofiServiceDetails.boxId || 'N/A'}</span>
                                                </div>
                                                <div className="flex items-center">
                                                    <span className="w-36 text-gray-600 dark:text-gray-400 text-sm">MAC Address</span>
                                                    <span className="text-gray-800 dark:text-white font-medium text-sm">{fofiServiceDetails.macAddress || 'N/A'}</span>
                                                </div>
                                                <div className="flex items-center">
                                                    <span className="w-36 text-gray-600 dark:text-gray-400 text-sm">Expiry Date</span>
                                                    <span className="text-gray-800 dark:text-white font-medium text-sm">{fofiServiceDetails.expiryDate || 'N/A'}</span>
                                                </div>
                                                <div className="flex items-center">
                                                    <span className="w-36 text-gray-600 dark:text-gray-400 text-sm">Status</span>
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                                        <span className="text-green-600 dark:text-green-400 font-medium text-sm">{fofiServiceDetails.status || 'Active'}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Upgrade Button */}
                                    <div className="flex justify-center mt-4">
                                        <button
                                            onClick={handleUpgradeClick}
                                            disabled={upgradePlansLoading}
                                            className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-12 rounded-full text-sm uppercase tracking-wide transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {upgradePlansLoading ? 'Loading...' : 'UPGRADE PLAN'}
                                        </button>
                                    </div>
                                    {upgradePlansError && (
                                        <p className="text-red-500 text-sm mt-3 text-center">{upgradePlansError}</p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // UPGRADE PLANS VIEW - Show available upgrade plans/services
    // =====================================================
    if (view === 'upgrade-plans') {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                {/* Header - Blue/Indigo gradient matching app theme */}
                <header className="sticky top-0 z-40 flex items-center px-4 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                    <button onClick={() => setView('overview')} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-white">Services</h1>
                </header>

                <div className="flex-1 px-4 py-4 space-y-4 pb-24 max-w-2xl mx-auto w-full">
                    {/* Search Input - Matching app theme */}
                    <div className="relative w-full">
                        <input
                            type="text"
                            placeholder="Search Plans"
                            value={upgradeSearchTerm}
                            onChange={(e) => handleUpgradeSearch(e.target.value)}
                            className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                        />
                        <MagnifyingGlassIcon className="h-5 w-5 absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>

                    {/* All Services Section Header - Matching app theme */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-base">All Services</span>
                            {!upgradePlansLoading && (
                                <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">
                                    {filteredUpgradePlans.length}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Loading State */}
                    {upgradePlansLoading && (
                        <div className="flex justify-center py-10">
                            <Loader size={10} color="indigo" text="Loading plans..." />
                        </div>
                    )}

                    {/* Error State */}
                    {upgradePlansError && !upgradePlansLoading && (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-lg p-4">
                            <p className="text-red-700 dark:text-red-400 text-sm">{upgradePlansError}</p>
                        </div>
                    )}

                    {/* Plans List */}
                    {!upgradePlansLoading && filteredUpgradePlans.length > 0 && (
                        <div className="space-y-3">
                            {filteredUpgradePlans.map((plan, index) => {
                                // Handle different API response structures
                                const planName = plan.serv_name || plan.plan_name || plan.name || 'Unknown Plan';
                                const planPrice = plan.serv_rates?.prices?.[0] || plan.price || plan.amount || '0';
                                const planLabel = plan.serv_rates?.labels?.[0] || '';
                                const planId = plan.servid || plan.srvid || plan.plan_id || plan.id || index;

                                return (
                                    <div
                                        key={planId}
                                        onClick={() => handleUpgradePlanSelect(plan)}
                                        className="relative flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-all duration-200 overflow-hidden"
                                    >
                                        {/* Special Offer Ribbon - Always shown */}
                                        <div className="absolute top-0 right-0">
                                            <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold px-3 py-1 shadow-md uppercase tracking-wide" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 10% 100%)' }}>
                                                SPECIAL OFFER
                                            </div>
                                        </div>

                                        {/* Plan Details */}
                                        <div className="flex-1 pr-20">
                                            <p className="font-medium text-gray-800 dark:text-white text-base">{planName}</p>
                                            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                                                {import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL || '₹'}{planPrice}
                                            </p>
                                        </div>

                                        {/* Arrow Icon */}
                                        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Empty State */}
                    {!upgradePlansLoading && !upgradePlansError && filteredUpgradePlans.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10">
                            <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400 text-center text-sm">No plans found matching your search.</p>
                            <button 
                                onClick={() => { setUpgradeSearchTerm(''); setFilteredUpgradePlans(upgradePlans); }}
                                className="mt-3 text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:underline"
                            >
                                Clear search
                            </button>
                        </div>
                    )}
                </div>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // LINK FO-FI BOX VIEW - Device linking form
    // =====================================================
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
                <button onClick={() => setView('overview')} className="p-1 mr-3">
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

                {/* Error Message Popup Modal */}
                <AnimatePresence>
                    {validationError && (
                        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 px-4">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: -20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                            >
                                {/* Gradient Header */}
                                <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4 flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-white">Error</h3>
                                    <button
                                        onClick={() => setValidationError('')}
                                        className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-all duration-200"
                                    >
                                        <XMarkIcon className="h-6 w-6" />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="p-8">
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                                        className="flex justify-center mb-6"
                                    >
                                        <div className="bg-gradient-to-br from-red-100 to-red-200 rounded-full p-4">
                                            <ExclamationCircleIcon className="h-16 w-16 text-red-500" />
                                        </div>
                                    </motion.div>

                                    <p className="text-gray-700 text-center text-base leading-relaxed mb-6">
                                        {validationError}
                                    </p>

                                    {/* Action Button */}
                                    <button
                                        onClick={() => setValidationError('')}
                                        className="w-full px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
                                    >
                                        OK
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                {/* FOFI MAC ID Input - Editable for Flow 2 */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-indigo-600">
                        FOFI MAC ID
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={macAddress}
                            onChange={(e) => setMacAddress(e.target.value)}
                            placeholder="Enter MAC Address or fetch via Box ID"
                            className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 bg-white font-mono text-sm transition-all duration-200"
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
                            <span className="ml-2 text-xs font-normal text-purple-600">✓ Plan selected</span>
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
                {showValidationSuccess && macAddress && (
                    <div className="bg-gradient-to-r from-purple-50 to-violet-50 border-l-4 border-purple-500 rounded-lg p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-purple-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="text-sm font-semibold text-purple-800">Device validated successfully</p>
                                <p className="text-xs text-purple-700 mt-1 font-mono">MAC: {macAddress}</p>
                                {deviceInfo?.serialNumber && (
                                    <p className="text-xs text-purple-700 font-mono">Serial: {deviceInfo.serialNumber}</p>
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

