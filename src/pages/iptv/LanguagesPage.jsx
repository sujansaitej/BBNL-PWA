import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Languages, Globe, AlertCircle, ArrowLeft } from "lucide-react";
import Layout from "../../layout/Layout";
import { LanguageListSkeleton } from "../../components/iptv/Loader";
import { getLanguageList, getIptvMobile } from "../../services/iptvApi";
import { preloadLogos } from "../../services/logoCache";
import useCachedLogo from "../../hooks/useCachedLogo";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0 },
};

function proxyImageUrl(url) {
  if (!url) return null;
  return url.replace(/^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i, "");
}

function LangCard({ lang, onClick }) {
  const hasLogo = lang.langlogomob && !lang.langlogomob.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(lang.langlogomob);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <motion.div variants={item} whileTap={{ scale: 0.95 }} onClick={onClick} className="flex flex-col items-center cursor-pointer group">
      <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-md mb-2 bg-gray-100 flex items-center justify-center group-active:shadow-sm transition-shadow">
        {cachedSrc ? (
          <img src={cachedSrc} alt={lang.langtitle} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
            <Globe className="w-7 h-7 text-emerald-600" />
          </div>
        )}
      </div>
      <span className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{lang.langtitle}</span>
    </motion.div>
  );
}

export default function LanguagesPage() {
  const navigate = useNavigate();
  const iptvMobile = getIptvMobile();

  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchLanguages();
  }, []);

  const fetchLanguages = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getLanguageList({ mobile: iptvMobile });
      const langs = data?.body?.[0]?.languages || [];
      preloadLogos(langs.map((l) => proxyImageUrl(l.langlogomob)).filter((u) => u && !u.includes("chnlnoimage")));
      setLanguages(langs);
    } catch (err) {
      setError(err.message || "Failed to load languages.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-5">
          <button onClick={() => navigate("/cust/livetv")} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-sm">
            <Languages className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">Languages</h2>
            <p className="text-xs text-gray-400">Select a language to browse channels</p>
          </div>
        </motion.div>

        {loading && <LanguageListSkeleton count={6} />}

        {!loading && error && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-red-400" /></div>
            <p className="text-sm text-gray-600 mb-1 font-medium">{error}</p>
            <button onClick={fetchLanguages} className="mt-3 text-sm text-purple-600 font-semibold hover:underline">Try again</button>
          </motion.div>
        )}

        {!loading && !error && languages.length > 0 && (
          <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-4 gap-4">
            {languages.map((lang, idx) => (
              <LangCard
                key={lang.langid || idx}
                lang={lang}
                onClick={() => navigate("/cust/livetv/channels", { state: { langid: lang.langid, langTitle: lang.langtitle } })}
              />
            ))}
          </motion.div>
        )}

        {!loading && !error && languages.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-20">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4"><Languages className="w-7 h-7 text-gray-300" /></div>
            <p className="text-sm text-gray-400">No languages available</p>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
