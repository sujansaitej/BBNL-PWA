import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck, CheckCircle } from "lucide-react";
import { ButtonSpinner } from "../components/Loader";
import OtpInput from "../components/ui/OtpInput";
// import { verifyOtp, resendOtp } from "../services/api"; // TODO: Enable when backend verifyftauserotp is fixed

export default function VerifyOtp() {
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = location.state?.mobile;
  const name = location.state?.name;

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (!mobile) navigate("/", { replace: true });
  }, [mobile, navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const maskedMobile = mobile
    ? `+91 ${mobile.slice(0, 2)}${"*".repeat(6)}${mobile.slice(-2)}`
    : "";

  const handleVerify = async (e) => {
    e.preventDefault();
    if (otp.length < 4) {
      setApiError("Please enter the complete 4-digit OTP");
      return;
    }

    setLoading(true);
    setApiError("");

    // Mock OTP verification — TODO: Replace when backend verifyftauserotp is fixed
    console.group("%c🔵 [VerifyOtp] Verify OTP (Mock)", "color: #3b82f6; font-weight: bold; font-size: 13px;");
    console.log("%c🔑 Sending Keys:", "color: #8b5cf6; font-weight: bold;", "mobile, otp");
    console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", mobile);
    console.log("%c🔢 otp:", "color: #6366f1; font-weight: bold;", otp);
    console.log("%c🟡 Mock Mode — accepting any 4-digit OTP", "color: #eab308; font-weight: bold;");
    console.log("%c🟢 MOCK VERIFICATION SUCCESS", "color: #22c55e; font-weight: bold; font-size: 13px;");
    console.groupEnd();

    setTimeout(() => {
      setLoading(false);
      localStorage.setItem("user", JSON.stringify({ name, mobile }));
      setSuccessMsg("OTP verified successfully!");
      setTimeout(() => {
        navigate("/home", { replace: true });
      }, 2000);
    }, 800);
  };

  const handleResend = async () => {
    if (countdown > 0) return;

    // Mock resend — TODO: Replace when backend is fixed
    console.group("%c🔵 [VerifyOtp] Resend OTP (Mock)", "color: #3b82f6; font-weight: bold; font-size: 13px;");
    console.log("%c🔑 Sending Keys:", "color: #8b5cf6; font-weight: bold;", "mobile");
    console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", mobile);
    console.log("%c🟡 Mock Mode — OTP resend simulated", "color: #eab308; font-weight: bold;");
    console.log("%c🟢 MOCK RESEND SUCCESS", "color: #22c55e; font-weight: bold; font-size: 13px;");
    console.groupEnd();

    setOtp("");
    setApiError("");
    setCountdown(60);
  };

  if (!mobile) return null;

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 bg-gradient-to-br from-blue-500 via-purple-500 to-purple-600">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 sm:p-8"
      >
        {/* Back Button */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center text-gray-500 hover:text-gray-700 active:text-gray-800 text-sm mb-6 transition-colors min-h-[44px] -ml-2 px-2 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5 mr-1.5" />
          Back
        </button>

        {/* Icon */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">Verify OTP</h1>
          <p className="text-sm text-gray-500 mt-2 text-center">
            We sent a verification code to
          </p>
          <p className="text-sm font-semibold text-gray-700">{maskedMobile}</p>
        </div>

        {/* Success Message - inline hidden, popup shown below */}

        {/* Error */}
        {apiError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"
          >
            {apiError}
          </motion.div>
        )}

        {/* OTP Form */}
        <form onSubmit={handleVerify} className="space-y-6">
          <OtpInput length={4} value={otp} onChange={setOtp} />

          {/* Verify Button */}
          <motion.button
            type="submit"
            disabled={loading || !!successMsg}
            whileTap={{ scale: 0.98 }}
            className={`w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg transition-all duration-300 min-h-[48px] ${
              loading || successMsg
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 hover:shadow-xl"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <ButtonSpinner />
                Verifying...
              </span>
            ) : (
              "Verify"
            )}
          </motion.button>
        </form>

        {/* Resend */}
        <div className="text-center mt-6">
          <p className="text-sm text-gray-500">
            Didn't receive the code?{" "}
            {countdown > 0 ? (
              <span className="text-gray-400">
                Resend in {countdown}s
              </span>
            ) : (
              <button
                onClick={handleResend}
                className="text-purple-600 font-medium hover:underline"
              >
                Resend OTP
              </button>
            )}
          </p>
        </div>
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
