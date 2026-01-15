import { useEffect, useState, useRef, forwardRef } from "react";
import Layout from "../layout/Layout";
import Terms from "../components/Terms";
import { useNavigate } from "react-router-dom";
import SignaturePad from "react-signature-canvas";
import { PhotoIcon, DocumentIcon, CheckCircleIcon, XCircleIcon, InformationCircleIcon, PencilSquareIcon, XMarkIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import {
  checkUsernameAvailability,
  checkEmailAvailability,
  checkMobileAvailability,
  uploadKycFile,
  submitRegistrationNecessities,
  getDeviceId,
} from "../services/registrationApis";
import { Modal } from "@/components/ui";

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
          onChange(val, name); // (value, name)
        } else {
          const clonedEvent = {
            ...e,
            target: { ...e.target, value: val, name },
          };
          onChange(clonedEvent); // (event)
        }
      }
    };
  const handleKeyDown = (e) => {
    if ((type === "email" || name.toLowerCase().includes("email")) && e.key === " ") {
      e.preventDefault();
    }
  };
  
  return (
    <div className="relative">
      <input
        id={name}
        // type={type}
        type={isPassword && showPassword ? "text" : type}
        inputMode={onlyNumbers ? "numeric" : undefined}
        name={name}
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        maxLength={len}
        placeholder=""
        // required={required}
        className={`peer w-full rounded-xl border p-3 text-sm dark:text-gray-700 bg-white outline-none transition ${cls ? cls : ""}
          ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"}
        `}
        {...props}
      />
      <label
        htmlFor={name}
        className={`absolute left-3 top-2 bg-white px-1 text-green-700 text-sm transition-all
          peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
          peer-focus:-top-2 peer-focus:text-xs
          ${value ? "-top-2.4 text-xs" : ""}
          ${error ? "text-red-500 peer-focus:text-red-500" : "peer-focus:text-blue-500"}
        `}
      >
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      {/* Eye Icon for Password Toggle */}
      {isPassword && (
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
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
const ThumbnailUploader = forwardRef(({ label, max = 1, username, fieldKey, multiple = false, error, required = false }, ref) => {
  const [files, setFiles] = useState([]); // local preview
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e) => {
    const selected = Array.from(e.target.files).slice(0, max - files.length);
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      setUploading(true);
      const apiRes = await uploadKycFile(username, file, fieldKey + (i + 1));
      
      setUploading(false);

      if (apiRes?.status?.err_code === 0) {
        const result = apiRes.body.result;

        // Save to localStorage
        const stored = JSON.parse(localStorage.getItem("filerefid") || "[]");
        stored.push(parseInt(result.id));
        localStorage.setItem("filerefid", JSON.stringify(stored));

        setFiles((prev) => [...prev, file]);
        switch (fieldKey) {
          case "photo":
            localStorage.setItem("photoFileId", result.id); break;
          case "addrproof":
            const apStored = JSON.parse(localStorage.getItem("addrproofIds") || "[]");
            apStored.push(parseInt(result.id));
            localStorage.setItem("addrproofIds", JSON.stringify(apStored));
            break;
          case "idcard":
            const idStored = JSON.parse(localStorage.getItem("idcardIds") || "[]");
            idStored.push(parseInt(result.id));
            localStorage.setItem("idcardIds", JSON.stringify(idStored));
            break;
        }
      } else {
        alert(apiRes?.status?.err_msg || "Upload failed");
      }
    }
  };

  const handleDelete = (idx) => {
    const newFiles = [...files];
    newFiles.splice(idx, 1);
    setFiles(newFiles);

    // Remove from localStorage
    const stored = JSON.parse(localStorage.getItem("filerefid") || "[]");
    const updated = stored.filter((_, i) => i !== idx);
    localStorage.setItem("filerefid", JSON.stringify(updated));

    if(fieldKey === "photo"){
       localStorage.setItem("photoFileId", "");
    } else if(fieldKey === "addrproof"){
      const aapStored = JSON.parse(localStorage.getItem("addrproofIds") || "[]");
      const updated = aapStored.filter((_, i) => i !== idx);
      localStorage.setItem("addrproofIds", JSON.stringify(updated));
    } else if(fieldKey === "idcard"){
      const aidStored = JSON.parse(localStorage.getItem("idcardIds") || "[]");
      const updated = aidStored.filter((_, i) => i !== idx);
      localStorage.setItem("idcardIds", JSON.stringify(updated));
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
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
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
            <input type="file" accept="image/*;capture=camera" multiple={multiple} className="hidden" onChange={handleFileChange} />
          </label>
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

// Small component to let user move a marker and update parent with lat/lng
function LocationPicker({ center, onChange }) {
  const [pos, setPos] = useState(center);
  function LocationMarker() {
    useMapEvents({
      click(e) {
        setPos(e.latlng);
        onChange(e.latlng);
      },
      dragend() {
        // no-op
      },
    });
    return pos ? (
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
    ) : null;
  }
  return (
    <MapContainer center={center} zoom={14} scrollWheelZoom={true} style={{ height: 400, width: "100%" }}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <LocationMarker />
    </MapContainer>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
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
  });

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
      alert("Please write signature");
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
        const stored = JSON.parse(localStorage.getItem("filerefid") || "[]");
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
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setMapPos({ lat: latitude, lng: longitude }); // center the map
          reverseGeocode(latitude, longitude); // also fetch address
          setShowMap(true); // finally show the map modal
        },
        (err) => {
          console.error("Geolocation error:", err);
          setShowMap(true); // fallback: just open map with existing center
        }
      );
    } else {
      alert("Geolocation not supported by your browser");
      setShowMap(true);
    }
  }
  // reverse geocode using Nominatim
  async function reverseGeocode(lat, lng) {
    try {
      const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    //   const u = `/nominatim/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
      const r = await fetch(u, { headers: { "User-Agent": "MyApp/1.0 (contact@example.com)" } });
      if (!r.ok) throw new Error("Geocode error");
      const d = await r.json();
      const addr = d.address || {};

      form.houseno = addr.house_number || "";
      form.floor = addr.floor || "";
      form.main = addr.street || "";
      form.cross = addr.road || "";
      form.area = addr.suburb || addr.neighbourhood || "";
      form.city = addr.city || addr.town || addr.village || "";
      form.post = addr.suburb || "";
      form.pincode = addr.postcode || "";
      // form.state = addr.state || "";
      // form.country = addr.country || "";

      // const structuredAddress = {
      //   houseno: addr.house_number || "",
      //   floor: addr.floor || "",
      //   main: addr.street || "",
      //   cross: addr.road || "",
      //   area: addr.suburb || addr.neighbourhood || "",
      //   city: addr.city || addr.town || addr.village || "",
      //   post: addr.suburb || "",
      //   // state: addr.state || "",
      //   pincode: addr.postcode || "",
      //   // country: addr.country || "",
      // };

      const display = d.display_name || "";
      setReverseAddress(display);
      setForm((p) => ({ ...p, address: display, latitude: lat, longitude: lng }));

    } catch (err) {
      console.error("reverseGeocode", err);
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
    if (!JSON.parse(localStorage.getItem("addrproofIds") || "[]").length) newErrors.addrproof = "Address proof is required";
    if (!JSON.parse(localStorage.getItem("idcardIds") || "[]").length) newErrors.idcard = "ID proof is required";
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
      
      const logUname = JSON.parse(localStorage.getItem('user')).username;
      const regRes = await submitRegistrationNecessities(logUname);

      // Save data in localStorage
      const filerefid = JSON.parse(localStorage.getItem("filerefid") || "[]");
      const data = { ...form, isKirana: false }; //signature
      if (filerefid.length > 0) data.filerefid = filerefid;
      localStorage.setItem("registrationData", JSON.stringify(data));

      // window.location.href = "/plans";
      navigate("/plans");
    } catch (err) {
      console.error("Submit error:", err);
      alert("Submit failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // effect: try to get geolocation to center map
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMapPos({ lat, lng });
      },
      (err) => {
        // ignore
      },
      { enableHighAccuracy: true }
    );
  }, []);

  useEffect(() => {
    if (usernameStatus?.available) {
      setEditable(false);
    }
  }, [usernameStatus?.available]);

  return (
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
                {/* Custom tooltip */}
                {/* <div className="absolute -top-8 right-0 px-2 py-1 text-xs text-white bg-gray-800 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    Click to edit username
                </div> */}
              </div>
            )}
          </div>
          <button type="button" onClick={handleCheckUsername} disabled={checking} className="rounded-lg border border-blue-500 px-3 py-3 text-sm text-blue-500 hover:bg-blue-50">
            {checking ? "Checking..." : "Check"}
          </button>
        </div>
        {/* {usernameStatus && <p className={`text-xs ${usernameStatus.available ? "text-green-600" : "text-red-600"}`}>{usernameStatus.message}</p>} */}
        {usernameStatus && (
            <p
                className={`flex items-center gap-1 text-xs ${
                usernameStatus.available ? "text-green-600" : "text-red-600"
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
        {/* {mobileStatus && <p className={`text-xs ${mobileStatus.available ? "text-green-600" : "text-red-600"}`}>{mobileStatus.message}</p>} */}
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
                navigator.geolocation.getCurrentPosition((p) => {
                  reverseGeocode(p.coords.latitude, p.coords.longitude);
                });
              } else alert("Geolocation not available");
            }} className="rounded border px-3 py-1 text-sm dark:text-gray-700">Use current location</button>
          </div>
          {errors.address && <p className="text-xs text-red-500">{errors.address}</p>}
          {form.address &&
            <div className="grid grid-cols-2 md:grid-cols-2 gap-3 mt-3">
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
        <ThumbnailUploader label="Customer Photo" files={photo} setFiles={setPhoto} icon={PhotoIcon} max={1} username={form.username} fieldKey="photo" error={errors.photo} ref={refs.photo} required />
        <ThumbnailUploader label="Address Proof (max 3)" files={addressProof} setFiles={setAddressProof} icon={DocumentIcon} multiple max={3} username={form.username} fieldKey="addrproof" error={errors.addrproof} ref={refs.addrproof} required />
        <ThumbnailUploader label="ID Proof (max 2)" files={idProof} setFiles={setIdProof} icon={DocumentIcon} multiple max={2} username={form.username} fieldKey="idcard" error={errors.idcard} ref={refs.idcard} required />
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
              <button onClick={() => { setForm((p) => ({ ...p, address: reverseAddress })); setShowMap(false); }} disabled={reverseAddress ? false : true} className="bg-transparent hover:bg-indigo-500 text-blue-700 hover:text-white px-4 border border-blue-500 hover:border-transparent rounded py-1">
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
  );
}
