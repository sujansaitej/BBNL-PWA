import { useState, useEffect } from "react";
import {
  LockClosedIcon,
  UserIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@heroicons/react/24/solid";
import { Download, Smartphone, Info, ArrowRight, CheckCircle } from "lucide-react";
import { UserToggle } from "../components/ui";
import { resolveLoginOutcome } from "../services/loginFlow";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useLocation, Link } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";

import { UserLogin } from "../services/generalApis";
import { setPendingAuth, clearPendingAuth } from "../services/pendingAuth";

export default function Login() {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const isLocal = import.meta.env.VITE_API_APP_ISLOCAL; // Set to true for local testing to bypass PWA install

  const [loginType, setLoginType] = useState("franchisee"); // franchisee | customer
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login, logout } = useAuth();
  const navigate = useNavigate();
  // SignUp navigates here on success and hands its message over as router
  // state, so the confirmation survives the redirect instead of vanishing with
  // a toast the way Android's does.
  const location = useLocation();
  const signupMessage = location.state?.signupMessage || "";

  useEffect(() => {
    const checkPWAInstalled = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
      const installedFlag = standalone || localStorage.getItem("pwaInstalledOnce") === "true";
      setIsStandalone(standalone);
      setIsInstalled(installedFlag);
    };

    checkPWAInstalled();

    // Detect if installed mode changes. Keep a handle to the MediaQueryList
    // and to each listener so cleanup on unmount actually removes them —
    // otherwise every login → logout → login cycle leaks another listener
    // and on low-RAM phones V8 pauses to GC, producing the "app freezes
    // for a few seconds" complaint.
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMediaChange = () => checkPWAInstalled();
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onAppInstalled = () => {
      localStorage.setItem("pwaInstalledOnce", "true");
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    mq.addEventListener("change", onMediaChange);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);

    if (isLocal==='true') {
      setIsInstalled(true);
      setIsStandalone(true);
    }

    return () => {
      mq.removeEventListener("change", onMediaChange);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  // Landing on /login abandons any outstanding OTP challenge. This is the
  // back-button path out of /verify-otp: the half-finished login is torn down
  // rather than left parked where a later navigation could pick it up.
  useEffect(() => {
    clearPendingAuth();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    // localStorage.clear();
    localStorage.removeItem('otprefid');
    clearPendingAuth();

    if (!username || !password) {
      setError("Please enter the username and password.");
      return;
    }

    setLoading(true);
    localStorage.setItem("loginType", loginType);

    try {
      const result = await UserLogin(username, password);
      const outcome = resolveLoginOutcome(result, loginType);

      if (outcome.action === 'error') {
        setError(outcome.message);
        setLoading(false);
        return;
      }

      // OTP outstanding → park the identity and create NO session. login()
      // writes localStorage.user, which is what PrivateRoute and every
      // getUser() call site treat as "authenticated"; calling it here (as this
      // code used to, before the otpstatus branch) made the OTP screen pure
      // decoration — back button, deep link or relaunching the app all landed
      // inside with the second factor unmet.
      if (outcome.action === 'otp') {
        // Tear down any session still on the device BEFORE parking the
        // challenge. Without this, an operator who was already logged in (and
        // /login is reachable while authenticated — the catch-all route sends
        // every unknown URL there) would hit OtpRoute, which sees the stale
        // session, and be redirected straight to the dashboard with the new
        // account's OTP never entered. Must run before setPendingAuth: logout()
        // purges the escrow too.
        logout();
        // logout() purges loginType — it is a session key. Restore it at once:
        // apiCore.getAppKeyType() reads localStorage.loginType to choose the
        // employee-vs-customer `appkeytype` header, and OTPauth/resendOTP are
        // sent while there is deliberately no session. Without this line a
        // franchisee's OTP verify goes out as appkeytype=customer, the backend
        // answers "Invalid User Credentials", and repeated tries trip its
        // "Login attempts has exhausted, 15 min left" lockout. Customer logins
        // were unaffected because their fallback is already 'customer'.
        localStorage.setItem("loginType", loginType);
        const parked = setPendingAuth({
          user: outcome.user,
          otprefid: outcome.otprefid,
          loginType: outcome.loginType,
          otpLength: outcome.otpLength,
          otpDataType: outcome.otpDataType,
        });
        if (!parked) {
          // Cannot hold the challenge (private mode / quota). Fail closed —
          // never fall through to login() because storage misbehaved.
          setError("Unable to start OTP verification on this device. Please try again.");
          setLoading(false);
          return;
        }
        navigate('/verify-otp', { replace: true });
        setLoading(false);
        return;
      }

      // action === 'session' — backend asked for no second factor.
      login(outcome.user);
      navigate(outcome.home, { replace: true });
    } catch (err) {
      console.error("Login failed:", err);
      // A session that could not be written to storage has its own actionable
      // message; the generic one would send the operator round the same loop.
      setError(
        err?.code === "SESSION_PERSIST_FAILED"
          ? err.message
          : "Login failed. Please try again."
      );
    }

    setLoading(false);
  };

  const AndroidIcon = ({ size = 24, color = "currentColor", className = "" }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={color}
      width={size}
      height={size}
      className={className}
    >
      <path d="M17.6 9.48l1.43-2.48a.5.5 0 0 0-.87-.5l-1.44 2.5A7.002 7.002 0 0 0 12 7c-1.84 0-3.51.7-4.72 1.87L5.84 6.5a.5.5 0 1 0-.87.5L6.4 9.48A6.982 6.982 0 0 0 5 13v5a1 1 0 0 0 1 1h1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3h4v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3h1a1 1 0 0 0 1-1v-5a6.982 6.982 0 0 0-1.4-3.52zM9 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm6 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
    </svg>
  );

  const AppleIcon = ({ size = 24, color = "currentColor", className = "" }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={color}
      width={size}
      height={size}
      className={className}
    >
      <path d="M16.365 1.43c.12 1.04-.31 2.08-.98 2.82-.66.73-1.73 1.36-2.8 1.25-.13-1.02.35-2.1 1.03-2.84.72-.8 1.92-1.4 2.75-1.23zM19.78 17.5c-.48 1.09-.7 1.56-1.3 2.52-.84 1.29-2.03 2.9-3.54 2.93-1.32.02-1.67-.85-3.47-.84-1.8.01-2.19.86-3.51.83-1.5-.03-2.65-1.46-3.49-2.75-2.39-3.54-2.64-7.7-1.17-9.9 1.04-1.58 2.68-2.52 4.24-2.52 1.57 0 2.56.85 3.85.85 1.26 0 2.02-.86 3.83-.86 1.37 0 2.82.75 3.86 2.05-3.38 1.85-2.84 6.65.7 8.69z" />
    </svg>
  );

  function InstallInstructions({ deferredPrompt }) {
    const [installMsg, setInstallMsg] = useState("");
    const handleInstallClick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response: ${outcome}`);
        if (outcome === "accepted") {
          console.log("User accepted the install prompt");
        }
      } else {
        setInstallMsg("The install option is not available. Try using the browser menu.");
      }
    };

    return (
      <>
      <div className="">
      {/* Outside the card: the background here is the indigo/purple gradient
          in BOTH themes, so this never follows the theme. */}
      <div className="flex justify-center mt-1 mb-3">
        <BrandLogo onDark className="h-12" plateClassName="inline-flex rounded-xl bg-white px-4 py-2 shadow-lg" />
      </div>
      <div className="bg-white dark:bg-gray-900 shadow-xl rounded-2xl p-4 max-w-lg w-full text-center animate-fade-in">
        <p className="mb-2 justify-center text-sm">Welcome to our newly launched platform independent app. We appreciate your continued support as we enhance our services.</p>
        <div className="flex justify-center mb-2">
          <Download className="h-10 w-10 text-blue-500 animate-bounce" />
        </div>

        <h2 className="text-md font-bold text-gray-800 dark:text-gray-100">
          Install BBNL CRM
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
          To get the best experience, please install this <b>BBNL CRM</b> application to your home screen.
        </p>

        {/* Install message */}
        {installMsg && (
          <div className="mb-2 p-2 rounded-lg bg-red-100 text-red-700 text-sm">{installMsg}</div>
        )}

        {/* Install button */}
        <button
          onClick={handleInstallClick}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 mb-1 bg-blue-600 hover:bg-blue-700 text-sm text-white font-semibold rounded-xl shadow transition-colors"
        >
          <Download className="w-5 h-5" />
          Install App
        </button>
        <p>OR</p>
        {/* Instructions for manual install */}
        <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-2 mb-2 text-left space-y-2">
          <div className="flex items-center space-x-2">
            {/* <Smartphone className="text-blue-500" /> */}
            <AndroidIcon className="w-6 h-8 text-green-600" />
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mt-2">
              Android Users:
            </p>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-400 pl-6">
            Tap the <b>⋮</b> menu at the top right → Select{" "}
            <b>"Add to Home Screen"</b>(choose 'Install') or <b>"Install App"</b>.
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-2 mb-2 text-left space-y-2">
          <div className="flex items-center space-x-2">
            {/* <Info className="text-blue-500" /> */}
            <AppleIcon className="w-6 h-6 text-gray-800 dark:text-white" />
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mt-2">
              iPhone Users:
            </p>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-400 pl-6">
            Tap the <b>Share</b> icon → Scroll down → Select{" "}
            <b>"Add to Home Screen"</b>.
          </p>
        </div>

        {/* <div className="flex items-center justify-center text-blue-600 dark:text-blue-400 font-medium gap-1">
          <span>Continue using browser</span>
          <ArrowRight className="w-4 h-4" />
        </div> */}
      </div>
      </div>
      </>
    );
  }

  function ThankYouMessage() {
    return (
      <>
      <div className="text-sm bg-white dark:bg-gray-900 shadow-xl rounded-2xl p-8 max-w-md w-full text-center animate-fade-in">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3 animate-pulse" />
        <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">
          Thank You for Installing BBNL CRM!
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          You can now open the installed app from your home screen or app drawer.
        </p>
        <p className="text-gray-500 text-sm dark:text-gray-400">
          Tip: Close this browser tab and use the installed version to log in.
        </p>
      </div>
      {/* <p className="text-gray-500 text-sm dark:text-gray-400">
        You can always reinstall the app later by following the install instructions below.
      </p> */}
      </>
    );
  }

  return (
    /* Centred, but the install-instructions variant is taller than an iPhone
       SE viewport — once it overflows, the top of the card scrolls under the
       notch and the bottom under the home indicator. pt-safe/pb-safe bound it. */
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 px-4 pt-safe pb-safe">
      {!isInstalled ? (
        <InstallInstructions deferredPrompt={deferredPrompt} />
      ) : !isStandalone ? (
        <ThankYouMessage />
      ) : (
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8">
        {/* Logo — the card behind it is white in light theme and gray-900 in
            dark, so BrandLogo follows the theme and picks the reversed lockup
            on dark.
            h-16 was too heavy here: the lockup is 512x110, so 64px tall made
            it ~298px wide — over three quarters of the card's 384px content
            width, which read as a banner rather than a mark. h-12 lands at
            ~223px. max-w keeps it inside the card if the art is ever
            re-cropped to a different ratio. */}
        <div className="flex justify-center mb-6">
          <BrandLogo className="h-12 w-auto max-w-[224px] object-contain" alt="App Logo" />
        </div>

        {/* Title */}
        <h2 className="text-center text-2xl font-extrabold text-gray-900 dark:text-white mb-2">
          Welcome Back
        </h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-6">
          Sign in to continue
        </p>

        {/* Handed over by SignUp on success. Android shows this as a Toast that
            disappears; here it survives the redirect so the customer can read
            what happened and knows which username to sign in with. */}
        {signupMessage && (
          <div
            role="status"
            className="mb-4 p-3 rounded-lg bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 text-xs"
          >
            {signupMessage}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Form */}
        {/* Login Type Toggle */}
        <UserToggle loginType={loginType} setLoginType={setLoginType} />
{/* <div className="flex items-center justify-center mb-6">
  <div className="bg-gray-200 dark:bg-gray-800 rounded-full p-1 flex">
    <button
      onClick={() => setLoginType("franchisee")}
      className={`px-4 py-1 rounded-full text-sm font-medium transition-all duration-300  ease-in-out ${
        loginType === "franchisee"
          ? "bg-blue-600 text-white"
          : "text-gray-600 dark:text-gray-300"
      }`}
    >
      Franchisee
    </button>

    <button
      onClick={() => setLoginType("customer")}
      className={`px-4 py-1 rounded-full text-sm font-medium transition-all duration-300 ease-in-out ${
        loginType === "customer"
          ? "bg-blue-600 text-white"
          : "text-gray-600 dark:text-gray-300"
      }`}
    >
      Customer
    </button>
  </div>
</div> */}

        <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
          {/* Fake fields */}
          <input type="text" name="_user" autoComplete="username" className="hidden" />
          <input type="password" name="_Pass" autoComplete="new-password" className="hidden" />

          {/* Username */}
          <div className="relative">
            <UserIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off" 
              className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                         placeholder-gray-400 dark:placeholder-gray-500
                         focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <LockClosedIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400 dark:text-gray-500" />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full pl-10 pr-10 py-3 rounded-lg border border-gray-300 dark:border-gray-700
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                         placeholder-gray-400 dark:placeholder-gray-500
                         focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showPassword ? (
                <EyeSlashIcon className="h-5 w-5" />
              ) : (
                <EyeIcon className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* Login Button */}
          <button
            type="submit" // Enter key works here
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 
                       hover:from-blue-700 hover:to-indigo-700 
                       text-white rounded-lg font-semibold shadow-md transition 
                       flex justify-center items-center"
          >
            {loading ? (
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                ></path>
              </svg>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* CUSTOMER TAB ONLY. Android shows "Sign Up" on its customer flavour's
            login screen; the operator app has no self-registration at all —
            franchisees are created by BBNL, not by filling in a form. This
            footer was stubbed out here from the start; ServiceApis/custRegistration
            is what makes it real. */}
        {loginType === "customer" && (
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Don&rsquo;t have an account?{" "}
            <Link
              to="/signup"
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Sign up
            </Link>
          </p>
        )}
      </div>
      )}
    </div>
  );
}
