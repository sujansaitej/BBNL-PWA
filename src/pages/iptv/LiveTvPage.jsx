import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Play, Tv, Radio, AlertCircle, X, Languages, Globe, ArrowLeft, Mic, MicOff } from "lucide-react";
import Layout from "../../layout/Layout";
import { ChannelListSkeleton } from "../../components/iptv/Loader";
import { getChannelList, getLanguageList, getAdvertisements, getIptvMobile } from "../../services/iptvApi";
import { preloadLogos } from "../../services/logoCache";
import useCachedLogo from "../../hooks/useCachedLogo";
import { proxyImageUrl } from "../../services/iptvImage";
import IptvSignup from "../../components/iptv/IptvSignup";

const AD_ZOOM_DURATION = 5;

function getNextAdIndex(page, totalAds) {
  const key = `ad_idx_${page}`;
  const last = parseInt(sessionStorage.getItem(key) ?? "-1", 10);
  const next = (last + 1) % totalAds;
  sessionStorage.setItem(key, String(next));
  return next;
}

function AdBanner({ ad }) {
  if (!ad?.content) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-4 rounded-xl overflow-hidden relative">
      <div className="aspect-[16/7] bg-gray-50 overflow-hidden">
        <a href={ad.redirectlink || "#"} target="_blank" rel="noopener noreferrer">
          <motion.img src={proxyImageUrl(ad.content)} alt={ad.description || "Ad"} initial={{ scale: 1.15 }} animate={{ scale: 1 }} transition={{ duration: AD_ZOOM_DURATION, ease: "easeOut" }} className="w-full h-full object-cover" onError={(e) => { e.target.closest(".rounded-xl").style.display = "none"; }} />
        </a>
      </div>
      <span className="absolute top-2 right-2 text-[9px] font-semibold text-white/70 bg-black/30 px-1.5 py-0.5 rounded backdrop-blur-sm">Ad</span>
    </motion.div>
  );
}

function LangCard({ lang, onClick }) {
  const hasLogo = lang.langlogomob && !lang.langlogomob.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(lang.langlogomob);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <motion.div whileTap={{ scale: 0.95 }} onClick={onClick} className="flex flex-col items-center cursor-pointer flex-shrink-0 w-[72px]">
      <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-md mb-1.5 bg-gray-100 flex items-center justify-center">
        {cachedSrc ? (
          <img src={cachedSrc} alt={lang.langtitle} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
            <Globe className="w-6 h-6 text-emerald-600" />
          </div>
        )}
      </div>
      <span className="text-[10px] font-semibold text-gray-600 text-center leading-tight truncate w-full">{lang.langtitle}</span>
    </motion.div>
  );
}

function ChannelRow({ channel, index, onPlay }) {
  const hasLogo = channel.chlogo && !channel.chlogo.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(channel.chlogo);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index * 0.02, 0.5) }} whileTap={{ scale: 0.98 }} onClick={() => onPlay(channel)} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors border border-gray-100 shadow-sm">
      <div className="w-7 text-center flex-shrink-0"><span className="text-xs font-bold text-gray-600">{channel.chno || index + 1}</span></div>
      <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {cachedSrc ? (<img src={cachedSrc} alt={channel.chtitle} className="w-full h-full object-contain p-1" />) : (<Tv className="w-5 h-5 text-gray-300" />)}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-gray-800 truncate">{channel.chtitle}</h4>
        <p className="text-[11px] text-gray-400 mt-0.5">{parseFloat(channel.chprice) === 0 ? "Free to Air" : `₹${channel.chprice}`}</p>
      </div>
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-red-200">
        <Play className="w-4 h-4 text-white ml-0.5" />
      </div>
    </motion.div>
  );
}

export default function LiveTvPage() {
  const navigate = useNavigate();
  const iptvMobile = getIptvMobile();

  const [channels, setChannels] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userNotFound, setUserNotFound] = useState(false);
  const [search, setSearch] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-IN");
  const [voiceError, setVoiceError] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);

  const hasSpeechSupport = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // Voice languages the user can cycle through
  const voiceLangs = [
    { code: "en-IN", label: "EN" },
    { code: "hi-IN", label: "HI" },
    { code: "te-IN", label: "TE" },
    { code: "ta-IN", label: "TA" },
    { code: "kn-IN", label: "KN" },
  ];

  // Cleanup recognition + timeout on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Check mic permission on mount (so we can show MicOff if blocked)
  useEffect(() => {
    if (!hasSpeechSupport) return;
    navigator.permissions?.query({ name: "microphone" }).then((status) => {
      setMicBlocked(status.state === "denied");
      status.onchange = () => setMicBlocked(status.state === "denied");
    }).catch(() => {});
  }, [hasSpeechSupport]);

  const parseSpokenNumber = useCallback((text) => {
    let t = text.toLowerCase().trim();

    // Strip filler words: "channel", "number", "no", "play", Hindi commands
    t = t.replace(/\b(channel|number|no\.?|play|open|search|find|go to|switch to|tune to|dikhao|chalao|lagao|batao|sunao)\b/gi, "").trim();

    // ── Hindi / Hinglish number words (1–99 + multipliers) ──
    const hindiMap = {
      sunya: 0, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, che: 6, cheh: 6,
      saat: 7, sat: 7, aath: 8, aat: 8, nau: 9, das: 10, gyarah: 11, barah: 12, terah: 13,
      chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20,
      ikkees: 21, bais: 22, teis: 23, chaubis: 24, pachchis: 25, chhabbis: 26, sattais: 27,
      attais: 28, untees: 29, tees: 30, ikatees: 31, battis: 32, tentis: 33, chautis: 34,
      paintis: 35, chhattis: 36, saintis: 37, adhtis: 38, untalis: 39, chalis: 40,
      iktalis: 41, bayalis: 42, tentalis: 43, chavalis: 44, paintalis: 45, chhiyalis: 46,
      saintalis: 47, adhtalis: 48, unchas: 49, pachas: 50, ikyavan: 51, bavan: 52,
      tirpan: 53, chauvan: 54, pachpan: 55, chhappan: 56, sattavan: 57, atthavan: 58,
      unsath: 59, saath: 60, iksath: 61, basath: 62, tirsath: 63, chausath: 64, painsath: 65,
      chhiyasath: 66, sarsath: 67, adsath: 68, unahattar: 69, sattar: 70, ikattar: 71,
      bahattar: 72, tihattar: 73, chauhattar: 74, pachattar: 75, chhihattar: 76,
      satattar: 77, athattar: 78, unasi: 79, assi: 80, ikyasi: 81, bayasi: 82,
      tirasi: 83, chaurasi: 84, pachasi: 85, chhiyasi: 86, sattasi: 87, aththasi: 88,
      navasi: 89, nabbe: 90, ikyaanbe: 91, bayaanbe: 92, tiraanbe: 93, chauraanbe: 94,
      pachaanbe: 95, chhiyaanbe: 96, sattaanbe: 97, athaanbe: 98, ninyaanbe: 99,
      sau: 100, hazaar: 1000, hazar: 1000,
      // common slang / alternate spellings
      pachaas: 50, pachass: 50, aathh: 8, paach: 5,
    };

    // Check if entire input is a single Hindi number word
    const hindiClean = t.replace(/[^a-z\s]/g, "").trim();
    if (hindiMap[hindiClean] !== undefined) return String(hindiMap[hindiClean]);

    // Handle Hindi compound like "ek sau pachas" (150), "do sau tees" (230)
    const hindiCompound = hindiClean.split(/\s+/);
    if (hindiCompound.length >= 2 && hindiCompound.length <= 4) {
      const allHindi = hindiCompound.every(w => hindiMap[w] !== undefined);
      if (allHindi) {
        const nums = hindiCompound.map(w => hindiMap[w]);
        let result = 0, i = 0;
        while (i < nums.length) {
          if (i + 1 < nums.length && nums[i + 1] === 1000) { result += nums[i] * 1000; i += 2; }
          else if (i + 1 < nums.length && nums[i + 1] === 100) { result += nums[i] * 100; i += 2; }
          else { result += nums[i]; i++; }
        }
        if (result > 0) return String(result);
      }
    }

    // ── English number words ──
    const engUnits = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
      seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
      sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    };
    const engMult = { hundred: 100, thousand: 1000 };

    const engWords = t.replace(/\band\b/g, "").replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
    if (engWords.length >= 1 && engWords.length <= 6) {
      const allEng = engWords.every(w => engUnits[w] !== undefined || engMult[w] !== undefined);
      if (allEng) {
        let result = 0, current = 0;
        for (const w of engWords) {
          if (engUnits[w] !== undefined) { current += engUnits[w]; }
          else if (w === "hundred") { current = (current === 0 ? 1 : current) * 100; }
          else if (w === "thousand") { current = (current === 0 ? 1 : current) * 1000; result += current; current = 0; }
        }
        result += current;
        if (result > 0) return String(result);
      }
    }

    // Shorthand like "one fifty" → 150, "two thirty" → 230
    if (engWords.length === 2) {
      const a = engUnits[engWords[0]], b = engUnits[engWords[1]];
      if (a !== undefined && b !== undefined && a >= 1 && a <= 9 && b >= 10 && b <= 90 && b % 10 === 0) {
        return String(a * 100 + b);
      }
    }

    // If text already has digits, extract them
    const digits = t.replace(/[^\d]/g, "");
    if (digits.length > 0) return digits;

    // Return cleaned text for name-based search
    return t;
  }, []);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setListening(false);
  }, []);

  const startVoiceSearch = useCallback(async () => {
    if (listening) { stopVoice(); return; }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("Voice search not supported on this device");
      setTimeout(() => setVoiceError(""), 3000);
      return;
    }

    // PWA requirement: request mic permission explicitly before SpeechRecognition
    // Some standalone PWAs won't grant mic access without a prior getUserMedia call.
    // On insecure contexts (HTTP) mediaDevices is undefined — skip and let
    // SpeechRecognition handle its own permission prompt.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release the stream immediately — we only needed the permission grant
        stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        setMicBlocked(true);
        setVoiceError(err.name === "NotAllowedError" ? "Microphone blocked — enable it in site settings" : "Microphone not available");
        setTimeout(() => setVoiceError(""), 4000);
        return;
      }
    }

    setVoiceError("");
    const recognition = new SpeechRecognition();
    recognition.lang = voiceLang;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    // Auto-stop after 8 seconds (safety net for PWAs where onend may not fire)
    timeoutRef.current = setTimeout(() => {
      recognition.stop();
    }, 8000);

    recognition.onstart = () => {
      setListening(true);
      setMicBlocked(false);
    };

    recognition.onresult = (event) => {
      let best = "";
      for (const result of event.results) {
        best = result[0].transcript;
      }
      const parsed = parseSpokenNumber(best.trim());
      setSearch(parsed);
    };

    recognition.onerror = (event) => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setListening(false);
      const errMap = {
        "not-allowed": "Microphone blocked — enable it in site settings",
        "audio-capture": "No microphone found on this device",
        "network": "Network error — voice search needs internet",
        "no-speech": "No speech detected — try again",
        "aborted": "",
      };
      const msg = errMap[event.error] || "";
      if (event.error === "not-allowed") setMicBlocked(true);
      if (msg) { setVoiceError(msg); setTimeout(() => setVoiceError(""), 4000); }
    };

    recognition.onend = () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setListening(false);
    };

    try {
      recognition.start();
    } catch (err) {
      setListening(false);
      setVoiceError("Could not start voice search");
      setTimeout(() => setVoiceError(""), 3000);
    }
  }, [listening, voiceLang, parseSpokenNumber, stopVoice]);

  const [ads, setAds] = useState([]);

  useEffect(() => {
    fetchChannels();
    fetchLanguages();
    getAdvertisements({ mobile: iptvMobile }).then(data => {
      const list = (data?.body?.[0]?.ads || []).filter(a => a.content);
      if (list.length > 0) setAds(list);
    }).catch(() => {});
  }, []);

  const fetchChannels = async () => {
    setLoading(true);
    setError("");
    setUserNotFound(false);
    try {
      const data = await getChannelList({ mobile: iptvMobile, langid: "subs" });
      const chnls = data?.body?.[0]?.channels || [];
      preloadLogos(chnls.map((ch) => proxyImageUrl(ch.chlogo)).filter((u) => u && !u.includes("chnlnoimage")));
      setChannels(chnls);
    } catch (err) {
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

  const fetchLanguages = async () => {
    try {
      const data = await getLanguageList({ mobile: iptvMobile });
      const langs = data?.body?.[0]?.languages || [];
      preloadLogos(langs.map((l) => proxyImageUrl(l.langlogomob)).filter((u) => u && !u.includes("chnlnoimage")));
      setLanguages(langs);
    } catch (_) {}
  };

  const filteredChannels = search.trim()
    ? channels.filter((ch) => {
        const term = search.trim().toLowerCase();
        const nameMatch = ch.chtitle?.toLowerCase().includes(term);
        const numMatch = /^\d+$/.test(term) && String(ch.chno || "") === term;
        return nameMatch || numMatch;
      })
    : channels;

  const handlePlayChannel = (channel) => {
    navigate("/cust/livetv/player", { state: { channel, channels } });
  };

  return (
    <Layout>
      <div className="px-4 pt-4 pb-2 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate("/cust/dashboard")} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-sm shadow-red-200">
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">Live TV</h2>
              <p className="text-[11px] text-gray-400">{loading ? "Loading..." : `${filteredChannels.length} live channel${filteredChannels.length !== 1 ? "s" : ""}`}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-red-50 px-3 py-1.5 rounded-full">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
            <span className="text-[11px] font-bold text-red-600 tracking-wider">LIVE</span>
          </div>
        </div>

        <div className="relative mb-4">
          <div className={`flex items-center bg-white border rounded-xl px-3 py-3 shadow-sm transition-all min-h-[48px] ${listening ? 'border-red-400 ring-2 ring-red-200' : 'border-gray-200 focus-within:border-red-300 focus-within:ring-1 focus-within:ring-red-200'}`}>
            <Search className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
            <input type="text" placeholder={listening ? "Listening..." : "Search by name or channel number..."} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full outline-none text-sm text-gray-700 bg-transparent placeholder-gray-400" />
            {search && (<button onClick={() => setSearch("")} className="ml-2 flex-shrink-0"><X className="w-4 h-4 text-gray-400" /></button>)}
            {hasSpeechSupport && (
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                <button onClick={() => setVoiceLang(prev => { const idx = voiceLangs.findIndex(l => l.code === prev); return voiceLangs[(idx + 1) % voiceLangs.length].code; })} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors">
                  {voiceLangs.find(l => l.code === voiceLang)?.label}
                </button>
                <button onClick={startVoiceSearch} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${micBlocked ? 'bg-gray-200 cursor-not-allowed' : listening ? 'bg-red-500 animate-pulse' : 'bg-gray-100 hover:bg-gray-200 active:bg-gray-300'}`}>
                  {micBlocked ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className={`w-4 h-4 ${listening ? 'text-white' : 'text-gray-500'}`} />}
                </button>
              </div>
            )}
          </div>
          <AnimatePresence>
            {listening && (
              <motion.p key="listening" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[11px] text-red-500 font-medium mt-1.5 ml-1">
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

        {loading && (<div className="space-y-4"><ChannelListSkeleton count={6} /></div>)}

        {!loading && userNotFound && (
          <IptvSignup
            name={(() => { const u = JSON.parse(localStorage.getItem("user") || "{}"); return [u.firstname, u.lastname].filter(Boolean).join(" ") || u.username || ""; })()}
            mobile={iptvMobile}
            onSuccess={() => { setUserNotFound(false); fetchChannels(); fetchLanguages(); }}
          />
        )}

        {!loading && error && !userNotFound && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-red-400" /></div>
            <p className="text-sm text-gray-600 mb-1 font-medium">{error}</p>
            <button onClick={() => fetchChannels()} className="mt-3 text-sm text-red-600 font-semibold hover:underline">Try again</button>
          </motion.div>
        )}

        {!loading && !error && filteredChannels.length > 0 && (
          <>
            {/* Languages horizontal scroll */}
            {!search && languages.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2.5 px-0.5">
                  <div className="flex items-center gap-2">
                    <Languages className="w-3.5 h-3.5 text-emerald-500" />
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Browse by Language</h3>
                  </div>
                  <button onClick={() => navigate("/cust/livetv/languages")} className="text-[11px] text-emerald-600 font-semibold">View All</button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}>
                  {languages.map((lang, idx) => (
                    <LangCard
                      key={lang.langid || idx}
                      lang={lang}
                      onClick={() => navigate("/cust/livetv/channels", { state: { langid: lang.langid, langTitle: lang.langtitle } })}
                    />
                  ))}
                </div>
              </div>
            )}

            {!search && ads.length > 0 && (<AdBanner ad={ads[getNextAdIndex("livetv_top", ads.length)]} />)}

            <div>
              <div className="flex items-center justify-between mb-2.5 px-0.5">
                <div className="flex items-center gap-2"><Tv className="w-3.5 h-3.5 text-gray-400" /><h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{search ? "Search Results" : "All Channels"}</h3></div>
                <span className="text-[11px] text-gray-400 font-medium">{filteredChannels.length} channels</span>
              </div>
              <div className="space-y-2">
                {filteredChannels.map((ch, idx) => {
                  const items = [];
                  if (ads.length > 0 && idx > 0 && idx % 10 === 0) {
                    const adIdx = Math.floor(idx / 10) % ads.length;
                    items.push(<AdBanner key={`ad-${idx}`} ad={ads[adIdx]} />);
                  }
                  items.push(<ChannelRow key={ch.chid || idx} channel={ch} index={idx} onPlay={handlePlayChannel} />);
                  return items;
                })}
              </div>
            </div>
          </>
        )}

        {!loading && !error && filteredChannels.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-20">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4"><Tv className="w-7 h-7 text-gray-300" /></div>
            <p className="text-sm text-gray-500 font-medium">No channels found</p>
            <p className="text-xs text-gray-400 mt-1">Try a different search</p>
            {search && (<button onClick={() => setSearch("")} className="mt-3 text-sm text-red-600 font-semibold hover:underline">Clear search</button>)}
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
