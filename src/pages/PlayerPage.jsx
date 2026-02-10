import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Tv,
  ExternalLink,
  RefreshCw,
  Play,
  Pause,
  ChevronUp,
} from "lucide-react";
import Hls from "hls.js";
import { getChannelStream, getChannelList } from "../services/api";
import { preloadLogos } from "../services/logoCache";
import useCachedLogo from "../hooks/useCachedLogo";

function proxyImageUrl(url) {
  if (!url) return null;
  return url.replace(
    /^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i,
    ""
  );
}

// Rewrite any absolute stream-server URL through local HTTP/2 proxy to bypass CORS.
const STREAM_RE = /^https?:\/\/[^/]+\.bbnl\.in/i;
function proxyStreamUrl(url) {
  if (!url) return url;
  return url.replace(STREAM_RE, "/stream");
}

// ── Orientation helpers ──
async function lockLandscape() {
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (_) {}
}

async function unlockOrientation() {
  try {
    if (screen.orientation?.unlock) {
      screen.orientation.unlock();
    }
  } catch (_) {}
}

async function enterFullscreen(el) {
  try {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) await fn.call(el);
  } catch (_) {}
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch (_) {}
}

// ── Channel card for horizontal swipeable strip ──
function ChannelCard({ channel, isActive, onSelect }) {
  const hasLogo = channel.chlogo && !channel.chlogo.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(channel.chlogo);
  const cachedSrc = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <button
      onClick={() => onSelect(channel)}
      className={`flex-shrink-0 flex flex-col items-center gap-1.5 w-20 p-2 rounded-2xl transition-all active:scale-95 ${
        isActive
          ? "bg-white/15 ring-1.5 ring-red-500/70"
          : "bg-white/5 active:bg-white/10"
      }`}
    >
      <div
        className={`w-13 h-13 rounded-xl flex items-center justify-center overflow-hidden ${
          isActive ? "bg-white/20" : "bg-white/10"
        }`}
      >
        {cachedSrc ? (
          <img
            src={cachedSrc}
            alt={channel.chtitle}
            className="w-full h-full object-contain p-1"
          />
        ) : (
          <Tv className="w-5 h-5 text-white/30" />
        )}
      </div>

      <p
        className={`text-[10px] font-semibold leading-tight line-clamp-2 text-center w-full ${
          isActive ? "text-white" : "text-white/60"
        }`}
      >
        {channel.chtitle}
      </p>

      {isActive && (
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[8px] text-red-400 font-bold uppercase tracking-wider">
            Live
          </span>
        </div>
      )}
    </button>
  );
}

export default function PlayerPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const channel = location.state?.channel;
  const allChannels = location.state?.channels || [];

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  // ── Channel switching state ──
  const [currentChannel, setCurrentChannel] = useState(channel);
  const [channelList, setChannelList] = useState(allChannels);

  // ── Bottom sheet state ──
  const [showSheet, setShowSheet] = useState(false);
  const touchStartRef = useRef(null);
  const stripScrollRef = useRef(null);

  const [videoKey, setVideoKey] = useState(0);
  const [streamUrl, setStreamUrl] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const hasLogo = currentChannel?.chlogo && !currentChannel.chlogo.includes("chnlnoimage");
  const logoSrc = proxyImageUrl(currentChannel?.chlogo);

  // ── Redirect if no channel data ──
  useEffect(() => {
    if (!channel) {
      navigate("/channels", { replace: true });
    }
  }, [channel, navigate]);

  // ── Fallback: fetch channel list if not passed via navigation state ──
  useEffect(() => {
    if (channelList.length > 0) return;
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (!user.mobile) return;
    let cancelled = false;
    getChannelList({ mobile: user.mobile, langid: "subs" })
      .then((data) => {
        if (cancelled) return;
        const chnls = data?.body?.[0]?.channels || [];
        setChannelList(chnls);
        preloadLogos(
          chnls
            .map((ch) => proxyImageUrl(ch.chlogo))
            .filter((u) => u && !u.includes("chnlnoimage"))
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Fetch stream URL when currentChannel changes ──
  useEffect(() => {
    if (!currentChannel) return;
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    let cancelled = false;

    const fetchStream = async () => {
      try {
        const data = await getChannelStream({
          mobile: user.mobile,
          chid: currentChannel.chid || "",
          chno: currentChannel.chno || "",
        });
        const stream = data?.body?.[0]?.stream?.[0];
        if (!stream || !stream.streamlink) {
          throw new Error("No stream available for this channel.");
        }
        if (!cancelled) {
          setStreamUrl(stream.streamlink);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err.message || "Failed to load stream.");
        }
      }
    };

    fetchStream();
    return () => { cancelled = true; };
  }, [currentChannel]);

  // ── Clean up fullscreen + orientation on unmount ──
  useEffect(() => {
    return () => {
      unlockOrientation();
      exitFullscreen();
    };
  }, []);

  // ── Auto-hide controls after 4s ──
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (status === "playing") setShowControls(false);
    }, 4000);
  }, [status]);

  useEffect(() => {
    if (status === "playing") {
      resetHideTimer();
    } else {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [status, resetHideTimer]);

  // ── Loading timeout — if stream doesn't start in 20s, show error ──
  useEffect(() => {
    if (status !== "loading") return;
    const timeout = setTimeout(() => {
      setStatus("error");
      setErrorMsg("Stream took too long to load. Please retry.");
    }, 20000);
    return () => clearTimeout(timeout);
  }, [status]);

  // ── Track fullscreen changes ──
  useEffect(() => {
    const onFsChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (fs) {
        lockLandscape();
      } else {
        unlockOrientation();
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  // ── Track play/pause state ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [videoKey]);

  // ── Stall detection — auto-recover when video gets stuck ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video || status !== "playing") return;

    let stallCount = 0;
    const MAX_STALL_RETRIES = 3;
    const pendingTimeouts = new Set();

    const onStalled = () => {
      stallCount++;
      if (stallCount > MAX_STALL_RETRIES) return;
      const hls = hlsRef.current;
      if (hls) {
        hls.startLoad();
      }
    };

    const onWaiting = () => {
      const waitTimeout = setTimeout(() => {
        pendingTimeouts.delete(waitTimeout);
        if (video.paused || !video.readyState || video.readyState < 3) {
          stallCount++;
          if (stallCount > MAX_STALL_RETRIES) return;
          const hls = hlsRef.current;
          if (hls) {
            hls.startLoad();
            video.play().catch(() => {});
          }
        }
      }, 8000);
      pendingTimeouts.add(waitTimeout);
      video.addEventListener("playing", () => {
        clearTimeout(waitTimeout);
        pendingTimeouts.delete(waitTimeout);
      }, { once: true });
    };

    video.addEventListener("stalled", onStalled);
    video.addEventListener("waiting", onWaiting);
    return () => {
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("waiting", onWaiting);
      pendingTimeouts.forEach((t) => clearTimeout(t));
      pendingTimeouts.clear();
    };
  }, [status, videoKey]);

  // ── Initialize HLS.js player ──
  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    const video = videoRef.current;
    let cancelled = false;

    const proxiedUrl = proxyStreamUrl(streamUrl);

    const tryPlay = async () => {
      try {
        await video.play();
      } catch (_) {
        video.muted = true;
        setMuted(true);
        try { await video.play(); } catch (__) {}
      }
    };

    // Use the video element's "playing" event to confirm actual playback —
    // keeps the loading overlay visible until video is truly rendering frames.
    const onVideoPlaying = () => {
      if (!cancelled) setStatus("playing");
    };
    video.addEventListener("playing", onVideoPlaying, { once: true });

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        liveSyncDuration: 3,
        liveMaxLatencyDuration: 10,
        liveDurationInfinity: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 16000,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1000,
        xhrSetup: (xhr, url) => {
          xhr.open("GET", proxyStreamUrl(url), true);
        },
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        tryPlay();
      });

      let networkRetries = 0;
      const MAX_NETWORK_RETRIES = 4;

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled) return;
        if (!data.fatal) return;

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            networkRetries++;
            if (networkRetries <= MAX_NETWORK_RETRIES) {
              setTimeout(() => {
                if (!cancelled) hls.startLoad();
              }, networkRetries * 1500);
            } else {
              if (!cancelled) {
                setStatus("error");
                setErrorMsg("Network error — stream unavailable.");
              }
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            if (!cancelled) {
              setStatus("error");
              setErrorMsg(data.details || "Stream playback failed.");
            }
            break;
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        networkRetries = 0;
      });

      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);

    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = proxiedUrl;
      video.addEventListener("loadedmetadata", () => {
        if (!cancelled) tryPlay();
      });
      // Status is set by the "playing" listener above
    } else {
      setStatus("error");
      setErrorMsg("HLS playback is not supported in this browser.");
    }

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onVideoPlaying);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl]);

  // ── Swipe detection on the video surface ──
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    const SWIPE_THRESHOLD = 50;
    const MAX_HORIZONTAL_DRIFT = 80;

    if (dt > 500) return;
    if (Math.abs(dx) > MAX_HORIZONTAL_DRIFT) return;

    if (dy < -SWIPE_THRESHOLD && !showSheet) {
      if (channelList.length > 0) {
        setShowSheet(true);
      }
    }
  }, [channelList.length, showSheet]);

  // ── Close sheet ──
  const closeSheet = useCallback(() => {
    setShowSheet(false);
  }, []);

  // ── Auto-scroll strip to the active channel when sheet opens ──
  useEffect(() => {
    if (!showSheet || !stripScrollRef.current || channelList.length === 0) return;
    const idx = channelList.findIndex((ch) => ch.chid === currentChannel?.chid);
    if (idx < 0) return;
    // Each card is 80px wide (w-20) + 8px gap = 88px stride
    const stride = 88;
    const containerW = stripScrollRef.current.clientWidth;
    const target = idx * stride - containerW / 2 + stride / 2;
    stripScrollRef.current.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [showSheet, currentChannel, channelList]);

  // ── Channel switch handler ──
  const handleChannelSwitch = useCallback((newChannel) => {
    if (newChannel.chid === currentChannel?.chid) return;

    // Eagerly destroy old HLS before React swaps the video element
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Increment key → React destroys old <video> and creates a fresh one,
    // exactly like navigating away and back. This clears all decoder state.
    setVideoKey((k) => k + 1);
    setStreamUrl(null);
    setStatus("loading");
    setErrorMsg("");
    setLogoError(false);
    setPaused(false);
    setCurrentChannel(newChannel);
    closeSheet();
  }, [currentChannel, closeSheet]);

  // ── Controls ──
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    resetHideTimer();
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setMuted(videoRef.current.muted);
    }
    resetHideTimer();
  };

  const toggleFullscreen = async (e) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      await enterFullscreen(el);
    } else {
      await exitFullscreen();
    }
    resetHideTimer();
  };

  const handleGoBack = async (e) => {
    if (e) e.stopPropagation();
    await exitFullscreen();
    await unlockOrientation();
    navigate(-1);
  };

  const handleScreenTap = () => {
    if (showSheet) {
      setShowSheet(false);
      return;
    }
    if (status === "playing") {
      setShowControls((prev) => !prev);
      if (!showControls) resetHideTimer();
    }
  };

  const retry = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setVideoKey((k) => k + 1);
    setStatus("loading");
    setErrorMsg("");
    setStreamUrl(null);
    setCurrentChannel({ ...currentChannel });
  };

  const openExternal = () => {
    if (streamUrl) window.open(streamUrl, "_blank");
  };

  if (!channel) return null;

  const controlsVisible = showControls || status !== "playing";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black z-50 select-none"
      onMouseMove={() => status === "playing" && resetHideTimer()}
      onClick={() => status === "playing" && handleScreenTap()}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ───── Video ───── */}
      <video
        key={videoKey}
        ref={videoRef}
        className={`absolute inset-0 w-full h-full ${isFullscreen ? "object-cover" : "object-contain"}`}
        playsInline
        autoPlay
      />

      {/* ───── Gradient Overlays ───── */}
      <AnimatePresence>
        {controlsVisible && !showSheet && (
          <>
            <motion.div
              key="grad-top"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute top-0 left-0 right-0 h-36 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-10 pointer-events-none"
            />
            <motion.div
              key="grad-bottom"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-10 pointer-events-none"
            />
          </>
        )}
      </AnimatePresence>

      {/* ───── Top Bar: Back + Logo + Title + LIVE ───── */}
      <AnimatePresence>
        {controlsVisible && !showSheet && (
          <motion.div
            key="top-bar"
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute top-0 left-0 right-0 z-30 px-4 pt-4 pb-2 safe-top"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={handleGoBack}
                className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/60 active:scale-95 transition-all flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>

              {hasLogo && logoSrc && !logoError ? (
                <img
                  src={logoSrc}
                  alt={currentChannel.chtitle}
                  onError={() => setLogoError(true)}
                  className="w-9 h-9 rounded-lg object-contain bg-white/10 backdrop-blur-sm p-0.5 flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                  <Tv className="w-4 h-4 text-white/60" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold text-white truncate drop-shadow-lg">
                  {currentChannel.chtitle}
                </h3>
                <p className="text-[11px] text-white/40 font-medium">
                  {currentChannel.chno ? `CH ${currentChannel.chno}` : ""}
                  {currentChannel.chno && currentChannel.chprice !== undefined ? " · " : ""}
                  {currentChannel.chprice !== undefined
                    ? parseFloat(currentChannel.chprice) === 0
                      ? "Free"
                      : `₹${currentChannel.chprice}`
                    : ""}
                </p>
              </div>

              {status === "playing" && (
                <div className="flex items-center gap-1.5 bg-red-600 px-3 py-1.5 rounded-md flex-shrink-0">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                  </span>
                  <span className="text-[11px] font-bold text-white tracking-widest">
                    LIVE
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Center Play/Pause ───── */}
      <AnimatePresence>
        {controlsVisible && status === "playing" && !showSheet && (
          <motion.div
            key="center-btn"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"
          >
            <button
              onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
              className="w-[72px] h-[72px] rounded-full bg-black/50 backdrop-blur-lg flex items-center justify-center hover:bg-black/70 active:scale-90 transition-all pointer-events-auto shadow-2xl"
            >
              {paused ? (
                <Play className="w-8 h-8 text-white ml-1" />
              ) : (
                <Pause className="w-8 h-8 text-white" />
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Bottom Bar ───── */}
      <AnimatePresence>
        {controlsVisible && status === "playing" && !showSheet && (
          <motion.div
            key="bottom-bar"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-4 pt-2 safe-bottom"
          >
            <div className="w-full h-[3px] bg-white/15 rounded-full mb-4 overflow-hidden">
              <div className="h-full bg-red-500 rounded-full w-full relative">
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 rounded-full shadow-lg shadow-red-500/50" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              {/* Swipe up hint */}
              {channelList.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSheet(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 active:bg-white/20 transition-all"
                >
                  <ChevronUp className="w-3.5 h-3.5 text-white/60" />
                  <span className="text-[11px] text-white/60 font-medium">Channels</span>
                </button>
              )}

              <div className="flex items-center gap-0.5">
                <button
                  onClick={toggleMute}
                  className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all"
                >
                  {muted ? (
                    <VolumeX className="w-[22px] h-[22px] text-white" />
                  ) : (
                    <Volume2 className="w-[22px] h-[22px] text-white" />
                  )}
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all"
                >
                  {isFullscreen ? (
                    <Minimize className="w-[22px] h-[22px] text-white" />
                  ) : (
                    <Maximize className="w-[22px] h-[22px] text-white" />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Channel Strip (swipe up to reveal) ───── */}
      <AnimatePresence>
        {showSheet && channelList.length > 0 && (
          <motion.div
            key="channel-strip"
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="absolute bottom-0 left-0 right-0 z-[35] safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient background for readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none" />

            {/* Horizontal scrollable channel strip */}
            <div
              ref={stripScrollRef}
              className="relative flex gap-2 overflow-x-auto px-3 pb-4 scrollbar-hide"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              {channelList.map((ch) => (
                <ChannelCard
                  key={ch.chid}
                  channel={ch}
                  isActive={ch.chid === currentChannel?.chid}
                  onSelect={handleChannelSwitch}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Loading Overlay ───── */}
      <AnimatePresence>
        {status === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ exit: { duration: 0.4 } }}
            className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/70 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center">
              {hasLogo && logoSrc && !logoError ? (
                <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center p-1.5 shadow-2xl mb-4">
                  <img
                    src={logoSrc}
                    alt={currentChannel.chtitle}
                    className="w-full h-full object-contain"
                    onError={() => setLogoError(true)}
                  />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center shadow-2xl mb-4">
                  <Tv className="w-7 h-7 text-white/30" />
                </div>
              )}

              <h3 className="text-sm font-bold text-white mb-3">{currentChannel.chtitle}</h3>

              <div className="relative w-8 h-8">
                <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-red-500 animate-spin" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Error Overlay ───── */}
      <AnimatePresence>
        {status === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/95 px-6"
          >
            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center ring-2 ring-red-500/20">
                {hasLogo && logoSrc && !logoError ? (
                  <img
                    src={logoSrc}
                    alt={currentChannel.chtitle}
                    className="w-12 h-12 rounded-lg object-contain"
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <Tv className="w-8 h-8 text-red-400" />
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center ring-4 ring-black">
                <span className="text-white text-xs font-bold">!</span>
              </div>
            </div>

            <p className="text-base text-white font-semibold text-center mb-1">
              Unable to Play
            </p>
            <p className="text-xs text-white/30 font-medium text-center mb-1">
              {currentChannel.chtitle}
            </p>
            <p className="text-sm text-white/40 text-center max-w-xs mb-8 leading-relaxed">
              {errorMsg}
            </p>

            <div className="flex items-center gap-3 w-full max-w-xs">
              <button
                onClick={retry}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 hover:bg-white/15 rounded-xl text-sm text-white font-semibold transition-all active:scale-95 backdrop-blur-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              <button
                onClick={openExternal}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 rounded-xl text-sm text-white font-semibold transition-all active:scale-95"
              >
                <ExternalLink className="w-4 h-4" />
                External
              </button>
            </div>

            <button
              onClick={handleGoBack}
              className="mt-5 text-xs text-white/30 hover:text-white/60 transition-colors font-medium"
            >
              Back to channels
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
