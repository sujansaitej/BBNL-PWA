import { useState } from "react";
import { motion } from "framer-motion";
import { Tv, UserPlus, Loader2, CheckCircle2 } from "lucide-react";
import { addFtaUser } from "../../services/iptvApi";

/**
 * Inline IPTV sign-up card shown when the user is not registered (API returns "User not found").
 *
 * Props:
 *  - name     : pre-filled user name (from CRM profile)
 *  - mobile   : pre-filled mobile number
 *  - onSuccess: callback fired after successful registration so the parent can reload data
 */
export default function IptvSignup({ name: initialName, mobile: initialMobile, onSuccess }) {
  const [name, setName] = useState(initialName || "");
  const [mobile, setMobile] = useState(initialMobile || "");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const handleActivate = async () => {
    setError("");
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!mobile.trim() || mobile.trim().length < 10) { setError("Please enter a valid mobile number."); return; }

    setBusy(true);
    try {
      const data = await addFtaUser({ name: name.trim(), mobile: mobile.trim() });
      setSuccess(data?.status?.err_msg || "Registration successful!");
    } catch (err) {
      const msg = err.message || "Registration failed.";
      if (msg.toLowerCase().includes("already exists")) {
        // User is already registered — just reload
        setSuccess("Your account is already active!");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (success) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-14 px-6">
        <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        </div>
        <p className="text-sm font-semibold text-gray-800 mb-1 text-center">{success}</p>
        <p className="text-xs text-gray-400 text-center mb-5">You can now access Live TV channels.</p>
        <button onClick={onSuccess} className="px-6 py-2.5 bg-gradient-to-r from-red-500 to-rose-600 text-white text-sm font-semibold rounded-xl shadow-sm shadow-red-200 active:scale-95 transition-transform">
          Continue to Live TV
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-10 px-4">
      <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-3">
        <Tv className="w-7 h-7 text-blue-500" />
      </div>
      <h3 className="text-base font-bold text-gray-800 mb-1">Activate Live TV</h3>
      <p className="text-xs text-gray-400 text-center mb-5 max-w-xs">Your account is not yet registered for Live TV. Activate now to start watching channels.</p>

      <div className="w-full max-w-xs space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-gray-500 ml-1">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your name" className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition-all" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500 ml-1">Mobile Number</label>
          <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Enter mobile number" maxLength={10} className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition-all" />
        </div>

        {error && <p className="text-xs text-red-500 font-medium text-center">{error}</p>}

        <button onClick={handleActivate} disabled={busy} className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold rounded-xl shadow-sm shadow-blue-200 active:scale-95 transition-transform disabled:opacity-60 disabled:active:scale-100">
          {busy ? (<><Loader2 className="w-4 h-4 animate-spin" />Activating...</>) : (<><UserPlus className="w-4 h-4" />Activate Live TV</>)}
        </button>
      </div>
    </motion.div>
  );
}
