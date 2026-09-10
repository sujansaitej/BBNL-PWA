import React, { useState, useEffect, useRef } from "react";
import { OTPauth, resendOTP } from "../services/generalApis";
import { useNavigate } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";
import { useAuth } from "../context/AuthContext";
import { isEnvelopeOk, envelopeError } from "../services/apiEnvelope";
import { classifyOtpFailure, firstSentence } from "../services/loginFlow";
import {
  getPendingAuth,
  clearPendingAuth,
  updatePendingOtpRef,
  recordFailedOtpAttempt,
} from "../services/pendingAuth";

export default function VerifyOtpPage() {
  const navigate   = useNavigate();
  const { login }  = useAuth();
  // Identity comes from the escrow, NOT from getUser() — there is deliberately
  // no session yet at this point. OtpRoute guarantees a pending record exists
  // when this renders; the fallback to {} only covers it expiring mid-render.
  //
  // NB: no `otprefid` const here on purpose. verifyOtp() re-reads the escrow at
  // submit time so a resend that swapped the ref id cannot be missed by a stale
  // render-time copy.
  const pending  = getPendingAuth() || {};
  const username = pending.user?.username || "";

  // Code shape is per-account and comes from the login response, the same way
  // Android sizes its pin view. Hardcoding 4 locked out any account configured
  // for a longer code.
  const otpLen = Number(pending.otpLength) >= 4 && Number(pending.otpLength) <= 8
    ? Number(pending.otpLength)
    : 4;
  const isAlphanumeric = pending.otpDataType === "alphanumeric";

  const [otp, setOtp] = useState(() => Array(otpLen).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const containerRef = useRef(null);
  const inFlightRef = useRef(false);

  const blankOtp = () => Array(otpLen).fill("");

  // w-14 is the original 4-box square. Narrower only when the account's code is
  // longer, so 8 boxes + gaps still fit inside the card on a small phone.
  const otpBoxWidth = otpLen <= 4 ? "w-14" : otpLen <= 6 ? "w-12" : "w-9";

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
    if (otp.join("").length === otpLen)
        verifyOtp();
  }, [otp]);

  // helper: trigger shake + haptic + message
  const triggerError = (msg) => {
    setError(msg);
    try {
      if (navigator && navigator.vibrate) navigator.vibrate(150);
    } catch (_e) {}
    if (containerRef.current) {
      containerRef.current.classList.remove("shake");
      // force reflow so animation retriggers
      // eslint-disable-next-line no-unused-expressions
      containerRef.current.offsetWidth;
      containerRef.current.classList.add("shake");
      setTimeout(() => containerRef.current && containerRef.current.classList.remove("shake"), 500);
    }
  };

  // One character per box. Alphanumeric accounts must accept letters — a
  // digits-only filter there reads to the operator as a broken keypad.
  const charOk = (v) => (isAlphanumeric ? /^[a-zA-Z0-9]?$/.test(v) : /^\d?$/.test(v));

  // when OTP changes
  const handleChange = (value, index) => {
    if (!charOk(value)) return;
    const next = otp.slice();
    next[index] = value;
    setOtp(next);

    // move focus
    if (value && index < otpLen - 1) {
      const el = document.getElementById("otp-" + (index + 1));
      if (el) el.focus();
    }
  };

  // handle paste: a full code pasted into any field fills every box
  const handlePaste = (e) => {
    const paste = (e.clipboardData || window.clipboardData).getData("text");
    const pattern = isAlphanumeric
      ? new RegExp(`^[a-zA-Z0-9]{${otpLen}}$`)
      : new RegExp(`^\\d{${otpLen}}$`);
    if (pattern.test(paste)) {
      setOtp(paste.split(""));
      e.preventDefault();
    }
  };

  // API call to verify
  const verifyOtp = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const otpcode = otp.join("");
    if (otpcode.length < otpLen) {
      triggerError(`Please enter the ${otpLen}-character OTP`);
      return;
    }
    // The last character auto-submits (see the effect above) and the Verify
    // button submits too, so one code could be sent twice — which now costs two
    // of the five capped attempts. Ref, not state: `loading` updates
    // asynchronously and both callers can pass the check in the same tick.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError("");
    try {
      // Re-read the escrow at submit time: it may have expired while the
      // operator was reading the SMS, and an expired challenge must not verify.
      const current = getPendingAuth();
      if (!current) {
        clearPendingAuth();
        navigate("/login", { replace: true });
        return;
      }

      const result = await OTPauth(current.user.username, current.otprefid, otpcode);

      // Anything that is not an explicit success is a failure. The old shape was
      // `if (err_code === 1) fail; else succeed`, which passed every other code.
      //
      // Must go through isEnvelopeOk: err_code arrives as an int from one
      // backend status model and as a STRING from the other, so a strict
      // `!== 0` here would reject a valid OTP whenever the response carried "0".
      if (!isEnvelopeOk(result)) {
        const raw = envelopeError(result);

        // A header-auth rejection or the backend's own rate limit is not a
        // mistyped code. Don't spend one of the five client attempts on it, and
        // don't bolt "— N attempts left" onto an already-long server message.
        if (classifyOtpFailure(raw) === "blocked") {
          setOtp(blankOtp());
          triggerError(firstSentence(raw));
          return;
        }

        const remaining = recordFailedOtpAttempt();
        if (remaining <= 0) {
          navigate("/login", { replace: true });
          return;
        }
        setOtp(blankOtp());
        const el = document.getElementById("otp-0");
        if (el) el.focus();
        triggerError(`${firstSentence(raw)} — ${remaining} attempt${remaining === 1 ? "" : "s"} left.`);
        return;
      }

      // Verified. This is the ONLY place a session is created for an
      // OTP-protected account: commit the parked identity, then drop the escrow.
      const verifiedUser = current.user;
      const type = current.loginType || localStorage.getItem("loginType") || "franchisee";
      localStorage.removeItem("otprefid");
      localStorage.setItem("loginType", type);
      // login() commits the session and clears the escrow itself. It runs
      // BEFORE the escrow is dropped by hand so that a storage failure inside
      // it leaves the verified challenge intact and retryable, instead of
      // stranding the operator on a screen whose challenge no longer exists.
      login(verifiedUser);
      clearPendingAuth();
      navigate(type === "franchisee" ? "/" : "/cust/dashboard", { replace: true });
    } catch (err) {
      triggerError(
        err?.code === "SESSION_PERSIST_FAILED"
          ? err.message
          : "Network error. Try again."
      );
    } finally {
      inFlightRef.current = false;
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
        // Same reason as verifyOtp: gate on the success contract, not on
        // err_code === 1, or a different failure code reads as a resend that
        // worked and we park an undefined otprefid.
        if (!isEnvelopeOk(result)) {
            triggerError(firstSentence(envelopeError(result)) || "Failed to resend OTP");
            return;
        }else{
            // The new ref id belongs to the escrow, not to localStorage — the
            // next verify reads it from there.
            if (!updatePendingOtpRef(result?.body?.otprefid)) {
              // Challenge expired while waiting on the resend.
              navigate("/login", { replace: true });
              return;
            }
            setOtp(blankOtp());
        }
    } catch (err) {
      triggerError("Failed to resend OTP");
    }
  };

  return (
    /* pt-safe / pb-safe: this screen is TOP-aligned and renders no app header,
       so on iPhone its heading sat under the notch — p-4's 1rem is nowhere
       near the ~47-59px inset. See the safe-area note in index.css. */
    <div className="min-h-dvh flex flex-col items-center space-y-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 p-4 pt-safe pb-safe">
      <div ref={containerRef} className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8 mt-10">
        {/* The card behind this is theme-driven (white → gray-900), so the
            logo follows the theme rather than the OS.
            Kept in step with Login.jsx — this is step 2 of the same flow in an
            identical card, so a different height here would make the logo jump
            mid-sign-in. */}
        <div className="flex justify-center mb-6">
          <BrandLogo className="h-12 w-auto max-w-[224px] object-contain" alt="App Logo" />
        </div>

        <h2 className="text-center text-2xl font-extrabold text-gray-900 dark:text-white mb-2">Verify OTP</h2>
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 mb-6">Enter the {otpLen}-{isAlphanumeric ? "character" : "digit"} code sent to your registered mobile number</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={verifyOtp} className="space-y-6" onPaste={handlePaste}>
          {/* Box count comes from the account's otp_totchars.
              The 4-box case keeps the original `justify-between gap-3` + `w-14`
              square exactly — every existing operator sees an unchanged screen.
              Only longer codes narrow the boxes, so 6–8 still fit a small phone
              instead of overflowing the card. */}
          <div className={otpLen > 4 ? "flex justify-center gap-2" : "flex justify-between gap-3"}>
            {Array.from({ length: otpLen }, (_, i) => (
              <input
                key={i}
                id={"otp-" + i}
                type="text"
                inputMode={isAlphanumeric ? "text" : "numeric"}
                autoComplete="one-time-code"
                aria-label={(isAlphanumeric ? "Character " : "Digit ") + (i + 1)}
                maxLength={1}
                value={otp[i] || ""}
                onChange={(e) =>
                  handleChange(
                    isAlphanumeric
                      ? e.target.value.replace(/[^a-zA-Z0-9]/g, "")
                      : e.target.value.replace(/\D/g, ""),
                    i
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !otp[i] && i > 0) {
                    const prev = document.getElementById("otp-" + (i - 1));
                    if (prev) prev.focus();
                  }
                }}
                className={`${otpBoxWidth} h-14 text-center text-2xl font-bold rounded-xl border border-gray-300 dark:border-gray-700 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-600 focus:outline-none shadow-sm transition`}
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
