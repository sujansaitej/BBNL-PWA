import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { User, Phone, CheckCircle } from "lucide-react";
import { ButtonSpinner } from "../components/Loader";
import { registerUser } from "../services/api";

export default function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", mobile: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.mobile.trim()) {
      errs.mobile = "Mobile number is required";
    } else if (!/^\d{10}$/.test(form.mobile.trim())) {
      errs.mobile = "Enter a valid 10-digit mobile number";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "mobile" && value && !/^\d*$/.test(value)) return;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
    setApiError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setApiError("");
    setSuccessMsg("");

    console.group("%c🔵 [Signup] Register User", "color: #3b82f6; font-weight: bold; font-size: 13px;");
    console.log("%c🔑 Sending Keys:", "color: #8b5cf6; font-weight: bold;", "name, mobile");
    console.log("%c📝 name:", "color: #6366f1; font-weight: bold;", form.name.trim());
    console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", form.mobile.trim());

    try {
      const data = await registerUser({ name: form.name.trim(), mobile: form.mobile.trim() });
      console.log("%c🟢 SUCCESS RESPONSE", "color: #22c55e; font-weight: bold; font-size: 13px;", data);
      console.log("%c🟢 err_code:", "color: #22c55e; font-weight: bold;", data?.status?.err_code);
      console.log("%c🟢 err_msg:", "color: #22c55e; font-weight: bold;", data?.status?.err_msg);
      console.groupEnd();

      setSuccessMsg(data?.status?.err_msg || "OTP sent successfully!");
      setTimeout(() => {
        navigate("/verify-otp", {
          state: {
            mobile: form.mobile.trim(),
            name: form.name.trim(),
            message: data?.status?.err_msg,
          },
        });
      }, 1500);
    } catch (err) {
      console.log("%c🔴 ERROR", "color: #ef4444; font-weight: bold; font-size: 13px;", err.message);
      console.groupEnd();
      setApiError(err.message || "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 bg-gradient-to-br from-blue-500 via-purple-500 to-purple-600">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 sm:p-8"
      >
        {/* Logo / Brand */}
        <div className="flex flex-col items-center mb-6">
          <img
            src="/logo-dark.png"
            alt="Fo-Fi IOT Labs Ltd."
            className="h-16 w-auto object-contain mb-2"
          />
          <p className="text-sm text-gray-400 mt-1">Free-to-Air Streaming</p>
        </div>

        {/* Heading */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-800">Welcome Back</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to continue</p>
        </div>

        {/* API Error */}
        {apiError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"
          >
            {apiError}
          </motion.div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name Field */}
          <div>
            <div
              className={`flex items-center border rounded-lg px-3 py-2.5 transition-colors ${
                errors.name
                  ? "border-red-400 bg-red-50"
                  : "border-gray-300 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500"
              }`}
            >
              <User className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0" />
              <input
                type="text"
                name="name"
                placeholder="Full Name"
                value={form.name}
                onChange={handleChange}
                className="w-full outline-none text-sm text-gray-700 bg-transparent placeholder-gray-400"
              />
            </div>
            {errors.name && (
              <p className="text-red-500 text-xs mt-1 ml-1">{errors.name}</p>
            )}
          </div>

          {/* Mobile Field */}
          <div>
            <div
              className={`flex items-center border rounded-lg px-3 py-2.5 transition-colors ${
                errors.mobile
                  ? "border-red-400 bg-red-50"
                  : "border-gray-300 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500"
              }`}
            >
              <Phone className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0" />
              <span className="text-sm text-gray-500 mr-1">+91</span>
              <input
                type="tel"
                name="mobile"
                placeholder="Mobile Number"
                value={form.mobile}
                onChange={handleChange}
                maxLength={10}
                className="w-full outline-none text-sm text-gray-700 bg-transparent placeholder-gray-400"
              />
            </div>
            {errors.mobile && (
              <p className="text-red-500 text-xs mt-1 ml-1">{errors.mobile}</p>
            )}
          </div>

          {/* Submit Button */}
          <motion.button
            type="submit"
            disabled={loading}
            whileTap={{ scale: 0.98 }}
            className={`w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg transition-all duration-300 min-h-[48px] ${
              loading
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 hover:shadow-xl"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <ButtonSpinner />
                Signing In...
              </span>
            ) : (
              "Sign In"
            )}
          </motion.button>
        </form>

      </motion.div>

      {/* Success Popup Toast */}
      {successMsg && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="bg-white rounded-2xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center"
          >
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Success!</h3>
            <p className="text-sm text-gray-500">{successMsg}</p>
            <div className="mt-4 flex justify-center">
              <div className="h-1 w-24 rounded-full bg-gray-200 overflow-hidden">
                <motion.div
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: 2, ease: "linear" }}
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full"
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
