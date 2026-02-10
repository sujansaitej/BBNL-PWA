import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Play, Tv, Radio, AlertCircle, X } from "lucide-react";
import Layout from "../../layout/Layout";
import { FeaturedSkeleton, ChannelListSkeleton } from "../../components/iptv/Loader";
import { getChannelList, getAdvertisements } from "../../services/iptvApi";
import { preloadLogos } from "../../services/logoCache";
import useCachedLogo from "../../hooks/useCachedLogo";
import { getCachedAds, setCachedAds, preloadAdImages } from "../../services/imageStore";

function proxyImageUrl(url) {
  if (!url) return null;
  return url.replace(/^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i, "");
}

const AD_ZOOM_DURATION = 5;

function getNextAdIndex(page, totalAds) {
  const key = `ad_idx_${page}`;
  const last = parseInt(sessionStorage.getItem(key) ?? "-1", 10);
  const next = (last + 1) % totalAds;
  sessionStorage.setItem(key, String(next));
  return next;
}

function AdBanner({ ad }) {
  const [ready, setReady] = useState(false);
  const src = proxyImageUrl(ad?.adpath);

  useEffect(() => {
    if (!src) return;
    setReady(false);
    const img = new Image();
    img.src = src;
    img.decode().then(() => setReady(true)).catch(() => {});
  }, [src]);

  if (!src || !ready) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-4 rounded-xl overflow-hidden relative">
      <div className="aspect-[16/7] bg-gray-50 overflow-hidden">
        <motion.img src={src} alt="Ad" initial={{ scale: 1.15 }} animate={{ scale: 1 }} transition={{ duration: AD_ZOOM_DURATION, ease: "easeOut" }} className="w-full h-full object-cover" onError={(e) => { e.target.closest(".rounded-xl").style.display = "none"; }} />
      </div>
      <span className="absolute top-2 right-2 text-[9px] font-semibold text-white/70 bg-black/30 px-1.5 py-0.5 rounded backdrop-blur-sm">Ad</span>
    </motion.div>
  );
}

function FeaturedCard({ channel, onPlay }) {
  const hasLogo = channel.chlogo && !channel.chlogo.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(channel.chlogo);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <motion.div whileTap={{ scale: 0.98 }} onClick={() => onPlay(channel)} className="relative rounded-2xl overflow-hidden cursor-pointer group bg-gradient-to-br from-gray-900 to-gray-800 aspect-video">
      {cachedSrc ? (<img src={cachedSrc} alt={channel.chtitle} className="absolute inset-0 w-full h-full object-contain p-6" />) : (<div className="absolute inset-0 flex items-center justify-center"><Tv className="w-16 h-16 text-white/10" /></div>)}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-active:opacity-100 transition-opacity">
        <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center"><Play className="w-7 h-7 text-white ml-0.5" /></div>
      </div>
      <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-600 px-2.5 py-1 rounded-md">
        <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" /></span>
        <span className="text-[10px] font-bold text-white tracking-wider">LIVE</span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <h3 className="text-white text-[13px] font-bold truncate drop-shadow-lg">{channel.chtitle}</h3>
        <p className="text-white/50 text-[10px] mt-0.5">{channel.chno ? `CH ${channel.chno}` : ""}{parseFloat(channel.chprice) === 0 ? " · Free" : ""}</p>
      </div>
    </motion.div>
  );
}

function ChannelRow({ channel, index, onPlay }) {
  const hasLogo = channel.chlogo && !channel.chlogo.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(channel.chlogo);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index * 0.02, 0.5) }} whileTap={{ scale: 0.98 }} onClick={() => onPlay(channel)} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors border border-gray-100 shadow-sm">
      <div className="w-7 text-center flex-shrink-0"><span className="text-[11px] font-bold text-gray-300">{channel.chno || index + 1}</span></div>
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
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const cachedAds = getCachedAds("livetv");
  const [ads, setAds] = useState(cachedAds);

  useEffect(() => {
    if (!user.mobileno) {
      navigate("/", { replace: true });
      return;
    }
    fetchChannels();
    if (cachedAds.length > 0) preloadAdImages(cachedAds, proxyImageUrl);
    getAdvertisements({ mobile: user.mobileno, displayarea: "homepage", displaytype: "multiple" })
      .then((data) => {
        const adList = data?.body || [];
        setAds(adList);
        setCachedAds("livetv", adList);
        preloadAdImages(adList, proxyImageUrl);
      })
      .catch(() => {});
  }, []);

  const fetchChannels = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getChannelList({ mobile: user.mobileno, langid: "subs" });
      const chnls = data?.body?.[0]?.channels || [];
      preloadLogos(chnls.map((ch) => proxyImageUrl(ch.chlogo)).filter((u) => u && !u.includes("chnlnoimage")));
      setChannels(chnls);
    } catch (err) {
      setError(err.message || "Failed to load channels.");
    } finally {
      setLoading(false);
    }
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

  const featured = channels.slice(0, 2);
  const remaining = channels.slice(2);

  return (
    <Layout>
      <div className="px-4 pt-4 pb-2 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
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
          <div className="flex items-center bg-white border border-gray-200 rounded-xl px-3 py-3 shadow-sm focus-within:border-red-300 focus-within:ring-1 focus-within:ring-red-200 transition-all min-h-[48px]">
            <Search className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
            <input type="text" placeholder="Search by name or channel number..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full outline-none text-sm text-gray-700 bg-transparent placeholder-gray-400" />
            {search && (<button onClick={() => setSearch("")} className="ml-2 flex-shrink-0"><X className="w-4 h-4 text-gray-400" /></button>)}
          </div>
        </div>

        {loading && (<div className="space-y-4"><FeaturedSkeleton /><ChannelListSkeleton count={5} /></div>)}

        {!loading && error && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-red-400" /></div>
            <p className="text-sm text-gray-600 mb-1 font-medium">{error}</p>
            <button onClick={() => fetchChannels()} className="mt-3 text-sm text-red-600 font-semibold hover:underline">Try again</button>
          </motion.div>
        )}

        {!loading && !error && filteredChannels.length > 0 && (
          <>
            {!search && featured.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2.5 px-0.5"><Play className="w-3.5 h-3.5 text-red-500" /><h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Featured</h3></div>
                <div className="grid grid-cols-2 gap-2.5">{featured.map((ch) => (<FeaturedCard key={ch.chid} channel={ch} onPlay={handlePlayChannel} />))}</div>
              </div>
            )}
            {!search && ads.length > 0 && (<AdBanner ad={ads[getNextAdIndex("livetv_top", ads.length)]} />)}
            <div>
              <div className="flex items-center justify-between mb-2.5 px-0.5">
                <div className="flex items-center gap-2"><Tv className="w-3.5 h-3.5 text-gray-400" /><h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{search ? "Search Results" : "All Channels"}</h3></div>
                <span className="text-[11px] text-gray-400 font-medium">{search ? filteredChannels.length : remaining.length} channels</span>
              </div>
              <div className="space-y-2">
                {(search ? filteredChannels : remaining).map((ch, idx) => {
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
