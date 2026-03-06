import { useState, useEffect } from "react";
import { Download, CheckCircle } from "lucide-react";
import { useDarkMode } from "../hooks/useDarkMode";
import { lsClearAll } from "../services/lsCache";

// Safe localStorage helpers — never throw (Safari private browsing, quota full)
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

/* ------------------------------------------------------------------ */
/*  BrowserGate                                                       */
/*  Wraps the entire app.  In standalone (PWA) mode or local dev the  */
/*  children (routes) render normally.  In the browser it shows:      */
/*    • Install prompt   — if the app has NOT been installed yet       */
/*    • Thank-you screen — if the app HAS been installed              */
/* ------------------------------------------------------------------ */

export default function BrowserGate({ children }) {
  const isDarkMode = useDarkMode();
  // import.meta.env.DEV is a Vite built-in: true ONLY during `npm run dev`,
  // false in EVERY build (production, staging, any --mode).
  // This guarantees BrowserGate can NEVER be bypassed in a deployed build,
  // regardless of which .env file is used.
  const isLocal = import.meta.env.DEV;

  const [isStandalone, setIsStandalone] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
  );
  const [isInstalled, setIsInstalled] = useState(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    return (
      standalone || lsGet("pwaInstalledOnce") === "true"
    );
  });
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installMsg, setInstallMsg] = useState("");

  useEffect(() => {
    /* --- display-mode changes (e.g. user installs while page is open) --- */
    const mq = window.matchMedia("(display-mode: standalone)");
    const handleMqChange = () => {
      const s = mq.matches || window.navigator.standalone === true;
      setIsStandalone(s);
      if (s) setIsInstalled(true);
    };
    mq.addEventListener("change", handleMqChange);

    /* --- capture the browser install prompt for manual triggering --- */
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    /* --- app installed event --- */
    const handleInstalled = () => {
      // Reinstall detection: if stale auth data exists from a previous
      // install, clear it so the PWA opens to the login screen.
      try {
        if (localStorage.getItem("user")) {
          localStorage.removeItem("user");
          localStorage.removeItem("loginTimestamp");
          localStorage.removeItem("loginType");
          localStorage.removeItem("otprefid");
          lsClearAll();
          console.warn("[BrowserGate] Stale auth cleared on reinstall");
        }
      } catch (_) {}

      lsSet("pwaInstalledOnce", "true");
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      mq.removeEventListener("change", handleMqChange);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  /* ---- Pass-through: standalone PWA or local dev ---- */
  // console.warn survives production builds (only console.log/debug/info are stripped).
  // Check DevTools console to verify BrowserGate is active after deployment.
  console.warn("[BrowserGate]", { isLocal, isStandalone, isInstalled, mode: isLocal || isStandalone ? "APP" : "BLOCKED" });

  if (isLocal || isStandalone) return children;

  const logo = isDarkMode
    ? import.meta.env.VITE_API_APP_DIR_PATH +
      import.meta.env.VITE_API_APP_LOGO_WHITE
    : import.meta.env.VITE_API_APP_DIR_PATH +
      import.meta.env.VITE_API_APP_LOGO_BLACK;

  /* ---- Already installed → Thank-you screen ---- */
  if (isInstalled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 px-4">
        <div className="flex flex-col items-center">
          <div className="flex justify-center mt-1 mb-3">
            <img src={logo} alt="Fo-Fi Logo" className="h-12" />
          </div>
          <div className="text-sm bg-white dark:bg-gray-900 shadow-xl rounded-2xl p-8 max-w-md w-full text-center animate-fade-in">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3 animate-pulse" />
            <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">
              Thank You for Installing Fo-Fi CRM!
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              You can now open the installed app from your home screen or app
              drawer.
            </p>
            <p className="text-gray-500 text-sm dark:text-gray-400">
              Tip: Close this browser tab and use the installed version to log
              in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Not installed → Install prompt ---- */
  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        console.log("User accepted the install prompt");
      }
    } else {
      setInstallMsg(
        "The install option is not available. Try using the browser menu."
      );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 px-4">
      <div className="">
        <div className="flex justify-center mt-1 mb-3">
          <img src={logo} alt="Fo-Fi Logo" className="h-12" />
        </div>
        <div className="bg-white dark:bg-gray-900 shadow-xl rounded-2xl p-4 max-w-lg w-full text-center animate-fade-in">
          <p className="mb-2 justify-center text-sm">
            Welcome to our newly launched platform independent app. We
            appreciate your continued support as we enhance our services.
          </p>
          <div className="flex justify-center mb-2">
            <Download className="h-10 w-10 text-blue-500 animate-bounce" />
          </div>

          <h2 className="text-md font-bold text-gray-800 dark:text-gray-100">
            Install Fo-Fi CRM
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            To get the best experience, please install this{" "}
            <b>Fo-Fi CRM</b> application to your home screen.
          </p>

          {installMsg && (
            <div className="mb-2 p-2 rounded-lg bg-red-100 text-red-700 text-sm">
              {installMsg}
            </div>
          )}

          <button
            onClick={handleInstallClick}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 mb-1 bg-blue-600 hover:bg-blue-700 text-sm text-white font-semibold rounded-xl shadow transition-colors"
          >
            <Download className="w-5 h-5" />
            Install App
          </button>
          <p>OR</p>

          {/* Manual install instructions */}
          <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-2 mb-2 text-left space-y-2">
            <div className="flex items-center space-x-2">
              <AndroidIcon className="w-6 h-8 text-green-600" />
              <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mt-2">
                Android Users:
              </p>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-400 pl-6">
              Tap the <b>&vellip;</b> menu at the top right &rarr; Select{" "}
              <b>&quot;Add to Home Screen&quot;</b>(choose &apos;Install&apos;)
              or <b>&quot;Install App&quot;</b>.
            </p>
          </div>

          <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-2 mb-2 text-left space-y-2">
            <div className="flex items-center space-x-2">
              <AppleIcon className="w-6 h-6 text-gray-800 dark:text-white" />
              <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mt-2">
                iPhone Users:
              </p>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-400 pl-6">
              Tap the <b>Share</b> icon &rarr; Scroll down &rarr; Select{" "}
              <b>&quot;Add to Home Screen&quot;</b>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Inline SVG icons (same as Login.jsx) ---------- */

function AndroidIcon({ size = 24, color = "currentColor", className = "" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={color}
      width={size}
      height={size}
      className={className}
    >
      <path d="M17.6 9.48l1.43-2.48a.5.5 0 0 0-.87-.5l-1.44 2.5A7.002 7.002 0 0 0 12 7c-1.84 0-3.51.7-4.72 1.87L5.84 6.5a.5.5 0 1 0-.87.5L6.4 9.48A6.982 6.982 0 0 0 5 13v5a1 1 0 0 0 1 1h1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3h4v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3h1a1 1 0 0 0 1-1v-5a6.982 6.982 0 0 0-1.4-3.52zM9 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm6 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
    </svg>
  );
}

function AppleIcon({ size = 24, color = "currentColor", className = "" }) {
  return (
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
}
