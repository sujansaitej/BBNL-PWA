import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Info,
  Globe,
  Facebook,
  Youtube,
  Tv,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import { AppInfoSkeleton } from "../components/Loader";
import { getAppLock } from "../services/api";

export default function AppInfoPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [appData, setAppData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user.mobile) {
      navigate("/", { replace: true });
      return;
    }
    fetchAppInfo();
  }, []);

  const fetchAppInfo = async () => {
    setLoading(true);
    setError("");

    console.group(
      "%c🔵 [AppInfo] Fetch App Lock / Company Info",
      "color: #3b82f6; font-weight: bold; font-size: 13px;"
    );
    console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", user.mobile);

    try {
      const data = await getAppLock({ mobile: user.mobile });
      console.log(
        "%c🟢 SUCCESS",
        "color: #22c55e; font-weight: bold; font-size: 13px;",
        data?.body
      );
      console.groupEnd();
      setAppData(data?.body || {});
    } catch (err) {
      console.log(
        "%c🔴 ERROR",
        "color: #ef4444; font-weight: bold; font-size: 13px;",
        err.message
      );
      console.groupEnd();
      setError(err.message || "Failed to load app info.");
    } finally {
      setLoading(false);
    }
  };

  const links = appData
    ? [
        { icon: Globe, label: "Website", url: appData.web_url, color: "text-blue-600", bg: "bg-blue-50" },
        { icon: Facebook, label: "Facebook", url: appData.fb_link, color: "text-indigo-600", bg: "bg-indigo-50" },
        { icon: Youtube, label: "YouTube", url: appData.utube_link, color: "text-red-600", bg: "bg-red-50" },
      ].filter((l) => l.url)
    : [];

  return (
    <AppLayout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-6"
        >
          <button
            onClick={() => navigate(-1)}
            className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-gray-800">App Info</h2>
            <p className="text-xs text-gray-400">About IPTV FTA</p>
          </div>
        </motion.div>

        {/* Loading */}
        {loading && <AppInfoSkeleton />}

        {/* Error */}
        {!loading && error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16"
          >
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <p className="text-sm text-gray-600 mb-1 font-medium">{error}</p>
            <button
              onClick={fetchAppInfo}
              className="mt-3 text-sm text-purple-600 font-semibold hover:underline"
            >
              Try again
            </button>
          </motion.div>
        )}

        {/* App Info Content */}
        {!loading && !error && appData && (
          <div className="space-y-5">
            {/* Brand Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <Tv className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-800">IPTV FTA</h3>
              <p className="text-sm text-gray-400 mt-1">Free-to-Air Streaming</p>
              <div className="mt-3 inline-block bg-purple-50 rounded-full px-4 py-1.5">
                <span className="text-sm font-semibold text-purple-600">
                  Version 1.0.0
                </span>
              </div>
              {appData.cmy_name && (
                <p className="text-xs text-gray-400 mt-3">
                  by {appData.cmy_name}
                </p>
              )}
            </motion.div>

            {/* Marquee / Test Message */}
            {appData.testappmsg && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3"
              >
                <p className="text-xs text-amber-700 font-medium">
                  {appData.testappmsg}
                </p>
              </motion.div>
            )}

            {/* Social Links */}
            {links.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden"
              >
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors min-h-[56px]"
                  >
                    <div className={`w-10 h-10 rounded-xl ${link.bg} flex items-center justify-center flex-shrink-0`}>
                      <link.icon className={`w-5 h-5 ${link.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-gray-800">{link.label}</h4>
                      <p className="text-[11px] text-gray-400 truncate">{link.url}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  </a>
                ))}
              </motion.div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
