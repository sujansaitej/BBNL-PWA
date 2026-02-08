import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutGrid,
  Search,
  AlertCircle,
  Play,
  Tv,
  ArrowLeft,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import { ChannelGridSkeleton } from "../components/Loader";
import { getChannelList, getAdvertisements } from "../services/api";
import { preloadShaka } from "../services/shakaLoader";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.03 },
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

const AD_ZOOM_DURATION = 5;

function getNextAdIndex(langid, totalAds) {
  const key = `ad_idx_${langid || "all"}`;
  const last = parseInt(sessionStorage.getItem(key) ?? "-1", 10);
  const next = (last + 1) % totalAds;
  sessionStorage.setItem(key, String(next));
  return next;
}

function AdBanner({ ad }) {
  const [loaded, setLoaded] = useState(false);
  const src = proxyImageUrl(ad?.adpath);
  if (!src) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="mb-4 rounded-xl overflow-hidden relative"
    >
      <div className="aspect-[16/7] bg-gray-50 overflow-hidden">
        <motion.img
          src={src}
          alt="Ad"
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: loaded ? 1 : 0, scale: loaded ? 1 : 1.15 }}
          transition={{
            opacity: { duration: 0.7 },
            scale: { duration: AD_ZOOM_DURATION, ease: "easeOut" },
          }}
          className="w-full h-full object-cover"
          onLoad={() => setLoaded(true)}
          onError={(e) => { e.target.closest(".rounded-xl").style.display = "none"; }}
        />
      </div>
      <span className="absolute top-2 right-2 text-[9px] font-semibold text-white/70 bg-black/30 px-1.5 py-0.5 rounded backdrop-blur-sm">
        Ad
      </span>
    </motion.div>
  );
}

function ChannelCard({ channel, onPlay }) {
  const [imgError, setImgError] = useState(false);
  const hasLogo =
    channel.chlogo && !channel.chlogo.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(channel.chlogo);

  const handlePlay = () => {
    if (channel.streamlink) {
      console.log(
        "%c▶️ [Channel] Play Stream",
        "color: #22c55e; font-weight: bold; font-size: 13px;",
        {
          title: channel.chtitle,
          chno: channel.chno,
          stream: channel.streamlink,
        }
      );
      onPlay(channel);
    }
  };

  return (
    <motion.div
      variants={item}
      whileTap={{ scale: 0.98 }}
      onClick={handlePlay}
      className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
    >
      {/* Channel Logo */}
      <div className="relative aspect-video bg-gray-50 flex items-center justify-center">
        {hasLogo && imgSrc && !imgError ? (
          <img
            src={imgSrc}
            alt={channel.chtitle}
            className="w-full h-full object-contain p-3"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-100 to-cyan-100 flex items-center justify-center">
            <Tv className="w-7 h-7 text-blue-500" />
          </div>
        )}

        {/* Play overlay */}
        {channel.streamlink && (
          <div className="absolute inset-0 bg-black/0 hover:bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-all">
            <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <Play className="w-5 h-5 text-blue-600 ml-0.5" />
            </div>
          </div>
        )}

      </div>

      {/* Channel Info */}
      <div className="px-3 py-2.5">
        <h4 className="text-xs font-semibold text-gray-800 truncate">
          {channel.chtitle}
        </h4>
        {channel.chprice !== undefined && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            {parseFloat(channel.chprice) === 0 ? "Free" : `₹${channel.chprice}`}
          </p>
        )}
      </div>
    </motion.div>
  );
}

export default function ChannelsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  // Read filter params from navigation state (e.g. from LanguagesPage)
  const langid = location.state?.langid || "subs";
  const langTitle = location.state?.langTitle || "";

  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [ads, setAds] = useState([]);

  useEffect(() => {
    if (!user.mobile) {
      navigate("/", { replace: true });
      return;
    }
    fetchChannels();
    preloadShaka();
    // Fetch ads in background
    getAdvertisements({ mobile: user.mobile, displayarea: "homepage", displaytype: "multiple" })
      .then((data) => setAds(data?.body || []))
      .catch(() => {});
  }, [langid]);

  const fetchChannels = async (searchTerm = "") => {
    setLoading(true);
    setError("");

    console.group(
      "%c🔵 [Channels] Fetch Channel List",
      "color: #3b82f6; font-weight: bold; font-size: 13px;"
    );
    console.log(
      "%c🔑 Sending Keys:",
      "color: #8b5cf6; font-weight: bold;",
      "mobile, grid, bcid, langid, search"
    );
    console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", user.mobile);
    console.log("%c🌐 langid:", "color: #6366f1; font-weight: bold;", langid);
    console.log("%c🔍 search:", "color: #6366f1; font-weight: bold;", searchTerm || "(empty)");

    try {
      const data = await getChannelList({
        mobile: user.mobile,
        langid,
        search: searchTerm,
      });
      console.log(
        "%c🟢 SUCCESS RESPONSE",
        "color: #22c55e; font-weight: bold; font-size: 13px;",
        data
      );
      console.log("%c🟢 err_code:", "color: #22c55e; font-weight: bold;", data?.status?.err_code);
      console.log("%c🟢 err_msg:", "color: #22c55e; font-weight: bold;", data?.status?.err_msg);

      const chnls = data?.body?.[0]?.channels || [];
      console.log(
        "%c🟢 Total Channels:",
        "color: #22c55e; font-weight: bold; font-size: 14px;",
        chnls.length
      );
      console.table(
        chnls.slice(0, 20).map((c, i) => ({
          "#": i + 1,
          "CH No": c.chno,
          Title: c.chtitle,
          Price: parseFloat(c.chprice) === 0 ? "Free" : `₹${c.chprice}`,
          "Has Logo": c.chlogo && !c.chlogo.includes("chnlnoimage") ? "Yes" : "No",
          "Has Stream": c.streamlink ? "Yes" : "No",
        }))
      );
      if (chnls.length > 20) {
        console.log(
          "%c📋 ... and %d more channels",
          "color: #6366f1; font-weight: bold;",
          chnls.length - 20
        );
      }
      console.groupEnd();

      setChannels(chnls);
    } catch (err) {
      console.log(
        "%c🔴 ERROR",
        "color: #ef4444; font-weight: bold; font-size: 13px;",
        err.message
      );
      console.groupEnd();
      setError(err.message || "Failed to load channels.");
    } finally {
      setLoading(false);
    }
  };

  const handlePlayChannel = (channel) => {
    navigate("/player", { state: { channel } });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchChannels(search.trim());
  };

  const pageTitle = langTitle ? `${langTitle} Channels` : "All Channels";

  return (
    <AppLayout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        {/* ───── Page Header ───── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-4"
        >
          {langTitle && (
            <button
              onClick={() => navigate("/languages")}
              className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
          )}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-sm flex-shrink-0">
            <LayoutGrid className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-800 truncate">
              {pageTitle}
            </h2>
            <p className="text-xs text-gray-400">
              {loading
                ? "Loading..."
                : `${channels.length} channel${channels.length !== 1 ? "s" : ""} available`}
            </p>
          </div>
        </motion.div>

        {/* ───── Search Bar ───── */}
        <motion.form
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onSubmit={handleSearch}
          className="mb-4"
        >
          <div className="flex items-center bg-white border border-gray-200 rounded-xl px-3 py-3 shadow-sm focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200 transition-all min-h-[48px]">
            <Search className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search channels..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full outline-none text-sm text-gray-700 bg-transparent placeholder-gray-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  fetchChannels("");
                }}
                className="text-xs text-gray-400 hover:text-gray-600 ml-2 flex-shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        </motion.form>

        {/* ───── Top Ad Banner (rotates per language visit) ───── */}
        {ads.length > 0 && (
          <AdBanner ad={ads[getNextAdIndex(langid, ads.length)]} />
        )}

        {/* ───── Loading State ───── */}
        {loading && <ChannelGridSkeleton count={6} />}

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
              onClick={() => fetchChannels(search.trim())}
              className="mt-3 text-sm text-blue-600 font-semibold hover:underline"
            >
              Try again
            </button>
          </motion.div>
        )}

        {/* ───── Channel Grid with Inline Ads ───── */}
        {!loading && !error && channels.length > 0 && (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 gap-2.5 sm:gap-3"
          >
            {channels.map((ch, idx) => (
              <ChannelCard
                key={ch.chid || idx}
                channel={ch}
                onPlay={handlePlayChannel}
              />
            ))}
          </motion.div>
        )}

        {/* ───── Empty State ───── */}
        {!loading && !error && channels.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <LayoutGrid className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-sm text-gray-500 font-medium">No channels found</p>
            <p className="text-xs text-gray-400 mt-1">Try a different search or language</p>
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  fetchChannels("");
                }}
                className="mt-3 text-sm text-blue-600 font-semibold hover:underline"
              >
                Clear search
              </button>
            )}
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}
