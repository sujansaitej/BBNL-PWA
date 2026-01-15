import { useState, useEffect } from "react";
import {
  LockClosedIcon,
  UserIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@heroicons/react/24/solid";
import { Download, Smartphone, Info, ArrowRight, CheckCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";

import { UserLogin } from "../services/generalApis";

export default function Login() {
  const isDarkMode = useDarkMode();
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  localStorage.setItem("pwaInstalledOnce", "false");
  const isLocal = import.meta.env.VITE_API_APP_ISLOCAL; // Set to true for local testing to bypass PWA install

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const logo = isDarkMode ? import.meta.env.VITE_API_APP_DIR_PATH + import.meta.env.VITE_API_APP_LOGO_WHITE
                         : import.meta.env.VITE_API_APP_DIR_PATH + import.meta.env.VITE_API_APP_LOGO_BLACK;

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

    // Detect if installed mode changes
    window
      .matchMedia("(display-mode: standalone)")
      .addEventListener("change", checkPWAInstalled);

    // Listen for beforeinstallprompt
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // console.log("✅ Install prompt saved");
    });

    // Listen for app installation
    window.addEventListener("appinstalled", () => {
      // console.log("✅ PWA installed");
      localStorage.setItem("pwaInstalledOnce", "true");
      setIsInstalled(true);
      setDeferredPrompt(null);
    });
    if (isLocal==='true') {
      setIsInstalled(true);
      setIsStandalone(true);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    localStorage.clear();

    if (!username || !password) {
      setError("Please enter the username and password.");
      return;
    }

    setLoading(true);

    // if (username === "superadmin" && password === "admin123") {
      login(username, password);
      try {
        const result = await UserLogin(username, password);
        if(result?.status?.err_code === 1) {
            setError(result?.status?.err_msg || "Login failed");
            setLoading(false);
            return;
        }
        const userDet = (({ username, firstname, lastname, emailid, mobileno, op_id, photo }) => ({ username, firstname, lastname, emailid, mobileno, op_id, photo }))(result.body);
        localStorage.setItem("user", JSON.stringify(userDet));
        localStorage.setItem("otprefid", result.body.otprefid);
        // localStorage.setItem("loginTime", new Date().toISOString());
        // console.log("Login success:", result);
        result.body.otpstatus === 'yes' ? navigate('/verify-otp') : navigate("/");
      } catch (err) {
        console.error("Login failed:", err);
      }
    // } else {
    //   setError("Invalid username or password.");
    // }

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
    const handleInstallClick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response: ${outcome}`);
        if (outcome === "accepted") {
          console.log("User accepted the install prompt");
        }
      } else {
        alert("The install option is not available. Try using the browser menu.");
      }
    };

    return (
      <>
      <div className="">
      <div className="flex justify-center mt-1 mb-3">
        <img src={logo} alt="Fo-Fi Logo" className="h-12" />
      </div>
      <div className="bg-white dark:bg-gray-900 shadow-xl rounded-2xl p-4 max-w-lg w-full text-center animate-fade-in">
        <p className="mb-2 justify-center text-base">Welcome to our newly launched platform independent app. We appreciate your continued support as we enhance our services.</p>
        <div className="flex justify-center mb-2">
          <Download className="h-10 w-10 text-blue-500 animate-bounce" />
        </div>

        <h2 className="text-md font-bold text-gray-800 dark:text-gray-100">
          Install Fo-Fi CRM
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
          To get the best experience, please install this <b>Fo-Fi CRM</b> application to your home screen.
        </p>

        {/* Install button */}
        <button
          onClick={handleInstallClick}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 mb-1 bg-blue-600 hover:bg-blue-700 text-sm text-white font-semibold rounded-xl shadow transition-all"
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
          Thank You for Installing Fo-Fi CRM!
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 px-4">
      {!isInstalled ? (
        <InstallInstructions deferredPrompt={deferredPrompt} />
      ) : (isInstalled && isStandalone) ? (
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src={logo} alt="App Logo" className="h-16" />
        </div>

        {/* Title */}
        <h2 className="text-center text-2xl font-extrabold text-gray-900 dark:text-white mb-2">
          Welcome Back
        </h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-6">
          Sign in to continue
        </p>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Username */}
          <div className="relative">
            <UserIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400 dark:text-white" />
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-lg border text-gray-900 dark:text-blue-500 border-gray-300 dark:border-gray-700 
                         focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-gray-800 
                         shadow-sm"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <LockClosedIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-10 py-3 rounded-lg border border-gray-300 dark:border-gray-700 
                         focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-gray-800 
                         text-gray-900 dark:text-white shadow-sm"
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

        {/* Footer */}
        {/* <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Don’t have an account?{" "}
          <a href="#" className="text-blue-600 hover:underline font-medium">
            Sign up
          </a>
        </p> */}
      </div>
      ) : (<ThankYouMessage />)
      // : (
      //   <>
      //   <div className="max-w-2xl mx-auto space-y-6 mb-6">
      //     <ThankYouMessage />
      //     <InstallInstructions deferredPrompt={deferredPrompt} />
      //   </div>
      //   </>
      // )
      }
    </div>
  );
}
