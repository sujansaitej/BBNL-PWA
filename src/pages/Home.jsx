import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Languages,
  LayoutGrid,
  Radio,
  Play,
  Sparkles,
  ChevronRight,
  Zap,
  Download,
  ShieldAlert,
  X,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import { AdCarouselSkeleton } from "../components/Loader";
import { getAdvertisements, getAppVersion, getAppLock } from "../services/api";
import { getCachedAds, setCachedAds, preloadAdImages, getCachedLogo, cacheLogoFromUrl } from "../services/imageStore";


function proxyImageUrl(url) {
  if (!url) return null;
  return url.replace(
    /^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i,
    ""
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

// ── Advertisement Carousel ──
function AdCarousel({ ads }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState(new Set());
  const [readyUrls, setReadyUrls] = useState({});
  const timerRef = useRef(null);
  const DURATION = 5000;

  // Filter out failed images
  const validAds = ads.filter((_, i) => !failedImages.has(i));

  // Preload & fully decode each ad image before showing — no progressive rendering
  useEffect(() => {
    ads.forEach((ad) => {
      const src = proxyImageUrl(ad.adpath);
      if (!src) return;
      const img = new Image();
      img.src = src;
      img.decode()
        .then(() => setReadyUrls((prev) => ({ ...prev, [src]: src })))
        .catch(() => {});
    });
  }, [ads]);

  // Reset timer when active index or ads change
  const resetTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (validAds.length <= 1) return;
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % validAds.length);
    }, DURATION);
  };

  useEffect(() => {
    resetTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [validAds.length]);

  if (validAds.length === 0) return null;

  const safeIndex = activeIndex % validAds.length;
  const originalIndex = ads.indexOf(validAds[safeIndex]);
  const currentSrc = proxyImageUrl(validAds[safeIndex]?.adpath);
  const displaySrc = readyUrls[currentSrc];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl overflow-hidden mb-5 shadow-lg shadow-black/5"
    >
      {/* Image */}
      <div className="relative aspect-[16/7] bg-gradient-to-br from-gray-100 to-gray-50 overflow-hidden">
        <AnimatePresence mode="wait">
          {displaySrc && (
            <motion.img
              key={safeIndex}
              src={displaySrc}
              alt={`Ad ${safeIndex + 1}`}
              initial={{ opacity: 0, scale: 1.15 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 0.7 },
                scale: { duration: DURATION / 1000, ease: "easeOut" },
              }}
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => {
                setFailedImages((prev) => new Set(prev).add(originalIndex));
              }}
            />
          )}
        </AnimatePresence>

        {/* Bottom gradient for dots visibility */}
        {validAds.length > 1 && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
        )}

        {/* Dot indicators */}
        {validAds.length > 1 && (
          <div className="absolute bottom-2.5 left-0 right-0 flex items-center justify-center gap-1.5 z-10">
            {validAds.map((_, i) => (
              <button
                key={i}
                onClick={() => { setActiveIndex(i); resetTimer(); }}
                className={`rounded-full transition-all duration-300 ${
                  i === safeIndex
                    ? "w-5 h-1.5 bg-white"
                    : "w-1.5 h-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}

        {/* Auto-advance progress bar */}
        {validAds.length > 1 && (
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/10">
            <motion.div
              key={safeIndex}
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: DURATION / 1000, ease: "linear" }}
              className="h-full bg-white/40"
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const homeCachedAds = getCachedAds("home");
  const [ads, setAds] = useState(homeCachedAds);
  const [adsLoading, setAdsLoading] = useState(homeCachedAds.length === 0);

  const [appLocked, setAppLocked] = useState(false);
  const [lockMsg, setLockMsg] = useState("");
  const [updateInfo, setUpdateInfo] = useState(null); // { version, message, link }

  // ── Cached dark logo (base64 in localStorage) ──
  const [darkLogoSrc, setDarkLogoSrc] = useState(() => getCachedLogo("logo-dark") || "/logo-dark.png");

  useEffect(() => {
    cacheLogoFromUrl("logo-dark", "/logo-dark.png").then((dataUrl) => {
      if (dataUrl) setDarkLogoSrc(dataUrl);
    });
  }, []);

  const greeting = getGreeting();
  const firstName = (user.name || "User").split(" ")[0];

  const APP_VERSION = "1.0";

  const quickActions = [
    {
      label: "Live TV",
      icon: Play,
      gradient: "from-rose-500 to-red-600",
      shadow: "shadow-red-200",
      path: "/live-tv",
    },
    {
      label: "Channels",
      icon: LayoutGrid,
      gradient: "from-blue-500 to-indigo-600",
      shadow: "shadow-blue-200",
      path: "/channels",
    },
    {
      label: "Languages",
      icon: Languages,
      gradient: "from-emerald-500 to-teal-600",
      shadow: "shadow-emerald-200",
      path: "/languages",
    },
    {
      label: "Radio",
      icon: Radio,
      gradient: "from-amber-500 to-orange-600",
      shadow: "shadow-amber-200",
      path: "/live-tv",
    },
  ];

  // ── Check App Lock ──
  useEffect(() => {
    if (!user.mobile) return;

    const checkAppLock = async () => {
      console.group("%c🔒 [AppLock] Check", "color: #8b5cf6; font-weight: bold; font-size: 13px;");
      try {
        const data = await getAppLock({ mobile: user.mobile, appversion: APP_VERSION });
        const body = data?.body || {};
        console.log("%c🟢 lock:", "color: #22c55e; font-weight: bold;", body.lock);
        console.groupEnd();

        if (body.lock === "true") {
          setAppLocked(true);
          setLockMsg(body.testappmsg || "This app has been locked.");
        }
      } catch (err) {
        console.log("%c🔴 AppLock Error:", "color: #ef4444; font-weight: bold;", err.message);
        console.groupEnd();
      }
    };

    checkAppLock();
  }, []);

  // ── Check App Version ──
  useEffect(() => {
    if (!user.mobile) return;

    const checkVersion = async () => {
      console.group("%c📦 [Version] Check", "color: #0ea5e9; font-weight: bold; font-size: 13px;");
      try {
        const data = await getAppVersion({ mobile: user.mobile });
        const body = data?.body || {};
        console.log("%c🟢 Server version:", "color: #22c55e; font-weight: bold;", body.appversion);
        console.log("%c🟢 Current version:", "color: #22c55e; font-weight: bold;", APP_VERSION);
        console.groupEnd();

        const dismissed = sessionStorage.getItem("update_dismissed");
        if (body.appversion && body.appversion !== APP_VERSION && !dismissed) {
          setUpdateInfo({
            version: body.appversion,
            message: body.verchngmsg || "A new version is available!",
            link: body.appdwnldlink || "",
          });
        }
      } catch (err) {
        console.log("%c🔴 Version Error:", "color: #ef4444; font-weight: bold;", err.message);
        console.groupEnd();
      }
    };

    checkVersion();
  }, []);

  // ── Fetch Advertisements ──
  useEffect(() => {
    if (!user.mobile) return;

    const fetchAds = async () => {
      const hasCached = homeCachedAds.length > 0;

      console.group(
        `%c📢 [Ads] ${hasCached ? "Background refresh" : "Fetch"} Homepage Advertisements`,
        "color: #f59e0b; font-weight: bold; font-size: 13px;"
      );
      console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", user.mobile);
      console.log("%c🏷️ adclient:", "color: #6366f1; font-weight: bold;", "fofi");
      console.log("%c🖼️ srctype:", "color: #6366f1; font-weight: bold;", "Image");
      console.log("%c📍 displayarea:", "color: #6366f1; font-weight: bold;", "homepage");
      console.log("%c📋 displaytype:", "color: #6366f1; font-weight: bold;", "multiple");
      if (hasCached) {
        console.log(
          "%c⚡ Using %d cached ads while refreshing",
          "color: #22c55e; font-weight: bold;",
          homeCachedAds.length
        );
      }

      try {
        const data = await getAdvertisements({
          mobile: user.mobile,
          adclient: "fofi",
          srctype: "Image",
          displayarea: "homepage",
          displaytype: "multiple",
        });

        const adList = data?.body || [];
        console.log(
          "%c🟢 Total Ads:",
          "color: #22c55e; font-weight: bold; font-size: 14px;",
          adList.length
        );
        console.table(
          adList.map((ad, i) => ({
            "#": i + 1,
            "Ad Path": ad.adpath,
          }))
        );
        console.groupEnd();

        setAds(adList);
        setCachedAds("home", adList);
        preloadAdImages(adList, proxyImageUrl);
      } catch (err) {
        console.log(
          "%c🔴 [Ads] Error:",
          "color: #ef4444; font-weight: bold; font-size: 13px;",
          err.message
        );
        console.groupEnd();
      } finally {
        setAdsLoading(false);
      }
    };

    fetchAds();
  }, []);

  return (
    <AppLayout>
      <div className="px-4 pt-5 max-w-lg mx-auto">

        {/* ───── 1. Welcome Section ───── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-5"
        >
          <div>
            <p className="text-[13px] text-gray-400 font-medium">{greeting}</p>
            <h2 className="text-[22px] font-bold text-gray-900 leading-tight mt-0.5">
              {firstName}
            </h2>
          </div>
        </motion.div>

        {/* ───── 2. Advertisement Carousel ───── */}
        {adsLoading && <AdCarouselSkeleton />}
        {!adsLoading && ads.length > 0 && <AdCarousel ads={ads} />}

        {/* ───── 3. Quick Watch Banner ───── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.05 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate("/channels")}
          className="relative rounded-2xl overflow-hidden mb-5 cursor-pointer group"
        >
          <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 p-4">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-10 w-20 h-20 bg-white/5 rounded-full translate-y-1/2" />

            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Zap className="w-5 h-5 text-yellow-300" />
                </div>
                <div>
                  <h3 className="text-white text-[15px] font-bold">
                    Start Watching Now
                  </h3>
                  <p className="text-white/60 text-xs mt-0.5">
                    100+ free channels available
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
                <ChevronRight className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* ───── 4. Explore Grid ───── */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="mb-5"
        >
          <motion.div variants={fadeUp} className="flex items-center gap-2 mb-3 px-0.5">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-bold text-gray-700">
              Explore
            </h3>
          </motion.div>

          <div className="grid grid-cols-4 gap-2">
            {quickActions.map((mod) => (
              <motion.div
                key={mod.label}
                variants={fadeUp}
                whileTap={{ scale: 0.92 }}
                onClick={() => navigate(mod.path)}
                className="flex flex-col items-center cursor-pointer group"
              >
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${mod.gradient} flex items-center justify-center mb-2 shadow-md ${mod.shadow} group-active:shadow-sm transition-shadow`}
                >
                  <mod.icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-[11px] font-semibold text-gray-600 text-center">
                  {mod.label}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ───── 5. Feature Highlights ───── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.15 }}
          className="grid grid-cols-2 gap-2.5 mb-5"
        >
          <div
            onClick={() => navigate("/live-tv")}
            className="relative rounded-2xl overflow-hidden p-4 cursor-pointer group bg-gradient-to-br from-rose-500 to-pink-600 text-white min-h-[100px]"
          >
            <div className="absolute -right-3 -bottom-3 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative">
              <Play className="w-5 h-5 mb-2 opacity-80" />
              <h4 className="text-sm font-bold">Live TV</h4>
              <p className="text-[10px] opacity-70 mt-0.5">Watch live now</p>
            </div>
          </div>

          <div
            onClick={() => navigate("/languages")}
            className="relative rounded-2xl overflow-hidden p-4 cursor-pointer group bg-gradient-to-br from-teal-500 to-emerald-600 text-white min-h-[100px]"
          >
            <div className="absolute -right-3 -bottom-3 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative">
              <Languages className="w-5 h-5 mb-2 opacity-80" />
              <h4 className="text-sm font-bold">By Language</h4>
              <p className="text-[10px] opacity-70 mt-0.5">Hindi, Tamil & more</p>
            </div>
          </div>
        </motion.div>

        {/* ───── App Version Footer ───── */}
        <div className="flex flex-col items-center py-2 gap-1">
          <img
            src={darkLogoSrc}
            alt="Fo-Fi"
            className="h-8 w-auto object-contain opacity-20"
          />
          <p className="text-[10px] text-gray-300 font-medium tracking-wider">
            v{APP_VERSION}
          </p>
        </div>
      </div>

      {/* ───── App Locked Overlay ───── */}
      <AnimatePresence>
        {appLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center px-6"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center"
            >
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <ShieldAlert className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">App Locked</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{lockMsg}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Update Available Dialog ───── */}
      <AnimatePresence>
        {updateInfo && !appLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm flex items-center justify-center px-6"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full relative"
            >
              <button
                onClick={() => { sessionStorage.setItem("update_dismissed", "1"); setUpdateInfo(null); }}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>

              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <Download className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">Update Available</h3>
                <p className="text-xs text-gray-400 mb-3">Version {updateInfo.version}</p>
                <p className="text-sm text-gray-500 leading-relaxed mb-5">
                  {updateInfo.message}
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => { sessionStorage.setItem("update_dismissed", "1"); setUpdateInfo(null); }}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors min-h-[44px]"
                  >
                    Later
                  </button>
                  {updateInfo.link && (
                    <a
                      href={updateInfo.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-sm font-semibold text-white text-center hover:from-blue-600 hover:to-purple-700 transition-all min-h-[44px] flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      Update
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
