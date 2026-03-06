import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Volume2, VolumeX, Maximize, Minimize, Tv, RefreshCw, Play, Pause, ChevronUp } from "lucide-react";
import Hls from "hls.js";
import { getChannelStream, getChannelList, getIptvMobile, prefetchPublicIP } from "../../services/iptvApi";
import { preloadLogos, clearQueue } from "../../services/logoCache";
import useCachedLogo from "../../hooks/useCachedLogo";
import { proxyImageUrl } from "../../services/iptvImage";
import { getEntry, getEntryAsync, setEntry, waitForHydration } from "../../services/channelStore";

// Obfuscated stream URL cache — prevents plain-text URLs in sessionStorage
const _XK = 0x5A;
function _sc(s) { return btoa(Array.from(s, c => String.fromCharCode(c.charCodeAt(0) ^ _XK)).join('')); }
function _ds(s) { try { return Array.from(atob(s), c => String.fromCharCode(c.charCodeAt(0) ^ _XK)).join(''); } catch { return null; } }

// Detect if user is far from Indian stream servers (high RTT).
// Uses Network Information API (Chrome/Edge) with timezone fallback (Safari/Firefox).
let _hlResult = null;
function isHighLatencyConnection() {
  if (_hlResult !== null) return _hlResult;
  const conn = navigator.connection || navigator.mozConnection;
  if (conn?.rtt > 0) { _hlResult = conn.rtt > 150; return _hlResult; }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    _hlResult = !/^Asia\/(Kolkata|Calcutta|Colombo|Dhaka|Kathmandu|Karachi|Thimphu|Rangoon|Bangkok|Jakarta)/.test(tz);
  } catch { _hlResult = false; }
  return _hlResult;
}

/** Check if a stream URL contains a valid auth token (e.g. ?token=xxx&expires=nnn) */
function isTokenizedUrl(url) { return !!url && /[?&]token=/.test(url); }

function storeStreamCache(chid, url) {
  try {
    // Extract token expiry from URL (e.g. ?expires=1772536233) for smarter cache lifetime.
    // Subtract 60s buffer so we don't serve an about-to-expire token.
    const m = url.match(/[?&]expires=(\d+)/);
    const exp = m ? (parseInt(m[1], 10) * 1000 - 60000) : (Date.now() + 25 * 60 * 1000);
    sessionStorage.setItem(`s_${chid}`, _sc(JSON.stringify({ u: url, t: Date.now(), e: exp })));
  } catch {}
}

function loadStreamCache(chid) {
  try {
    const raw = sessionStorage.getItem(`s_${chid}`);
    if (!raw) return null;
    const parsed = JSON.parse(_ds(raw));
    const { u, e } = parsed;
    // Use stored token expiry if available, otherwise fallback 25 min from creation
    const expiry = e || (parsed.t + 25 * 60 * 1000);
    if (Date.now() > expiry) { sessionStorage.removeItem(`s_${chid}`); return null; }
    return u;
  } catch { try { sessionStorage.removeItem(`s_${chid}`); } catch {} return null; }
}

// Stream URL routing:
// - Low-latency users (India/nearby): direct HTTPS to stream servers
// - High-latency users (international): route through nearest relay server
//   → relay caches segments at edge (15ms vs 200ms), eliminates CORS preflight
//
// To enable relay servers, set VITE_RELAY_US and/or VITE_RELAY_AU in .env:
//   VITE_RELAY_US=https://relay-us.yourdomain.com
//   VITE_RELAY_AU=https://relay-au.yourdomain.com
// When not set, falls back to routing through the main server proxy.
const RELAY_US = import.meta.env.VITE_RELAY_US || '';
const RELAY_AU = import.meta.env.VITE_RELAY_AU || '';

function getNearestRelay() {
  if (!RELAY_US && !RELAY_AU) return ''; // no relays configured
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    // Australia/NZ timezones → AU relay
    if (/^(Australia|Pacific\/Auckland|Pacific\/Fiji)/.test(tz)) return RELAY_AU || RELAY_US;
    // Americas, Europe, Africa → US relay (closer than India)
    if (/^(America|US|Canada|Europe|Africa|Atlantic)/.test(tz)) return RELAY_US || RELAY_AU;
    // Fallback for other international
    return RELAY_US || RELAY_AU;
  } catch { return RELAY_US || RELAY_AU; }
}

function normalizeStreamUrl(url) {
  if (!url) return url;

  if (isHighLatencyConnection()) {
    if (url.startsWith('https://')) {
      try {
        const u = new URL(url);
        const relay = getNearestRelay();
        if (relay) {
          // Route through relay: https://relay-us.domain.com/stream/hostname/path
          return `${relay}/stream/${u.hostname}${u.pathname}${u.search}`;
        }
        // No relay configured — fall back to main server proxy
        const base = import.meta.env.BASE_URL || '/';
        return `${base}stream/${u.hostname}${u.pathname}${u.search}`;
      } catch { return url; }
    }
    return url;
  }

  // Direct mode — connect straight to stream server for minimum hops
  if (url.startsWith('https://')) return url;
  const proxyMatch = url.match(/^\/stream\/([^/]+)(\/.*)$/);
  if (proxyMatch) return `https://${proxyMatch[1]}${proxyMatch[2]}`;
  return url;
}

function loadWithHlsJs(video, streamUrl, isCancelled, tryPlay, setStatus, setErrorMsg, hlsRef, onTokenExpired) {
  const conn = navigator.connection || navigator.mozConnection;
  const etype = conn?.effectiveType || '4g';
  const isSlow = etype === '2g' || etype === 'slow-2g';
  const isMid  = etype === '3g';
  const isHL   = isHighLatencyConnection();

  // High-latency (international users 200-350ms RTT to India):
  //   - 30s buffer ahead (vs 10s) — absorbs network jitter over long distances
  //   - 12s behind live edge (vs 3s) — large cushion prevents rebuffering
  //   - 30s timeouts (vs 10s) — tolerates slow TLS handshakes across oceans
  //   - 15s back-buffer — allows rewind without re-fetch
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    startFragPrefetch: true,
    backBufferLength: isHL ? 15 : 0,
    liveSyncDuration: isHL ? 12 : isSlow ? 6 : isMid ? 4 : 3,
    liveMaxLatencyDuration: isHL ? 60 : isSlow ? 30 : isMid ? 20 : 15,
    liveDurationInfinity: true,
    maxBufferLength: isHL ? 30 : isSlow ? 15 : isMid ? 12 : 10,
    maxMaxBufferLength: isHL ? 120 : isSlow ? 60 : isMid ? 45 : 30,
    maxBufferSize: isHL ? 60 * 1000 * 1000 : 20 * 1000 * 1000,
    maxBufferHole: isHL ? 1.5 : 1,
    startLevel: 0,
    capLevelToPlayerSize: true,
    abrEwmaDefaultEstimate: isSlow ? 150000 : isMid ? 350000 : 500000,
    abrBandWidthFactor: 0.9,
    abrBandWidthUpFactor: isHL ? 0.5 : 0.7,
    initialLiveManifestSize: 1,
    progressive: !isSlow,
    highBufferWatchdogPeriod: isHL ? 3 : 2,
    nudgeOffset: isHL ? 0.5 : 0.3,
    nudgeMaxRetry: isHL ? 12 : 8,
    fragLoadingTimeOut: isHL ? 30000 : isSlow ? 20000 : isMid ? 15000 : 10000,
    fragLoadingMaxRetry: isHL ? 10 : isSlow ? 8 : 6,
    fragLoadingRetryDelay: isHL ? 2000 : 1000,
    fragLoadingMaxRetryTimeout: isHL ? 30000 : isSlow ? 20000 : 10000,
    manifestLoadingTimeOut: isHL ? 30000 : isSlow ? 20000 : isMid ? 15000 : 10000,
    manifestLoadingMaxRetry: isHL ? 10 : isSlow ? 8 : 5,
    manifestLoadingRetryDelay: isHL ? 2000 : 1000,
    levelLoadingTimeOut: isHL ? 30000 : isSlow ? 20000 : isMid ? 15000 : 10000,
    levelLoadingMaxRetry: isHL ? 10 : isSlow ? 8 : 5,
    levelLoadingRetryDelay: isHL ? 2000 : 1000,
    xhrSetup(xhr) {
      xhr.setRequestHeader("X-App-Package", "com.bbnl.smartphone");
    },
    fetchSetup(context, initParams) {
      const headers = new Headers(initParams.headers);
      headers.set("X-App-Package", "com.bbnl.smartphone");
      return new Request(context.url, { ...initParams, headers });
    },
  });
  hlsRef.current = hls;

  // Queue play() as early as possible — browser auto-starts when first frame is decodable
  let firstPlayAttempted = false;
  const earlyPlay = () => { if (!firstPlayAttempted && !isCancelled()) { firstPlayAttempted = true; tryPlay(); } };
  hls.on(Hls.Events.MANIFEST_PARSED, earlyPlay);   // Try on manifest (before any data)
  hls.on(Hls.Events.BUFFER_APPENDED, earlyPlay);    // Try when first chunk arrives
  hls.on(Hls.Events.FRAG_BUFFERED, earlyPlay);      // Safety fallback

  let networkRetries = 0;
  const MAX_NETWORK_RETRIES = 6;
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (isCancelled() || !data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        // If manifest/level load failed (403 = expired token or auth error),
        // immediately request a fresh tokenized URL instead of retrying 6x.
        if (networkRetries === 0 && onTokenExpired &&
            (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
             data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT)) {
          onTokenExpired();
          return;
        }
        networkRetries++;
        if (networkRetries <= MAX_NETWORK_RETRIES) {
          setTimeout(() => {
            if (isCancelled()) return;
            if (networkRetries > 3) { hls.loadSource(streamUrl); hls.startLoad(); }
            else { hls.startLoad(); }
          }, Math.min(networkRetries * 1000, 4000));
        }
        else { if (!isCancelled()) { setStatus("error"); setErrorMsg("Network error — stream unavailable."); } }
        break;
      case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
      default: if (!isCancelled()) { setStatus("error"); setErrorMsg("Stream playback failed."); } break;
    }
  });
  hls.on(Hls.Events.FRAG_LOADED, () => { networkRetries = 0; });
  hls.loadSource(streamUrl);
  hls.attachMedia(video);
}

// NOTE: We intentionally do NOT use the browser Fullscreen API (requestFullscreen)
// NOR screen.orientation.lock(). Both cause the browser to display the domain name
// ("example.com – to exit full screen...") which exposes the domain to the user.
// screen.orientation.lock() on Chrome/Android implicitly activates Fullscreen API.
// Instead, we rely on CSS (fixed inset-0 + 100dvw/100dvh) for a true edge-to-edge
// experience without any browser notifications. Users rotate their device manually.

const ChannelCard = memo(function ChannelCard({ channel, isActive, onSelect }) {
  const hasLogo = channel.chlogo && !channel.chlogo.includes("chnlnoimage");
  const imgSrc = proxyImageUrl(channel.chlogo);
  const [cachedSrc, logoRef] = useCachedLogo(hasLogo ? imgSrc : null);

  return (
    <button ref={logoRef} onClick={() => onSelect(channel)} className={`flex-shrink-0 flex flex-col items-center gap-1.5 w-20 p-2 rounded-2xl transition-colors active:scale-95 ${isActive ? "bg-white/15 ring-1.5 ring-red-500/70" : "bg-white/5 active:bg-white/10"}`} style={{ willChange: 'transform', contain: 'layout style' }}>
      <div className={`w-13 h-13 rounded-xl flex items-center justify-center overflow-hidden ${isActive ? "bg-white/20" : "bg-white/10"}`}>
        {cachedSrc ? (<img src={cachedSrc} alt={channel.chtitle} className="w-full h-full object-contain p-1" />) : (<Tv className="w-5 h-5 text-white/30" />)}
      </div>
      <p className={`text-[10px] font-semibold leading-tight line-clamp-2 text-center w-full ${isActive ? "text-white" : "text-white/60"}`}>{channel.chtitle}</p>
      {isActive && (<div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /><span className="text-[8px] text-red-400 font-bold uppercase tracking-wider">Live</span></div>)}
    </button>
  );
});

export default function PlayerPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const channel = location.state?.channel;
  const allChannels = location.state?.channels || [];

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const [currentChannel, setCurrentChannel] = useState(channel);
  const [channelList, setChannelList] = useState(allChannels);

  const [showSheet, setShowSheet] = useState(false);
  const touchStartRef = useRef(null);
  const stripScrollRef = useRef(null);

  const [videoKey, setVideoKey] = useState(0);
  // Use streamlink from channel directly — browser negotiates HTTP/2+ automatically.
  // The stream server requires HTTP/2+; browsers handle this via ALPN during TLS.
  const [streamUrl, setStreamUrl] = useState(normalizeStreamUrl(channel?.streamlink) || null);
  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [logoError, setLogoError] = useState(false);
  const [isNaturalLandscape, setIsNaturalLandscape] = useState(() => window.innerWidth > window.innerHeight);
  // Auto-enter fullscreen (forced landscape) when opening in portrait mode
  const [forceLandscape, setForceLandscape] = useState(() => !(window.innerWidth > window.innerHeight));

  const hasLogo = currentChannel?.chlogo && !currentChannel.chlogo.includes("chnlnoimage");
  const logoSrc = proxyImageUrl(currentChannel?.chlogo);
  const [cachedPosterUrl] = useCachedLogo(hasLogo ? logoSrc : null);

  useEffect(() => {
    if (!channel) navigate("/cust/livetv/channels", { replace: true });
  }, [channel, navigate]);

  useEffect(() => {
    if (channelList.length > 0) return;
    const mobile = getIptvMobile();
    if (!mobile) return;
    let cancelled = false;

    (async () => {
      // Check channelStore cache first (L1 → L2) before hitting the network
      await waitForHydration();

      const storeKey = `channels_${mobile}_subs`;
      const cached = getEntry(storeKey) || await getEntryAsync(storeKey);
      if (cached?.data?.length > 0 && !cancelled) {
        setChannelList(cached.data);
        return;
      }

      // Cache miss — fetch from network
      try {
        const data = await getChannelList({ mobile, langid: "subs" });
        if (cancelled) return;
        const chnls = data?.body?.[0]?.channels || [];
        setEntry(storeKey, chnls);
        setChannelList(chnls);
      } catch (_) {}
    })();

    return () => { cancelled = true; };
  }, []);

  // Preload nearby channel logos only — don't compete with video stream for bandwidth.
  // On 3G, preloading all 275 logos starves the HLS video stream.
  // Only preload ±20 channels around the current channel in the strip.
  useEffect(() => {
    if (channelList.length === 0) return;
    const idx = channelList.findIndex((ch) => ch.chid === currentChannel?.chid);
    const start = Math.max(0, idx - 20);
    const end = Math.min(channelList.length, idx + 21);
    const nearbyUrls = channelList.slice(start, end)
      .map((ch) => proxyImageUrl(ch.chlogo))
      .filter((u) => u && !u.includes("chnlnoimage"));
    if (nearbyUrls.length > 0) preloadLogos(nearbyUrls);
    return () => { clearQueue(); };
  }, [channelList, currentChannel]);

  useEffect(() => {
    if (!currentChannel) return;

    // 1. If channel has streamlink, use it directly — browser uses HTTP/2+
    //    (the stream server only accepts HTTP/2 and HTTP/3; browsers negotiate
    //    this automatically via ALPN during TLS handshake)
    if (currentChannel.streamlink) {
      const normalized = normalizeStreamUrl(currentChannel.streamlink);
      storeStreamCache(currentChannel.chid, normalized);
      setStreamUrl(normalized);
      return;
    }

    // 2. Check session cache for a previously fetched URL
    const cachedUrl = loadStreamCache(currentChannel.chid);
    if (cachedUrl) {
      setStreamUrl(cachedUrl);
      return;
    }

    // 3. No streamlink — fetch from /ftauserstream API
    const mobile = getIptvMobile();
    let cancelled = false;
    const fetchStream = async () => {
      try {
        const data = await getChannelStream({ mobile, chid: currentChannel.chid || "", chno: currentChannel.chno || "" });
        const stream = data?.body?.[0]?.stream?.[0];
        if (!stream || !stream.streamlink) throw new Error("No stream available for this channel.");
        const normalized = normalizeStreamUrl(stream.streamlink);
        if (!cancelled) {
          storeStreamCache(currentChannel.chid, normalized);
          setStreamUrl(normalized);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err.message || "Failed to load stream.";
          setStatus("error");
          setErrorMsg(msg.toLowerCase().includes("user not found") ? "Your account is not activated for Live TV. Please contact support." : msg);
        }
      }
    };
    fetchStream();
    return () => { cancelled = true; };
  }, [currentChannel]);

  // On mount: black body background to fill any gaps
  useEffect(() => {
    const origBodyBg = document.body.style.background;
    const origHtmlBg = document.documentElement.style.background;
    document.body.style.background = '#000';
    document.documentElement.style.background = '#000';

    return () => {
      document.body.style.background = origBodyBg;
      document.documentElement.style.background = origHtmlBg;
    };
  }, []);

  // Pre-fetch adjacent channel streamlinks for instant switching.
  // Only caches the streamlink URL from the channel object — NO API calls.
  // The stream server handles auth via HTTP/2, so these URLs work directly.
  useEffect(() => {
    if (!currentChannel || channelList.length === 0 || status !== "playing") return;

    const currentIdx = channelList.findIndex((ch) => ch.chid === currentChannel.chid);
    if (currentIdx < 0) return;

    const prefetchChannel = (channel) => {
      if (!channel || loadStreamCache(channel.chid)) return;
      // Only cache if channel already has a streamlink (no API call)
      if (channel.streamlink) {
        storeStreamCache(channel.chid, normalizeStreamUrl(channel.streamlink));
      }
    };

    const timer = setTimeout(() => {
      if (currentIdx < channelList.length - 1) prefetchChannel(channelList[currentIdx + 1]);
      if (currentIdx > 0) prefetchChannel(channelList[currentIdx - 1]);
    }, 500);

    return () => clearTimeout(timer);
  }, [currentChannel, channelList, status]);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => { if (status === "playing") setShowControls(false); }, 4000);
  }, [status]);

  useEffect(() => {
    if (status === "playing") { resetHideTimer(); } else { setShowControls(true); if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [status, resetHideTimer]);

  // Track natural orientation and auto-exit forced landscape when device rotates
  useEffect(() => {
    const onResize = () => {
      const landscape = window.innerWidth > window.innerHeight;
      setIsNaturalLandscape(landscape);
      if (landscape) setForceLandscape(false); // Already landscape naturally, no need for CSS rotation
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (status !== "loading") return;
    const conn = navigator.connection || navigator.mozConnection;
    const loadTimeout = isHighLatencyConnection() ? 45000 : (conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') ? 35000 : conn?.effectiveType === '3g' ? 25000 : 20000;
    const timeout = setTimeout(() => { setStatus("error"); setErrorMsg("Stream took too long to load. Please retry."); }, loadTimeout);
    return () => clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => { video.removeEventListener("play", onPlay); video.removeEventListener("pause", onPause); };
  }, [videoKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || status !== "playing") return;
    let stallCount = 0;
    const MAX_STALL_RETRIES = 8;
    const pendingTimeouts = new Set();
    const recover = () => {
      stallCount++;
      if (stallCount > MAX_STALL_RETRIES) return;
      const hls = hlsRef.current;
      if (!hls) return;
      // Try to skip past any buffer hole first
      const buffered = video.buffered;
      if (buffered.length > 0) {
        const currentTime = video.currentTime;
        for (let i = 0; i < buffered.length; i++) {
          if (buffered.start(i) > currentTime + 0.1) {
            video.currentTime = buffered.start(i) + 0.05;
            break;
          }
        }
      }
      hls.startLoad();
      video.play().catch(() => {});
    };
    const onStalled = () => recover();
    const onWaiting = () => {
      const waitTimeout = setTimeout(() => {
        pendingTimeouts.delete(waitTimeout);
        if (video.paused || !video.readyState || video.readyState < 3) recover();
      }, 1500);
      pendingTimeouts.add(waitTimeout);
      video.addEventListener("playing", () => { clearTimeout(waitTimeout); pendingTimeouts.delete(waitTimeout); }, { once: true });
    };
    video.addEventListener("stalled", onStalled);
    video.addEventListener("waiting", onWaiting);
    return () => { video.removeEventListener("stalled", onStalled); video.removeEventListener("waiting", onWaiting); pendingTimeouts.forEach((t) => clearTimeout(t)); pendingTimeouts.clear(); };
  }, [status, videoKey]);

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;
    const video = videoRef.current;
    let cancelled = false;
    const tryPlay = async () => { try { await video.play(); } catch (_) { video.muted = true; setMuted(true); try { await video.play(); } catch (__) {} } };
    const onVideoPlaying = () => { if (!cancelled) setStatus("playing"); };
    video.addEventListener("playing", onVideoPlaying, { once: true });

    // When HLS manifest fails (403 / expired token), fetch a fresh
    // tokenized URL from /ftauserstream instead of retrying the dead URL.
    const onTokenExpired = () => {
      if (cancelled) return;
      const mobile = getIptvMobile();
      if (!currentChannel?.chid || !mobile) return;
      // Clear stale cache entry
      try { sessionStorage.removeItem(`s_${currentChannel.chid}`); } catch {}
      (async () => {
        try {
          const data = await getChannelStream({ mobile, chid: currentChannel.chid, chno: currentChannel.chno || "" });
          const stream = data?.body?.[0]?.stream?.[0];
          if (!cancelled && stream?.streamlink) {
            const normalized = normalizeStreamUrl(stream.streamlink);
            storeStreamCache(currentChannel.chid, normalized);
            setStreamUrl(normalized); // triggers this useEffect again with fresh URL
          }
        } catch (err) {
          if (!cancelled) { setStatus("error"); setErrorMsg(err.message || "Failed to load stream."); }
        }
      })();
    };

    // HLS.js is required — it sends X-App-Package header on the first request
    // for server-side identification, then streams without headers for smooth
    // playback. Native <video>.src cannot send headers at all,
    // so we do NOT fall back to native HLS.
    if (Hls.isSupported()) {
      loadWithHlsJs(video, streamUrl, () => cancelled, tryPlay, setStatus, setErrorMsg, hlsRef, onTokenExpired);
    } else {
      setStatus("error");
      setErrorMsg("Your browser does not support secure streaming. Please use Chrome or update your browser.");
    }
    return () => { cancelled = true; video.removeEventListener("playing", onVideoPlaying); if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } video.pause(); video.removeAttribute("src"); video.load(); };
  }, [streamUrl]);

  const handleTouchStart = useCallback((e) => { const touch = e.touches[0]; touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }; }, []);
  const handleTouchEnd = useCallback((e) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    if (dt > 500 || Math.abs(dx) > 80) return;
    if (dy < -50 && !showSheet && channelList.length > 0) setShowSheet(true);
  }, [channelList.length, showSheet]);

  const closeSheet = useCallback(() => setShowSheet(false), []);

  useEffect(() => {
    if (!showSheet || !stripScrollRef.current || channelList.length === 0) return;
    const idx = channelList.findIndex((ch) => ch.chid === currentChannel?.chid);
    if (idx < 0) return;
    const stride = 88;
    const containerW = stripScrollRef.current.clientWidth;
    const target = idx * stride - containerW / 2 + stride / 2;
    stripScrollRef.current.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [showSheet, currentChannel, channelList]);

  const handleChannelSwitch = useCallback((newChannel) => {
    if (newChannel.chid === currentChannel?.chid) return;

    // Clean up current HLS instance for smooth transition
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Immediately show the new channel UI
    setCurrentChannel(newChannel);
    setLogoError(false);
    setPaused(false);
    closeSheet();

    // Reset stream state - the useEffect will handle loading
    setStatus("loading");
    setErrorMsg("");

    // Check streamlink or cache for instant switch
    if (newChannel.streamlink) {
      setStreamUrl(normalizeStreamUrl(newChannel.streamlink));
    } else {
      const cachedUrl = loadStreamCache(newChannel.chid);
      if (cachedUrl) { setStreamUrl(cachedUrl); return; }
      setStreamUrl(null); // Let useEffect handle the fetch
    }
  }, [currentChannel, closeSheet]);

  const togglePlayPause = () => { const video = videoRef.current; if (!video) return; if (video.paused) video.play().catch(() => {}); else video.pause(); resetHideTimer(); };
  const toggleMute = (e) => { e.stopPropagation(); if (videoRef.current) { videoRef.current.muted = !videoRef.current.muted; setMuted(videoRef.current.muted); } resetHideTimer(); };
  const toggleFullscreen = (e) => { e.stopPropagation(); setForceLandscape((prev) => !prev); resetHideTimer(); };
  const handleGoBack = (e) => { if (e) e.stopPropagation(); if (forceLandscape) { setForceLandscape(false); return; } navigate(-1); };
  const handleScreenTap = () => { if (showSheet) { setShowSheet(false); return; } if (status === "playing") { setShowControls((prev) => !prev); if (!showControls) resetHideTimer(); } };
  const retry = () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } setVideoKey((k) => k + 1); setStatus("loading"); setErrorMsg(""); setStreamUrl(null); setCurrentChannel({ ...currentChannel }); };

  if (!channel) return null;
  const controlsVisible = showControls || status !== "playing";
  const isRotated = forceLandscape && !isNaturalLandscape;

  return (
    <div ref={containerRef} className={`fixed bg-black z-50 select-none overflow-hidden ${isRotated ? 'top-0 left-0' : 'inset-0'}`} style={isRotated ? { width: '100vh', height: '100vw', transformOrigin: 'top left', transform: 'rotate(90deg) translateY(-100%)' } : undefined} onMouseMove={() => status === "playing" && resetHideTimer()} onClick={() => status === "playing" && handleScreenTap()} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <video key={videoKey} ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline autoPlay preload="auto" poster={cachedPosterUrl || undefined} onContextMenu={(e) => e.preventDefault()} />

      <AnimatePresence>
        {controlsVisible && !showSheet && (<>
          <motion.div key="grad-top" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="absolute top-0 left-0 right-0 h-36 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-10 pointer-events-none" />
          <motion.div key="grad-bottom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-10 pointer-events-none" />
        </>)}
      </AnimatePresence>

      <AnimatePresence>
        {controlsVisible && !showSheet && (
          <motion.div key="top-bar" initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }} transition={{ duration: 0.3, ease: "easeOut" }} className="absolute top-0 left-0 right-0 z-30 px-4 pt-4 pb-2" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))', paddingLeft: 'max(1rem, env(safe-area-inset-left, 1rem))', paddingRight: 'max(1rem, env(safe-area-inset-right, 1rem))' }}>
            <div className="flex items-center gap-3">
              <button onClick={handleGoBack} className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/60 active:scale-95 transition-transform flex-shrink-0"><ArrowLeft className="w-5 h-5 text-white" /></button>
              {hasLogo && (cachedPosterUrl || logoSrc) && !logoError ? (<img src={cachedPosterUrl || logoSrc} alt={currentChannel.chtitle} onError={() => setLogoError(true)} className="w-9 h-9 rounded-lg object-contain bg-white/10 backdrop-blur-sm p-0.5 flex-shrink-0" />) : (<div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0"><Tv className="w-4 h-4 text-white/60" /></div>)}
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold text-white truncate" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{currentChannel.chtitle}</h3>
                <p className="text-[11px] text-white/40 font-medium">{currentChannel.chno ? `CH ${currentChannel.chno}` : ""}{currentChannel.chno && currentChannel.chprice !== undefined ? " · " : ""}{currentChannel.chprice !== undefined ? parseFloat(currentChannel.chprice) === 0 ? "Free" : `₹${currentChannel.chprice}` : ""}</p>
              </div>
              {status === "playing" && (<div className="flex items-center gap-1.5 bg-red-600 px-3 py-1.5 rounded-md flex-shrink-0"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-white" /></span><span className="text-[11px] font-bold text-white tracking-widest">LIVE</span></div>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {controlsVisible && status === "playing" && !showSheet && (
          <motion.div key="center-btn" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.2 }} className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <button onClick={(e) => { e.stopPropagation(); togglePlayPause(); }} className="w-[72px] h-[72px] rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 active:scale-90 transition-transform pointer-events-auto shadow-2xl">
              {paused ? <Play className="w-8 h-8 text-white ml-1" /> : <Pause className="w-8 h-8 text-white" />}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {controlsVisible && status === "playing" && !showSheet && (
          <motion.div key="bottom-bar" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} transition={{ duration: 0.3, ease: "easeOut" }} className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-4 pt-2" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))', paddingLeft: 'max(1rem, env(safe-area-inset-left, 1rem))', paddingRight: 'max(1rem, env(safe-area-inset-right, 1rem))' }}>
            <div className="w-full h-[3px] bg-white/15 rounded-full mb-4 overflow-hidden"><div className="h-full bg-red-500 rounded-full w-full relative"><div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 rounded-full shadow-lg shadow-red-500/50" /></div></div>
            <div className="flex items-center justify-between">
              {channelList.length > 0 && (<button onClick={(e) => { e.stopPropagation(); setShowSheet(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 active:bg-white/20 transition-colors"><ChevronUp className="w-3.5 h-3.5 text-white/60" /><span className="text-[11px] text-white/60 font-medium">Channels</span></button>)}
              <div className="flex items-center gap-0.5">
                <button onClick={toggleMute} className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-90 transition-transform">{muted ? <VolumeX className="w-[22px] h-[22px] text-white" /> : <Volume2 className="w-[22px] h-[22px] text-white" />}</button>
                <button onClick={toggleFullscreen} className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-90 transition-transform">{forceLandscape || isNaturalLandscape ? <Minimize className="w-[22px] h-[22px] text-white" /> : <Maximize className="w-[22px] h-[22px] text-white" />}</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSheet && channelList.length > 0 && (
          <motion.div key="channel-strip" initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 80 }} transition={{ type: "spring", damping: 28, stiffness: 300 }} className="absolute bottom-0 left-0 right-0 z-[35]" onClick={(e) => e.stopPropagation()}>
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none" />
            <div ref={stripScrollRef} className="relative flex gap-2 overflow-x-auto px-3 pb-4 hide-scrollbar" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
              {channelList.map((ch) => (<ChannelCard key={ch.chid} channel={ch} isActive={ch.chid === currentChannel?.chid} onSelect={handleChannelSwitch} />))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {status === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ exit: { duration: 0.4 } }} className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/70 backdrop-blur-sm">
            <div className="flex flex-col items-center">
              {hasLogo && (cachedPosterUrl || logoSrc) && !logoError ? (<div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center p-1.5 shadow-2xl mb-4"><img src={cachedPosterUrl || logoSrc} alt={currentChannel.chtitle} className="w-full h-full object-contain" onError={() => setLogoError(true)} /></div>) : (<div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center shadow-2xl mb-4"><Tv className="w-7 h-7 text-white/30" /></div>)}
              <h3 className="text-sm font-bold text-white mb-3">{currentChannel.chtitle}</h3>
              <div className="relative w-8 h-8"><div className="absolute inset-0 rounded-full border-2 border-white/10" /><div className="absolute inset-0 rounded-full border-2 border-transparent border-t-red-500 animate-spin" /></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {status === "error" && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/95 px-6">
            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center ring-2 ring-red-500/20">
                {hasLogo && (cachedPosterUrl || logoSrc) && !logoError ? (<img src={cachedPosterUrl || logoSrc} alt={currentChannel.chtitle} className="w-12 h-12 rounded-lg object-contain" onError={() => setLogoError(true)} />) : (<Tv className="w-8 h-8 text-red-400" />)}
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center ring-4 ring-black"><span className="text-white text-xs font-bold">!</span></div>
            </div>
            <p className="text-base text-white font-semibold text-center mb-1">Unable to Play</p>
            <p className="text-xs text-white/30 font-medium text-center mb-1">{currentChannel.chtitle}</p>
            <p className="text-sm text-white/40 text-center max-w-xs mb-8 leading-relaxed">{errorMsg}</p>
            <div className="flex items-center gap-3 w-full max-w-xs">
              <button onClick={retry} className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 hover:bg-white/15 rounded-xl text-sm text-white font-semibold transition-colors active:scale-95 backdrop-blur-sm"><RefreshCw className="w-4 h-4" />Retry</button>
            </div>
            <button onClick={handleGoBack} className="mt-5 text-xs text-white/30 hover:text-white/60 transition-colors font-medium">Back to channels</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
