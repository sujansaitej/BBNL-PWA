import { useEffect, useState, useRef, forwardRef } from "react";
import Layout from "../layout/Layout";
import Terms from "../components/Terms";
import { useNavigate } from "react-router-dom";
import SignaturePad from "react-signature-canvas";
import { PhotoIcon, DocumentIcon, CheckCircleIcon, XCircleIcon, InformationCircleIcon, PencilSquareIcon, XMarkIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer, useMapEvents, useMap } from "react-leaflet";
import {
  checkUsernameAvailability,
  checkEmailAvailability,
  checkMobileAvailability,
  uploadKycFile,
  submitRegistrationNecessities,
  getDeviceId,
} from "../services/registrationApis";
import { Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser, safeGetArray } from "../services/safeStorage";
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

// debounce helper
function debounce(fn, wait = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const FloatingInput = forwardRef(({ label, type = "text", name, cls, value, len = "100", onChange, error, children, required = false, onlyNumbers = false, onlyLetters = false, forceLowercase = false, autoTrimSpaces = false, ...props }, ref) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

    const handleChange = (e) => {
      let val = e.target.value;

      if (type === "email" || name.toLowerCase().includes("email")) {
        val = val.toLowerCase();
      }

      if (onlyNumbers) {
        val = val.replace(/[^0-9]/g, "");
      }

      if (onlyLetters) {
        val = val.replace(/[^a-zA-Z\s]/g, "");
      }

      if (forceLowercase) {
        val = val.toLowerCase();
      }

      if (autoTrimSpaces) {
        val = val.replace(/\s/g, "");
      }

      if (len && val.length > len) {
        val = val.substring(0, len);
      }

      if (onChange) {
        if (onChange.length >= 2) {
          onChange(val, name);
        } else {
          const clonedEvent = {
            ...e,
            target: { ...e.target, value: val, name },
          };
          onChange(clonedEvent);
        }
      }
    };
  const handleKeyDown = (e) => {
    if ((type === "email" || name.toLowerCase().includes("email")) && e.key === " ") {
      e.preventDefault();
    }
  };

  return (
    <div className="relative overflow-visible pt-3">
      <input
        id={name}
        type={isPassword && showPassword ? "text" : type}
        inputMode={onlyNumbers ? "numeric" : undefined}
        name={name}
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        maxLength={len}
        placeholder=" "
        className={`peer w-full rounded-xl border px-3 pb-2.5 pt-4 text-base sm:text-sm dark:text-gray-700 bg-white outline-none transition-colors ${cls ? cls : ""}
          ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"}
        `}
        {...props}
      />
      <label
        htmlFor={name}
        className={`absolute left-2.5 z-[1] bg-white px-1.5 py-0.5 pointer-events-none transition-all duration-200
          top-0 text-xs font-medium
          peer-placeholder-shown:top-[26px] peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal
          peer-focus:top-0 peer-focus:text-xs peer-focus:font-medium
          ${error
            ? "text-red-500 peer-focus:text-red-500"
            : "text-purple-700 peer-placeholder-shown:text-gray-400 peer-focus:text-blue-600"
          }
        `}
      >
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      {isPassword && (
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-[26px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {showPassword ? (
            <EyeSlashIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </button>
      )}

      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
});

function smoothScrollTo(element, duration = 800) {
  const targetPosition = element.getBoundingClientRect().top + window.scrollY - 100; // little offset
  const startPosition = window.scrollY;
  const distance = targetPosition - startPosition;
  let startTime = null;

  function animation(currentTime) {
    if (!startTime) startTime = currentTime;
    const timeElapsed = currentTime - startTime;
    const run = ease(timeElapsed, startPosition, distance, duration);
    window.scrollTo(0, run);
    if (timeElapsed < duration) requestAnimationFrame(animation);
  }

  function ease(t, b, c, d) {
    // easeInOutQuad
    t /= d / 2;
    if (t < 1) return (c / 2) * t * t + b;
    t--;
    return (-c / 2) * (t * (t - 2) - 1) + b;
  }

  requestAnimationFrame(animation);
}

// const ThumbnailUploader = ({ label, multiple = false, max = 1, files, setFiles, icon: Icon }) => {
//   const handleFileChange = (e) => {
//     const selected = Array.from(e.target.files);
//     if (multiple) setFiles([...files, ...selected].slice(0, max));
//     else setFiles(selected.slice(0, 1));
//   };
//   return (
//     <div>
//       <p className="mb-2 text-sm font-medium text-gray-700">{label}</p>
//       <div className="flex gap-3 flex-wrap">
//         {files.map((f, i) => (
//           <img key={i} src={URL.createObjectURL(f)} alt="preview" className="h-16 w-16 rounded-lg border object-cover" />
//         ))}
//         {files.length < max && (
//           <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-400 hover:bg-gray-100">
//             <Icon className="h-6 w-6 text-gray-500" />
//             <input type="file" accept="image/*" multiple={multiple} className="hidden" onChange={handleFileChange} />
//           </label>
//         )}
//       </div>
//     </div>
//   );
// };
const ThumbnailUploader = forwardRef(({ label, max = 1, username, fieldKey, multiple = false, error, required = false, onRequestUpload, onBeforeCapture, onRequestPhotoCapture }, ref) => {
  const [files, setFiles] = useState([]); // local preview
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  // Process selected file(s) — shared by camera and file picker
  const processFiles = async (selectedFiles) => {
    const MAX_FILE_SIZE_MB = 2; // server accepts up to 2MB per file
    const MAX_RAW_SIZE_MB = 15; // reject absurdly large captures up front
    const selected = Array.from(selectedFiles).slice(0, max - files.length);
    for (let i = 0; i < selected.length; i++) {
      const rawFile = selected[i];

      // HEIC/HEIF from iOS Photo Library can't be decoded by <img> on most
      // devices, so compressImage silently returns the raw file and upload
      // fails. Surface a clear action-oriented message instead.
      const nameLower = (rawFile.name || '').toLowerCase();
      const isHeic = /heic|heif/i.test(rawFile.type || '') ||
                     nameLower.endsWith('.heic') || nameLower.endsWith('.heif');
      if (isHeic) {
        toast.add(
          'This image is in HEIC format. Tap Camera to take a fresh photo, or on iPhone go to Settings → Camera → Formats → Most Compatible and retry.',
          { type: "error", duration: 6000 }
        );
        continue;
      }

      // Validate raw file weight before showing the loader
      if (rawFile.size > MAX_RAW_SIZE_MB * 1024 * 1024) {
        const rawMB = (rawFile.size / (1024 * 1024)).toFixed(2);
        toast.add(
          `Image size (${rawMB} MB) is too large. Please retake with a lower resolution.`,
          { type: "error", duration: 5000 }
        );
        continue;
      }

      setUploading(true);

      try {
        // Compress image before upload to avoid server 2MB limit
        const file = await compressImage(rawFile);

        // Validate compressed image weight — if still over the server limit,
        // show a validation toast and skip upload instead of letting the
        // server reject it after a long round-trip.
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          toast.add(
            `Image size (${sizeMB} MB) exceeds the ${MAX_FILE_SIZE_MB} MB limit. Please retake the photo or choose a smaller image.`,
            { type: "error", duration: 5000 }
          );
          continue;
        }

        const apiRes = await uploadKycFile(username, file, fieldKey + (files.length + i + 1));

        if (apiRes?.status?.err_code === 0) {
          const result = apiRes.body.result;

          // Save to localStorage
          const stored = safeGetArray("filerefid");
          stored.push(parseInt(result.id));
          localStorage.setItem("filerefid", JSON.stringify(stored));

          setFiles((prev) => [...prev, file]);
          switch (fieldKey) {
            case "photo":
              localStorage.setItem("photoFileId", result.id); break;
            case "addrproof":
              const apStored = safeGetArray("addrproofIds");
              apStored.push(parseInt(result.id));
              localStorage.setItem("addrproofIds", JSON.stringify(apStored));
              break;
            case "idcard":
              const idStored = safeGetArray("idcardIds");
              idStored.push(parseInt(result.id));
              localStorage.setItem("idcardIds", JSON.stringify(idStored));
              break;
          }
        } else {
          toast.add(apiRes?.status?.err_msg || "Upload failed", { type: "error" });
        }
      } catch (err) {
        console.error("File upload error:", err);
        toast.add("Upload failed. Please try again.", { type: "error" });
      } finally {
        setUploading(false);
      }
    }
  };

  // Open camera to capture photo — uses the in-page PhotoCaptureModal
  // instead of the native <input capture> flow. This keeps the browser
  // tab foregrounded throughout capture so MIUI / low-RAM Android can't
  // kill us mid-photo (see Bug 11). Falls back to the File picker if
  // the user's device has no camera or permission is denied.
  const handleCameraCapture = () => {
    // Still save the form draft — harmless on the in-page path and
    // protects against accidental navigation / low-memory reloads.
    if (onBeforeCapture) onBeforeCapture();
    if (onRequestPhotoCapture) {
      onRequestPhotoCapture((file) => {
        if (file) processFiles([file]);
      });
    }
  };

  // Open file picker to select from gallery/files.
  //
  // MIUI / Redmi treatment: any image-restricted accept value triggers
  // MIUI's "Select an image" chooser, which includes a Camera option
  // that tab-kills our PWA on capture. Detect MIUI and use accept="*/*"
  // so the operator lands in the file manager directly. On Samsung /
  // Pixel / iOS we keep the explicit extension list — those devices
  // honour it correctly. Validation downstream rejects non-image
  // selections.
  // Open Media picker — single tap straight to the device gallery.
  //
  // accept="image/*" is the value that consistently routes to the
  // gallery / system Photo Picker on every Android skin we've tested:
  //   - Pixel / stock Android 13+ → system Photo Picker (no Camera)
  //   - Samsung One UI → Gallery picker (no Camera)
  //   - MIUI / Redmi / HyperOS → MIUI Gallery (no Camera tile)
  //   - iOS → Photos picker
  //
  // We deliberately do NOT include explicit extensions or wildcard
  // (the previous values, ".jpg,.jpeg,..." and "*/*") because:
  //   - extension lists trigger MIUI's chooser-with-Camera-tile
  //   - "*/*" opens the Files / Documents app (not the gallery),
  //     which was the second-tap-confusion QA reported.
  // image/* is the canonical gallery-direct shape and works the same
  // on every device.
  const handleFilePick = () => {
    if (onBeforeCapture) onBeforeCapture();
    markCameraOpen();
    prepareForCameraCapture();
    document.activeElement?.blur();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (multiple) input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => {
      try { document.body.removeChild(input); } catch (_) {}
      clearCameraOpen();
      document.activeElement?.blur();
    };
    input.onchange = (e) => {
      const picked = Array.from(e.target.files || []);
      if (picked.length === 0) { cleanup(); return; }
      // accept="image/*" already filters to images at the OS level;
      // the regex below is belt-and-braces for the rare device that
      // lets through non-images.
      const okExt = /\.(jpe?g|png|gif|webp|bmp)$/i;
      const okMime = /^image\/(jpeg|jpg|png|gif|webp|bmp)$/i;
      const valid = picked.filter(f => okMime.test(f.type || '') || okExt.test(f.name || ''));
      if (valid.length > 0) processFiles(valid);
      cleanup();
    };
    input.addEventListener('cancel', cleanup);
    input.click();
  };

  // When + is clicked, pass camera/files handlers to parent to show bottom sheet
  const handlePlusClick = () => {
    if (uploading) return;
    // Bottom sheet gives the user both Camera (routes to our in-page
    // PhotoCaptureModal — no tab-kill risk) and Files (native file
    // picker — user can pick existing photos / PDFs from the gallery).
    if (onRequestUpload) {
      onRequestUpload({ onCamera: handleCameraCapture, onFiles: handleFilePick });
    }
  };

  const handleDelete = (idx) => {
    const newFiles = [...files];
    newFiles.splice(idx, 1);
    setFiles(newFiles);

    // Get the actual ID being deleted from field-specific storage
    let deletedId = null;
    try {
      if(fieldKey === "photo"){
         deletedId = parseInt(localStorage.getItem("photoFileId"));
         localStorage.setItem("photoFileId", "");
      } else if(fieldKey === "addrproof"){
        const aapStored = safeGetArray("addrproofIds");
        if (idx < aapStored.length) {
          deletedId = aapStored[idx];
          aapStored.splice(idx, 1);
          localStorage.setItem("addrproofIds", JSON.stringify(aapStored));
        }
      } else if(fieldKey === "idcard"){
        const aidStored = safeGetArray("idcardIds");
        if (idx < aidStored.length) {
          deletedId = aidStored[idx];
          aidStored.splice(idx, 1);
          localStorage.setItem("idcardIds", JSON.stringify(aidStored));
        }
      }

      // Remove the correct ID from global filerefid by value
      if (deletedId) {
        const stored = safeGetArray("filerefid");
        const idIdx = stored.indexOf(deletedId);
        if (idIdx !== -1) stored.splice(idIdx, 1);
        localStorage.setItem("filerefid", JSON.stringify(stored));
      }
    } catch (e) {
      console.error("Error cleaning up file references:", e);
    }
  };

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-700" ref={ref}>{label} {required && <span className="text-red-500">*</span>}</p>
      <div className="flex gap-3 flex-wrap">
        {files.map((file, idx) => (
          <div key={idx} className="relative">
            <img
              src={URL.createObjectURL(file)}
              alt="preview"
              className="h-16 w-16 rounded-lg border object-cover"
            />
            <button
              type="button"
              onClick={() => handleDelete(idx, fieldKey)}
              className="absolute -top-2 -right-2 rounded-full bg-red-500 p-1 text-white"
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          </div>
        ))}
        {files.length < max && (
          <button
            type="button"
            disabled={uploading}
            onClick={handlePlusClick}
            className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {uploading ? (
              <svg
                className="h-6 w-6 animate-spin text-blue-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
            ) : (
              <span className="text-gray-500">+</span>
            )}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
});

const customMarker = L.icon({
  iconUrl: import.meta.env.VITE_API_APP_DIR_PATH + "icons/marker.png",
  iconSize: [55, 55],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40],
});

// Recenter map when center prop changes — defined at module level to avoid
// React remounting the component on every parent render.
function RecenterMap({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center[0], center[1]]);
  return null;
}

// Stable module-level component for handling map click events.
// Defined outside LocationPicker so React never unmounts/remounts it on
// parent re-renders — fixes BUG-002 (Android tap-to-pick not registering).
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng);
    },
  });
  return null;
}

// Small component to let user move a marker and update parent with lat/lng
function LocationPicker({ center, onChange }) {
  const [pos, setPos] = useState(center);

  // Sync marker position when center prop changes (e.g. from geolocation)
  useEffect(() => {
    setPos({ lat: center[0], lng: center[1] });
  }, [center[0], center[1]]);

  const handleMapClick = (latlng) => {
    setPos(latlng);
    onChange(latlng);
  };

  return (
    <MapContainer center={center} zoom={14} scrollWheelZoom={true} style={{ height: 400, width: "100%" }}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <RecenterMap center={center} />
      <MapClickHandler onMapClick={handleMapClick} />
      {pos && (
        <Marker
          draggable
          position={pos}
          icon={customMarker}
          eventHandlers={{
            dragend(e) {
              const ll = e.target.getLatLng();
              setPos(ll);
              onChange(ll);
            },
          }}
        />
      )}
    </MapContainer>
  );
}

// Storage key for persisting form data across camera captures.
// On Android, opening the native camera via <input capture> can cause
// the OS to kill the browser tab AND clear sessionStorage with it, so we
// persist the draft to localStorage. It is cleared on successful submit
// and when the user navigates away from the Register page.
const REG_FORM_SESSION_KEY = 'register_form_draft';

const EMPTY_FORM = {
  username: "",
  firstname: "",
  lastname: "",
  mobileno: "",
  emailid: "",
  dob: "",
  password: "",
  cust_gstn: "",
  address: "",
  houseno: "",
  floor: "",
  main: "",
  cross: "",
  area: "",
  city: "",
  post: "",
  pincode: "",
  billaddress: "",
  latitude: "",
  longitude: "",
  photo: "",
  addrproof: [],
  idcard: [],
  termsAccepted: false,
};

function getInitialFormState() {
  try {
    const saved = localStorage.getItem(REG_FORM_SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Don't clear the draft here — keep it alive so a second camera
      // kill also restores correctly. It's cleared on successful submit
      // or when the user navigates away from the Register page.
      return parsed;
    }
  } catch (_) {}
  return { ...EMPTY_FORM };
}

export default function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(getInitialFormState);

  const refs = {
    username: useRef(null),
    firstname: useRef(null),
    lastname: useRef(null),
    mobileno: useRef(null),
    emailid: useRef(null),
    dob: useRef(null),
    password: useRef(null),
    cust_gstn: useRef(null),
    address: useRef(null),
    houseno: useRef(null),
    floor: useRef(null),
    main: useRef(null),
    cross: useRef(null),
    area: useRef(null),
    city: useRef(null),
    post: useRef(null),
    pincode: useRef(null),
    billaddress: useRef(null),
    photo: useRef(null),
    addrproof: useRef(null),
    idcard: useRef(null),
  };

  const [errors, setErrors] = useState({});
  // const [newErrors, setNewErrors] = useState({});
  const [photo, setPhoto] = useState([]); // File[]
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [addressProof, setAddressProof] = useState([]); // File[]
  const [idProof, setIdProof] = useState([]); // File[]
  const [signature, setSignature] = useState(null);
  const sigCanvas = useRef();

  // ── Form persistence across camera captures ──
  // Save form data to sessionStorage on every change so it survives
  // if Android kills the browser tab while the native camera is open.
  const formRef = useRef(form);
  formRef.current = form; // always points to latest form state

  const saveFormDraft = () => {
    try {
      localStorage.setItem(REG_FORM_SESSION_KEY, JSON.stringify(formRef.current));
    } catch (_) {}
  };

  // Auto-save form on every change (debounced to avoid excessive writes)
  useEffect(() => {
    const timer = setTimeout(() => saveFormDraft(), 300);
    return () => clearTimeout(timer);
  }, [form]);

  // Last-resort save when the page is about to be hidden/killed
  // (pagehide fires reliably on mobile, beforeunload does not)
  useEffect(() => {
    const onPageHide = () => saveFormDraft();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Clear the draft when leaving the Register page (unmount)
  useEffect(() => {
    return () => {
      // Only clear if navigating away, not if the page is being killed
      // (pagehide with persisted=true means the page is being cached, not destroyed)
      if (document.visibilityState !== 'hidden') {
        localStorage.removeItem(REG_FORM_SESSION_KEY);
      }
    };
  }, []);

  // Fresh-start cleanup: if there is no saved form draft on mount,
  // the operator is starting a brand-new customer registration — wipe
  // any file-reference IDs left over from a previous (possibly aborted)
  // session. Without this, filerefid / photoFileId / addrproofIds /
  // idcardIds accumulate across sessions and get attached to the next
  // customer on submit, which is exactly the "other user's photos show
  // up in new customer's Uploaded Documents" bug QA reported.
  useEffect(() => {
    const hasDraft = !!localStorage.getItem(REG_FORM_SESSION_KEY);
    if (!hasDraft) {
      localStorage.removeItem('photoFileId');
      localStorage.removeItem('addrproofIds');
      localStorage.removeItem('idcardIds');
      localStorage.removeItem('filerefid');
      localStorage.removeItem('registrationData');
    }
  }, []);

  // Detect if page was killed by Android while camera was open.
  // The app_camera_open flag is set before the camera launches and
  // cleared when the camera returns normally. If it's still set on
  // mount, the page was killed mid-capture → notify the user and
  // scroll the photo field into view so they can retry immediately.
  useEffect(() => {
    if (consumeCameraKillFlag()) {
      if (form.username) {
        toast.add(
          'Your form was saved but the photo was lost when the camera reloaded the page. Tap Customer Photo below to retake it.',
          { type: 'info', duration: 6000 }
        );
      }
      // Scroll to the photo field so the retake CTA is immediately visible.
      setTimeout(() => {
        try {
          const el = refs.photo?.current;
          if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } catch (_) {}
      }, 150);
    }
    // One-time device-specific warning for known-aggressive memory
    // managers (MIUI / Redmi / Xiaomi / budget Samsung). Shown only
    // once per session so it doesn't spam repeat visitors.
    try {
      if (isLowMemoryDevice() && !sessionStorage.getItem('miui_camera_hint_shown')) {
        sessionStorage.setItem('miui_camera_hint_shown', '1');
        toast.add(
          'On this phone the camera can briefly reload the page. Your form will be saved — just retake the photo if that happens.',
          { type: 'info', duration: 6000 }
        );
      }
    } catch (_) {}
  }, []);

  const [checking, setChecking] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [mobileStatus, setMobileStatus] = useState(null);

  const [showMap, setShowMap] = useState(false);
  const [mapPos, setMapPos] = useState({ lat: 13.00322, lng: 77.58960 }); // Default Bangalore, India
  const [reverseAddress, setReverseAddress] = useState("");

  const [modalOpen, setModalOpen] = useState(false);

  const [editable, setEditable] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [uploadSheet, setUploadSheet] = useState({ open: false, onCamera: null, onFiles: null });
  // Photo capture modal — rendered at parent level so every
  // ThumbnailUploader can request a capture via a shared instance.
  // The onCapture callback is stored here and invoked when the modal
  // hands back a File. Scoping it here also means we can keep exactly
  // one active modal even if the user somehow triggers two uploaders.
  const [photoCapture, setPhotoCapture] = useState({ open: false, onCapture: null, title: 'Take Photo', fileName: 'capture.jpg' });
  const openPhotoCapture = (fieldKey, onCaptureCb) => {
    setPhotoCapture({
      open: true,
      onCapture: onCaptureCb,
      title: fieldKey === 'photo' ? 'Take Customer Photo' :
             fieldKey === 'addrproof' ? 'Capture Address Proof' :
             fieldKey === 'idcard' ? 'Capture ID Proof' : 'Take Photo',
      fileName: `${fieldKey || 'capture'}.jpg`,
    });
  };
  const closePhotoCapture = () => setPhotoCapture({ open: false, onCapture: null, title: 'Take Photo', fileName: 'capture.jpg' });

  // debounce email check: when pattern satisfied
  const debouncedEmailCheck = useRef(
    debounce(async (value) => {
      try {
        const res = await checkEmailAvailability(value);
        setEmailStatus(res);
      } catch (e) {
        setEmailStatus({ available: false, message: "Error checking email" });
      }
    }, 700)
  ).current;

  // handle input changes
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((p) => ({ ...p, [name]: type === "checkbox" ? checked : value }));

    // realtime triggers:
    if (name === "emailid") {
      setEmailStatus(null);
      const newErrors = {};
      if (!value) newErrors.emailid = "Invalid Email ID";
      setErrors((p) => ({ ...p, [name]: newErrors.emailid || null }));
      // trigger when contains @ and . and at least 2 chars after last dot
      const val = value;
      const at = val.indexOf("@");
      const lastDot = val.lastIndexOf(".");
      if (at > -1 && lastDot > at && val.length - lastDot - 1 >= 2) {
        debouncedEmailCheck(val);
      }
    }

    if (name === "mobileno") {
      setMobileStatus(null);
      const digits = value.replace(/\D/g, "");
      const newErrors = {};
      if (value.charAt(0)<6) newErrors.mobileno = "Invalid mobile number";
      setErrors((p) => ({ ...p, [name]: newErrors.mobileno || null }));
      if (digits.length === 10) {
        // call API
        checkMobile(value).catch(() => {});
      }
    }
    if (name === "username") {
      setUsernameStatus(null);
    }
    if(value && errors[name]){
      setErrors((p) => ({ ...p, [name]: null }));
    }
  };

  // wrapper calls
  async function checkMobile(value) {
    setMobileStatus(null);
    try {
      const res = await checkMobileAvailability(value);
      setMobileStatus(res);
    } catch (e) {
      setMobileStatus({ available: false, message: "Error checking mobile number" });
    }
  }

  const isDisabled = usernameStatus?.available && !editable;
  // Username check button
  const handleCheckUsername = async () => {
    setErrors((p) => ({ ...p, username: null }));
    if (!form.username) {
      setErrors((p) => ({ ...p, username: "Enter username" }));
      return;
    } else if (!/^[A-Za-z0-9_]{6,16}$/.test(form.username)) {
      setErrors((p) => ({ ...p, username: "Username must be 6–16 characters. Only letters, numbers, and underscore(_) are allowed." }));
      return;
    }
    
    setChecking(true);
    setUsernameStatus(null);
    try {
      const res = await checkUsernameAvailability(form.username);
      setUsernameStatus(res);
    } catch (err) {
      setUsernameStatus({ available: false, message: "Error checking username" });
    } finally {
      setChecking(false);
    }
  };

  // signature helpers
  const clearSignature = () => {
    sigCanvas.current.clear();
    setSignature(null);
  };
  const saveSignature = () => {
    if (!sigCanvas.current.isEmpty()) {
      const dataUrl = sigCanvas.current.getCanvas().toDataURL("image/png");
      setSignature(dataUrl); // not used
      // signature -> 'signature' (we will convert dataURL -> blob)
      saveSign(dataUrl);
    } else {
      toast.add("Please write signature", { type: "error" });
    }
  };
  
  async function saveSign(dataUrl){
  // if (signature) {
      // convert dataURL to blob
      const res = await fetch(dataUrl);//console.log(res);
      const blob = await res.blob();
      const file = new File([blob], "signature.png", { type: blob.type });
      const docUp = await uploadKycFile(form.username, file, "signature");
      if (docUp?.status?.err_code === 0) {
        const result = docUp.body.result;
        const stored = safeGetArray("filerefid");
        stored.push(parseInt(result.id));
        localStorage.setItem("filerefid", JSON.stringify(stored));
        // alert("Signature saved");
      } else {
        // alert(docUp?.status?.err_msg || "Signature upload failed");
      }
      // newErrors.signature = (docUp?.status?.err_code === 0) ? null : docUp?.status?.err_msg || "Signature upload failed";
    // }
  }

  async function openMapgetLoc(){
    if (navigator.geolocation) {
      toast.add("Getting your location...", { type: "info", duration: 3000 });
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setMapPos({ lat: latitude, lng: longitude }); // center the map
          reverseGeocode(latitude, longitude); // also fetch address
          setShowMap(true); // finally show the map modal
        },
        (err) => {
          console.error("Geolocation error:", err);
          const msg = err.code === 1
            ? "Location permission denied. Please allow location access in Settings."
            : "Could not get location. You can pick manually on the map.";
          toast.add(msg, { type: "error" });
          setShowMap(true); // fallback: just open map with existing center
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
      );
    } else {
      toast.add("Geolocation not supported by your browser", { type: "error" });
      setShowMap(true);
    }
  }
  // reverse geocode using Nominatim
  async function reverseGeocode(lat, lng) {
    try {
      const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
      const r = await fetch(u);
      if (!r.ok) throw new Error("Geocode error");
      const d = await r.json();
      const addr = d.address || {};
      const display = d.display_name || "";
      setReverseAddress(display);
      setForm((p) => ({
        ...p,
        address: display,
        latitude: lat,
        longitude: lng,
        houseno: addr.house_number || "",
        floor: addr.floor || "",
        main: addr.street || "",
        cross: addr.road || "",
        area: addr.suburb || addr.neighbourhood || "",
        city: addr.city || addr.town || addr.village || "",
        post: addr.suburb || "",
        pincode: addr.postcode || "",
      }));
    } catch (err) {
      console.error("reverseGeocode", err);
      toast.add("Could not fetch address. Please try again.", { type: "error" });
    }
  }

  // when user picks a map position
  const onMapChange = (ll) => {
    setMapPos({ lat: ll.lat, lng: ll.lng });
    reverseGeocode(ll.lat, ll.lng);
  };

  const today = new Date();
  // Calculate max = today - 18 years
  const maxDate = new Date(
  today.getFullYear() - 18,
  today.getMonth(),
  today.getDate()
  ).toISOString().split("T")[0];

  // Calculate min = today - 100 years
  const minDate = new Date(
  today.getFullYear() - 100,
  today.getMonth(),
  today.getDate()
  ).toISOString().split("T")[0];

  // const closeTerms = () => {
  //   setModalOpen(false);
  // };

  // validation
  function validate() {
    const newErrors = {};
    if (!form.username) {
      newErrors.username = "Username is required";
    } else if (!/^[A-Za-z0-9_]{3,16}$/.test(form.username)) {
      newErrors.username =
        "Username must be 3–16 characters. Only letters, numbers, and underscore(_) are allowed.";
    }
    if (!form.firstname.trim()) newErrors.firstname = "First name is required";
    if (!form.lastname.trim()) newErrors.lastname = "Last name is required";
    if (!form.mobileno) newErrors.mobileno = "Mobile number is required";
    else if(!/^\d{10}$/.test(form.mobileno)) newErrors.mobileno = "Mobile number should be 10 digits";
    else if(form.mobileno.charAt(0)<6) newErrors.mobileno = "Invalid mobile number";

    if (!form.emailid) {
      newErrors.emailid = "Email ID is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.emailid)) {
      newErrors.emailid = "Invalid email";
    }

    if (form.cust_gstn) {
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.cust_gstn)) {
        newErrors.cust_gstn = "Invalid GST number";
      }
    }
    
    if (!form.dob) newErrors.dob = "DOB is required";
    else {
      const dob = new Date(form.dob);
      const age = new Date().getFullYear() - dob.getFullYear();
      if (age < 18) newErrors.dob = "Age must be 18+";
    }

    if (!form.password) {
      newErrors.password = "Password is required";
    } else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(form.password)) {
      newErrors.password =
        "Password must be minimum 8 characters and it should be the combination of at least one lowercase, uppercase, number, special character (@$!%*?&).";//"Password must contain at least one lowercase, uppercase, number, special character (@$!%*?&), and be at least 8 characters long.";
    }

    else if (["12345678", "password"].includes(form.password.toLowerCase())) newErrors.password = "Weak password";
    if (!form.address) newErrors.address = "Installation address is required";
    if(form.address){
      if (!form.houseno) newErrors.houseno = "House No. is required";
      if (!form.area) newErrors.area = "Area is required";
      if (!form.post) newErrors.post = "Post is required";
      if (!form.city) newErrors.city = "City is required";
      if (!form.pincode) newErrors.pincode = "Pincode is required";
      else if(!/^\d{6}$/.test(form.pincode)) newErrors.pincode = "Pincode should be 6 digits";
    }

    if (!form.billaddress) newErrors.billaddress = "Billing address is required";

    if (!localStorage.getItem("photoFileId")) newErrors.photo = "Customer photo is required";
    if (!safeGetArray("addrproofIds").length) newErrors.addrproof = "Address proof is required";
    if (!safeGetArray("idcardIds").length) newErrors.idcard = "ID proof is required";
    if (!signature) newErrors.signature = "Signature is required";
    
    if (!form.termsAccepted) newErrors.termsAccepted = "Accept the terms";

    //setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstErrorField = Object.keys(newErrors)[0];
      const fieldRef = refs[firstErrorField];
      if (fieldRef?.current) {
        fieldRef.current.focus();
        // fieldRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        smoothScrollTo(fieldRef.current, 1000);
      }
      return;
    }

    return Object.keys(newErrors).length === 0;
  }

  // KYC upload helper: will rename files to required names and post
  async function uploadAllKycFiles(username) {
    // photo -> photo1 (only first)
    if (photo.length > 0) {
      await uploadKycFile(username, "photo1", photo[0]);
    }
    // addressProof -> addrproof1..3
    for (let i = 0; i < addressProof.length; i++) {
      const name = `addrproof${i + 1}`;
      await uploadKycFile(username, name, addressProof[i]);
    }
    // idProof -> idcard1..2
    for (let i = 0; i < idProof.length; i++) {
      const name = `idcard${i + 1}`;
      await uploadKycFile(username, name, idProof[i]);
    }
    // signature -> 'signature' (we will convert dataURL -> blob)
    if (signature) {
      // convert dataURL to blob
      const res = await fetch(signature);
      const blob = await res.blob();
      const file = new File([blob], "signature.png", { type: blob.type });
      await uploadKycFile(username, "signature", file);
    }
  }

  // Final submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    localStorage.setItem("registrationData", "");
    // localStorage.setItem("filerefid", "");

    if (!validate()) return;
    setSubmitting(true);
    try {
      const username = form.username;
      // await uploadAllKycFiles(username);
      
      const logUname = getUser().username || "";
      const regRes = await submitRegistrationNecessities(logUname);

      // Save data in localStorage
      const filerefid = safeGetArray("filerefid");
      const data = { ...form, isKirana: false }; //signature
      if (filerefid.length > 0) data.filerefid = filerefid;
      localStorage.setItem("registrationData", JSON.stringify(data));

      // Clear the form draft and per-file staging keys on successful
      // submission so the next Add User starts empty.
      localStorage.removeItem(REG_FORM_SESSION_KEY);
      localStorage.removeItem("photoFileId");
      localStorage.removeItem("addrproofIds");
      localStorage.removeItem("idcardIds");
      localStorage.removeItem("filerefid");
      toast.add('Registration submitted successfully!', { type: 'success' });
      navigate("/plans");
    } catch (err) {
      console.error("Submit error:", err);
      toast.add('Submit failed. Please try again.', { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // effect: try to get geolocation to center map (low accuracy is faster on iPhone)
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMapPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    if (usernameStatus?.available) {
      setEditable(false);
    }
  }, [usernameStatus?.available]);

  return (
    <>
    <Layout>
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6 p-4" noValidate autoComplete="off">
      {/* ACCOUNT */}
      <div className="rounded-xl bg-white p-4 shadow space-y-3">
        <h2 className="text-lg font-semibold dark:text-gray-700">Account</h2>
        <div className="flex gap-2 items-start">
          <div className="relative w-full">
            <FloatingInput label="Username" name="username" cls="lowercase" ref={refs.username} value={form.username} onChange={handleChange} error={errors.username} disabled={isDisabled} forceLowercase={true} required />
            {isDisabled && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 group">
                <button
                    type="button"
                    onClick={() => setEditable(true)}
                    className="text-gray-500 hover:text-gray-700"
                >
                    <PencilSquareIcon className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={handleCheckUsername} disabled={checking} className="mt-3 rounded-xl border border-blue-500 px-4 pb-2.5 pt-4 text-sm text-blue-500 hover:bg-blue-50 shrink-0">
            {checking ? "Checking..." : "Check"}
          </button>
        </div>
        {/* {usernameStatus && <p className={`text-xs ${usernameStatus.available ? "text-purple-600" : "text-red-600"}`}>{usernameStatus.message}</p>} */}
        {usernameStatus && (
            <p
                className={`flex items-center gap-1 text-xs ${
                usernameStatus.available ? "text-purple-600" : "text-red-600"
                }`}
            >
                {usernameStatus.available ? (
                <CheckCircleIcon className="h-4 w-4" />
                ) : (
                <XCircleIcon className="h-4 w-4" />
                )}
                {usernameStatus.message}
            </p>
        )}
      </div>

      {/* KYC DETAILS */}
      <div className="rounded-xl bg-white p-4 shadow space-y-3">
        <h2 className="text-lg font-semibold dark:text-gray-700">KYC Details</h2>

        <FloatingInput label="First Name" name="firstname" ref={refs.firstname} value={form.firstname} onChange={handleChange} error={errors.firstname} required />
        <FloatingInput label="Last Name" name="lastname" ref={refs.lastname} value={form.lastname} onChange={handleChange} error={errors.lastname} onlyLetters required />

        <FloatingInput label="Mobile Number" name="mobileno" ref={refs.mobileno} value={form.mobileno} len={10} onChange={handleChange} error={errors.mobileno} onlyNumbers required />
        {/* {mobileStatus && <p className={`text-xs ${mobileStatus.available ? "text-purple-600" : "text-red-600"}`}>{mobileStatus.message}</p>} */}
        {mobileStatus && !mobileStatus.available && (
            <p className="flex items-center gap-1 text-xs text-red-600">{mobileStatus.message}</p>
        )}

        <FloatingInput label="Email ID" name="emailid" type="email" ref={refs.emailid} value={form.emailid} onChange={handleChange} autoTrimSpaces error={errors.emailid} required />
        {emailStatus && !emailStatus.available && <p className="text-xs text-red-600">{emailStatus.message}</p>}

        <FloatingInput label="Date of Birth" name="dob" type="date" ref={refs.dob} value={form.dob} onChange={handleChange} error={errors.dob} min={minDate} max={maxDate} required />
        <FloatingInput label="Password" name="password" type="password" ref={refs.password} value={form.password} onChange={handleChange} error={errors.password} required />
        <p className="flex gap-1.5 text-xs text-gray-500"><InformationCircleIcon className="h-4 w-4" />Password must be at least 8 chars and strong. "password" & "12345678" not allowed.</p>

        <FloatingInput label="GST Number (optional)" name="cust_gstn" ref={refs.cust_gstn} value={form.cust_gstn} len={15} onChange={handleChange} error={errors.cust_gstn} />

        {/* Installation address via map */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Installation Address <span className="text-red-500">*</span></label>
          <textarea name="address" value={form.address} onChange={handleChange} className="w-full text-sm dark:text-gray-700 bg-white rounded-xl border p-3" maxLength={300} ref={refs.address} />
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={openMapgetLoc} className="rounded border px-3 py-1 text-sm dark:text-gray-700">Pick on map</button>
            <button type="button" onClick={() => {
              // try geolocation fill if available
              if (navigator.geolocation) {
                toast.add("Getting your location...", { type: "info", duration: 3000 });
                navigator.geolocation.getCurrentPosition((p) => {
                  reverseGeocode(p.coords.latitude, p.coords.longitude);
                }, (err) => {
                  const msg = err.code === 1
                    ? "Location permission denied. Please allow location access in Settings."
                    : err.code === 3
                    ? "Location timed out. Please try again or check GPS settings."
                    : "Could not get your location. Please try again.";
                  toast.add(msg, { type: "error" });
                }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
              } else toast.add("Geolocation not available", { type: "error" });
            }} className="rounded border px-3 py-1 text-sm dark:text-gray-700">Use current location</button>
          </div>
          {errors.address && <p className="text-xs text-red-500">{errors.address}</p>}
          {form.address &&
            <div className="grid grid-cols-2 md:grid-cols-2 gap-x-3 gap-y-5 mt-3">
              <FloatingInput label="House/Flat No." name="houseno" ref={refs.houseno} value={form.houseno} onChange={handleChange} error={errors.houseno} required />
              <FloatingInput label="Floor" name="floor" ref={refs.floor} value={form.floor} onChange={handleChange} error={errors.floor} />
              <FloatingInput label="Cross" name="cross" ref={refs.cross} value={form.cross} onChange={handleChange} error={errors.cross} />
              <FloatingInput label="Area" name="area" ref={refs.area} value={form.area} onChange={handleChange} error={errors.area} required />
              <FloatingInput label="Main/Phase" name="main" ref={refs.main} value={form.main} onChange={handleChange} error={errors.main} />
              <FloatingInput label="Post" name="post" ref={refs.post} value={form.post} onChange={handleChange} error={errors.post} required />
              <FloatingInput label="City" name="city" ref={refs.city} value={form.city} onChange={handleChange} error={errors.city} required />
              <FloatingInput label="Pincode" name="pincode" ref={refs.pincode} value={form.pincode} len={6} onChange={handleChange} error={errors.pincode} onlyNumbers required />
            </div>
          }
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Billing Address <span className="text-red-500">*</span></label>
          <textarea name="billaddress" value={form.billaddress} onChange={handleChange} className="w-full text-sm dark:text-gray-700 bg-white rounded-xl border p-3" maxLength={300} ref={refs.billaddress} />
          <label className="flex items-center gap-2 text-sm mt-2 dark:text-gray-700">
            <input type="checkbox" onChange={(e) => setForm((p) => ({ ...p, billaddress: e.target.checked ? p.address : "" }))} className="[color-scheme:light]"/>
            Same as installation address
          </label>
          {errors.billaddress && <p className="text-xs text-red-500">{errors.billaddress}</p>}
        </div>
      </div>

      {/* KYC DOCUMENTS */}
      <div className="rounded-xl bg-white p-4 shadow space-y-3">
        <h2 className="text-lg font-semibold dark:text-gray-700">KYC Documents</h2>
        <ThumbnailUploader label="Customer Photo" files={photo} setFiles={setPhoto} icon={PhotoIcon} max={1} username={form.username} fieldKey="photo" error={errors.photo} ref={refs.photo} required onBeforeCapture={saveFormDraft} onRequestUpload={(handlers) => setUploadSheet({ open: true, ...handlers })} onRequestPhotoCapture={(cb) => openPhotoCapture('photo', cb)} />
        <ThumbnailUploader label="Address Proof (max 3)" files={addressProof} setFiles={setAddressProof} icon={DocumentIcon} multiple max={3} username={form.username} fieldKey="addrproof" error={errors.addrproof} ref={refs.addrproof} required onBeforeCapture={saveFormDraft} onRequestUpload={(handlers) => setUploadSheet({ open: true, ...handlers })} onRequestPhotoCapture={(cb) => openPhotoCapture('addrproof', cb)} />
        <ThumbnailUploader label="ID Proof (max 2)" files={idProof} setFiles={setIdProof} icon={DocumentIcon} multiple max={2} username={form.username} fieldKey="idcard" error={errors.idcard} ref={refs.idcard} required onBeforeCapture={saveFormDraft} onRequestUpload={(handlers) => setUploadSheet({ open: true, ...handlers })} onRequestPhotoCapture={(cb) => openPhotoCapture('idcard', cb)} />
      </div>

      {/* Signature */}
      <div className="rounded-xl bg-white p-4 shadow space-y-3">
        <h2 className="text-lg font-semibold dark:text-gray-700">Signature <span className="text-red-500">*</span></h2>
        <SignaturePad ref={sigCanvas} penColor="blue" canvasProps={{ className: "w-full h-40 border rounded-lg bg-gray-50" }} />
        <div className="flex gap-2">
          <button type="button" onClick={clearSignature} className="rounded border px-3 py-1 text-sm text-gray-500">Clear</button>
          <button type="button" onClick={saveSignature} className="rounded border px-3 py-1 text-sm text-blue-500">Save</button>
        </div>
        {signature && <img src={signature} alt="signature" className="h-16 mt-2 border rounded" />}
        {errors.signature && <p className="text-xs text-red-500">{errors.signature}</p>}
      </div>

      {/* Terms */}
      <div className="flex items-center gap-2">
        <input className="[color-scheme:light]" type="checkbox" name="termsAccepted" checked={form.termsAccepted} onChange={handleChange} />
        <span className="text-sm">I accept the <span className="text-violet-500" onClick={() => setModalOpen(true)}>terms & conditions</span></span>
      </div>
      {errors.termsAccepted && <p className="text-xs text-red-500">{errors.termsAccepted}</p>}

      {/* Submit */}
      <div>
        <button type="submit" disabled={submitting} className={`w-full rounded-lg border border-blue-500 px-4 py-2 text-blue-500 hover:bg-blue-50 flex justify-center items-center gap-2 ${submitting ? "opacity-60 cursor-not-allowed" : ""}`}>
          {submitting && <svg className="h-4 w-4 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>}
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>

      {/* MAP MODAL */}
      {showMap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowMap(false)} />
          <div className="bg-white rounded-lg p-4 max-w-2xl w-full z-50">
            <h3 className="text-md font-semibold">Pick Installation Location</h3>
            <p className="text-xs flex mb-1"><InformationCircleIcon className="h-4 w-4 mr-1" />Drag & drop the marker to change location</p>
            <LocationPicker center={[mapPos.lat, mapPos.lng]} onChange={(ll) => onMapChange(ll)} />

            <p className="mt-2 text-xs text-black-600">Selected Address: <span className="text-blue-600">{reverseAddress}</span></p>
            <div className="mt-2 flex gap-2">
              {/* <button type="button" onClick={() => { setForm((p) => ({ ...p, address: reverseAddress })); setShowMap(false); }} className="px-3 py-1 rounded border">Use this address</button> */}
              <button type="button" onClick={() => { setForm((p) => ({ ...p, address: reverseAddress })); setShowMap(false); }} disabled={reverseAddress ? false : true} className="bg-transparent hover:bg-indigo-500 text-blue-700 hover:text-white px-4 border border-blue-500 hover:border-transparent rounded py-1">
                Use this address
              </button>
              <button type="button" onClick={() => setShowMap(false)} className="bg-transparent hover:bg-red-500 text-red-700 hover:text-white px-4 border border-red-500 hover:border-transparent rounded py-1">Close</button>
            </div>
          </div>
        </div>
      )}
    </form>

    <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
      <Terms />
    </Modal>
    </Layout>

    {/* Upload Options Bottom Sheet — rendered OUTSIDE Layout to escape overflow-x-hidden */}
    {uploadSheet.open && (
      <div className="fixed inset-0 z-[9999] flex items-end justify-center" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/40"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onClick={() => setUploadSheet({ open: false, onCamera: null, onFiles: null })}
        />
        {/* Bottom Sheet */}
        <div className="relative w-full bg-gray-50 rounded-t-2xl shadow-2xl" style={{ animation: 'slideUpSheet 0.3s ease-out', position: 'relative', zIndex: 1 }}>
          {/* Cancel */}
          <div className="px-5 pt-4 pb-2">
            <button
              type="button"
              onClick={() => setUploadSheet({ open: false, onCamera: null, onFiles: null })}
              className="text-blue-600 font-medium text-base"
            >
              Cancel
            </button>
          </div>
          {/* Icons Row */}
          <div className="flex gap-6 px-5 pt-2" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))' }}>
            {/* Camera */}
            <button
              type="button"
              onClick={() => { setUploadSheet({ open: false, onCamera: null, onFiles: null }); uploadSheet.onCamera?.(); }}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-2xl bg-white shadow-md flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-gray-700">
                  <path d="M12 9a3.75 3.75 0 1 0 0 7.5A3.75 3.75 0 0 0 12 9Z" />
                  <path fillRule="evenodd" d="M9.344 3.071a49.52 49.52 0 0 1 5.312 0c.967.052 1.83.585 2.332 1.39l.821 1.317c.24.383.645.643 1.11.71.386.054.77.113 1.152.177 1.432.239 2.429 1.493 2.429 2.909V18a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V9.574c0-1.416.997-2.67 2.429-2.909.382-.064.766-.123 1.151-.178a1.56 1.56 0 0 0 1.11-.71l.822-1.315a2.942 2.942 0 0 1 2.332-1.39ZM6.75 12.75a5.25 5.25 0 1 1 10.5 0 5.25 5.25 0 0 1-10.5 0Zm12-1.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="text-xs text-gray-700 font-medium">Camera</span>
            </button>

            {/* Media picker — was "Files" before. Renamed to match
                the reference app and to make the intent unambiguous:
                this opens the device gallery / file manager for an
                EXISTING image, not the camera. The icon is a photo-
                stack so operators don't confuse it with the camera
                tile that MIUI's chooser used to show. The underlying
                handleFilePick already uses the wildcard accept value
                on MIUI to bypass MIUI's image chooser entirely. */}
            <button
              type="button"
              onClick={() => { setUploadSheet({ open: false, onCamera: null, onFiles: null }); uploadSheet.onFiles?.(); }}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-2xl bg-white shadow-md flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-blue-600">
                  {/* Photo-stack / media-library icon */}
                  <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v9.75a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 15.75V6Zm1.5 0a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 .75.75v6.69l-3.22-3.22a.75.75 0 0 0-1.06 0L13.06 12.5l-2.97-2.97a.75.75 0 0 0-1.06 0L3 15.56V6Z" clipRule="evenodd" />
                  <path d="M16.5 8.25a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                </svg>
              </div>
              <span className="text-xs text-gray-700 font-medium">Media picker</span>
            </button>
          </div>
        </div>
      </div>
    )}

    {/* In-page camera modal — replaces the native <input capture> path
        so MIUI / low-RAM Android phones don't kill the tab mid-capture.
        Files path is unchanged and uses the bottom sheet above. */}
    <PhotoCaptureModal
      isOpen={photoCapture.open}
      title={photoCapture.title}
      fileName={photoCapture.fileName}
      onCapture={(file) => {
        try { photoCapture.onCapture?.(file); } finally { closePhotoCapture(); }
      }}
      onClose={closePhotoCapture}
    />

    <style>{`
      @keyframes slideUpSheet {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    `}</style>
    </>
  );
}
