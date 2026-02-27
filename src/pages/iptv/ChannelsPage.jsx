import { useState, useEffect, useCallback, memo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutGrid, Search, AlertCircle, Play, Tv, ArrowLeft, X, Mic, MicOff } from "lucide-react";
import Layout from "../../layout/Layout";
import useVoiceSearch from "../../hooks/useVoiceSearch";
import { ChannelGridSkeleton } from "../../components/iptv/Loader";
import { getChannelList, getAdvertisements, getIptvMobile, prefetchPublicIP } from "../../services/iptvApi";
import { preloadLogos } from "../../services/logoCache";
import useCachedLogo from "../../hooks/useCachedLogo";
import { proxyImageUrl } from "../../services/iptvImage";
import { getEntry, getEntryAsync, setEntry, getAdaptiveTTL, waitForHydration } from "../../services/channelStore";
import IptvSignup from "../../components/iptv/IptvSignup";

/** Filter master channel list by language.
 *  The "subs" endpoint returns all subscribed channels; each channel
 *  carries its language id.  We match against the passed langid. */
function filterByLang(allChannels, langid) {
  if (!langid || langid === "subs") return allChannels;
  const id = String(langid);
  return allChannels.filter(
    (ch) => String(ch.langid ?? "") === id || String(ch.chlangid ?? "") === id
  );
}

const AD_ZOOM_DURATION = 5;

function getNextAdIndex(langid, totalAds) {
  const key = `ad_idx_${langid || "all"}`;
  const last = parseInt(sessionStorage.getItem(key) ?? "-1", 10);
  const next = (last + 1) % totalAds;
  sessionStorage.setItem(key, String(next));
  return next;
}

const AdBanner = memo(function AdBanner({ ad }) {
  if (!ad?.content) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-4 rounded-xl overflow-hidden relative col-span-2" style={{ willChange: 'transform, opacity' }}>
      <div className="aspect-[16/7] bg-gray-50 overflow-hidden">
        <a href={ad.redirectlink || "#"} target="_blank" rel="noopener noreferrer">
          <motion.img src={proxyImageUrl(ad.content)} alt={ad.description || "Ad"} initial={{ scale: 1.15 }} animate={{ scale: 1 }} transition={{ duration: AD_ZOOM_DURATION, ease: "easeOut" }} className="w-full h-full object-cover" onError={(e) => { e.target.closest(".rounded-xl").style.display = "none"; }} />
        </a>
      </div>
      <span className="absolute top-2 right-2 text-[9px] font-semibold text-white/70 bg-black/30 px-1.5 py-0.5 rounded backdrop-blur-sm">Ad</span>
    </motion.div>
  );
});

// Plain div instead of motion.div — eliminates framer-motion JS overhead
// for 275 DOM nodes. CSS active:scale-[0.98] gives the same tap feedback
// via the GPU compositor (zero JS cost).
// content-visibility: auto — Chrome skips layout/paint for off-screen cards,
// cutting initial render from 200+ items to ~6 visible ones.
const ChannelCard = memo(function ChannelCard({ channel, onPlay }) {
  const hasLogo = channel.chlogo && !channel.chlogo.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(channel.chlogo);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <div onClick={() => onPlay(channel)} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer hover:shadow-md active:scale-[0.98] transition-[shadow,transform] duration-150" style={{ contain: 'layout style', contentVisibility: 'auto', containIntrinsicSize: 'auto 185px' }}>
      <div className="relative aspect-video bg-gray-50 flex items-center justify-center">
        {cachedSrc ? (<img src={cachedSrc} alt={channel.chtitle} className="w-full h-full object-contain p-3" />) : (
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-100 to-cyan-100 flex items-center justify-center"><Tv className="w-7 h-7 text-blue-500" /></div>
        )}
        <div className="absolute inset-0 bg-black/0 hover:bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg"><Play className="w-5 h-5 text-blue-600 ml-0.5" /></div>
        </div>
      </div>
      <div className="px-3 py-2.5">
        <h4 className="text-xs font-semibold text-gray-800 truncate">{channel.chtitle}</h4>
        {channel.chprice !== undefined && (
          <p className="text-[10px] text-gray-400 mt-0.5">{parseFloat(channel.chprice) === 0 ? "Free" : `₹${channel.chprice}`}</p>
        )}
      </div>
    </div>
  );
});

export default function ChannelsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const iptvMobile = getIptvMobile();

  const langid = location.state?.langid || "subs";
  const langTitle = location.state?.langTitle || "";
  const isSpecificLang = langid && langid !== "subs";

  // ── Local-first: try per-language cache first, then master list ──
  const langKey = isSpecificLang ? `channels_${iptvMobile}_${langid}` : null;
  const masterKey = `channels_${iptvMobile}_subs`;

  const langEntry = langKey ? getEntry(langKey) : null;
  const masterEntry = getEntry(masterKey);

  const initialChannels = langEntry?.data?.length
    ? langEntry.data
    : masterEntry?.data?.length
      ? filterByLang(masterEntry.data, langid)
      : [];

  const [channels, setChannels] = useState(initialChannels);
  const [loading, setLoading] = useState(!initialChannels.length);
  const [error, setError] = useState("");
  const [userNotFound, setUserNotFound] = useState(false);
  const [search, setSearch] = useState("");
  const [retrying, setRetrying] = useState(false);

  const onVoiceResult = useCallback((text) => setSearch(text), []);
  const {
    listening, voiceLang, voiceLangs, voiceError, micBlocked,
    hasSpeechSupport, startVoiceSearch, cycleVoiceLang,
  } = useVoiceSearch(onVoiceResult, { parseNumbers: true });

  const [ads, setAds] = useState([]);

  // Preload logos for channels loaded from memory
  useEffect(() => {
    if (initialChannels.length) {
      const urls = initialChannels.map((ch) => proxyImageUrl(ch.chlogo)).filter((u) => u && !u.includes("chnlnoimage"));
      preloadLogos(urls.slice(0, 25));
      if (urls.length > 25) setTimeout(() => preloadLogos(urls.slice(25)), 100);
    }
  }, []); // run once on mount

  useEffect(() => {
    prefetchPublicIP();
    loadChannels();
    getAdvertisements({ mobile: iptvMobile }).then(data => {
      const list = (data?.body?.[0]?.ads || []).filter(a => a.content);
      if (list.length > 0) setAds(list);
    }).catch(() => {});
  }, [langid]);

  function _preloadChannelLogos(chnls) {
    const urls = chnls.map((ch) => proxyImageUrl(ch.chlogo)).filter((u) => u && !u.includes("chnlnoimage"));
    preloadLogos(urls.slice(0, 25));
    if (urls.length > 25) setTimeout(() => preloadLogos(urls.slice(25)), 100);
  }

  const loadChannels = async () => {
    setError("");
    setUserNotFound(false);

    // Ensure IndexedDB → L1 hydration is complete before cache lookups
    // (prevents missing persisted data on cold page load / deep link)
    await waitForHydration();

    const ttl = getAdaptiveTTL();
    let hasCachedData = channels.length > 0;
    let dataIsFresh = false;

    // After hydration, re-check caches (L1 may now have IDB data)
    if (!hasCachedData) {
      // Try per-language cache first (fastest path for repeat visits)
      if (langKey) {
        const entry = getEntry(langKey) || await getEntryAsync(langKey);
        if (entry?.data?.length > 0) {
          setChannels(entry.data);
          setLoading(false);
          hasCachedData = true;
          dataIsFresh = Date.now() - entry.ts < ttl;
          _preloadChannelLogos(entry.data);
        }
      }
      // Fall back to master list
      if (!hasCachedData) {
        const mEntry = getEntry(masterKey) || await getEntryAsync(masterKey);
        if (mEntry?.data?.length > 0) {
          const filtered = filterByLang(mEntry.data, langid);
          if (filtered.length > 0) {
            setChannels(filtered);
            setLoading(false);
            hasCachedData = true;
            dataIsFresh = Date.now() - mEntry.ts < ttl;
            _preloadChannelLogos(filtered);
          }
        }
      }
    } else {
      // Determine freshness from whichever cache produced initial data
      const ts = langEntry?.ts || masterEntry?.ts || 0;
      dataIsFresh = ts > 0 && (Date.now() - ts < ttl);
    }

    if (dataIsFresh) return;
    if (!hasCachedData) setLoading(true);

    try {
      if (isSpecificLang && !hasCachedData) {
        // ── FAST PATH: fetch only this language (smaller payload, faster) ──
        // Instead of downloading all 275+ channels, fetch only ~20-40 for
        // this language.  Background-fetch "subs" to populate master cache.
        const data = await getChannelList({ mobile: iptvMobile, langid });
        const chnls = data?.body?.[0]?.channels || [];

        if (langKey) setEntry(langKey, chnls);
        setChannels(chnls);
        _preloadChannelLogos(chnls);

        // Background: populate master cache for future navigation
        getChannelList({ mobile: iptvMobile, langid: "subs" })
          .then((d) => {
            const all = d?.body?.[0]?.channels || [];
            if (all.length > 0) setEntry(masterKey, all);
          })
          .catch(() => {}); // best-effort
      } else {
        // ── NORMAL PATH: fetch all, filter client-side, cache both ──
        const data = await getChannelList({ mobile: iptvMobile, langid: "subs" });
        const allChnls = data?.body?.[0]?.channels || [];

        setEntry(masterKey, allChnls);
        const chnls = filterByLang(allChnls, langid);
        // Also cache per-language for instant future direct hits
        if (isSpecificLang && langKey && chnls.length > 0) {
          setEntry(langKey, chnls);
        }
        setChannels(chnls);
        _preloadChannelLogos(chnls);
      }
    } catch (err) {
      if (hasCachedData) return;
      const msg = err.message || "Failed to load channels.";
      if (msg.toLowerCase().includes("user not found")) {
        setUserNotFound(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePlayChannel = (channel) => {
    navigate("/cust/livetv/player", { state: { channel, channels } });
  };

  const filteredChannels = search.trim()
    ? channels.filter((ch) => {
        const term = search.trim().toLowerCase();
        const nameMatch = ch.chtitle?.toLowerCase().includes(term);
        const numMatch = /^\d+$/.test(term) && String(ch.chno || "") === term;
        return nameMatch || numMatch;
      })
    : channels;

  const pageTitle = langTitle ? `${langTitle} Channels` : "All Channels";

  return (
    <Layout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-sm flex-shrink-0">
            <LayoutGrid className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-800 truncate">{pageTitle}</h2>
            <p className="text-xs text-gray-400">{loading ? "Loading..." : `${filteredChannels.length} channel${filteredChannels.length !== 1 ? "s" : ""} available`}</p>
          </div>
        </motion.div>

        <div className="relative mb-4">
          <div className={`flex items-center bg-white border rounded-xl px-3 py-3 shadow-sm transition-[border-color,box-shadow] min-h-[48px] ${listening ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200'}`}>
            <Search className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
            <input type="text" placeholder={listening ? "Listening..." : "Search by name or channel number..."} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full outline-none text-sm text-gray-700 bg-transparent placeholder-gray-400" />
            {search && (<button onClick={() => setSearch("")} className="ml-2 flex-shrink-0"><X className="w-4 h-4 text-gray-400" /></button>)}
            {hasSpeechSupport && (
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                <button onClick={cycleVoiceLang} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors">
                  {voiceLangs.find(l => l.code === voiceLang)?.label}
                </button>
                <button onClick={startVoiceSearch} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${micBlocked ? 'bg-gray-200 cursor-not-allowed' : listening ? 'bg-blue-500 animate-pulse' : 'bg-gray-100 hover:bg-gray-200 active:bg-gray-300'}`}>
                  {micBlocked ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className={`w-4 h-4 ${listening ? 'text-white' : 'text-gray-500'}`} />}
                </button>
              </div>
            )}
          </div>
          <AnimatePresence>
            {listening && (
              <motion.p key="listening" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[11px] text-blue-500 font-medium mt-1.5 ml-1">
                Speak a channel name or number...
              </motion.p>
            )}
            {voiceError && !listening && (
              <motion.p key="voice-error" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[11px] text-orange-600 font-medium mt-1.5 ml-1">
                {voiceError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {ads.length > 0 && (<AdBanner ad={ads[getNextAdIndex(langid, ads.length)]} />)}

        {loading && <ChannelGridSkeleton count={6} />}

        {!loading && userNotFound && (
          <IptvSignup
            name={(() => { const u = JSON.parse(localStorage.getItem("user") || "{}"); return [u.firstname, u.lastname].filter(Boolean).join(" ") || u.username || ""; })()}
            mobile={iptvMobile}
            onSuccess={() => { setUserNotFound(false); loadChannels(); }}
          />
        )}

        {!loading && error && !userNotFound && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-red-400" /></div>
            <p className="text-sm text-gray-600 mb-1 font-medium">{error}</p>
            <button onClick={() => { setRetrying(true); setError(''); loadChannels().finally(() => setRetrying(false)); }} disabled={retrying} className="mt-3 text-sm text-blue-600 font-semibold hover:underline disabled:opacity-50">{retrying ? 'Retrying...' : 'Try again'}</button>
          </motion.div>
        )}

        {!loading && !error && filteredChannels.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {filteredChannels.map((ch, idx) => (<ChannelCard key={ch.chid || idx} channel={ch} onPlay={handlePlayChannel} />))}
          </div>
        )}

        {!loading && !error && filteredChannels.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-20">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4"><LayoutGrid className="w-7 h-7 text-gray-300" /></div>
            <p className="text-sm text-gray-500 font-medium">No channels found</p>
            <p className="text-xs text-gray-400 mt-1">Try a different search or language</p>
            {search && (<button onClick={() => setSearch("")} className="mt-3 text-sm text-blue-600 font-semibold hover:underline">Clear search</button>)}
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
