import React, { useState, useEffect, useRef } from "react";
import { OTPauth, resendOTP } from "../services/generalApis";
import { useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";

export default function VerifyOtpPage() {
  const navigate   = useNavigate();
  const isDarkMode = useDarkMode();
  const logo = isDarkMode ? import.meta.env.VITE_API_APP_DIR_PATH + import.meta.env.VITE_API_APP_LOGO_WHITE
                         : import.meta.env.VITE_API_APP_DIR_PATH + import.meta.env.VITE_API_APP_LOGO_BLACK;
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const containerRef = useRef(null);

  const userdet = JSON.parse(localStorage.getItem('user'));
  const username = userdet ? userdet.username : "";
  const otprefid = localStorage.getItem("otprefid") || "";

  // countdown timer
  useEffect(() => {
    if (timer <= 0) {
      setCanResend(true);
      return;
    }
    setCanResend(false);
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // focus first input on mount
  useEffect(() => {
    const el = document.getElementById("otp-0");
    if (el) el.focus();
  }, []);

  useEffect(() => {
    if (otp.join("").length === 4)
        verifyOtp();
  }, [otp]);

  // helper: trigger shake + haptic + message
  const triggerError = (msg) => {
    setError(msg);
    try {
      if (navigator && navigator.vibrate) navigator.vibrate(150);
    } catch {}
    if (containerRef.current) {
      containerRef.current.classList.remove("shake");
      // force reflow so animation retriggers
      // eslint-disable-next-line no-unused-expressions
      containerRef.current.offsetWidth;
      containerRef.current.classList.add("shake");
      setTimeout(() => containerRef.current && containerRef.current.classList.remove("shake"), 500);
    }
  };

  // when OTP changes
  const handleChange = (value, index) => {
    if (!/^\d?$/.test(value)) return;
    const next = otp.slice();
    next[index] = value;
    setOtp(next);

    // move focus
    if (value && index < 3) {
      const el = document.getElementById("otp-" + (index + 1));
      if (el) el.focus();
    }

    // auto-submit when full
    // if (next.join("").length === 4) {
      // small delay to allow state to settle
    //   setTimeout(() => verifyOtp(), 500);
    // }
  };

  // handle paste: if user pastes 4 digit string into any field
  const handlePaste = (e) => {
    const paste = (e.clipboardData || window.clipboardData).getData("text");
    if (/^\d{4}$/.test(paste)) {
      const arr = paste.split("");
      setOtp(arr);
      // small delay then submit
    //   setTimeout(() => verifyOtp(), 100);
      e.preventDefault();
    }
  };

  // API call to verify
  const verifyOtp = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const otpcode = otp.join("");
    if (otpcode.length < 4) {
      triggerError("Please enter the 4-digit OTP");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await OTPauth(username, otprefid, otpcode);
      if(result?.status?.err_code == '1') {
          triggerError((result?.status && result?.status?.err_msg ) || "Invalid OTP");
      }else{
          localStorage.removeItem("otprefid");
          localStorage.getItem('loginType') == "franchisee" ? navigate("/", { replace: true }) : navigate("/cust/dashboard", { replace: true });
          // navigate("/");
      }
    } catch (err) {
      triggerError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // resend OTP
  const resend = async () => {
    if (!canResend && timer > 0) return;
    setCanResend(false);
    setTimer(30);
    try {
        const result = await resendOTP(username);
        if(result?.status?.err_code === 1) {
            triggerError(result?.status?.err_msg || "Failed to resend OTP");
            return;
        }else{
            localStorage.setItem("otprefid", result.body.otprefid);
        }
    } catch (err) {
      triggerError("Failed to resend OTP");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center space-y-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 p-4">
      <div ref={containerRef} className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8 mt-10 transition-all">
        <div className="flex justify-center mb-6">
          <img src={logo} alt="App Logo" className="h-16" />
        </div>

        <h2 className="text-center text-2xl font-extrabold text-gray-900 dark:text-white mb-2">Verify OTP</h2>
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 mb-6">Enter the 4-digit code sent to your registered mobile number</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={verifyOtp} className="space-y-6" onPaste={handlePaste}>
          <div className="flex justify-between gap-3">
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                id={"otp-" + i}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={"Digit " + (i + 1)}
                maxLength={1}
                value={otp[i]}
                onChange={(e) => handleChange(e.target.value.replace(/\D/g, ""), i)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !otp[i] && i > 0) {
                    const prev = document.getElementById("otp-" + (i - 1));
                    if (prev) prev.focus();
                  }
                }}
                className="w-14 h-14 text-center text-2xl font-bold rounded-xl border border-gray-300 dark:border-gray-700 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-600 focus:outline-none shadow-sm transition"
              />
            ))}
          </div>

          <p className="text-center text-md text-gray-600 dark:text-gray-300">
            Didn't receive the code?{" "}
            <button
              type="button"
              onClick={resend}
              disabled={timer > 0}
              className="text-blue-600 font-semibold hover:underline disabled:opacity-50"
            >
              {timer > 0 ? "Resend in " + timer + "s" : "Resend OTP"}
            </button>
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg font-semibold shadow-md transition flex justify-center items-center"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
            ) : (
              "Verify OTP"
            )}
          </button>
        </form>
      </div>

      {/* Advertisement Banner */}
      <div className="w-full max-w-md mt-6 mb-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-1 text-center text-gray-700 dark:text-gray-300">
          {/* <h3 className="font-semibold text-lg mb-2">Advertisement</h3> */}
          {/* <p className="text-sm">Your promotional content or banner can appear here.</p> */}
          <img src={import.meta.env.VITE_API_APP_DIR_PATH + "img/ads/otpad.png"} alt="Advertisement" className="mx-auto rounded-lg" />
        </div>
      </div>

    </div>
  );
}
