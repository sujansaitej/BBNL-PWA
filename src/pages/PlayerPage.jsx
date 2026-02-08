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
} from "lucide-react";
import { getShaka } from "../services/shakaLoader";
import { getChannelStream } from "../services/api";

function proxyImageUrl(url) {
  if (!url) return null;
  return url.replace(
    /^https?:\/\/124\.40\.244\.211\/netmon\/Cabletvapis/i,
    ""
  );
}

// Rewrite livestream URLs through local HTTP/2 proxy to bypass CORS
function proxyStreamUrl(url) {
  if (!url) return url;
  return url.replace(
    /^https?:\/\/livestream\.bbnl\.in/i,
    "/stream"
  );
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

export default function PlayerPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const channel = location.state?.channel;

  const videoRef = useRef(null);
  const shakaPlayerRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const [streamUrl, setStreamUrl] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const hasLogo = channel?.chlogo && !channel.chlogo.includes("chnlnoimage");
  const logoSrc = proxyImageUrl(channel?.chlogo);

  // ── Redirect if no channel data ──
  useEffect(() => {
    if (!channel) {
      navigate("/channels", { replace: true });
    }
  }, [channel, navigate]);

  // ── Fetch stream URL on mount ──
  useEffect(() => {
    if (!channel) return;
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    let cancelled = false;

    const fetchStream = async () => {
      try {
        const data = await getChannelStream({
          mobile: user.mobile,
          chid: channel.chid || "",
          chno: channel.chno || "",
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
  }, [channel]);

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

  // ── Track fullscreen changes ──
  useEffect(() => {
    const onFsChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      // Sync orientation with fullscreen
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
  }, []);

  const destroyShaka = useCallback(async () => {
    if (shakaPlayerRef.current) {
      try { await shakaPlayerRef.current.destroy(); } catch (_) {}
      shakaPlayerRef.current = null;
    }
  }, []);

  const safePlay = useCallback(async (video) => {
    try {
      await video.play();
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
      throw err;
    }
  }, []);

  // ── Initialize player ──
  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    const video = videoRef.current;
    let cancelled = false;

    const onCanPlay = async () => {
      if (cancelled) return;
      try {
        const played = await safePlay(video);
        if (played && !cancelled) setStatus("playing");
      } catch (playErr) {
        video.muted = true;
        setMuted(true);
        try {
          const played = await safePlay(video);
          if (played && !cancelled) setStatus("playing");
        } catch (_) {
          if (!cancelled) {
            setStatus("error");
            setErrorMsg("Autoplay blocked. Tap the screen to play.");
          }
        }
      }
    };

    const onPlaying = () => {
      if (!cancelled) setStatus("playing");
    };

    const onError = () => {
      if (cancelled) return;
      const err = video.error;
      console.log(
        "%c🔴 [Video] Media error:",
        "color: #ef4444; font-weight: bold;",
        err?.message || `code ${err?.code}`
      );
      setStatus("error");
      setErrorMsg(err?.message || "Failed to load stream.");
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);

    const init = async () => {
      console.group(
        "%c▶️ [Player] Initializing (Shaka Player)",
        "color: #3b82f6; font-weight: bold; font-size: 13px;"
      );
      console.log("%c📺 Channel:", "color: #6366f1; font-weight: bold;", channel.chtitle);
      console.log("%c🔗 Stream URL:", "color: #6366f1; font-weight: bold;", streamUrl);
      console.groupEnd();

      try {
        const shaka = await getShaka();
        if (cancelled) return;

        if (!shaka.Player.isBrowserSupported()) {
          throw new Error("Shaka Player is not supported in this browser.");
        }

        const player = new shaka.Player();
        await player.attach(video);
        if (cancelled) { player.destroy(); return; }

        shakaPlayerRef.current = player;

        let retryCount = 0;
        const MAX_AUTO_RETRIES = 4;

        player.addEventListener("error", async (event) => {
          const detail = event.detail;
          // 7000 = LOAD_INTERRUPTED (normal during cleanup / HMR)
          if (cancelled || detail?.code === 7000) return;

          // 1001 = BAD_HTTP_STATUS, 1002 = TIMEOUT — auto-reload the stream
          // These are transient proxy errors; reloading gets a fresh manifest
          if ((detail?.code === 1001 || detail?.code === 1002) && retryCount < MAX_AUTO_RETRIES) {
            retryCount++;
            console.log(`%c[Shaka] Auto-reloading (${retryCount}/${MAX_AUTO_RETRIES})`, "color: #f59e0b; font-weight: bold;");
            // Wait briefly to let the proxy session stabilize
            await new Promise(r => setTimeout(r, 1500));
            try {
              await player.load(proxyStreamUrl(streamUrl));
              if (!cancelled) {
                setStatus("playing");
                retryCount = 0; // Reset on successful recovery
              }
              return;
            } catch (_) {
              // reload failed — fall through to show error
            }
          }

          console.log("%c[Shaka] Error", "color: #ef4444; font-weight: bold; font-size: 13px;", detail);
          if (!cancelled) {
            setStatus("error");
            setErrorMsg(detail?.message || "Stream playback failed.");
          }
        });

        // Rewrite all livestream.bbnl.in URLs through local HTTP/2 proxy
        player.getNetworkingEngine().registerRequestFilter((_type, request) => {
          request.uris = request.uris.map((uri) => proxyStreamUrl(uri));
        });

        // Convert proxy errors (502/503) to retryable errors
        player.getNetworkingEngine().registerResponseFilter((_type, response) => {
          if (response.status === 502 || response.status === 503) {
            throw new shaka.util.Error(
              shaka.util.Error.Severity.RECOVERABLE,
              shaka.util.Error.Category.NETWORK,
              shaka.util.Error.Code.BAD_HTTP_STATUS,
              response.uri,
              response.status
            );
          }
        });

        player.configure({
          streaming: {
            retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 1.5, timeout: 35000 },
            bufferingGoal: 20,
            rebufferingGoal: 5,
            bufferBehind: 10,
            lowLatencyMode: false,
            segmentPrefetchLimit: 2,
          },
          manifest: {
            retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 1.5, timeout: 15000 },
            hls: {
              ignoreTextStreamFailures: true,
            },
          },
          abr: {
            enabled: true,
          },
        });

        await player.load(proxyStreamUrl(streamUrl));
        if (cancelled) return;
        console.log("%c🟢 [Shaka] Stream loaded", "color: #22c55e; font-weight: bold; font-size: 13px;");
      } catch (err) {
        // 7000 = LOAD_INTERRUPTED — normal during cleanup / HMR, not a real error
        if (cancelled || err.code === 7000 || err.message?.includes("7000")) return;
        console.log("%c🔴 [Shaka] Load failed:", "color: #ef4444; font-weight: bold; font-size: 13px;", err.message);
        setStatus("error");
        setErrorMsg(
          err.message?.includes("7001") || err.message?.includes("7002")
            ? "Stream blocked by CORS policy. Try opening externally."
            : err.message || "Failed to load stream."
        );
      }
    };

    init();

    return () => {
      cancelled = true;
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      video.pause();
      video.removeAttribute("src");
      video.load();
      destroyShaka();
    };
  }, [streamUrl]);

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
      // fullscreenchange listener handles lockLandscape
    } else {
      await exitFullscreen();
      // fullscreenchange listener handles unlockOrientation
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
    if (status === "playing") {
      setShowControls((prev) => !prev);
      if (!showControls) resetHideTimer();
    }
  };

  const retry = () => {
    setStatus("loading");
    setErrorMsg("");
    const state = location.state;
    navigate("/player", { replace: true, state });
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
    >
      {/* ───── Video ───── */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full ${isFullscreen ? "object-cover" : "object-contain"}`}
        playsInline
        autoPlay
      />

      {/* ───── Gradient Overlays ───── */}
      <AnimatePresence>
        {controlsVisible && (
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
        {controlsVisible && (
          <motion.div
            key="top-bar"
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute top-0 left-0 right-0 z-30 px-4 pt-4 pb-2 safe-top"
          >
            <div className="flex items-center gap-3">
              {/* Back */}
              <button
                onClick={handleGoBack}
                className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/60 active:scale-95 transition-all flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>

              {/* Channel Logo */}
              {hasLogo && logoSrc && !logoError ? (
                <img
                  src={logoSrc}
                  alt={channel.chtitle}
                  onError={() => setLogoError(true)}
                  className="w-9 h-9 rounded-lg object-contain bg-white/10 backdrop-blur-sm p-0.5 flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                  <Tv className="w-4 h-4 text-white/60" />
                </div>
              )}

              {/* Channel Info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold text-white truncate drop-shadow-lg">
                  {channel.chtitle}
                </h3>
                <p className="text-[11px] text-white/40 font-medium">
                  {channel.chno ? `CH ${channel.chno}` : ""}
                  {channel.chno && channel.chprice !== undefined ? " · " : ""}
                  {channel.chprice !== undefined
                    ? parseFloat(channel.chprice) === 0
                      ? "Free"
                      : `₹${channel.chprice}`
                    : ""}
                </p>
              </div>

              {/* LIVE badge */}
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
        {controlsVisible && status === "playing" && (
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
        {controlsVisible && status === "playing" && (
          <motion.div
            key="bottom-bar"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-4 pt-2 safe-bottom"
          >
            {/* Live bar */}
            <div className="w-full h-[3px] bg-white/15 rounded-full mb-4 overflow-hidden">
              <div className="h-full bg-red-500 rounded-full w-full relative">
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 rounded-full shadow-lg shadow-red-500/50" />
              </div>
            </div>

            <div className="flex items-center justify-end">
              {/* Controls */}
              <div className="flex items-center gap-0.5">
                {/* Mute */}
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

                {/* Fullscreen / Portrait toggle */}
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

      {/* ───── Loading Overlay (semi-transparent so video shows through) ───── */}
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
            {/* Compact loading — logo + spinner + title in a tight group */}
            <div className="flex flex-col items-center">
              {hasLogo && logoSrc && !logoError ? (
                <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center p-1.5 shadow-2xl mb-4">
                  <img
                    src={logoSrc}
                    alt={channel.chtitle}
                    className="w-full h-full object-contain"
                    onError={() => setLogoError(true)}
                  />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center shadow-2xl mb-4">
                  <Tv className="w-7 h-7 text-white/30" />
                </div>
              )}

              <h3 className="text-sm font-bold text-white mb-3">{channel.chtitle}</h3>

              {/* Slim spinner */}
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
            {/* Channel logo with error ring */}
            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center ring-2 ring-red-500/20">
                {hasLogo && logoSrc && !logoError ? (
                  <img
                    src={logoSrc}
                    alt={channel.chtitle}
                    className="w-12 h-12 rounded-lg object-contain"
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <Tv className="w-8 h-8 text-red-400" />
                )}
              </div>
              {/* Error dot */}
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center ring-4 ring-black">
                <span className="text-white text-xs font-bold">!</span>
              </div>
            </div>

            <p className="text-base text-white font-semibold text-center mb-1">
              Unable to Play
            </p>
            <p className="text-xs text-white/30 font-medium text-center mb-1">
              {channel.chtitle}
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
