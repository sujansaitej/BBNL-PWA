import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  getCustKYCPreview,
  uploadCustKYC,
  submitKYC,
} from "../services/generalApis";
import { Alert, ConfirmDialog, Loader } from "@/components/ui";
import {
  isLowMemoryDevice,
  prepareForCameraCapture,
  markCameraOpen,
  clearCameraOpen,
  consumeCameraKillFlag,
} from "../utils/cameraPrep";
import PhotoCaptureModal from "../components/PhotoCaptureModal";

// Compress image client-side to fit under maxSizeMB using canvas.
// Strategy: step quality down first; if still over target, step dimensions
// down and retry. Guarantees the result is <= maxSizeMB for any decodable
// image (high-res document scans included).
async function compressImage(file, { maxWidth = 1280, maxHeight = 1280, maxSizeMB = 1.5 } = {}) {
  if (!file.type.startsWith("image/")) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const targetBytes = maxSizeMB * 1024 * 1024;
      const QUALITIES = [0.7, 0.55, 0.4, 0.3];
      const DIM_STEPS = [1.0, 0.75, 0.5, 0.35];
      let dimIdx = 0;

      const tryAtCurrentDim = () => {
        const baseW = img.width, baseH = img.height;
        const fitRatio = Math.min(maxWidth / baseW, maxHeight / baseH, 1.0);
        const scale = fitRatio * DIM_STEPS[dimIdx];
        const w = Math.max(1, Math.round(baseW * scale));
        const h = Math.max(1, Math.round(baseH * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);

        let qIdx = 0;
        const nextQuality = () => {
          canvas.toBlob(
            (blob) => {
              if (!blob) { resolve(file); return; }
              if (blob.size <= targetBytes) {
                const fileName = (file.name || "upload").replace(/\.\w+$/, ".jpg");
                resolve(new File([blob], fileName, { type: "image/jpeg", lastModified: Date.now() }));
                return;
              }
              if (qIdx < QUALITIES.length - 1) {
                qIdx++;
                nextQuality();
              } else if (dimIdx < DIM_STEPS.length - 1) {
                dimIdx++;
                tryAtCurrentDim();
              } else {
                const fileName = (file.name || "upload").replace(/\.\w+$/, ".jpg");
                resolve(new File([blob], fileName, { type: "image/jpeg", lastModified: Date.now() }));
              }
            },
            "image/jpeg",
            QUALITIES[qIdx]
          );
        };
        nextQuality();
      };
      tryAtCurrentDim();
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}

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

  // Upload options bottom sheet state
  const [uploadOptionsOpen, setUploadOptionsOpen] = useState(false);
  const [uploadOptionsType, setUploadOptionsType] = useState(null);
  // In-page camera modal — replaces the native <input capture> flow
  // so MIUI / low-RAM Android can't kill the tab mid-capture.
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);

  // Store the full proofs array from API to track maxlimit, remainlmt, etc.
  const [proofsData, setProofsData] = useState([]);

  // Processed documents for display
  // Default limits must match Register.jsx contract:
  //   Customer Photo = max 1, Address Proof = max 3, ID Proof = max 2.
  const [documents, setDocuments] = useState({
    photoProof: { images: [], maxlimit: 1, remainlmt: 1, allowupdate: 1 },
    addressProof: { images: [], maxlimit: 3, remainlmt: 3, allowupdate: 1 },
    idProof: { images: [], maxlimit: 2, remainlmt: 2, allowupdate: 1 }
  });

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const loginuser = user?.username || 'superadmin';

  useEffect(() => {
    if (!kycData && customerData) {
      fetchDocuments();
    } else if (kycData) {
      processKYCData(kycData);
    }
    // Detect tab kill during a previous document-camera session (MIUI /
    // Redmi / low-RAM phones). The user lost their photo in memory but
    // everything server-side is untouched — they just need to retake.
    if (consumeCameraKillFlag()) {
      setAlertConfig({
        type: 'info',
        title: 'Camera reloaded the page',
        message: 'Your previous photo was lost when the camera reloaded the page. Please tap the document tile and retake the photo.',
      });
      setAlertOpen(true);
    }
    // One-time heads-up on known-aggressive memory managers so the user
    // isn't surprised if the page reloads mid-capture.
    try {
      if (isLowMemoryDevice() && !sessionStorage.getItem('miui_camera_hint_shown')) {
        sessionStorage.setItem('miui_camera_hint_shown', '1');
        setAlertConfig({
          type: 'info',
          title: 'Tip',
          message: 'On this phone the camera can briefly reload the page. If that happens, just retake the photo — the rest of your progress is saved.',
        });
        setAlertOpen(true);
      }
    } catch (_) {}
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

      if (response?.status?.err_code === 0 && response?.body) {
        processKYCData(response.body);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
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
    let photoProof = { images: [], maxlimit: 1, remainlmt: 1, allowupdate: 1 };
    let addressProof = { images: [], maxlimit: 3, remainlmt: 3, allowupdate: 1 };
    let idProof = { images: [], maxlimit: 2, remainlmt: 2, allowupdate: 1 };

    if (data?.proofs && Array.isArray(data.proofs)) {
      setProofsData(data.proofs);

      data.proofs.forEach((proof) => {
        const ptypekey = proof.ptypekey || '';
        // Per-type hard cap — must match Register.jsx. If the backend
        // ever returns more images than allowed (e.g. stale filerefid
        // leakage from a previous aborted session), we cap the render
        // here so the operator never sees more than the contract.
        const hardCapFor = (key) =>
          key === 'photoProof' ? 1 :
          key === 'addProofs' ? 3 :
          key === 'idProofs' ? 2 : 3;
        const cap = hardCapFor(ptypekey);
        const maxlimit = Math.min(proof.maxlimit || cap, cap);
        const remainlmt = proof.remainlmt || 0;
        const allowupdate = proof.allowupdate || 0;

        const validImages = [];
        if (proof.imgs && Array.isArray(proof.imgs)) {
          proof.imgs.forEach((img) => {
            if (img.url && img.url.trim()) {
              validImages.push({ id: img.id || '', url: img.url, status: img.status || '' });
            }
          });
        }
        // Safety slice — never render more than the contract, even if
        // the server returned extras due to the filerefid-leak bug.
        const cappedImages = validImages.slice(0, maxlimit);

        if (ptypekey === 'photoProof') {
          photoProof = { images: cappedImages, maxlimit, remainlmt, allowupdate };
        } else if (ptypekey === 'addProofs') {
          addressProof = { images: cappedImages, maxlimit, remainlmt, allowupdate };
        } else if (ptypekey === 'idProofs') {
          idProof = { images: cappedImages, maxlimit, remainlmt, allowupdate };
        }
      });
    }

    setDocuments({ photoProof, addressProof, idProof });
  };

  // Show the upload options bottom sheet (Camera / Files).
  // Camera → PhotoCaptureModal (in-page camera, no OS tab-kill risk).
  // Files → native picker (gallery + PDFs).
  const handleFileUpload = (type) => {
    setUploadOptionsType(type);
    setUploadOptionsOpen(true);
  };

  // Process the selected file (shared by camera and file picker)
  const processFileUpload = async (rawFile, type) => {
    if (!rawFile) return;

    const MAX_FILE_SIZE_MB = 2; // server accepts up to 2 MB per file
    const MAX_RAW_SIZE_MB = 20; // reject absurdly large raw captures (HEIC/large PDFs)

    // HEIC/HEIF files from iOS Photo Library cannot be decoded by the
    // browser's <img> element on most devices (Android, older iOS), so
    // compressImage silently returns the raw multi-MB file and the upload
    // fails. Surface a clear message up front telling the user what to
    // do instead of letting them wait and see a generic failure.
    const nameLower = (rawFile.name || '').toLowerCase();
    const isHeic = /heic|heif/i.test(rawFile.type || '') ||
                   nameLower.endsWith('.heic') || nameLower.endsWith('.heif');
    if (isHeic) {
      setAlertConfig({
        type: 'error',
        title: 'Unsupported Image Format',
        message: 'This image is in HEIC format, which this device cannot upload. Tap Camera to take a fresh photo, or on iPhone go to Settings → Camera → Formats → Most Compatible and retry.',
      });
      setAlertOpen(true);
      return;
    }

    // Reject obviously huge files up front so the user isn't waiting on a
    // long compression pass that will still be rejected later.
    if (rawFile.size > MAX_RAW_SIZE_MB * 1024 * 1024) {
      const rawMB = (rawFile.size / (1024 * 1024)).toFixed(2);
      setAlertConfig({
        type: 'error',
        title: 'File Too Large',
        message: `File size (${rawMB} MB) is too large. Please retake the photo at a lower resolution or choose a smaller file.`,
      });
      setAlertOpen(true);
      return;
    }

    // Compress image before upload to stay under the server 2 MB limit.
    // Non-image files (PDF) pass through compressImage unchanged.
    const file = await compressImage(rawFile);

    // Post-compression guard: if the file is still over the server limit
    // (e.g. HEIC that couldn't be decoded and fell through as-is, or a PDF
    // that compressImage doesn't touch), fail fast with a clear message.
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      setAlertConfig({
        type: 'error',
        title: 'File Too Large',
        message: `File size (${sizeMB} MB) exceeds the ${MAX_FILE_SIZE_MB} MB limit. Please retake the photo or choose a smaller image.`,
      });
      setAlertOpen(true);
      return;
    }

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

      // Step 1: Upload the file (the only blocking step)
      const uploadResponse = await uploadCustKYC({
        cid: customerData?.customer_id,
        prooftype,
        reqtype: 'update',
        file,
        loginuser
      });

      if (uploadResponse?.status?.err_code !== 0) {
        setAlertConfig({
          type: 'error',
          title: 'Upload Failed',
          message: uploadResponse?.status?.err_msg || 'Unknown error occurred. Please try again.'
        });
        setAlertOpen(true);
        setUploading(false);
        return;
      }

      // Upload succeeded — show success immediately, run remaining steps in parallel
      setAlertConfig({
        type: 'success',
        title: 'Upload Successful!',
        message: 'Document uploaded successfully and is being processed.'
      });
      setAlertOpen(true);
      setUploading(false);

      // Finalize the KYC submission, then refresh the document list.
      // (Previously this also warmed the customer-detail cache via the
      // unauthenticated primaryCustdet/cblCustDet endpoints — removed; those
      // calls exposed customer PII without auth and the results were discarded.)
      Promise.allSettled([
        submitKYC({ cid: customerData?.customer_id, loginuser, prooftype, reqtype: 'update' }).catch(() => {}),
      ]).then(() => {
        // Refresh document list after all background tasks complete
        fetchDocuments();
      });

    } catch (err) {
      console.error('Upload error:', err);
      setAlertConfig({
        type: 'error',
        title: 'Upload Error',
        message: `Failed to upload document: ${err.message}. Please try again.`
      });
      setAlertOpen(true);
      setUploading(false);
    }
  };

  // Open camera — in-page modal, not the native <input capture>.
  // Keeps the browser tab foregrounded throughout capture so MIUI /
  // low-RAM phones can't kill us between shutter and upload.
  const handleCameraCapture = () => {
    setUploadOptionsOpen(false);
    setPhotoCaptureOpen(true);
  };

  // Open Media picker — single tap straight to the device gallery.
  //
  // accept="image/*" is the value that consistently routes to the
  // gallery / system Photo Picker on every Android skin tested:
  //   - Pixel / stock Android 13+: system Photo Picker (no Camera)
  //   - Samsung One UI: Gallery picker (no Camera)
  //   - MIUI / Redmi / HyperOS: MIUI Gallery (no Camera tile)
  //   - iOS: Photos picker
  //
  // PDF support intentionally dropped from this button — KYC PDFs
  // were rare and the UX cost (chooser-with-Camera on MIUI on every
  // tap) wasn't worth it. Operators can take a photo of paper
  // documents via the Camera button instead. If PDF upload becomes
  // a hard requirement later, add a separate "Document" button so
  // its accept="application/pdf" can stay isolated from the gallery.
  const handleFilePick = () => {
    const type = uploadOptionsType;
    markCameraOpen();
    prepareForCameraCapture();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => {
      try { document.body.removeChild(input); } catch (_) {}
      clearCameraOpen();
    };
    input.onchange = (e) => {
      setUploadOptionsOpen(false);
      const file = e.target.files[0];
      if (!file) { cleanup(); return; }
      // Belt-and-braces filter — accept="image/*" already restricts
      // at the OS level, but a stray non-image file gets a clear
      // message rather than a generic upload failure.
      const okMime = /^image\/(jpeg|jpg|png|gif|webp|bmp)$/i;
      const okExt = /\.(jpe?g|png|gif|webp|bmp)$/i;
      const looksOk = okMime.test(file.type || '') || okExt.test(file.name || '');
      if (!looksOk) {
        setAlertConfig({
          type: 'error',
          title: 'Unsupported File',
          message: 'Please pick a JPG, PNG, GIF, WebP, or BMP image.',
        });
        setAlertOpen(true);
        cleanup();
        return;
      }
      processFileUpload(file, type);
      cleanup();
    };
    input.addEventListener('cancel', cleanup);
    // CRITICAL: click() must happen in the synchronous call stack of the
    // user's tap event. Calling setUploadOptionsOpen(false) before click()
    // triggers a React re-render that breaks the user-gesture chain on
    // Android Chrome and iOS Safari, causing the file picker to not open.
    input.click();
    setUploadOptionsOpen(false);
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

      const proofTypes = [
        { key: 'photoProof', name: 'Photo Proof', hasDocuments: documents.photoProof.images.length > 0 },
        { key: 'addProofs', name: 'Address Proof', hasDocuments: documents.addressProof.images.length > 0 },
        { key: 'idProofs', name: 'ID Proof', hasDocuments: documents.idProof.images.length > 0 }
      ];

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

      // Submit ALL proof types in PARALLEL for speed
      const settled = await Promise.allSettled(
        proofTypesToSubmit.map(proofType =>
          submitKYC({
            cid: customerData?.customer_id,
            loginuser: loginuser,
            prooftype: proofType.key,
            reqtype: 'update'
          }).then(response => ({ proofType, response }))
        )
      );

      const results = settled.map((result, idx) => {
        const proofType = proofTypesToSubmit[idx];
        if (result.status === 'rejected') {
          return { name: proofType.name, success: false, message: result.reason?.message || 'Request failed' };
        }
        const { response } = result.value;
        const isSuccess = response?.status?.err_code === 0 || response?.status?.err_code === '0';
        const errorMsg = response?.status?.err_msg || '';

        if (!isSuccess && errorMsg.includes('upload documents to submit')) {
          return { name: proofType.name, success: true, message: 'Already submitted - awaiting verification' };
        }
        return { name: proofType.name, success: isSuccess, message: isSuccess ? 'Verification requested' : errorMsg };
      });

      const successCount = results.filter(r => r.success).length;
      const resultText = results.map(r => `${r.success ? '✅' : '❌'} ${r.name}: ${r.message}`).join('\n');

      if (successCount === results.length) {
        setAlertConfig({ type: 'success', title: 'Verification Requested Successfully!', message: resultText + '\n\nYour documents are under review.' });
      } else if (successCount > 0) {
        setAlertConfig({ type: 'warning', title: 'Partial Success', message: resultText + '\n\nSome documents may need re-upload.' });
      } else {
        setAlertConfig({ type: 'error', title: 'Verification Request Failed', message: resultText + '\n\nPlease ensure all documents are uploaded correctly.' });
      }
      setAlertOpen(true);

      // Refresh documents in background
      fetchDocuments();

    } catch (err) {
      console.error('Submission error:', err);
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
      <div className="min-h-dvh flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">No customer data available</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col bg-white">
      {/* Blue Gradient Header */}
      <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
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
                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-shadow duration-200 shadow-md hover:shadow-lg"
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
                        <span className={`text-sm mt-2 font-medium ${img.status === 'approved' ? 'text-purple-600' : 'text-orange-500'}`}>
                          {img.status}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <button
                    onClick={() => handleFileUpload('photoProof')}
                    className="w-28 h-32 border-2 border-dashed border-indigo-300 rounded-xl flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-50 transition-colors bg-white shadow-sm"
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
                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-shadow duration-200 shadow-md hover:shadow-lg"
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
                      <span className={`text-sm mt-2 font-medium ${img.status === 'approved' ? 'text-purple-600' : 'text-orange-500'}`}>
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
                    className="w-28 h-32 border-2 border-dashed border-indigo-300 rounded-xl flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-50 transition-colors bg-white shadow-sm"
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
                    className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-shadow duration-200 shadow-md hover:shadow-lg"
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
                      <span className={`text-sm mt-2 font-medium ${img.status === 'approved' ? 'text-purple-600' : 'text-orange-500'}`}>
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
                    className="w-28 h-32 border-2 border-dashed border-indigo-300 rounded-xl flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-50 transition-colors bg-white shadow-sm"
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
                className={`w-full font-bold py-4 rounded-lg text-base uppercase tracking-wider shadow-lg transition-shadow duration-200 ${submitting || uploading
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white hover:shadow-xl'
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

      {/* In-page camera modal — replaces native <input capture> so MIUI
          / low-RAM phones can't kill the tab between shutter and upload.
          onCapture runs synchronously inside the user-gesture chain. */}
      <PhotoCaptureModal
        isOpen={photoCaptureOpen}
        title={
          uploadOptionsType === 'photoProof' ? 'Take Customer Photo'
          : uploadOptionsType === 'addressProof' ? 'Capture Address Proof'
          : uploadOptionsType === 'idProof' ? 'Capture ID Proof'
          : 'Take Photo'
        }
        fileName={`${uploadOptionsType || 'capture'}.jpg`}
        onCapture={(file) => {
          setPhotoCaptureOpen(false);
          if (file) processFileUpload(file, uploadOptionsType);
        }}
        onClose={() => setPhotoCaptureOpen(false)}
      />

      {/* Upload Options Bottom Sheet */}
      {uploadOptionsOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          {/* Backdrop */}
          <div
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
            onClick={() => setUploadOptionsOpen(false)}
          />
          {/* Bottom Sheet */}
          <div style={{ position: 'relative', width: '100%', backgroundColor: '#f9fafb', borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem', boxShadow: '0 -4px 20px rgba(0,0,0,0.15)', animation: 'slideUpSheet 0.3s ease-out', zIndex: 1 }}>
            {/* Cancel */}
            <div style={{ padding: '16px 20px 8px' }}>
              <button
                onClick={() => setUploadOptionsOpen(false)}
                style={{ color: '#2563eb', fontWeight: 500, fontSize: '16px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
            {/* Icons Row */}
            <div style={{ display: 'flex', gap: '24px', padding: '8px 20px', paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}>
              {/* Camera */}
              <button
                onClick={handleCameraCapture}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <div style={{ width: '64px', height: '64px', borderRadius: '16px', backgroundColor: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#374151" style={{ width: '32px', height: '32px' }}>
                    <path d="M12 9a3.75 3.75 0 1 0 0 7.5A3.75 3.75 0 0 0 12 9Z" />
                    <path fillRule="evenodd" d="M9.344 3.071a49.52 49.52 0 0 1 5.312 0c.967.052 1.83.585 2.332 1.39l.821 1.317c.24.383.645.643 1.11.71.386.054.77.113 1.152.177 1.432.239 2.429 1.493 2.429 2.909V18a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V9.574c0-1.416.997-2.67 2.429-2.909.382-.064.766-.123 1.151-.178a1.56 1.56 0 0 0 1.11-.71l.822-1.315a2.942 2.942 0 0 1 2.332-1.39ZM6.75 12.75a5.25 5.25 0 1 1 10.5 0 5.25 5.25 0 0 1-10.5 0Zm12-1.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                  </svg>
                </div>
                <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>Camera</span>
              </button>

              {/* Media picker — was "Files" before. Renamed to match
                  the reference app and match Register.jsx. Underlying
                  handleFilePick already uses the wildcard accept on
                  MIUI to bypass the image-with-Camera chooser. The
                  photo-stack icon makes the intent unambiguous,
                  avoiding the folder icon that read like "file
                  manager" to operators. */}
              <button
                onClick={handleFilePick}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <div style={{ width: '64px', height: '64px', borderRadius: '16px', backgroundColor: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2563eb" style={{ width: '32px', height: '32px' }}>
                    <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v9.75a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 15.75V6Zm1.5 0a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 .75.75v6.69l-3.22-3.22a.75.75 0 0 0-1.06 0L13.06 12.5l-2.97-2.97a.75.75 0 0 0-1.06 0L3 15.56V6Z" clipRule="evenodd" />
                    <path d="M16.5 8.25a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                  </svg>
                </div>
                <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>Media picker</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUpSheet {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
