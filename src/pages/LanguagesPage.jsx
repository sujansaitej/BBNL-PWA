import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Languages, ChevronRight, Globe, AlertCircle } from "lucide-react";
import AppLayout from "../components/AppLayout";
import { LanguageListSkeleton } from "../components/Loader";
import { getLanguageList } from "../services/api";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0 },
};

function proxyImageUrl(url) {
  if (!url) return null;
  return url.replace(
    /^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i,
    ""
  );
}

function LangItem({ lang, onClick }) {
  const [imgError, setImgError] = useState(false);
  const hasLogo =
    lang.langlogomob && !lang.langlogomob.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(lang.langlogomob);

  return (
    <motion.div
      variants={item}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors min-h-[56px]"
    >
      {hasLogo && imgSrc && !imgError ? (
        <img
          src={imgSrc}
          alt={lang.langtitle}
          className="w-11 h-11 rounded-xl object-cover flex-shrink-0 bg-gray-100 shadow-sm"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center flex-shrink-0">
          <Globe className="w-5 h-5 text-emerald-600" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-gray-800">
          {lang.langtitle}
        </h4>
        {lang.langdetails &&
          lang.langdetails !== lang.langtitle &&
          !lang.langdetails.includes("<") && (
            <p className="text-[11px] text-gray-400 truncate">
              {lang.langdetails}
            </p>
          )}
      </div>

      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </motion.div>
  );
}

export default function LanguagesPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user.mobile) {
      navigate("/", { replace: true });
      return;
    }
    fetchLanguages();
  }, []);

  const fetchLanguages = async () => {
    setLoading(true);
    setError("");

    console.group("%c🔵 [Languages] Fetch Language List", "color: #3b82f6; font-weight: bold; font-size: 13px;");
    console.log("%c🔑 Sending Keys:", "color: #8b5cf6; font-weight: bold;", "mobile");
    console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", user.mobile);

    try {
      const data = await getLanguageList({ mobile: user.mobile });
      console.log("%c🟢 SUCCESS RESPONSE", "color: #22c55e; font-weight: bold; font-size: 13px;", data);
      console.log("%c🟢 err_code:", "color: #22c55e; font-weight: bold;", data?.status?.err_code);
      console.log("%c🟢 err_msg:", "color: #22c55e; font-weight: bold;", data?.status?.err_msg);

      const langs = data?.body?.[0]?.languages || [];
      console.log("%c🟢 Total Languages:", "color: #22c55e; font-weight: bold; font-size: 14px;", langs.length);
      console.log("%c🟢 Languages:", "color: #22c55e; font-weight: bold;", langs.map((l) => `${l.langtitle} (id: ${l.langid})`));
      console.table(langs.map((l, i) => ({
        "#": i + 1,
        Language: l.langtitle,
        ID: l.langid,
        "Has Image": l.langlogomob && !l.langlogomob.includes("chnlnoimage") ? "Yes" : "No",
        "Image URL (Proxied)": proxyImageUrl(l.langlogomob) || "N/A",
      })));
      console.groupEnd();

      setLanguages(langs);
    } catch (err) {
      console.log("%c🔴 ERROR", "color: #ef4444; font-weight: bold; font-size: 13px;", err.message);
      console.groupEnd();
      setError(err.message || "Failed to load languages.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        {/* ───── Page Header ───── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-5"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-sm">
            <Languages className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">Languages</h2>
            <p className="text-xs text-gray-400">
              Select a language to browse channels
            </p>
          </div>
        </motion.div>

        {/* ───── Loading State ───── */}
        {loading && <LanguageListSkeleton count={6} />}

        {/* ───── Error State ───── */}
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
              onClick={fetchLanguages}
              className="mt-3 text-sm text-purple-600 font-semibold hover:underline"
            >
              Try again
            </button>
          </motion.div>
        )}

        {/* ───── Language List ───── */}
        {!loading && !error && languages.length > 0 && (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden"
          >
            {languages.map((lang, idx) => (
              <LangItem
                key={lang.langid || idx}
                lang={lang}
                onClick={() =>
                  navigate("/channels", {
                    state: { langid: lang.langid, langTitle: lang.langtitle },
                  })
                }
              />
            ))}
          </motion.div>
        )}

        {/* ───── Empty State ───── */}
        {!loading && !error && languages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Languages className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">No languages available</p>
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}
