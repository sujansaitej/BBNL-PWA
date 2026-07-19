import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize, RefreshCw, Lock } from "lucide-react";
import Hls from "hls.js";
import { getOTTStream, getOttMobile } from "../../services/ottApi";

function normalizeStreamUrl(url) {
  if (!url) return url;
  // If the URL is relative, prefix with the base URL
  if (url.startsWith("/")) {
    return (import.meta.env.VITE_API_BASE_URL || "") + url.replace(/^\//, "");
  }
  return url;
}

function loadWithHls(video, streamUrl, hlsRef, setStatus, setErrorMsg) {
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    startLevel: -1,
    capLevelToPlayerSize: true,
    progressive: true,
    xhrSetup(xhr) {
      xhr.setRequestHeader("X-App-Package", "com.bbnl.smartphone");
    },
  });

  hlsRef.current = hls;

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.play().then(() => setStatus("playing")).catch(() => setStatus("paused"));
  });

  let networkRetries = 0;
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        networkRetries++;
        if (networkRetries <= 3) {
          setTimeout(() => {
            hls.startLoad();
          }, Math.min(networkRetries * 1500, 5000));
        } else {
          setStatus("error");
          setErrorMsg("Network error — unable to play this content.");
        }
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        hls.recoverMediaError();
        break;
      default:
        setStatus("error");
        setErrorMsg("Playback failed. Please try again.");
        break;
    }
  });

  hls.on(Hls.Events.FRAG_LOADED, () => {
    networkRetries = 0;
  });

  hls.loadSource(streamUrl);
  hls.attachMedia(video);
}

export default function OTTPlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const content = location.state?.content;
  const locked = location.state?.locked;

  const mobile = getOttMobile();

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const [status, setStatus] = useState(locked ? "locked" : "loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [streamUrl, setStreamUrl] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Fetch stream URL
  useEffect(() => {
    if (!content || locked) return;

    // If content already has a streamlink, use it directly
    if (content.streamlink || content.stream_url) {
      setStreamUrl(normalizeStreamUrl(content.streamlink || content.stream_url));
      return;
    }

    // Otherwise fetch from OTT API
    const contentId = content.contentid || content.id;
    if (!contentId || !mobile) {
      setStatus("error");
      setErrorMsg("Content not available.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await getOTTStream({ mobile, contentId });
        const stream = data?.body?.streamlink || data?.body?.stream_url || data?.streamlink || data?.stream_url;
        if (!stream) throw new Error("Stream not available for this content.");
        if (!cancelled) setStreamUrl(normalizeStreamUrl(stream));
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err.message || "Unable to play this content.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [content, locked, mobile]);

  // Initialize HLS player when stream URL is available
  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    const video = videoRef.current;
    let cancelled = false;
    setStatus("loading");

    if (Hls.isSupported()) {
      loadWithHls(video, streamUrl, hlsRef, setStatus, setErrorMsg);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", () => {
        if (!cancelled) video.play().then(() => setStatus("playing")).catch(() => setStatus("paused"));
      });
    } else {
      setStatus("error");
      setErrorMsg("Your browser does not support video playback.");
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl]);

  // Progress tracking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.duration && isFinite(video.duration)) {
        setDuration(video.duration);
        setProgress((video.currentTime / video.duration) * 100);
      }
    };

    const onPlay = () => setStatus("playing");
    const onPause = () => setStatus("paused");

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (status === "playing") setShowControls(false);
    }, 4000);
  }, [status]);

  useEffect(() => {
    if (showControls && status === "playing") resetHideTimer();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [showControls, status, resetHideTimer]);

  // Fullscreen
  useEffect(() => {
    const onFS = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFS);
    return () => document.removeEventListener("fullscreenchange", onFS);
  }, []);

  function toggleFullscreen() {
    const el = containerRef.current;
    const video = videoRef.current;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (el?.requestFullscreen) {
      el.requestFullscreen();
    } else if (video?.webkitEnterFullscreen) {
      // iPhone Safari has no element Fullscreen API — only <video> can go
      // fullscreen, via the WebKit-prefixed method.
      video.webkitEnterFullscreen();
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function seekTo(e) {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * duration;
  }

  function formatTime(s) {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function retry() {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setStatus("loading");
    setErrorMsg("");
    setStreamUrl(null);
    // Re-trigger stream fetch
    if (content?.streamlink || content?.stream_url) {
      setStreamUrl(normalizeStreamUrl(content.streamlink || content.stream_url));
    } else {
      const contentId = content?.contentid || content?.id;
      if (contentId && mobile) {
        getOTTStream({ mobile, contentId })
          .then((data) => {
            const stream = data?.body?.streamlink || data?.body?.stream_url || data?.streamlink || data?.stream_url;
            if (stream) setStreamUrl(normalizeStreamUrl(stream));
            else { setStatus("error"); setErrorMsg("Stream not available."); }
          })
          .catch((err) => { setStatus("error"); setErrorMsg(err.message); });
      }
    }
  }

  if (!content) {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-sm mb-4">No content selected.</p>
          <button onClick={() => navigate(-1)} className="text-purple-400 font-semibold">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-[60] flex flex-col">
      {/* Video Element */}
      <div
        className="flex-1 relative flex items-center justify-center"
        onClick={() => {
          if (status === "locked") return;
          setShowControls((p) => !p);
          if (!showControls) resetHideTimer();
        }}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          playsInline
          muted={muted}
          autoPlay
        />

        {/* Locked State */}
        {status === "locked" && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center p-6 max-w-sm">
              <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-yellow-500" />
              </div>
              <h3 className="text-white text-lg font-bold mb-2">Premium Content</h3>
              <p className="text-gray-400 text-sm mb-6">
                Subscribe to access "{content.title}". Contact your operator to activate your OTT plan.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => navigate(-1)}
                  className="bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 px-6 rounded-xl transition-colors"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {status === "loading" && (
          <div className="absolute inset-0 bg-black flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-purple-300 border-t-purple-600 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Loading {content.title}...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {status === "error" && (
          <div className="absolute inset-0 bg-black/90 flex items-center justify-center">
            <div className="text-center p-4 max-w-sm">
              <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <RefreshCw className="w-7 h-7 text-red-400" />
              </div>
              <p className="text-white text-sm mb-1 font-medium">{errorMsg}</p>
              <div className="flex gap-3 justify-center mt-4">
                <button
                  onClick={retry}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-medium py-2.5 px-6 rounded-xl transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => navigate(-1)}
                  className="bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 px-6 rounded-xl transition-colors"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Controls Overlay */}
        {showControls && (status === "playing" || status === "paused") && (
          <>
            {/* Top gradient + back button */}
            <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/80 to-transparent z-20">
              <div className="flex items-center px-4 pt-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(-1); }}
                  className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center mr-3"
                >
                  <ArrowLeft className="w-5 h-5 text-white" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">
                    {content.title}
                  </p>
                  {content.genre && (
                    <p className="text-white/50 text-[11px]">{content.genre}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Center play/pause */}
            <button
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              className="absolute z-20 w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
            >
              {status === "paused" ? (
                <Play className="w-7 h-7 text-white ml-1" />
              ) : (
                <Pause className="w-7 h-7 text-white" />
              )}
            </button>

            {/* Bottom gradient + controls */}
            <div className="absolute bottom-0 left-0 right-0 z-20">
              <div className="bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-12"
                style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}
              >
                {/* Progress Bar */}
                {duration > 0 && (
                  <div
                    onClick={(e) => { e.stopPropagation(); seekTo(e); }}
                    className="w-full h-6 flex items-center cursor-pointer mb-2"
                  >
                    <div className="w-full h-1 bg-white/20 rounded-full relative">
                      <div
                        className="h-full bg-purple-500 rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow"
                        style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
                      />
                    </div>
                  </div>
                )}

                {/* Time + Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/70 font-mono">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                  <div className="flex items-center gap-3">
                    <button onClick={(e) => { e.stopPropagation(); toggleMute(); }}>
                      {muted ? (
                        <VolumeX className="w-5 h-5 text-white/80" />
                      ) : (
                        <Volume2 className="w-5 h-5 text-white/80" />
                      )}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
                      {isFullscreen ? (
                        <Minimize className="w-5 h-5 text-white/80" />
                      ) : (
                        <Maximize className="w-5 h-5 text-white/80" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
