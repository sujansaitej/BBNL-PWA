import { useState, useEffect, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Languages, Globe, AlertCircle, ArrowLeft, Search, X, Mic, MicOff } from "lucide-react";
import Layout from "../../layout/Layout";
import { LanguageListSkeleton } from "../../components/iptv/Loader";
import { getLanguageList, getIptvMobile } from "../../services/iptvApi";
import { preloadLogos } from "../../services/logoCache";
import useCachedLogo from "../../hooks/useCachedLogo";
import { proxyImageUrl } from "../../services/iptvImage";
import { getEntry, getEntryAsync, setEntry, getAdaptiveTTL } from "../../services/channelStore";
import useVoiceSearch from "../../hooks/useVoiceSearch";
import IptvSignup from "../../components/iptv/IptvSignup";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.015 } },
};

const item = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0 },
};

const LangCard = memo(function LangCard({ lang, onClick }) {
  const hasLogo = lang.langlogomob && !lang.langlogomob.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(lang.langlogomob);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);
  const [imgError, setImgError] = useState(false);

  // Reset error when a new cached src arrives (e.g. cache finishes loading)
  useEffect(() => { if (cachedSrc) setImgError(false); }, [cachedSrc]);

  return (
    <motion.div variants={item} whileTap={{ scale: 0.95 }} onClick={onClick} className="flex flex-col items-center cursor-pointer group" style={{ willChange: 'transform, opacity' }}>
      <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-md mb-2 bg-gray-100 flex items-center justify-center group-active:shadow-sm transition-shadow">
        {cachedSrc && !imgError ? (
          <img src={cachedSrc} alt={lang.langtitle} className="w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
            <Globe className="w-7 h-7 text-emerald-600" />
          </div>
        )}
      </div>
      <span className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{lang.langtitle}</span>
    </motion.div>
  );
});

export default function LanguagesPage() {
  const navigate = useNavigate();
  const iptvMobile = getIptvMobile();

  const storeKey = `languages_${iptvMobile}`;
  const memEntry = getEntry(storeKey);

  const [languages, setLanguages] = useState(memEntry?.data || []);
  const [loading, setLoading] = useState(!memEntry?.data?.length);
  const [error, setError] = useState("");
  const [userNotFound, setUserNotFound] = useState(false);
  const [search, setSearch] = useState("");
  const [retrying, setRetrying] = useState(false);

  const onVoiceResult = useCallback((text) => setSearch(text), []);
  const {
    listening, voiceLang, voiceLangs, voiceError, micBlocked,
    hasSpeechSupport, startVoiceSearch, cycleVoiceLang,
  } = useVoiceSearch(onVoiceResult);

  useEffect(() => {
    if (memEntry?.data?.length) {
      preloadLogos(memEntry.data.map((l) => proxyImageUrl(l.langlogomob)).filter((u) => u && !u.includes("chnlnoimage")), true);
    }
  }, []);

  useEffect(() => {
    loadLanguages();
  }, []);

  const loadLanguages = async () => {
    setError("");
    setUserNotFound(false);

    // Languages change rarely — use 2× adaptive TTL
    const ttl = getAdaptiveTTL() * 2;
    let hasCachedData = languages.length > 0;
    let dataIsFresh = memEntry && (Date.now() - memEntry.ts < ttl);

    // L2 fallback: IndexedDB
    if (!hasCachedData) {
      const idbEntry = await getEntryAsync(storeKey);
      if (idbEntry?.data?.length > 0) {
        setLanguages(idbEntry.data);
        setLoading(false);
        hasCachedData = true;
        dataIsFresh = Date.now() - idbEntry.ts < ttl;
        preloadLogos(idbEntry.data.map((l) => proxyImageUrl(l.langlogomob)).filter((u) => u && !u.includes("chnlnoimage")), true);
      }
    }

    if (dataIsFresh) return;
    if (!hasCachedData) setLoading(true);

    try {
      const data = await getLanguageList({ mobile: iptvMobile });
      const langs = data?.body?.[0]?.languages || [];

      setEntry(storeKey, langs);
      preloadLogos(langs.map((l) => proxyImageUrl(l.langlogomob)).filter((u) => u && !u.includes("chnlnoimage")), true);
      setLanguages(langs);
    } catch (err) {
      if (hasCachedData) return;
      const msg = err.message || "Failed to load languages.";
      if (msg.toLowerCase().includes("user not found")) {
        setUserNotFound(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredLanguages = search.trim()
    ? languages.filter((lang) => lang.langtitle?.toLowerCase().includes(search.trim().toLowerCase()))
    : languages;

  return (
    <Layout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate("/cust/livetv")} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-sm">
            <Languages className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">Languages</h2>
            <p className="text-xs text-gray-400">{loading ? "Loading..." : `${filteredLanguages.length} language${filteredLanguages.length !== 1 ? "s" : ""} available`}</p>
          </div>
        </motion.div>

        {/* Search bar with voice */}
        <div className="relative mb-4">
          <div className={`flex items-center bg-white border rounded-xl px-3 py-3 shadow-sm transition-[border-color,box-shadow] min-h-[48px] ${listening ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-gray-200 focus-within:border-emerald-300 focus-within:ring-1 focus-within:ring-emerald-200'}`}>
            <Search className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
            <input type="text" placeholder={listening ? "Listening..." : "Search languages..."} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full outline-none text-sm text-gray-700 bg-transparent placeholder-gray-400" />
            {search && (<button onClick={() => setSearch("")} className="ml-2 flex-shrink-0"><X className="w-4 h-4 text-gray-400" /></button>)}
            {hasSpeechSupport && (
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                <button onClick={cycleVoiceLang} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors">
                  {voiceLangs.find(l => l.code === voiceLang)?.label}
                </button>
                <button onClick={startVoiceSearch} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${micBlocked ? 'bg-gray-200 cursor-not-allowed' : listening ? 'bg-emerald-500 animate-pulse' : 'bg-gray-100 hover:bg-gray-200 active:bg-gray-300'}`}>
                  {micBlocked ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className={`w-4 h-4 ${listening ? 'text-white' : 'text-gray-500'}`} />}
                </button>
              </div>
            )}
          </div>
          <AnimatePresence>
            {listening && (
              <motion.p key="listening" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[11px] text-emerald-500 font-medium mt-1.5 ml-1">
                Speak a language name...
              </motion.p>
            )}
            {voiceError && !listening && (
              <motion.p key="voice-error" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[11px] text-orange-600 font-medium mt-1.5 ml-1">
                {voiceError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {loading && <LanguageListSkeleton count={6} />}

        {!loading && userNotFound && (
          <IptvSignup
            name={(() => { const u = JSON.parse(localStorage.getItem("user") || "{}"); return [u.firstname, u.lastname].filter(Boolean).join(" ") || u.username || ""; })()}
            mobile={iptvMobile}
            onSuccess={() => { setUserNotFound(false); loadLanguages(); }}
          />
        )}

        {!loading && error && !userNotFound && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-red-400" /></div>
            <p className="text-sm text-gray-600 mb-1 font-medium">{error}</p>
            <button onClick={() => { setRetrying(true); setError(''); loadLanguages().finally(() => setRetrying(false)); }} disabled={retrying} className="mt-3 text-sm text-purple-600 font-semibold hover:underline disabled:opacity-50">{retrying ? 'Retrying...' : 'Try again'}</button>
          </motion.div>
        )}

        {!loading && !error && filteredLanguages.length > 0 && (
          <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-4 gap-4">
            {filteredLanguages.map((lang, idx) => (
              <LangCard
                key={lang.langid || idx}
                lang={lang}
                onClick={() => navigate("/cust/livetv/channels", { state: { langid: lang.langid, langTitle: lang.langtitle } })}
              />
            ))}
          </motion.div>
        )}

        {!loading && !error && filteredLanguages.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-20">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4"><Languages className="w-7 h-7 text-gray-300" /></div>
            <p className="text-sm text-gray-500 font-medium">No languages found</p>
            <p className="text-xs text-gray-400 mt-1">Try a different search</p>
            {search && (<button onClick={() => setSearch("")} className="mt-3 text-sm text-emerald-600 font-semibold hover:underline">Clear search</button>)}
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
