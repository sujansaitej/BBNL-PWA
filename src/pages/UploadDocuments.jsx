import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  getCustKYCPreview,
  uploadCustKYC,
  submitKYC,
  getCableCustomerDetails,
  getPrimaryCustomerDetails
} from "../services/generalApis";
import { Alert, ConfirmDialog, Loader } from "@/components/ui";

export default function UploadDocuments() {
  const location = useLocation();
  const navigate = useNavigate();
  const customerData = location.state?.customer;
  const kycData = location.state?.kycData;

  const [loading, setLoading] = useState(!kycData);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Alert state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ type: 'success', title: '', message: '' });

  // Confirm Dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', onConfirm: () => { } });

  // Store the full proofs array from API to track maxlimit, remainlmt, etc.
  const [proofsData, setProofsData] = useState([]);

  // Processed documents for display
  const [documents, setDocuments] = useState({
    photoProof: { images: [], maxlimit: 1, remainlmt: 1, allowupdate: 1 },
    addressProof: { images: [], maxlimit: 3, remainlmt: 3, allowupdate: 1 },
    idProof: { images: [], maxlimit: 3, remainlmt: 3, allowupdate: 1 }
  });

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const loginuser = user?.username || 'superadmin';

  // Debug logging
  console.log('🔵 [UploadDocuments] Customer Data:', customerData);
  console.log('🔵 [UploadDocuments] Customer ID:', customerData?.customer_id);
  console.log('🔵 [UploadDocuments] Login User:', loginuser);

  useEffect(() => {
    if (!kycData && customerData) {
      fetchDocuments();
    } else if (kycData) {
      processKYCData(kycData);
    }
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);

      // API: custKYCpreview
      // Request: { cid: "iptvuser", reqtype: "update" }
      const response = await getCustKYCPreview({
        cid: customerData?.customer_id,
        reqtype: 'update'
      });

      console.log('🟢 KYC Preview Response:', response);

      if (response?.status?.err_code === 0 && response?.body) {
        processKYCData(response.body);
      } else {
        console.warn('⚠️ No documents found or error:', response?.status?.err_msg);
      }
    } catch (err) {
      console.error('❌ Error fetching documents:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Process KYC data from API response
   * API Response Structure:
   * {
   *   "proofs": [
   *     {
   *       "proofname": "Address Proof",
   *       "ptypekey": "addProofs",
   *       "maxlimit": 3,
   *       "remainlmt": 2,
   *       "allowupdate": 1,
   *       "allowreplace": 1,
   *       "imgs": [
   *         { "id": "", "url": "http://...", "status": "approved" },
   *         { "id": "", "url": "", "status": "" }
   *       ]
   *     }
   *   ]
   * }
   */
  const processKYCData = (data) => {
    console.log('🔵 Processing KYC Data:', JSON.stringify(data, null, 2));

    // Initialize processed documents
    let photoProof = { images: [], maxlimit: 1, remainlmt: 1, allowupdate: 1 };
    let addressProof = { images: [], maxlimit: 3, remainlmt: 3, allowupdate: 1 };
    let idProof = { images: [], maxlimit: 3, remainlmt: 3, allowupdate: 1 };

    // Check if data has a proofs array
    if (data?.proofs && Array.isArray(data.proofs)) {
      console.log('📦 Found proofs array with', data.proofs.length, 'items');
      setProofsData(data.proofs);

      data.proofs.forEach((proof) => {
        const ptypekey = proof.ptypekey || '';
        const maxlimit = proof.maxlimit || 3;
        const remainlmt = proof.remainlmt || 0;
        const allowupdate = proof.allowupdate || 0;

        console.log(`📄 Processing: ${proof.proofname} (${ptypekey})`);
        console.log(`   - Max: ${maxlimit}, Remaining: ${remainlmt}, AllowUpdate: ${allowupdate}`);

        // Extract valid images (non-empty URLs)
        const validImages = [];
        if (proof.imgs && Array.isArray(proof.imgs)) {
          proof.imgs.forEach((img, idx) => {
            if (img.url && img.url.trim()) {
              validImages.push({
                id: img.id || '',
                url: img.url,
                status: img.status || ''
              });
              console.log(`   ✓ Image ${idx}: ${img.url} (${img.status})`);
            }
          });
        }

        // Categorize by ptypekey
        if (ptypekey === 'photoProof') {
          photoProof = { images: validImages, maxlimit, remainlmt, allowupdate };
        } else if (ptypekey === 'addProofs') {
          addressProof = { images: validImages, maxlimit, remainlmt, allowupdate };
        } else if (ptypekey === 'idProofs') {
          idProof = { images: validImages, maxlimit, remainlmt, allowupdate };
        }
      });
    }

    console.log('✅ Final Processed Documents:', { photoProof, addressProof, idProof });

    setDocuments({
      photoProof,
      addressProof,
      idProof
    });
  };

  /**
   * Handle file upload
   * API Flow (matching client logs):
   * 1. custKYCpreview - Get current status
   * 2. uploadcustKYC - Upload the file
   * 3. cblCustDet - Get cable customer details
   * 4. primaryCustdet - Get primary customer details
   * 5. custKYCpreview - Refresh status
   */
  const handleFileUpload = async (type) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Map type to API prooftype (matching ptypekey from API)
      const prooftypeMap = {
        photoProof: 'photoProof',
        addressProof: 'addProofs',
        idProof: 'idProofs'
      };

      const prooftype = prooftypeMap[type];

      // Validate required fields
      if (!customerData?.customer_id) {
        setAlertConfig({
          type: 'error',
          title: 'Missing Information',
          message: 'Customer ID is missing. Please try again.'
        });
        setAlertOpen(true);
        return;
      }

      if (!prooftype) {
        setAlertConfig({
          type: 'error',
          title: 'Invalid Proof Type',
          message: 'Proof type is missing. Please try again.'
        });
        setAlertOpen(true);
        return;
      }

      try {
        setUploading(true);

        console.log('📤 [UPLOAD FLOW] Starting file upload...');
        console.log('📤 [UPLOAD FLOW] Customer ID:', customerData?.customer_id);
        console.log('📤 [UPLOAD FLOW] Proof Type:', prooftype);
        console.log('📤 [UPLOAD FLOW] Login User:', loginuser);
        console.log('📤 [UPLOAD FLOW] File:', {
          name: file.name,
          size: file.size,
          type: file.type
        });

        // Step 1: Upload the file
        console.log('📤 [STEP 1/5] Uploading file...');
        console.log('📤 [STEP 1/5] Calling uploadCustKYC with:', {
          cid: customerData?.customer_id,
          prooftype: prooftype,
          reqtype: 'update',
          loginuser: loginuser,
          file: file.name
        });

        const uploadResponse = await uploadCustKYC({
          cid: customerData?.customer_id,
          prooftype,
          reqtype: 'update',
          file,
          loginuser
        });

        console.log('📤 [STEP 1/5] Upload Response:', uploadResponse);

        if (uploadResponse?.status?.err_code !== 0) {
          console.error('❌ Upload failed:', uploadResponse?.status?.err_msg);
          setAlertConfig({
            type: 'error',
            title: 'Upload Failed',
            message: uploadResponse?.status?.err_msg || 'Unknown error occurred. Please try again.'
          });
          setAlertOpen(true);
          setUploading(false);
          return;
        }

        console.log('✅ [STEP 1/5] File uploaded successfully!');

        // Step 2: Get cable customer details (matching client flow)
        console.log('📤 [STEP 2/5] Fetching cable customer details...');
        try {
          const cableDetails = await getCableCustomerDetails(customerData?.customer_id);
          console.log('📤 [STEP 2/5] Cable Details:', cableDetails);
        } catch (err) {
          console.warn('⚠️ [STEP 2/5] Cable details fetch failed (non-critical):', err.message);
        }

        // Step 3: Get primary customer details (matching client flow)
        console.log('📤 [STEP 3/5] Fetching primary customer details...');
        try {
          const primaryDetails = await getPrimaryCustomerDetails(customerData?.customer_id);
          console.log('📤 [STEP 3/5] Primary Details:', primaryDetails);
        } catch (err) {
          console.warn('⚠️ [STEP 3/5] Primary details fetch failed (non-critical):', err.message);
        }

        // Step 4: Submit for verification (optional - some implementations skip this)
        console.log('📤 [STEP 4/5] Submitting for verification...');
        try {
          const submitResponse = await submitKYC({
            cid: customerData?.customer_id,
            loginuser,
            prooftype,
            reqtype: 'update'
          });

          console.log('📤 [STEP 4/5] Submit Response:', submitResponse);
        } catch (submitErr) {
          console.warn('⚠️ [STEP 4/5] Submit failed (non-critical):', submitErr.message);
        }

        // Step 5: Refresh KYC preview to get updated documents
        console.log('📤 [STEP 5/5] Refreshing document list...');
        await fetchDocuments();

        console.log('✅ [UPLOAD FLOW] Complete!');

        // Show success message
        setAlertConfig({
          type: 'success',
          title: 'Upload Successful!',
          message: 'Document uploaded successfully and is being processed.'
        });
        setAlertOpen(true);

      } catch (err) {
        console.error('❌ Error uploading file:', err);
        console.error('❌ Error details:', {
          message: err.message,
          stack: err.stack
        });
        setAlertConfig({
          type: 'error',
          title: 'Upload Error',
          message: `Failed to upload document: ${err.message}. Please try again.`
        });
        setAlertOpen(true);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  // Check if there are any documents uploaded
  const hasDocuments = () => {
    return documents.photoProof.images.length > 0 ||
      documents.addressProof.images.length > 0 ||
      documents.idProof.images.length > 0;
  };

  // Check if all documents are already approved
  const allDocumentsApproved = () => {
    if (!hasDocuments()) return false;

    const allPhotosApproved = documents.photoProof.images.length === 0 ||
      documents.photoProof.images.every(img => img.status === 'approved');
    const allAddressApproved = documents.addressProof.images.length === 0 ||
      documents.addressProof.images.every(img => img.status === 'approved');
    const allIdApproved = documents.idProof.images.length === 0 ||
      documents.idProof.images.every(img => img.status === 'approved');

    return allPhotosApproved && allAddressApproved && allIdApproved;
  };

  /**
   * Handle Final Submission - Re-verify all uploaded documents
   * API: ServiceApis/submitKYC
   * Request: { cid, loginuser, prooftype, reqtype }
   * 
   * Note: This triggers re-verification for all uploaded documents.
   * Individual uploads are already submitted automatically after upload.
   * This button allows users to request re-verification if needed.
   */
  const handleFinalSubmission = async () => {
    if (!customerData?.customer_id) {
      setAlertConfig({
        type: 'error',
        title: 'Missing Information',
        message: 'Customer ID is missing. Please try again.'
      });
      setAlertOpen(true);
      return;
    }

    // Check if there are any documents to submit
    if (!hasDocuments()) {
      setAlertConfig({
        type: 'warning',
        title: 'No Documents',
        message: 'Please upload at least one document before submitting.'
      });
      setAlertOpen(true);
      return;
    }

    // Check if all documents are already approved
    if (allDocumentsApproved()) {
      setConfirmConfig({
        title: 'Documents Already Approved',
        message: 'All your documents are already approved. Do you want to request re-verification?',
        onConfirm: () => { setConfirmOpen(false); proceedWithSubmission(); }
      });
      setConfirmOpen(true);
      return;
    } else {
      // Confirm submission
      setConfirmConfig({
        title: 'Request Verification',
        message: 'Request verification for all uploaded documents? Note: Documents are automatically submitted after upload. Use this only if you need to re-verify.',
        onConfirm: () => { setConfirmOpen(false); proceedWithSubmission(); }
      });
      setConfirmOpen(true);
      return;
    }
  };

  const proceedWithSubmission = async () => {
    try {
      setSubmitting(true);

      // API structure as per client documentation:
      // { cid: "iptvuser", loginuser: "superadmin", prooftype: "addProofs", reqtype: "update" }
      const proofTypes = [
        { key: 'photoProof', name: 'Photo Proof', hasDocuments: documents.photoProof.images.length > 0 },
        { key: 'addProofs', name: 'Address Proof', hasDocuments: documents.addressProof.images.length > 0 },
        { key: 'idProofs', name: 'ID Proof', hasDocuments: documents.idProof.images.length > 0 }
      ];

      // Only submit proof types that have documents
      const proofTypesToSubmit = proofTypes.filter(pt => pt.hasDocuments);

      if (proofTypesToSubmit.length === 0) {
        setAlertConfig({
          type: 'warning',
          title: 'No Documents Found',
          message: 'No documents found to submit. Please upload documents first.'
        });
        setAlertOpen(true);
        setSubmitting(false);
        return;
      }

      const results = [];

      console.log('📤 Final Submission - Customer:', customerData?.customer_id);
      console.log('📤 Requesting verification for:', proofTypesToSubmit.map(pt => pt.name).join(', '));

      // Submit each proof type sequentially
      for (const proofType of proofTypesToSubmit) {
        console.log(`📤 Requesting verification for ${proofType.name} (${proofType.key})...`);

        const response = await submitKYC({
          cid: customerData?.customer_id,
          loginuser: loginuser,
          prooftype: proofType.key,
          reqtype: 'update'
        });

        const isSuccess = response?.status?.err_code === 0 || response?.status?.err_code === '0';
        const errorMsg = response?.status?.err_msg || '';

        // Handle specific error messages
        let displayMessage = errorMsg;
        if (!isSuccess && errorMsg.includes('upload documents to submit')) {
          displayMessage = 'Already submitted - awaiting verification';
          // Treat as success since documents are already in the system
          results.push({
            name: proofType.name,
            success: true,
            message: displayMessage
          });
        } else {
          results.push({
            name: proofType.name,
            success: isSuccess,
            message: isSuccess ? 'Verification requested' : displayMessage
          });
        }

        console.log(`${isSuccess ? '✅' : '⚠️'} ${proofType.name}:`, displayMessage);
      }

      // Show results
      const successCount = results.filter(r => r.success).length;
      const resultText = results.map(r => `${r.success ? '✅' : '❌'} ${r.name}: ${r.message}`).join('\n');

      if (successCount === results.length) {
        setAlertConfig({
          type: 'success',
          title: 'Verification Requested Successfully!',
          message: resultText + '\n\nYour documents are under review.'
        });
        setAlertOpen(true);
      } else if (successCount > 0) {
        setAlertConfig({
          type: 'warning',
          title: 'Partial Success',
          message: resultText + '\n\nSome documents may need re-upload.'
        });
        setAlertOpen(true);
      } else {
        setAlertConfig({
          type: 'error',
          title: 'Verification Request Failed',
          message: resultText + '\n\nPlease ensure all documents are uploaded correctly.'
        });
        setAlertOpen(true);
      }

      // Refresh documents to get updated status
      await fetchDocuments();

    } catch (err) {
      console.error('❌ Submission error:', err);
      setAlertConfig({
        type: 'error',
        title: 'Submission Error',
        message: 'Verification request failed: ' + err.message + '. Please try again.'
      });
      setAlertOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate remaining slots for each document type
  const getRemainingSlots = (docType) => {
    const doc = documents[docType];
    return Math.max(0, doc.maxlimit - doc.images.length);
  };

  if (!customerData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">No customer data available</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Blue Gradient Header */}
      <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">Uploaded Documents</h1>
      </header>

      <div className="flex-1 px-4 py-5 pb-24 bg-gray-50">
        {loading ? (
          <Loader text="Loading documents..." />
        ) : uploading ? (
          <Loader text="Uploading document..." />
        ) : submitting ? (
          <Loader text="Submitting documents for verification..." />
        ) : (
          <div className="space-y-5">
            {/* Photo Proof Section */}
            <div className="bg-white rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                  <h3 className="text-indigo-600 text-lg font-semibold">Photo Proof</h3>
                </div>
                {documents.photoProof.allowupdate === 1 && documents.photoProof.images.length > 0 && (
                  <button
                    onClick={() => handleFileUpload('photoProof')}
                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Change Profile
                  </button>
                )}
              </div>

              <div className="flex gap-4">
                {documents.photoProof.images.length > 0 ? (
                  documents.photoProof.images.map((img, idx) => (
                    <div key={idx} className="flex flex-col items-center">
                      <img
                        src={img.url}
                        alt="Photo Proof"
                        className="w-28 h-32 object-cover rounded-xl border-2 border-indigo-200 shadow-md hover:shadow-lg transition-shadow duration-200"
                      />
                      {img.status && (
                        <span className={`text-sm mt-2 font-medium ${img.status === 'approved' ? 'text-green-600' : 'text-orange-500'}`}>
                          {img.status}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <button
                    onClick={() => handleFileUpload('photoProof')}
                    className="w-28 h-32 border-2 border-dashed border-indigo-300 rounded-xl flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-50 transition-all bg-white shadow-sm"
                  >
                    <span className="text-5xl text-indigo-600 font-light">+</span>
                  </button>
                )}
              </div>
            </div>

            {/* Address Proof Section */}
            <div className="bg-white rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                  <h3 className="text-indigo-600 text-lg font-semibold">Address Proof</h3>
                </div>
                {documents.addressProof.allowupdate === 1 && documents.addressProof.images.length > 0 && (
                  <button
                    onClick={() => handleFileUpload('addressProof')}
                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Change Address
                  </button>
                )}
              </div>

              <div className="flex gap-4 flex-wrap">
                {/* Existing images */}
                {documents.addressProof.images.map((img, idx) => (
                  <div key={idx} className="flex flex-col items-center">
                    <img
                      src={img.url}
                      alt={`Address Proof ${idx + 1}`}
                      className="w-28 h-32 object-cover rounded-xl border-2 border-indigo-200 shadow-md hover:shadow-lg transition-shadow duration-200"
                    />
                    {img.status && (
                      <span className={`text-sm mt-2 font-medium ${img.status === 'approved' ? 'text-green-600' : 'text-orange-500'}`}>
                        {img.status}
                      </span>
                    )}
                  </div>
                ))}

                {/* Add new document buttons based on remaining slots */}
                {[...Array(getRemainingSlots('addressProof'))].map((_, idx) => (
                  <button
                    key={`add-${idx}`}
                    onClick={() => handleFileUpload('addressProof')}
                    className="w-28 h-32 border-2 border-dashed border-indigo-300 rounded-xl flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-50 transition-all bg-white shadow-sm"
                  >
                    <span className="text-5xl text-indigo-600 font-light">+</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ID Proof Section */}
            <div className="bg-white rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                  <h3 className="text-indigo-600 text-lg font-semibold">ID Proof</h3>
                </div>
                {documents.idProof.allowupdate === 1 && documents.idProof.images.length > 0 && (
                  <button
                    onClick={() => handleFileUpload('idProof')}
                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Change Identity
                  </button>
                )}
              </div>

              <div className="flex gap-4 flex-wrap">
                {/* Existing images */}
                {documents.idProof.images.map((img, idx) => (
                  <div key={idx} className="flex flex-col items-center">
                    <img
                      src={img.url}
                      alt={`ID Proof ${idx + 1}`}
                      className="w-28 h-32 object-cover rounded-xl border-2 border-indigo-200 shadow-md hover:shadow-lg transition-shadow duration-200"
                    />
                    {img.status && (
                      <span className={`text-sm mt-2 font-medium ${img.status === 'approved' ? 'text-green-600' : 'text-orange-500'}`}>
                        {img.status}
                      </span>
                    )}
                  </div>
                ))}

                {/* Add new document buttons based on remaining slots */}
                {[...Array(getRemainingSlots('idProof'))].map((_, idx) => (
                  <button
                    key={`add-${idx}`}
                    onClick={() => handleFileUpload('idProof')}
                    className="w-28 h-32 border-2 border-dashed border-indigo-300 rounded-xl flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-50 transition-all bg-white shadow-sm"
                  >
                    <span className="text-5xl text-indigo-600 font-light">+</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Final Submission Button */}
            <div className="pt-4">
              <button
                onClick={handleFinalSubmission}
                disabled={submitting || uploading}
                className={`w-full font-bold py-4 rounded-lg text-base uppercase tracking-wider shadow-lg transition-all duration-200 ${submitting || uploading
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-gradient-to-r from-green-600 to-green-600 hover:from-green-700 hover:to-green-700 text-white hover:shadow-xl'
                  }`}
              >
                {submitting ? 'SUBMITTING...' : 'FINAL SUBMISSION'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Beautiful Alert Component */}
      <Alert
        isOpen={alertOpen}
        onClose={() => setAlertOpen(false)}
        type={alertConfig.type}
        title={alertConfig.title}
        message={alertConfig.message}
      />

      {/* Beautiful Confirm Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
