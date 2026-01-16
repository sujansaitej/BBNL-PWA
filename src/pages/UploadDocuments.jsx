import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { getCustKYCPreview, uploadCustKYC, submitKYC } from "../services/generalApis";

export default function UploadDocuments() {
  const location = useLocation();
  const navigate = useNavigate();
  const customerData = location.state?.customer;
  const kycData = location.state?.kycData;

  const [loading, setLoading] = useState(!kycData);
  const [uploading, setUploading] = useState(false);

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
   * API: uploadcustKYC
   * FormData: cid, prooftype, reqtype, loginuser, file
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
        alert('Customer ID is missing');
        return;
      }

      if (!prooftype) {
        alert('Proof type is missing');
        return;
      }

      try {
        setUploading(true);

        console.log('📤 Uploading document:', {
          cid: customerData?.customer_id,
          prooftype,
          reqtype: 'update',
          loginuser,
          fileName: file.name,
          fileSize: file.size
        });

        // API: uploadcustKYC with multipart/form-data
        const response = await uploadCustKYC({
          cid: customerData?.customer_id,
          prooftype,
          reqtype: 'update',
          file,
          loginuser
        });

        console.log('📤 Upload Response:', response);

        if (response?.status?.err_code === 0) {
          // Success - now submit the document for verification
          console.log('📤 Upload successful, now submitting for verification...');

          try {
            const submitResponse = await submitKYC({
              cid: customerData?.customer_id,
              loginuser,
              prooftype,
              reqtype: 'update'
            });

            console.log('📤 Submit Response:', submitResponse);

            if (submitResponse?.status?.err_code === 0) {
              alert('Document uploaded and submitted for verification!');
            } else {
              // Upload succeeded but submit had an issue - still show success
              alert('Document uploaded successfully!\n\nNote: ' + (submitResponse?.status?.err_msg || ''));
            }
          } catch (submitErr) {
            console.error('❌ Submit error (upload was successful):', submitErr);
            alert('Document uploaded successfully!');
          }

          // Refresh documents from API
          await fetchDocuments();
        } else {
          alert('Upload failed: ' + (response?.status?.err_msg || 'Unknown error'));
        }
      } catch (err) {
        console.error('❌ Error uploading file:', err);
        alert('Failed to upload document. Please try again.');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const [submitting, setSubmitting] = useState(false);

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
      alert('Customer ID is missing');
      return;
    }

    // Check if there are any documents to submit
    if (!hasDocuments()) {
      alert('Please upload at least one document before submitting.');
      return;
    }

    // Check if all documents are already approved
    if (allDocumentsApproved()) {
      const confirmResubmit = confirm('All your documents are already approved.\n\nDo you want to request re-verification?');
      if (!confirmResubmit) {
        return;
      }
    } else {
      // Confirm submission
      if (!confirm('Request verification for all uploaded documents?\n\nNote: Documents are automatically submitted after upload. Use this only if you need to re-verify.')) {
        return;
      }
    }

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
        alert('No documents found to submit.');
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
        alert('✅ Verification requested successfully!\n\n' + resultText + '\n\nYour documents are under review.');
      } else if (successCount > 0) {
        alert('⚠️ Partial success:\n\n' + resultText + '\n\nSome documents may need re-upload.');
      } else {
        alert('❌ Verification request failed:\n\n' + resultText + '\n\nPlease ensure all documents are uploaded correctly.');
      }

      // Refresh documents to get updated status
      await fetchDocuments();

    } catch (err) {
      console.error('❌ Submission error:', err);
      alert('Verification request failed: ' + err.message + '\n\nPlease try again.');
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
      {/* Teal Header */}
      <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-teal-500 shadow-sm">
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">Uploaded Documents</h1>
      </header>

      <div className="flex-1 px-4 py-5 pb-24 bg-gray-50">
        {loading ? (
          <div className="text-center py-10 text-gray-500">Loading documents...</div>
        ) : uploading ? (
          <div className="text-center py-10 text-orange-500 font-medium">Uploading document...</div>
        ) : submitting ? (
          <div className="text-center py-10 text-orange-500 font-medium">Submitting documents for verification...</div>
        ) : (
          <div className="space-y-5">
            {/* Photo Proof Section */}
            <div className="bg-white rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-600 text-base font-medium">Photo Proof</h3>
                {documents.photoProof.allowupdate === 1 && documents.photoProof.images.length > 0 && (
                  <button
                    onClick={() => handleFileUpload('photoProof')}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-6 rounded-full text-sm transition-colors shadow-sm"
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
                        className="w-24 h-28 object-cover rounded-lg border-2 border-gray-200 shadow-sm"
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
                    className="w-28 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center hover:border-orange-400 hover:bg-orange-50 transition-all bg-white"
                  >
                    <span className="text-5xl text-orange-500 font-light">+</span>
                  </button>
                )}
              </div>
            </div>

            {/* Address Proof Section */}
            <div className="bg-white rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-600 text-base font-medium">Address Proof</h3>
                {documents.addressProof.allowupdate === 1 && documents.addressProof.images.length > 0 && (
                  <button
                    onClick={() => handleFileUpload('addressProof')}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-6 rounded-full text-sm transition-colors shadow-sm"
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
                      className="w-24 h-28 object-cover rounded-lg border-2 border-gray-200 shadow-sm"
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
                    className="w-28 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center hover:border-orange-400 hover:bg-orange-50 transition-all bg-white"
                  >
                    <span className="text-5xl text-orange-500 font-light">+</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ID Proof Section */}
            <div className="bg-white rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-600 text-base font-medium">ID Proof</h3>
                {documents.idProof.allowupdate === 1 && documents.idProof.images.length > 0 && (
                  <button
                    onClick={() => handleFileUpload('idProof')}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-6 rounded-full text-sm transition-colors shadow-sm"
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
                      className="w-24 h-28 object-cover rounded-lg border-2 border-gray-200 shadow-sm"
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
                    className="w-28 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center hover:border-orange-400 hover:bg-orange-50 transition-all bg-white"
                  >
                    <span className="text-5xl text-orange-500 font-light">+</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Final Submission Button */}
            <div className="pt-4">
              <button
                onClick={handleFinalSubmission}
                disabled={submitting || uploading}
                className={`w-full font-semibold py-4 rounded-lg text-base uppercase tracking-wider shadow-md transition-colors ${submitting || uploading
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-orange-500 hover:bg-orange-600 text-white'
                  }`}
              >
                {submitting ? 'SUBMITTING...' : 'FINAL SUBMISSION'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
