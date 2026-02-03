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
    upgradeRegistration,
    getFofiPaymentInfo,
} from "../../services/fofiApis";
import { getCableCustomerDetails, getPrimaryCustomerDetails, getMyPlanDetails, getCustKYCPreview, getUserAssignedItems } from "../../services/generalApis";

function FoFiSmartBox() {
    const location = useLocation();
    const navigate = useNavigate();

    // Use actual customer data from API (passed from customer list)
    const customerData = location.state?.customer;
    const fromInternet = location.state?.fromInternet;
    const internetId = location.state?.internetId;
    const refreshData = location.state?.refreshData; // Flag to force refresh after payment
    const paymentSuccess = location.state?.paymentSuccess; // Flag to show success message
    const isNewRegistration = location.state?.isNewRegistration; // Flag to indicate new registration vs upgrade

    // Use mock data ONLY for service details (new feature)
    const mockServiceData = mockCustomerServices[customerData?.customer_id];
    const fofiService = mockServiceData?.services?.fofi;
    const isExistingUser = fofiService?.active;

    // State management
    const [showServiceModal, setShowServiceModal] = useState(false);
    // View states: 'overview', 'link-fofi', 'upgrade-plans', 'subscription-confirm', 'device-validation', 'payment'
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
    const [ottPlansMap, setOttPlansMap] = useState({}); // Map of plan names to OTT plan IDs
    const [upgradePlansLoading, setUpgradePlansLoading] = useState(false);
    const [upgradePlansError, setUpgradePlansError] = useState('');
    const [upgradeSearchTerm, setUpgradeSearchTerm] = useState('');
    const [showZeroPricePopup, setShowZeroPricePopup] = useState(false); // Popup for ₹0 plans
    
    // Toast/Snackbar for payment success
    const [showSuccessToast, setShowSuccessToast] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    // Show success toast if coming back from successful payment
    useEffect(() => {
        if (paymentSuccess) {
            if (isNewRegistration) {
                setSuccessMessage('FoFi-Box Registration Successful! Plan has been activated.');
            } else {
                setSuccessMessage('Plan upgraded successfully! Your new plan is now active.');
            }
            setShowSuccessToast(true);
            // Auto-hide toast after 5 seconds
            const timer = setTimeout(() => {
                setShowSuccessToast(false);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [paymentSuccess, isNewRegistration]);

    // =====================================================
    // FETCH CUSTOMER OVERVIEW DATA ON COMPONENT MOUNT
    // APIs called: getUserAssignedItems, cblCustDet, primaryCustdet, getMyPlanDetails
    // =====================================================
    useEffect(() => {
        const fetchCustomerOverviewData = async () => {
            if (!customerData) return;

            const userid = customerData?.username || customerData?.customer_id;
            console.log('🔵 [FoFi SmartBox] Starting to fetch customer overview data...');
            console.log('🔵 [FoFi SmartBox] Customer Data:', customerData);
            console.log('🔵 [FoFi SmartBox] User ID:', userid);
            if (refreshData) {
                console.log('🔵 [FoFi SmartBox] REFRESH FLAG DETECTED - Forcing data refresh after payment');
            }

            setIsOverviewLoading(true);

            try {
                // STEP 1: First get assigned items to get fofiboxid
                console.log('🔵 [FoFi SmartBox] STEP 1: Getting assigned items...');
                const assignedItemsResponse = await getUserAssignedItems('fofi', userid).catch(err => {
                    console.error('❌ [FoFi SmartBox] getUserAssignedItems API failed:', err);
                    return null;
                });
                console.log('🟢 [FoFi SmartBox] getUserAssignedItems Response:', assignedItemsResponse);
                
                // Extract fofiboxid from assigned items
                const fofiItems = assignedItemsResponse?.body?.fofi || [];
                const fofiBoxId = fofiItems?.[0]?.fofiboxid || fofiItems?.[0]?.boxid || fofiItems?.[0]?.product_name || '';
                console.log('🔵 [FoFi SmartBox] Extracted fofiBoxId:', fofiBoxId);
                
                // STEP 2: Call remaining APIs in parallel (with fofiboxid if available)
                console.log('🔵 [FoFi SmartBox] STEP 2: Calling remaining APIs...');
                const [cableDetailsResponse, primaryDetailsResponse, planDetailsResponse] = await Promise.all([
                    // API 2: cblCustDet - Get cable customer details
                    getCableCustomerDetails(userid).catch(err => {
                        console.error('❌ [FoFi SmartBox] getCableCustomerDetails API failed:', err);
                        return null;
                    }),
                    // API 3: primaryCustdet - Get primary customer details
                    getPrimaryCustomerDetails(userid).catch(err => {
                        console.error('❌ [FoFi SmartBox] getPrimaryCustomerDetails API failed:', err);
                        return null;
                    }),
                    // API 4: getMyPlanDetails - Get FoFi plan details (WITH fofiboxid)
                    getMyPlanDetails({ servicekey: 'fofi', userid, fofiboxid: fofiBoxId, voipnumber: '' }).catch(err => {
                        console.error('❌ [FoFi SmartBox] getMyPlanDetails API failed:', err);
                        return null;
                    })
                ]);

                // Log API responses
                console.log('🟢 [FoFi SmartBox] getCableCustomerDetails Response:', cableDetailsResponse);
                console.log('🟢 [FoFi SmartBox] getPrimaryCustomerDetails Response:', primaryDetailsResponse);
                console.log('🟢 [FoFi SmartBox] getMyPlanDetails Response:', planDetailsResponse);
                console.log('🟢 [FoFi SmartBox] planDetailsResponse FULL:', JSON.stringify(planDetailsResponse, null, 2));
                console.log('🟢 [FoFi SmartBox] subscribed_services:', planDetailsResponse?.body?.subscribed_services);

                // Process getUserAssignedItems response
                if (assignedItemsResponse) {
                    setFofiAssignedItems(assignedItemsResponse);
                    
                    // Check if user has FoFi service based on response
                    // If body contains fofi items, user has the service
                    console.log('🔵 [FoFi SmartBox] FoFi Items from API:', fofiItems);
                    
                    // Log ALL fields in first fofi item for debugging
                    if (fofiItems && fofiItems.length > 0) {
                        console.log('🔵 [FoFi SmartBox] First FoFi Item:', fofiItems[0]);
                        console.log('🔵 [FoFi SmartBox] All fields in fofiItems[0]:', Object.keys(fofiItems[0]));
                    }
                    
                    // Extract from planDetails API for planname and expirydate
                    // Check multiple service keys: 'fofi', 'ott', 'smartbox', 'fofibox'
                    const subscribedServices = planDetailsResponse?.body?.subscribed_services || [];
                    console.log('🔵 [FoFi SmartBox] All subscribed_services:', subscribedServices);
                    
                    const fofiService = subscribedServices.find(s => 
                        s.servicekey === 'fofi' || s.servicekey === 'ott' || s.servicekey === 'smartbox' || s.servicekey === 'fofibox'
                    );
                    console.log('🔵 [FoFi SmartBox] FoFi Service from planDetails:', fofiService);
                    console.log('🔵 [FoFi SmartBox] All fields in fofiService:', fofiService ? Object.keys(fofiService) : 'N/A');
                    
                    if ((fofiItems && Array.isArray(fofiItems) && fofiItems.length > 0) || fofiService) {
                        // User has existing FoFi service
                        console.log('✅ [FoFi SmartBox] User has EXISTING FoFi service');
                        setHasFofiService(true);
                        
                        // Get boxId from assigned items
                        const boxId = fofiBoxId || fofiService?.fofiboxid || 'N/A';
                        
                        // Get planName from API - check multiple possible field names
                        // Priority: planname (most common) > serv_name > title > plan_name
                        const planName = fofiService?.planname || 
                                        fofiService?.serv_name || 
                                        fofiService?.servname || 
                                        fofiService?.plan_name || 
                                        fofiService?.title ||
                                        fofiItems?.[0]?.planname || 
                                        fofiItems?.[0]?.serv_name || 
                                        fofiItems?.[0]?.servname || 
                                        fofiItems?.[0]?.plan_name ||
                                        planDetailsResponse?.body?.planname ||
                                        'N/A';
                        
                        // Get expiryDate from planDetails API - check multiple possible field names
                        const expiryDate = fofiService?.expirydate || 
                                          fofiService?.expiry_date || 
                                          fofiService?.expdate ||
                                          fofiItems?.[0]?.expirydate || 
                                          fofiItems?.[0]?.expiry_date ||
                                          fofiItems?.[0]?.expdate ||
                                          planDetailsResponse?.body?.expirydate ||
                                          'N/A';
                        
                        // Get macAddress from assigned items
                        const macAddress = fofiItems?.[0]?.mac || fofiItems?.[0]?.macid || fofiItems?.[0]?.mac_addr || fofiService?.macid || 'N/A';
                        
                        console.log('🔵 [FoFi SmartBox] ========== EXTRACTED VALUES ==========');
                        console.log('🔵 [FoFi SmartBox] boxId:', boxId);
                        console.log('🔵 [FoFi SmartBox] planName:', planName);
                        console.log('🔵 [FoFi SmartBox] expiryDate:', expiryDate);
                        console.log('🔵 [FoFi SmartBox] macAddress:', macAddress);
                        console.log('🔵 [FoFi SmartBox] ====================================');
                        
                        // Extract OTT/FoFi plan ID from the service - this is needed for payment API
                        const ottPlanId = fofiService?.internet_planid || fofiService?.srvid || fofiService?.planid || fofiService?.servid ||
                                         fofiItems?.[0]?.internet_planid || fofiItems?.[0]?.srvid || fofiItems?.[0]?.planid || fofiItems?.[0]?.servid || null;
                        const serialNumber = fofiItems?.[0]?.fserialno || fofiItems?.[0]?.serial_number || fofiService?.fserialno || '';

                        console.log('🔵 [FoFi SmartBox] Extracted ottPlanId:', ottPlanId);
                        console.log('🔵 [FoFi SmartBox] Extracted serialNumber:', serialNumber);
                        console.log('🔵 [FoFi SmartBox] fofiService FULL:', JSON.stringify(fofiService, null, 2));
                        console.log('🔵 [FoFi SmartBox] fofiItems[0] FULL:', fofiItems?.[0] ? JSON.stringify(fofiItems[0], null, 2) : 'N/A');

                        setFofiServiceDetails({
                            boxId: boxId,
                            planName: planName,
                            expiryDate: expiryDate,
                            macAddress: macAddress,
                            serialNumber: serialNumber,
                            ottPlanId: ottPlanId,
                            status: fofiItems?.[0]?.status || fofiService?.status || 'Active'
                        });
                        
                        console.log('✅ [FoFi SmartBox] Service Details SET:', { boxId, planName, expiryDate, macAddress });
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
    }, [customerData, refreshData]); // Also re-fetch when refreshData flag is set (after payment)

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
                customer: customerData,
                cableDetails: customerDetails, // Pass cableDetails for op_id used in payment history API
                serviceType: 'fofi', // Indicate this is FoFi order history
                fofiboxid: fofiServiceDetails?.boxId || '' // Pass FoFi box ID for order history API
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
    // BOTH existing and new users use registrationNecessities API for plans
    // =====================================================
    const handleUpgradeClick = async () => {
        const userid = customerData?.username || customerData?.customer_id;
        const user = JSON.parse(localStorage.getItem('user'));
        const logUname = user?.username || 'superadmin';

        console.log('🔵 [UPGRADE] Starting upgrade flow...');
        console.log('🔵 [UPGRADE] User ID:', userid);
        console.log('🔵 [UPGRADE] Log Username:', logUname);
        console.log('🔵 [UPGRADE] hasFofiService:', hasFofiService);

        setUpgradePlansLoading(true);
        setUpgradePlansError('');
        setUpgradePlans([]);
        setFilteredUpgradePlans([]);
        setUpgradeSearchTerm('');

        try {
            // Skip validation for existing users
            if (!hasFofiService) {
                // For NEW users - validate first
                console.log('🔵 [UPGRADE] Step 1: Calling validateBeforeFofiBoxReg...');
                const validateResponse = await validateBeforeFofiBoxReg({
                    username: userid,
                    loginuname: logUname
                });
                console.log('🟢 [UPGRADE] validateBeforeFofiBoxReg Response:', validateResponse);

                if (validateResponse?.status?.err_code !== 0) {
                    const errorMsg = validateResponse?.status?.err_msg || 'Validation failed. Please try again.';
                    console.error('❌ [UPGRADE] Validation failed:', errorMsg);
                    setUpgradePlansError(errorMsg);
                    setUpgradePlansLoading(false);
                    return;
                }
            }
            
            // Call registrationNecessities for plans
            console.log('🔵 [UPGRADE] Fetching plans from registrationNecessities...');
            const plansResponse = await getFofiUpgradePlans({
                logUname: logUname,
                moduletype: "upgradation",
                userid: userid
            });
            console.log('🟢 [UPGRADE] registrationNecessities Response:', plansResponse);
            
            if (plansResponse?.status?.err_code === 0) {
                // Log the FULL response body to find planid field
                console.log('✅ [UPGRADE] Full response body:', JSON.stringify(plansResponse?.body, null, 2));
                console.log('✅ [UPGRADE] Response body keys:', Object.keys(plansResponse?.body || {}));
                
                // Check ALL plan arrays in response
                console.log('✅ [UPGRADE] === Checking all plan arrays ===');
                console.log('✅ [UPGRADE] ott_plans:', plansResponse?.body?.ott_plans);
                console.log('✅ [UPGRADE] internet_plans:', plansResponse?.body?.internet_plans?.length || 0, 'plans');
                console.log('✅ [UPGRADE] fofi_plans:', plansResponse?.body?.fofi_plans);
                console.log('✅ [UPGRADE] cable_plans:', plansResponse?.body?.cable_plans);
                console.log('✅ [UPGRADE] plans:', plansResponse?.body?.plans);
                
                // Check fofi_plans for OTT/FoFi plan IDs (planid like "55")
                // Build a map of FoFi plans by name for cross-referencing with internet_plans
                const fofiPlansArray = plansResponse?.body?.fofi_plans || plansResponse?.body?.ott_plans || [];
                console.log('✅ [UPGRADE] fofi_plans array:', fofiPlansArray);

                if (fofiPlansArray.length > 0) {
                    console.log('✅ [UPGRADE] FoFi Plans found! Count:', fofiPlansArray.length);
                    console.log('✅ [UPGRADE] First FoFi plan:', JSON.stringify(fofiPlansArray[0], null, 2));
                    console.log('✅ [UPGRADE] FoFi plan keys:', Object.keys(fofiPlansArray[0]));

                    // Create a map of plan names to FoFi/OTT plan IDs
                    // The fofi_plans should have the correct planid (like "55") that the payment API needs
                    const fofiMap = {};
                    fofiPlansArray.forEach(plan => {
                        const planName = plan.serv_name || plan.planname || plan.plan_name || plan.name || '';
                        // The FoFi plan ID could be in various fields - srvid, planid, servid, or id
                        const fofiPlanId = plan.srvid || plan.planid || plan.servid || plan.id || '';
                        console.log(`✅ [UPGRADE] FoFi plan: "${planName}" -> srvid:${plan.srvid}, planid:${plan.planid}, servid:${plan.servid}, id:${plan.id}`);
                        if (planName && fofiPlanId) {
                            fofiMap[planName.toLowerCase()] = String(fofiPlanId);
                            console.log(`✅ [UPGRADE] FoFi Map: "${planName}" -> ${fofiPlanId}`);
                        }
                    });
                    setOttPlansMap(fofiMap);
                    console.log('✅ [UPGRADE] FoFi Plans Map:', fofiMap);
                } else {
                    console.log('⚠️ [UPGRADE] No FoFi/OTT plans found in response');
                }

                // PLAN DISPLAY LOGIC:
                // - NEW USERS: Display ONLY fofi_plans (FoFi-box specific plans)
                // - EXISTING USERS: Display ALL plans from the API (all available plan arrays)
                let plans = [];
                let plansSource = 'none';

                if (hasFofiService) {
                    // EXISTING USER - Show ALL FoFi/OTT compatible plans from the API
                    // Note: Only fofi_plans and ott_plans work with the paymentinfo/fofi API
                    // internet_plans and cable_plans use different payment flows
                    console.log('✅ [UPGRADE] Existing user - loading ALL FoFi/OTT plans');

                    // Collect all FoFi-compatible plan arrays with unique keys
                    const allPlans = [];
                    const seenPlanKeys = new Set(); // Track seen plans to avoid duplicates

                    // Helper to add plans with unique key and source tracking
                    const addPlansWithSource = (planArray, source) => {
                        planArray.forEach((plan, idx) => {
                            const planId = plan.planid || plan.servid || plan.srvid || plan.id || idx;
                            const planName = plan.planname || plan.serv_name || plan.plan_name || '';
                            const uniqueKey = `${source}_${planId}_${planName}`;

                            // Skip if we've already seen this plan (deduplicate)
                            if (!seenPlanKeys.has(uniqueKey)) {
                                seenPlanKeys.add(uniqueKey);
                                allPlans.push({
                                    ...plan,
                                    _source: source,
                                    _uniqueKey: uniqueKey
                                });
                            }
                        });
                    };

                    // Add fofi_plans (primary - contains correct planid for payment API)
                    if (fofiPlansArray.length > 0) {
                        addPlansWithSource(fofiPlansArray, 'fofi');
                        console.log('✅ [UPGRADE] Added fofi_plans:', fofiPlansArray.length);
                    }

                    // Add ott_plans (if different from fofi_plans - also compatible with FoFi payment API)
                    const ottPlans = plansResponse?.body?.ott_plans || [];
                    if (ottPlans.length > 0 && ottPlans !== fofiPlansArray) {
                        addPlansWithSource(ottPlans, 'ott');
                        console.log('✅ [UPGRADE] Added ott_plans:', ottPlans.length);
                    }

                    // Note: internet_plans and cable_plans are NOT added as they use different payment APIs
                    // If needed in future, they should use their respective payment endpoints

                    plans = allPlans;
                    plansSource = 'fofi_ott_plans (existing user)';
                    console.log('✅ [UPGRADE] Total FoFi/OTT plans for existing user (after dedup):', plans.length);
                } else {
                    // NEW USER - Show ONLY fofi_plans (FoFi-box specific plans)
                    console.log('✅ [UPGRADE] New user - loading only FoFi-box plans');
                    if (fofiPlansArray.length > 0) {
                        plans = fofiPlansArray.map((plan, idx) => ({
                            ...plan,
                            _source: 'fofi',
                            _uniqueKey: `fofi_${plan.planid || plan.srvid || idx}_${plan.planname || ''}`
                        }));
                        plansSource = 'fofi_plans (new user)';
                        console.log('✅ [UPGRADE] Using fofi_plans ONLY for new user (contains correct planid)');
                    }
                }
                
                console.log('✅ [UPGRADE] Using plans from:', plansSource);
                console.log('✅ [UPGRADE] Plans count:', plans.length);
                if (plans.length > 0) {
                    console.log('✅ [UPGRADE] First plan (FULL):', JSON.stringify(plans[0], null, 2));
                    console.log('✅ [UPGRADE] First plan keys:', Object.keys(plans[0]));
                    
                    // Look for ANY field with small numbers (like 55)
                    Object.entries(plans[0]).forEach(([key, value]) => {
                        if (typeof value === 'number' && value < 200) {
                            console.log(`✅ [UPGRADE] Small number field: ${key} = ${value}`);
                        }
                        if (key.toLowerCase().includes('plan') || key.toLowerCase().includes('id')) {
                            console.log(`✅ [UPGRADE] ID-related field: ${key} =`, value);
                        }
                    });
                    
                    if (plans[0].serv_rates) {
                        console.log('✅ [UPGRADE] First plan serv_rates (FULL):', JSON.stringify(plans[0].serv_rates, null, 2));
                        console.log('✅ [UPGRADE] serv_rates keys:', Object.keys(plans[0].serv_rates));
                        
                        // Look for planid inside serv_rates
                        Object.entries(plans[0].serv_rates).forEach(([key, value]) => {
                            console.log(`✅ [UPGRADE] serv_rates.${key} =`, value);
                        });
                    }
                }
                
                if (Array.isArray(plans) && plans.length > 0) {
                    setUpgradePlans(plans);
                    setFilteredUpgradePlans(plans);
                    setView('upgrade-plans');
                } else {
                    setUpgradePlansError('No upgrade plans available at the moment.');
                }
            } else {
                const errorMsg = plansResponse?.status?.err_msg || 'Failed to fetch upgrade plans.';
                setUpgradePlansError(errorMsg);
            }
            
            setUpgradePlansLoading(false);
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

    // Select an upgrade plan (supports both fofi_plans and internet_plans)
    const handleUpgradePlanSelect = async (plan) => {
        console.log('🔵 [UPGRADE] Plan selected:', plan);
        console.log('🔵 [UPGRADE] Plan keys:', Object.keys(plan));
        console.log('🔵 [UPGRADE] Plan source:', plan._source);

        // Get plan ID - supports both planid (fofi_plans) and servid (internet_plans)
        const planIdentifier = plan.planid || plan.servid || plan.srvid || plan.id;
        console.log('🔵 [UPGRADE] Plan ID:', planIdentifier, '(planid:', plan.planid, ', servid:', plan.servid, ')');

        // Validate that some ID exists (required for payment API)
        if (!planIdentifier) {
            console.error('❌ [UPGRADE] No plan ID found! This plan cannot be used for payment.');
            alert('Error: This plan does not have a valid Plan ID. Please select another plan.');
            return;
        }

        // Get the plan price - supports both fofi_plans (planrate) and internet_plans (serv_rates.prices)
        let planPrice = plan.planrate || plan.price || plan.amount || 0;

        // For internet_plans, extract price from serv_rates
        if (!planPrice && plan.serv_rates?.prices?.length > 0) {
            planPrice = plan.serv_rates.prices[0];
        }

        const numericPrice = parseFloat(String(planPrice).replace(/[^0-9.]/g, '')) || 0;

        console.log('🔵 [UPGRADE] Plan price:', planPrice, 'Numeric:', numericPrice);

        // Check if price is 0 or free plan
        if (numericPrice === 0 || String(planPrice).toLowerCase() === 'free') {
            console.log('⚠️ [UPGRADE] Zero price plan selected - showing popup');
            setShowZeroPricePopup(true);
            return;
        }

        setSelectedPlan(plan);

        // Check if this is an existing FoFi user (has service already)
        if (hasFofiService && fofiServiceDetails) {
            // EXISTING USER - Show subscription confirmation screen with auto-detected Box ID
            console.log('🔵 [UPGRADE] Existing user - showing subscription confirmation screen...');
            console.log('🔵 [UPGRADE] Plan Name:', plan?.planname || plan?.serv_name);
            console.log('🔵 [UPGRADE] Plan ID:', planIdentifier);
            console.log('🔵 [UPGRADE] Box ID:', fofiServiceDetails.boxId);

            // Navigate to subscription confirmation view
            setView('subscription-confirm');
        } else {
            // NEW USER - Navigate to link-fofi view with selected plan
            setView('link-fofi');
        }
    };
    
    // Handle SUBMIT from subscription confirmation screen (existing users)
    const handleSubscriptionSubmit = async () => {
        if (!selectedPlan || !fofiServiceDetails) {
            alert('Please select a plan first');
            return;
        }
        
        console.log('🔵 [SUBSCRIPTION] Submitting subscription...');
        setIsLoading(true);
        
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const loginuname = user?.username || 'superadmin';
            const username = customerData?.username || customerData?.customer_id;
            
            // Get FoFi box details from existing service
            const fofiBoxId = fofiServiceDetails.boxId || '';
            const fofiMac = fofiServiceDetails.mac || fofiServiceDetails.macAddress || '';
            const fofiSerial = fofiServiceDetails.serialNumber || fofiServiceDetails.fserialno || '';
            
            // Log ALL plan fields exhaustively to find planid like "55"
            console.log('🔵 [SUBSCRIPTION] ========== FULL PLAN ANALYSIS ==========');
            console.log('🔵 [SUBSCRIPTION] Full plan object (JSON):', JSON.stringify(selectedPlan, null, 2));
            console.log('🔵 [SUBSCRIPTION] All plan keys:', Object.keys(selectedPlan));
            
            // Check all possible planid fields
            console.log('🔵 [SUBSCRIPTION] === Direct plan fields ===');
            console.log('  plan.id:', selectedPlan.id);
            console.log('  plan.planid:', selectedPlan.planid);
            console.log('  plan.plan_id:', selectedPlan.plan_id);
            console.log('  plan.srvid:', selectedPlan.srvid);
            console.log('  plan.servid:', selectedPlan.servid);
            console.log('  plan.service_id:', selectedPlan.service_id);
            console.log('  plan.fofi_planid:', selectedPlan.fofi_planid);
            console.log('  plan.ott_planid:', selectedPlan.ott_planid);
            
            // Check serv_rates deeply
            if (selectedPlan.serv_rates) {
                console.log('🔵 [SUBSCRIPTION] === serv_rates fields ===');
                console.log('  serv_rates (JSON):', JSON.stringify(selectedPlan.serv_rates, null, 2));
                console.log('  serv_rates keys:', Object.keys(selectedPlan.serv_rates));
                console.log('  serv_rates.planid:', selectedPlan.serv_rates.planid);
                console.log('  serv_rates.plan_id:', selectedPlan.serv_rates.plan_id);
                console.log('  serv_rates.id:', selectedPlan.serv_rates.id);
                console.log('  serv_rates.srvid:', selectedPlan.serv_rates.srvid);
                console.log('  serv_rates.servid:', selectedPlan.serv_rates.servid);
                console.log('  serv_rates.priceid:', selectedPlan.serv_rates.priceid);
            }
            
            // Check if there's a rates array
            if (selectedPlan.rates) {
                console.log('🔵 [SUBSCRIPTION] === rates array ===');
                console.log('  rates:', selectedPlan.rates);
            }
            
            // Check plan_details
            if (selectedPlan.plan_details) {
                console.log('🔵 [SUBSCRIPTION] === plan_details ===');
                console.log('  plan_details:', JSON.stringify(selectedPlan.plan_details, null, 2));
            }
            
            console.log('🔵 [SUBSCRIPTION] ========================================');
            
            // Extract plan details
            const servRates = selectedPlan.serv_rates || {};
            const planName = selectedPlan.serv_name || selectedPlan.planname || selectedPlan.plan_name || '';

            // DEBUG: Log full plan object to find correct OTT plan ID field
            console.log('🔴🔴🔴 DEBUG: selectedPlan FULL:', JSON.stringify(selectedPlan, null, 2));
            console.log('🔴🔴🔴 DEBUG: serv_rates FULL:', JSON.stringify(servRates, null, 2));
            console.log('🔴🔴🔴 DEBUG: selectedPlan keys:', Object.keys(selectedPlan));
            console.log('🔴🔴🔴 DEBUG: serv_rates keys:', Object.keys(servRates));
            console.log('🔴🔴🔴 DEBUG: ottPlansMap:', ottPlansMap);
            console.log('🔴🔴🔴 DEBUG: fofiServiceDetails:', fofiServiceDetails);
            console.log('🔴🔴🔴 DEBUG: planName:', planName);

            // PLAN ID EXTRACTION:
            // - fofi_plans: use planid
            // - internet_plans: use servid
            // Both are valid for the payment API

            let planId = '';

            // Get plan ID - supports both planid (fofi_plans) and servid (internet_plans)
            planId = String(
                selectedPlan.planid ||
                selectedPlan.servid ||
                selectedPlan.srvid ||
                selectedPlan.plan_id ||
                selectedPlan.id ||
                ''
            );
            console.log('🔵 [SUBSCRIPTION] Using plan ID:', planId, '(source:', selectedPlan._source || 'unknown', ')');

            // Validate we have a plan ID
            if (!planId) {
                console.error('❌ [SUBSCRIPTION] No plan ID found! Selected plan:', selectedPlan);
                alert('Error: Plan ID not found. Please select a valid plan.');
                setIsLoading(false);
                return;
            }

            // Extract price ID and plan price - supports both plan structures
            // fofi_plans: priceid, planrate
            // internet_plans: serv_rates.priceid, serv_rates.prices[0]
            const priceId = String(
                selectedPlan.priceid ||
                selectedPlan.price_id ||
                servRates.priceid ||
                servRates.price_id ||
                '99'
            );

            let planPrice = selectedPlan.planrate || selectedPlan.price || 0;
            // For internet_plans, extract price from serv_rates
            if (!planPrice && servRates.prices?.length > 0) {
                planPrice = servRates.prices[0];
            }

            // Service ID for FoFi/OTT is ALWAYS '3' - this is the service type for FoFi payment API
            const servId = '3';

            console.log('🔵 [SUBSCRIPTION] Plan details - planId:', planId, 'priceId:', priceId, 'planPrice:', planPrice);
            console.log('🔵 [SUBSCRIPTION] Box details - boxId:', fofiBoxId, 'mac:', fofiMac, 'serial:', fofiSerial);
            
            // =====================================================
            // STEP 1: Call upgradeRegistration API
            // =====================================================
            const upgradePayload = {
                fofiboxid: fofiBoxId,
                fofimac: fofiMac,
                fofiserailnumber: fofiSerial,
                loginuname: loginuname,
                services: ["ott"],
                username: username
            };
            
            console.log('🔵 [STEP 1] Calling upgradeRegistration API...');
            console.log('🔵 Upgrade Payload:', JSON.stringify(upgradePayload, null, 2));
            
            const upgradeResponse = await upgradeRegistration(upgradePayload);
            console.log('🟢 Upgrade Registration Response:', upgradeResponse);
            
            if (upgradeResponse?.status?.err_code !== 0) {
                const errorMsg = upgradeResponse?.status?.err_msg || 'Failed to register upgrade';
                console.error('❌ Upgrade registration failed:', errorMsg);
                alert('Failed to register upgrade: ' + errorMsg);
                setIsLoading(false);
                return;
            }
            
            // =====================================================
            // STEP 2: Call cblCustDet and primaryCustdet APIs
            // =====================================================
            console.log('🔵 [STEP 2] Fetching customer details...');
            try {
                const [cableDetails, primaryDetails] = await Promise.all([
                    getCableCustomerDetails(username),
                    getPrimaryCustomerDetails(username)
                ]);
                console.log('🟢 Cable Customer Details:', cableDetails);
                console.log('🟢 Primary Customer Details:', primaryDetails);
            } catch (detailsError) {
                console.warn('⚠️ Could not fetch customer details:', detailsError);
            }
            
            // =====================================================
            // STEP 3: Call paymentinfo/fofi API
            // =====================================================
            const paymentPayload = {
                fofi_box_id: fofiBoxId,
                planid: planId,
                priceid: priceId,
                servapptype: "crmapp",
                servid: servId,
                userid: username,
                username: loginuname,
                voipnumber: ""
            };

            console.log('🔵 [STEP 3] Calling getFofiPaymentInfo API...');
            console.log('🔵 Payment Payload:', JSON.stringify(paymentPayload, null, 2));

            const paymentResponse = await getFofiPaymentInfo(paymentPayload);
            console.log('🟢 Payment Info Response:', paymentResponse);
            
            if (paymentResponse?.status?.err_code !== 0) {
                const errorMsg = paymentResponse?.status?.err_msg || 'Failed to get payment info';
                console.error('❌ Payment info failed:', errorMsg);
                alert('Failed to get payment info: ' + errorMsg);
                setIsLoading(false);
                return;
            }
            
            // =====================================================
            // STEP 4: Navigate to payment page with response data
            // =====================================================
            const paymentBody = paymentResponse?.body || {};
            
            // Debug: Log the full API response structure
            console.log('🔴 [DEBUG] Full paymentBody:', JSON.stringify(paymentBody, null, 2));
            
            // API Response Structure (actual):
            // - planrate: "130.00" (string)
            // - total_amt: 153.4 (number)
            // - tax: 23.4 (total tax)
            // - tax_details: [{ title: "SGST", percent: "9%", amt: 11.7 }, { title: "CGST", percent: "9%", amt: 11.7 }]
            // - balance_amt: 0
            // - other_amt: 0
            // - oprtrshare: 153.4 (operator share)
            // - bbnl_share: "-23.40"
            // - tds: 0
            // - softwarecharges: 0
            // - fofishare: 0
            // - deduction: { title: "...", totalamount: "0.00" }
            
            // Extract tax details from tax_details array
            const taxDetails = paymentBody?.tax_details || [];
            const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
            const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
            const cgst = cgstObj?.amt || 0;
            const sgst = sgstObj?.amt || 0;
            
            // Extract amounts directly from paymentBody
            const extractedPlanRate = parseFloat(paymentBody?.planrate) || planPrice || 0;
            const extractedTotal = paymentBody?.total_amt || 0;
            const otherCharges = paymentBody?.other_amt || 0;
            const balanceAmount = paymentBody?.balance_amt || 0;
            
            // Extract share info directly from paymentBody
            const operatorShare = paymentBody?.oprtrshare || 0;
            const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
            const softCharge = paymentBody?.softwarecharges || 0;
            const tds = paymentBody?.tds || 0;
            const fofiShare = paymentBody?.fofishare || 0;
            
            // Amount deductable from deduction object
            const amountDeductable = parseFloat(paymentBody?.deduction?.totalamount) || 0;
            
            console.log('🔴 [DEBUG] Extracted values from paymentBody:');
            console.log('  - Plan Rate:', extractedPlanRate);
            console.log('  - Total Amount:', extractedTotal);
            console.log('  - CGST:', cgst);
            console.log('  - SGST:', sgst);
            console.log('  - Other Charges:', otherCharges);
            console.log('  - Balance Amount:', balanceAmount);
            console.log('  - Operator Share:', operatorShare);
            console.log('  - BBNL Share:', bbnlShare);
            console.log('  - Software Charges:', softCharge);
            console.log('  - TDS:', tds);
            console.log('  - FoFi Share:', fofiShare);
            console.log('  - Amount Deductable:', amountDeductable);
            
            const fofiPaymentData = {
                // Customer & Plan identifiers (using fofi_plans structure)
                userid: username,
                fofiboxid: fofiBoxId,
                planid: planId, // from fofi_plans.planid
                priceid: priceId, // from fofi_plans.priceid
                servid: servId,
                loginuname: loginuname,
                paytype: 'upgrade',
                transactionid: paymentBody?.transactionid || '',
                
                // Wallet balance (not in this response, default to 0)
                walletBalance: 0,
                
                // Payment details for display
                paymentDetails: {
                    "Plan Name": paymentBody?.planname || selectedPlan?.planname || "N/A",
                    "Plan Rate": extractedPlanRate,
                    "CGST": cgst,
                    "SGST": sgst,
                    "Other Charges": otherCharges,
                    "Balance Amount": balanceAmount,
                    "Total Amount": extractedTotal
                },
                
                // More details (share info)
                moreDetails: {
                    "Operator Share": operatorShare,
                    "BBNL Share": bbnlShare,
                    "Software Charges": softCharge,
                    "TDS": tds,
                    "Amount Deductable": amountDeductable
                },
                
                noofmonth: 1,
                amountDeductable: amountDeductable,
                customer: customerData,
                planName: paymentBody?.planname || selectedPlan?.planname || "N/A",
                planRate: extractedPlanRate,
                totalAmount: extractedTotal,
                operatorShare: operatorShare
            };
            
            console.log('🔵 [STEP 4] Navigating to FoFi Payment with fofi_plans data:', fofiPaymentData);
            
            // Navigate to FoFi Payment Review page
            navigate('/fofi-payment', { state: fofiPaymentData });
            
        } catch (error) {
            console.error('❌ [SUBSCRIPTION] Error:', error);
            alert('Failed to process subscription. Please try again.');
        } finally {
            setIsLoading(false);
        }
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
    // API: fofi/fofiapis/validateAsset
    // Request: { mac_addr: "", serialno: "", userid: "superadmin", boxid: "BBNL-ANDBOX-00000933" }
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
            const userid = user?.username || 'superadmin';
            const customerUsername = customerData?.username || '';

            console.log('🔵 [GET MAC ID] Calling validateAsset API...');
            console.log('🔵 [GET MAC ID] Box ID:', boxId);
            console.log('🔵 [GET MAC ID] User ID:', userid);

            const response = await validateFoFiAsset({
                mac_addr: "",
                serialno: "",
                userid: userid,
                boxid: boxId.trim()
            });

            console.log('🟢 [GET MAC ID] Validate Asset Response:', response);
            console.log('🟢 [GET MAC ID] Response Body:', response?.body);
            console.log('🟢 [GET MAC ID] Response Status:', response?.status);

            if (response?.status?.err_code === 0) {
                let extractedMac = '';
                let extractedSerial = '';

                // Try to get MAC and Serial from response body first
                if (response?.body) {
                    // Handle both array and object responses
                    const bodyData = Array.isArray(response.body) ? response.body[0] : response.body;
                    extractedMac = bodyData?.mac_addr || bodyData?.macAddress || bodyData?.mac || '';
                    extractedSerial = bodyData?.serial_number || bodyData?.serialNumber || bodyData?.serialno || bodyData?.serial || '';
                    console.log('🔵 [GET MAC ID] Body data:', bodyData);
                }

                // If MAC not in body, try to extract from success message
                // Message format: "Fo-Fi device(11:1D:EF:1A:13:9F) belongs to BBNL_OP49 & available"
                if (!extractedMac && response?.status?.err_msg) {
                    const macMatch = response.status.err_msg.match(/\(([0-9A-Fa-f:]{17})\)/);
                    if (macMatch && macMatch[1]) {
                        extractedMac = macMatch[1];
                        console.log('✅ [GET MAC ID] Extracted MAC from message:', extractedMac);
                    }
                }

                if (!extractedMac) {
                    setValidationError('MAC address not found for this Box ID');
                    setIsLoading(false);
                    return;
                }

                // Device is available - set all device info
                setMacAddress(extractedMac);
                setSerialNumber(extractedSerial);
                setDeviceInfo({
                    macAddress: extractedMac,
                    serialNumber: extractedSerial,
                    boxId: boxId.trim()
                });
                setDeviceValidated(true);
                setShowValidationSuccess(true);
                setValidationMethod('manual');

                console.log('✅ [GET MAC ID] Device validated successfully');
                console.log('✅ [GET MAC ID] MAC Address:', extractedMac);
                console.log('✅ [GET MAC ID] Serial Number:', extractedSerial);
                console.log('✅ [GET MAC ID] Box ID:', boxId.trim());
            } else {
                setValidationError(response?.status?.err_msg || 'Device not found or invalid Box ID');
            }
        } catch (error) {
            console.error('❌ [GET MAC ID] Error:', error);
            setValidationError('Failed to validate device. Please check the Box ID and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Link FoFi Box handler - Uses upgradeRegistration API for fresh/new user registration
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

            // Extract plan details
            // For combo plans (IPTV_OTT_COMBO), the OTT plan ID is in ottservplanid field inside serv_rates
            // For registrationNecessities API: servid is the internet plan ID, but we need OTT plan ID
            const servRates = selectedPlan.serv_rates || {};
            const planId = String(
                servRates.ottservplanid ||
                servRates.ott_servplanid ||
                servRates.ottplanid ||
                servRates.ott_planid ||
                servRates.ott_plan_id ||
                servRates.fofiplanid ||
                servRates.fofi_planid ||
                servRates.planid ||
                servRates.plan_id ||
                servRates.servplanid ||
                selectedPlan.ottservplanid ||
                selectedPlan.ott_servplanid ||
                selectedPlan.ottplanid ||
                selectedPlan.ott_planid ||
                selectedPlan.fofiplanid ||
                selectedPlan.fofi_planid ||
                selectedPlan.planid ||
                selectedPlan.plan_id ||
                selectedPlan.id ||
                selectedPlan.servid ||
                selectedPlan.srvid ||
                ''
            );
            const priceId = String(servRates.priceid || servRates.price_id || selectedPlan.priceid || selectedPlan.price_id || '99');
            // Service ID for FoFi/OTT is ALWAYS '3' - this is the service type
            const servId = '3';

            console.log('🔵 Selected Plan Object:', selectedPlan);
            console.log('🔵 All plan fields:', Object.keys(selectedPlan));
            console.log('🔵 serv_rates fields:', Object.keys(servRates));
            console.log('🔵 serv_rates.ottservplanid:', servRates.ottservplanid);
            console.log('🔵 serv_rates.ottplanid:', servRates.ottplanid);
            console.log('🔵 serv_rates.fofiplanid:', servRates.fofiplanid);
            console.log('🔵 serv_rates.planid:', servRates.planid);
            console.log('🔵 Plan ID:', planId, 'Price ID:', priceId, 'Service ID:', servId);

            // =====================================================
            // STEP 1: Call upgradeRegistration API
            // =====================================================
            const upgradePayload = {
                fofiboxid: deviceInfo.boxId || boxId,
                fofimac: macAddress,
                fofiserailnumber: deviceInfo.serialNumber || serialNumber || '',
                loginuname: loginuname,
                services: ["ott"],
                username: username
            };

            console.log('🔵 [STEP 1] Calling upgradeRegistration API...');
            console.log('🔵 Upgrade Payload:', JSON.stringify(upgradePayload, null, 2));

            const upgradeResponse = await upgradeRegistration(upgradePayload);
            console.log('🟢 Upgrade Registration Response:', upgradeResponse);

            if (upgradeResponse?.status?.err_code !== 0) {
                setValidationError(upgradeResponse?.status?.err_msg || 'Failed to register upgrade');
                setIsLoading(false);
                return;
            }

            // =====================================================
            // STEP 2: Call cblCustDet and primaryCustdet APIs
            // =====================================================
            console.log('🔵 [STEP 2] Fetching customer details...');
            try {
                const [cableDetails, primaryDetails] = await Promise.all([
                    getCableCustomerDetails(username),
                    getPrimaryCustomerDetails(username)
                ]);
                console.log('🟢 Cable Customer Details:', cableDetails);
                console.log('🟢 Primary Customer Details:', primaryDetails);
                setCustomerDetails(cableDetails);
                setPrimaryCustomerDetails(primaryDetails);
            } catch (detailsError) {
                console.warn('⚠️ Could not fetch customer details:', detailsError);
            }

            // =====================================================
            // STEP 3: Call paymentinfo/fofi API
            // =====================================================
            const paymentPayload = {
                fofi_box_id: deviceInfo.boxId || boxId,
                planid: planId,
                priceid: priceId,
                servapptype: "crmapp",
                servid: servId,
                userid: username,
                username: loginuname,
                voipnumber: ""
            };

            console.log('🔵 [STEP 3] Calling getFofiPaymentInfo API...');
            console.log('🔵 Payment Payload:', JSON.stringify(paymentPayload, null, 2));

            const paymentResponse = await getFofiPaymentInfo(paymentPayload);
            console.log('🟢 Payment Info Response:', paymentResponse);

            if (paymentResponse?.status?.err_code !== 0) {
                // Payment info API failed, but registration was successful
                console.warn('⚠️ Payment info API failed, but registration succeeded');
                alert('FoFi Box registered successfully! Payment info could not be retrieved.');
                // Reset form and navigate back to overview
                setView('overview');
                setDeviceValidated(false);
                setMacAddress('');
                setSerialNumber('');
                setBoxId('');
                setDeviceInfo(null);
                setSelectedPlan(null);
            } else {
                // Both APIs succeeded - Navigate to FoFi Payment Review Page
                console.log('✅ Registration successful, navigating to payment page...');
                
                // Extract payment details from the response
                const paymentBody = paymentResponse?.body || {};
                
                // Debug: Log the full API response structure
                console.log('🔴 [DEBUG] Full paymentBody (new user):', JSON.stringify(paymentBody, null, 2));
                
                // Extract tax details from tax_details array
                const taxDetails = paymentBody?.tax_details || [];
                const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
                const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
                const cgst = cgstObj?.amt || 0;
                const sgst = sgstObj?.amt || 0;
                
                // Extract amounts directly from paymentBody
                const extractedPlanRate = parseFloat(paymentBody?.planrate) || selectedPlan?.price || 0;
                const extractedTotal = paymentBody?.total_amt || 0;
                const otherCharges = paymentBody?.other_amt || 0;
                const balanceAmount = paymentBody?.balance_amt || 0;
                
                // Extract share info directly from paymentBody
                const operatorShare = paymentBody?.oprtrshare || 0;
                const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
                const softCharge = paymentBody?.softwarecharges || 0;
                const tds = paymentBody?.tds || 0;
                const fofiShare = paymentBody?.fofishare || 0;
                
                // Amount deductable from deduction object
                const amountDeductable = parseFloat(paymentBody?.deduction?.totalamount) || 0;
                
                // Prepare payment data for the review page
                const fofiPaymentData = {
                    // Customer & Plan identifiers
                    userid: username,
                    fofiboxid: deviceInfo.boxId || boxId,
                    planid: planId,
                    priceid: priceId,
                    servid: servId,
                    loginuname: loginuname,
                    paytype: 'new_registration',
                    transactionid: paymentBody?.transactionid || '',
                    
                    // Wallet balance
                    walletBalance: 0,
                    
                    // Payment details for display
                    paymentDetails: {
                        "Plan Name": paymentBody?.planname || selectedPlan?.planname || selectedPlan?.plan_name || "N/A",
                        "Plan Rate": extractedPlanRate,
                        "CGST": cgst,
                        "SGST": sgst,
                        "Other Charges": otherCharges,
                        "Balance Amount": balanceAmount,
                        "Total Amount": extractedTotal
                    },
                    
                    // More details (share info)
                    moreDetails: {
                        "Operator Share": operatorShare,
                        "BBNL Share": bbnlShare,
                        "Software Charges": softCharge,
                        "TDS": tds,
                        "Amount Deductable": amountDeductable
                    },
                    
                    // Additional payment info
                    noofmonth: 1,
                    amountDeductable: amountDeductable,
                    planName: paymentBody?.planname || selectedPlan?.planname || selectedPlan?.plan_name || "N/A",
                    planRate: extractedPlanRate,
                    totalAmount: extractedTotal,
                    operatorShare: operatorShare,
                    
                    // Customer data for reference
                    customer: customerData
                };

                console.log('🔵 Navigating to FoFi Payment with data:', fofiPaymentData);
                
                // Navigate to FoFi Payment Review page
                navigate('/fofi-payment', { state: fofiPaymentData });
                return; // Exit the function after navigation
            }

        } catch (error) {
            console.error('❌ Upgrade registration error:', error);
            setValidationError('Failed to register FoFi box. Please try again.');
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

        // Show fullScreen loader while loading
        if (isOverviewLoading) {
            return (
                <Loader fullScreen showHeader headerTitle="Customer OverView" text="Loading customer overview..." />
            );
        }

        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                {/* Success Toast - Shows after successful payment */}
                {showSuccessToast && (
                    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in-down">
                        <div className="bg-green-500 text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-3">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-medium">{successMessage}</span>
                            <button 
                                onClick={() => setShowSuccessToast(false)}
                                className="ml-2 hover:bg-green-600 rounded-full p-1"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                )}

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
                                <>
                                    {/* FoFi Box ID Section - Matching Internet ID style exactly */}
                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            FoFi Box ID
                                        </h3>
                                        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700">
                                            <p className="text-indigo-600 font-semibold text-base">{fofiServiceDetails?.boxId || 'N/A'}</p>
                                        </div>
                                    </div>

                                    {/* Current Plan (Read-Only) Section - Matching Internet style exactly */}
                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            Current Plan 
                                        </h3>
                                        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 dark:border-gray-700">
                                            <div className="flex items-start gap-4">
                                                {/* FoFi Smart Box Logo - Hardcoded SVG */}
                                                <div className="flex-shrink-0">
                                                    <svg className="w-16 h-16" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        {/* Blue circle background */}
                                                        <circle cx="50" cy="50" r="50" fill="url(#fofiGradient)" />
                                                        {/* Top dome/arc */}
                                                        <path d="M25 48 Q50 22, 75 48" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
                                                        {/* Three horizontal wave lines */}
                                                        <line x1="22" y1="55" x2="78" y2="55" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="26" y1="66" x2="74" y2="66" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="32" y1="77" x2="68" y2="77" stroke="white" strokeWidth="4" strokeLinecap="round" />
                                                        <defs>
                                                            <linearGradient id="fofiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                <stop offset="0%" stopColor="#38BDF8" />
                                                                <stop offset="100%" stopColor="#0284C7" />
                                                            </linearGradient>
                                                        </defs>
                                                    </svg>
                                                </div>

                                                {/* Plan Info - Matching Internet style */}
                                                <div className="flex-1 space-y-2 text-sm">
                                                    <div className="flex">
                                                        <span className="w-28 text-gray-700 dark:text-gray-300">Service Name</span>
                                                        <span className="text-gray-700 dark:text-gray-300">:   FoFi Smart Box</span>
                                                    </div>
                                                    <div className="flex">
                                                        <span className="w-28 text-gray-700 dark:text-gray-300">Plan Name</span>
                                                        <span className="text-gray-700 dark:text-gray-300">:   {fofiServiceDetails?.planName || 'N/A'}</span>
                                                    </div>
                                                    <div className="flex items-start">
                                                        <span className="w-28 text-gray-700 dark:text-gray-300">Expiry Date</span>
                                                        <span className="text-gray-700 dark:text-gray-300">:</span>
                                                        <span className="flex flex-col ml-2 text-gray-700 dark:text-gray-300">
                                                            <span>{fofiServiceDetails?.expiryDate || 'N/A'}</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* PAY BILL Button - Matching Internet style */}
                                            <div className="space-y-3 mt-4">
                                                <button
                                                    onClick={handleUpgradeClick}
                                                    disabled={upgradePlansLoading}
                                                    className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {upgradePlansLoading ? 'Loading...' : 'Upgrade Plan'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
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
                                // Plan display - supports both fofi_plans and internet_plans
                                // fofi_plans: planname, planrate, planid
                                // internet_plans: serv_name, serv_rates, servid
                                const planName = plan.planname || plan.serv_name || plan.plan_name || plan.name || 'Unknown Plan';
                                const planPrice = plan.planrate || plan.serv_rates?.prices?.[0] || plan.price || plan.amount || '0';
                                // Use _uniqueKey for React key to avoid duplicates
                                const uniqueKey = plan._uniqueKey || `plan_${index}`;

                                return (
                                    <div
                                        key={uniqueKey}
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

                {/* Zero Price Plan Popup */}
                <AnimatePresence>
                    {showZeroPricePopup && (
                        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 px-4">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: -20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                            >
                                {/* Gradient Header */}
                                <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-white">Alert</h3>
                                    <button
                                        onClick={() => setShowZeroPricePopup(false)}
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
                                        <div className="bg-gradient-to-br from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 rounded-full p-4">
                                            <ExclamationCircleIcon className="h-16 w-16 text-orange-500" />
                                        </div>
                                    </motion.div>

                                    <p className="text-gray-700 dark:text-gray-300 text-center text-base leading-relaxed mb-6">
                                       Plan Rate is Missing.Please Contact Admin to Update the Plan Rate.
                                    </p>

                                    {/* Action Button */}
                                    <button
                                        onClick={() => setShowZeroPricePopup(false)}
                                        className="w-full px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
                                    >
                                        OK, Select Other Plan
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // SUBSCRIPTION CONFIRMATION VIEW - For EXISTING users
    // Shows Plan Type, Plan Name, auto-detected Box ID, and SUBMIT button
    // =====================================================
    if (view === 'subscription-confirm') {
        const confirmPlanName = selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || selectedPlan?.name || 'N/A';
        const confirmBoxId = fofiServiceDetails?.boxId || 'N/A';
        
        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                {/* Header - Blue/Indigo gradient matching app theme */}
                <header className="sticky top-0 z-40 flex items-center px-4 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                    <button onClick={() => setView('upgrade-plans')} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-white">Services Subscription</h1>
                </header>

                <div className="flex-1 px-4 py-6 space-y-6 max-w-md mx-auto w-full">
                    {/* Plan Info Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                        <div className="space-y-3">
                            <div className="flex">
                                <span className="text-gray-600 dark:text-gray-400 w-28">Plan Type</span>
                                <span className="text-gray-600 dark:text-gray-400 mr-2">:</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">FoFi Plan</span>
                            </div>
                            <div className="flex">
                                <span className="text-gray-600 dark:text-gray-400 w-28">Plan Name</span>
                                <span className="text-gray-600 dark:text-gray-400 mr-2">:</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold uppercase">{confirmPlanName}</span>
                            </div>
                        </div>
                    </div>

                    {/* FOFI Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-sm uppercase tracking-wide">FOFI</span>
                        </div>
                        
                        {/* FoFi Box ID - Auto-detected (Read-only) */}
                        <div className="relative">
                            <label className="absolute -top-2.5 left-3 bg-gray-50 dark:bg-gray-900 px-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                FOFI BOX ID
                            </label>
                            <input
                                type="text"
                                value={confirmBoxId}
                                readOnly
                                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl focus:outline-none cursor-not-allowed"
                            />
                        </div>
                    </div>

                    {/* SUBMIT Button */}
                    <div className="pt-4">
                        <button
                            onClick={handleSubscriptionSubmit}
                            disabled={isLoading}
                            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Processing...
                                </>
                            ) : (
                                'SUBMIT'
                            )}
                        </button>
                    </div>
                </div>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // SERVICES SUBSCRIPTION VIEW - Device linking form (formerly link-fofi)
    // =====================================================
    // Get selected plan details for display
    const selectedPlanName = selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || selectedPlan?.name || 'N/A';
    const selectedPlanPrice = selectedPlan?.planrate || selectedPlan?.serv_rates?.prices?.[0] || selectedPlan?.price || selectedPlan?.amount || selectedPlan?.rate || '0';
    
    return (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* QR Scanner Modal */}
            {showQRScanner && (
                <QRScanner
                    onScan={handleQRCodeScanned}
                    onClose={handleQRScannerClose}
                    onError={handleQRScanError}
                />
            )}

            {/* Blue/Indigo Gradient Header - Matching app theme */}
            <header className="sticky top-0 z-40 flex items-center px-4 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
                <button onClick={() => setView('upgrade-plans')} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-xl font-medium text-white">Services Subscription</h1>
            </header>

            <div className="flex-1 px-4 py-4 space-y-4 pb-24 max-w-md mx-auto w-full">
                {/* Plan Info Card */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                    <div className="space-y-2">
                        <div className="flex">
                            <span className="w-24 text-gray-600 dark:text-gray-400 text-sm font-medium">Plan Type</span>
                            <span className="text-indigo-600 dark:text-indigo-400 text-sm font-semibold">: FoFi Plan</span>
                        </div>
                        <div className="flex">
                            <span className="w-24 text-gray-600 dark:text-gray-400 text-sm font-medium">Plan Name</span>
                            <span className="text-indigo-600 dark:text-indigo-400 text-sm font-semibold flex-1">: {selectedPlanName}</span>
                        </div>
                    </div>
                </div>

                {/* FOFI Section Card */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                    {/* FOFI Header */}
                    <div className="flex items-center gap-2 mb-5">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                        <h2 className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">FOFI</h2>
                    </div>

                    {/* Scan From TV Button */}
                    <div className="flex justify-center mb-4">
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
                    <div className="flex items-center justify-center py-2">
                        <span className="text-gray-400 dark:text-gray-500 font-medium text-sm">OR</span>
                    </div>

                    {/* FOFI Box ID Input */}
                    <div className="space-y-3 mb-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={boxId}
                                onChange={(e) => setBoxId(e.target.value)}
                                placeholder="FOFI Box Id*"
                                className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 dark:text-white bg-white dark:bg-gray-700 placeholder-gray-400 transition-all duration-200"
                            />
                            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                                {/* Barcode Icon */}
                                <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M2 4h2v16H2V4zm4 0h1v16H6V4zm2 0h2v16H8V4zm4 0h1v16h-1V4zm2 0h3v16h-3V4zm4 0h1v16h-1V4zm2 0h2v16h-2V4z"/>
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* GET MAC ID Button */}
                    <div className="flex justify-center mb-4">
                        <button
                            onClick={handleFetchMAC}
                            disabled={isLoading || !boxId}
                            className={`bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-3 px-10 rounded-full transition-all duration-200 uppercase text-sm shadow-md hover:shadow-lg ${isLoading || !boxId ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isLoading ? 'Getting MAC...' : 'GET MAC ID'}
                        </button>
                    </div>

                    {/* FOFI MAC ID Input */}
                    <div className="space-y-3">
                        <div className="relative">
                            <input
                                type="text"
                                value={macAddress}
                                onChange={(e) => setMacAddress(e.target.value)}
                                placeholder="FOFI MAC ID*"
                                className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 dark:text-white bg-white dark:bg-gray-700 font-mono text-sm placeholder-gray-400 transition-all duration-200"
                            />
                            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                                {/* Barcode Icon */}
                                <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M2 4h2v16H2V4zm4 0h1v16H6V4zm2 0h2v16H8V4zm4 0h1v16h-1V4zm2 0h3v16h-3V4zm4 0h1v16h-1V4zm2 0h2v16h-2V4z"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Error Message Popup Modal */}
                <AnimatePresence>
                    {validationError && (
                        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 px-4">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: -20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
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
                                        <div className="bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-900/50 rounded-full p-4">
                                            <ExclamationCircleIcon className="h-16 w-16 text-red-500" />
                                        </div>
                                    </motion.div>

                                    <p className="text-gray-700 dark:text-gray-300 text-center text-base leading-relaxed mb-6">
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

                {/* Success Message */}
                {showValidationSuccess && macAddress && (
                    <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded-lg p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="text-sm font-semibold text-green-800 dark:text-green-300">Device validated successfully</p>
                                <p className="text-xs text-green-700 dark:text-green-400 mt-1 font-mono">MAC: {macAddress}</p>
                                {deviceInfo?.serialNumber && (
                                    <p className="text-xs text-green-700 dark:text-green-400 font-mono">Serial: {deviceInfo.serialNumber}</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* SUBMIT Button */}
                <div className="flex justify-center pt-6">
                    <button
                        onClick={handleLinkFoFiBox}
                        disabled={isLoading || !macAddress || !selectedPlan}
                        className={`bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-4 px-20 rounded-full transition-all duration-200 uppercase text-sm shadow-lg hover:shadow-xl tracking-wide ${isLoading || !macAddress || !selectedPlan ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!selectedPlan ? 'Please select a plan first' : !macAddress ? 'Please get MAC ID first' : 'Click to submit'}
                    >
                        {isLoading ? 'Submitting...' : 'SUBMIT'}
                    </button>
                </div>
                
                {/* Status indicators below button */}
                {(!macAddress || !selectedPlan) && (
                    <div className="text-center text-xs text-gray-500 dark:text-gray-400 space-y-1 mt-2">
                        <p className="flex items-center justify-center gap-2">
                            <span className={boxId ? 'text-green-500' : 'text-gray-400'}>
                                {boxId ? '✓' : '○'}
                            </span>
                            <span>Enter Box ID</span>
                        </p>
                        <p className="flex items-center justify-center gap-2">
                            <span className={macAddress ? 'text-green-500' : 'text-gray-400'}>
                                {macAddress ? '✓' : '○'}
                            </span>
                            <span>Get MAC ID</span>
                        </p>
                        <p className="flex items-center justify-center gap-2">
                            <span className={selectedPlan ? 'text-green-500' : 'text-gray-400'}>
                                {selectedPlan ? '✓' : '○'}
                            </span>
                            <span>Plan Selected</span>
                        </p>
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
}

export default FoFiSmartBox;