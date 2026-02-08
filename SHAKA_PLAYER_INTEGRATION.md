# Shaka Player Integration Documentation

> **IPTV FTA** — React 18 + Vite PWA Live Streaming Application
> **Shaka Player Version**: `4.16.10`
> **Last Updated**: February 2026

---

## Table of Contents

1. [Overview & Introduction](#1-overview--introduction)
2. [Requirements & Prerequisites](#2-requirements--prerequisites)
3. [Installation Steps](#3-installation-steps)
4. [Architecture & File Structure](#4-architecture--file-structure)
5. [Implementation Details](#5-implementation-details)
   - 5a. [Shaka Player Lazy Loading](#5a-shaka-player-lazy-loading-shakaloaderjs)
   - 5b. [Primary Player — PlayerPage.jsx](#5b-primary-player--playerpagejsx)
   - 5c. [Shaka UI Overlay — LivePlayer.jsx](#5c-shaka-ui-overlay--liveplayerjsx)
   - 5d. [Legacy Hook — useShakaPlayer.js](#5d-legacy-hook--useshakaplayerjs)
6. [End-to-End Streaming Flow](#6-end-to-end-streaming-flow)
7. [Player Features](#7-player-features)
8. [Configuration Options](#8-configuration-options)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Troubleshooting & Common Issues](#10-troubleshooting--common-issues)
11. [API Reference](#11-api-reference)

---

## 1. Overview & Introduction

### What is Shaka Player?

[Shaka Player](https://github.com/shaka-project/shaka-player) is an open-source JavaScript library by Google for adaptive media playback. It supports:

- **DASH** (Dynamic Adaptive Streaming over HTTP)
- **HLS** (HTTP Live Streaming)
- **DRM** (Widevine, FairPlay, PlayReady)
- **Adaptive Bitrate (ABR)** — automatic quality switching based on network conditions

### Why Shaka Player in IPTV FTA?

The IPTV FTA application streams live TV channels to users across various browsers and devices. The challenge:

| Browser | Native HLS Support | Needs Shaka? |
|---------|-------------------|--------------|
| Safari (macOS/iOS) | Yes | No — uses native `<video>` |
| Chrome (Desktop/Android) | No | **Yes** |
| Firefox | No | **Yes** |
| Edge (Chromium) | No | **Yes** |

Shaka Player acts as the **fallback playback engine** for browsers that don't natively support HLS. The application uses a dual-playback strategy:

1. **Native HLS** — Safari and iOS browsers play streams directly via `<video src="...">`
2. **Shaka Player** — All other browsers use Shaka to parse and play HLS/DASH streams

### Version

```
shaka-player@4.16.10
```

Installed as an npm dependency — no CDN or `<script>` tag required.

---

## 2. Requirements & Prerequisites

### System Requirements

| Requirement | Minimum Version | Purpose |
|------------|----------------|---------|
| Node.js | 18.0+ | Build toolchain, npm package manager |
| npm | 9.0+ (bundled with Node 18) | Dependency installation |
| Vite | 5.3.5+ | Build tool & dev server |
| React | 18.2.0+ | UI framework (hooks required) |
| React DOM | 18.2.0+ | DOM rendering |

### Package Dependencies

**Direct dependency** (in `package.json`):

```json
{
  "dependencies": {
    "shaka-player": "^4.16.10"
  }
}
```

**Peer dependencies** (already in the project):

```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^7.8.2",
  "framer-motion": "^12.23.24",
  "lucide-react": "^0.545.0"
}
```

### Browser Compatibility

| Browser | Min Version | Playback Method | Notes |
|---------|------------|-----------------|-------|
| Chrome | 70+ | Shaka Player | Full DASH + HLS support |
| Firefox | 60+ | Shaka Player | Full DASH + HLS support |
| Edge (Chromium) | 79+ | Shaka Player | Full DASH + HLS support |
| Safari (macOS) | 13+ | Native HLS | Shaka used as fallback only |
| Safari (iOS) | 13+ | Native HLS | Shaka not needed |
| Android WebView | Chrome 70+ | Shaka Player | Used in PWA context |
| Samsung Internet | 10+ | Shaka Player | Chromium-based |

### Network Requirements

- **CORS**: The streaming server must include appropriate CORS headers, or a proxy must be configured
- **HTTPS**: Required for DRM and PWA features in production
- **Proxy (Development)**: Vite dev server proxy configured to forward `/api` requests to the backend

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Base URL for all API calls | `/api` (dev), `https://...` (prod) |
| `VITE_API_USERNAME` | Basic auth username | `user@example.com` |
| `VITE_API_PASSWORD` | Basic auth password | `password123` |
| `VITE_API_AUTH_KEY` | API key for `x-api-key` header | `284fb758bef45b...` |

---

## 3. Installation Steps

### Step 1: Install the Package

```bash
npm install shaka-player
```

This installs `shaka-player` into `node_modules/` and adds it to `package.json` under `dependencies`.

### Step 2: Verify Installation

```bash
# Check installed version
npm list shaka-player
# Expected output: shaka-player@4.16.10
```

### Step 3: Vite Configuration

No special Vite configuration is needed. Shaka Player ships as an ES module and works with Vite's default bundling:

```javascript
// vite.config.js — no Shaka-specific config required
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // ... proxy config for API, not for Shaka itself
});
```

### Step 4: Import in Code

Shaka Player is imported dynamically (lazy-loaded) to avoid adding ~200KB to the initial bundle:

```javascript
// Dynamic import — loaded only when needed
const shaka = await import("shaka-player/dist/shaka-player.ui.js");
```

For the UI overlay variant (includes built-in controls + CSS):

```javascript
import shaka from "shaka-player/dist/shaka-player.ui.js";
import "shaka-player/dist/controls.css";
```

---

## 4. Architecture & File Structure

### Shaka-Related Files

```
src/
├── services/
│   └── shakaLoader.js          # Singleton lazy-loader with preload caching
├── pages/
│   ├── PlayerPage.jsx           # Primary full-featured player (custom controls)
│   └── ChannelsPage.jsx         # Triggers preloadShaka() on mount
├── components/
│   └── LivePlayer.jsx           # Simple Shaka UI overlay wrapper (secondary)
└── hooks/
    └── useShakaPlayer.js        # Legacy hook (deprecated, not actively used)
```

### Data Flow Diagram

```
┌──────────────────┐
│  ChannelsPage    │
│                  │
│  1. Mount        │
│  2. preloadShaka()──────────────────────────┐
│  3. User taps    │                          │
│     channel      │                          ▼
│  4. API call:    │               ┌─────────────────────┐
│     getChannel   │               │   shakaLoader.js    │
│     Stream()     │               │                     │
└───────┬──────────┘               │  Singleton cache:   │
        │                          │  - import() once    │
        │ navigate("/player",      │  - polyfill.install │
        │   state: { channel })    │  - return cached    │
        │                          │    module            │
        ▼                          └──────────┬──────────┘
┌──────────────────┐                          │
│  PlayerPage      │                          │
│                  │                          │
│  5. Check native │                          │
│     HLS support  │                          │
│         │        │                          │
│    ┌────┴────┐   │                          │
│    │         │   │                          │
│  YES        NO   │                          │
│    │         │   │                          │
│    ▼         ▼   │                          │
│  Native    getShaka() ◄─────────────────────┘
│  HLS       │         │
│  video.src │         │
│    │       ▼         │
│    │  6. new Player()│
│    │  7. attach()    │
│    │  8. authFilter()│
│    │  9. configure() │
│    │  10. load(url)  │
│    │       │         │
│    ▼       ▼         │
│  ┌───────────────┐   │
│  │  <video>      │   │
│  │  element      │   │
│  │  playing      │   │
│  └───────────────┘   │
└──────────────────────┘
```

### Component Relationships

```
shakaLoader.js (service)
  ├── Used by: ChannelsPage.jsx  → preloadShaka() on mount
  └── Used by: PlayerPage.jsx    → getShaka() during initialization

PlayerPage.jsx (page)
  ├── Imports: getShaka from shakaLoader.js
  ├── Uses: <video> element with ref
  ├── Pattern: Custom controls (no Shaka UI)
  └── Fallback: Native HLS for Safari/iOS

LivePlayer.jsx (component)
  ├── Imports: shaka directly (static import)
  ├── Uses: shaka.ui.Overlay for built-in controls
  └── Note: Simpler alternative, used for basic playback

useShakaPlayer.js (hook) — DEPRECATED
  ├── Imports: shaka directly (static import)
  └── Note: Legacy code, not used by PlayerPage
```

---

## 5. Implementation Details

### 5a. Shaka Player Lazy Loading (`shakaLoader.js`)

**File**: `src/services/shakaLoader.js`
**Lines**: 28
**Purpose**: Lazy-load the Shaka Player module (~200KB) using a singleton cache pattern

```javascript
// Singleton cache for Shaka Player module.
// Calling preload() on the channels page means the ~200KB module
// is already parsed and ready by the time the user taps a channel.

let shakaPromise = null;

export function preloadShaka() {
  if (!shakaPromise) {
    shakaPromise = import("shaka-player/dist/shaka-player.ui.js").then(
      (shaka) => {
        shaka.polyfill.installAll();
        console.log(
          "%c⚡ [Shaka] Module preloaded & cached",
          "color: #f59e0b; font-weight: bold;"
        );
        return shaka;
      }
    );
  }
  return shakaPromise;
}

export function getShaka() {
  return preloadShaka();
}
```

#### How It Works

1. **Singleton Pattern**: `shakaPromise` stores the import Promise. The module is only imported once, regardless of how many times `getShaka()` is called.
2. **Preloading**: `preloadShaka()` is called on `ChannelsPage` mount (line 129 of ChannelsPage.jsx). This starts downloading the ~200KB Shaka module in the background while the user browses channels.
3. **Polyfill Installation**: `shaka.polyfill.installAll()` patches browser APIs (e.g., `MediaSource`, EME) for maximum compatibility.
4. **Instant Access**: When the user taps a channel and navigates to `PlayerPage`, `getShaka()` returns the already-cached module instantly (no network delay).

#### Import Path

```javascript
import("shaka-player/dist/shaka-player.ui.js")
```

This imports the UI-enabled build which includes:
- Core player engine
- Networking layer
- ABR manager
- UI overlay components
- Controls CSS (optional, imported separately)

---

### 5b. Primary Player — `PlayerPage.jsx`

**File**: `src/pages/PlayerPage.jsx`
**Lines**: 677
**Route**: `/player`
**Purpose**: Full-featured video player with custom controls, native HLS fallback, auth headers, and comprehensive error handling

#### Native HLS Detection

```javascript
function supportsNativeHLS() {
  const video = document.createElement("video");
  return (
    video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    video.canPlayType("application/x-mpegURL") !== ""
  );
}
```

This function creates a temporary `<video>` element and tests if the browser can play HLS MIME types natively. Returns `true` on Safari (macOS/iOS), `false` on Chrome/Firefox/Edge.

#### Player Initialization Flow

The core initialization happens in a `useEffect` (lines 181-312):

```javascript
useEffect(() => {
  if (!streamUrl || !videoRef.current) return;

  const video = videoRef.current;
  let cancelled = false;

  // ... event listeners setup ...

  const init = async () => {
    // Step 1: Check native HLS
    if (supportsNativeHLS()) {
      setPlaybackMethod("native");
      video.src = streamUrl;
      return;
    }

    // Step 2: Load Shaka
    const shaka = await getShaka();
    if (cancelled) return;

    // Step 3: Check browser support
    if (!shaka.Player.isBrowserSupported()) {
      throw new Error("Shaka Player is not supported in this browser.");
    }

    // Step 4: Create and attach player
    const player = new shaka.Player();
    await player.attach(video);
    if (cancelled) { player.destroy(); return; }

    shakaPlayerRef.current = player;
    setPlaybackMethod("shaka");

    // Step 5: Register error handler
    player.addEventListener("error", (event) => {
      const detail = event.detail;
      setStatus("error");
      setErrorMsg(detail?.message || "Stream playback failed.");
    });

    // Step 6: Add auth headers
    if (authKey && authVal) {
      player.getNetworkingEngine().registerRequestFilter((_type, request) => {
        request.headers[authKey] = authVal;
      });
    }

    // Step 7: Configure streaming options
    player.configure({
      streaming: {
        retryParameters: {
          maxAttempts: 2,
          baseDelay: 500,
          backoffFactor: 1.5,
          timeout: 10000,
        },
      },
    });

    // Step 8: Load the stream
    await player.load(streamUrl);
  };

  init();

  // Cleanup
  return () => {
    cancelled = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    destroyShaka();
  };
}, [streamUrl]);
```

#### Cancellation Pattern

The `cancelled` flag prevents state updates after the component unmounts:

```javascript
let cancelled = false;

// In async operations:
if (cancelled) return;

// On cleanup:
return () => { cancelled = true; };
```

This is critical because `getShaka()` is async — the user might navigate away before Shaka finishes loading.

#### Auth Header Injection

The streaming API returns `authkey` and `authval` for protected streams. These are injected into every network request Shaka makes:

```javascript
if (authKey && authVal) {
  player.getNetworkingEngine().registerRequestFilter((_type, request) => {
    request.headers[authKey] = authVal;
  });
}
```

This ensures segment requests (`.ts` chunks, manifests) include the required authentication headers.

#### Player Cleanup

```javascript
const destroyShaka = useCallback(async () => {
  if (shakaPlayerRef.current) {
    try { await shakaPlayerRef.current.destroy(); } catch (_) {}
    shakaPlayerRef.current = null;
  }
}, []);
```

`player.destroy()` is called on unmount to:
- Stop all network requests
- Release MediaSource object
- Free video element resources
- Prevent memory leaks

#### Autoplay Handling

Browsers block autoplay with sound. The player handles this gracefully:

```javascript
const onCanPlay = async () => {
  try {
    // Attempt 1: Play with sound
    const played = await safePlay(video);
    if (played) setStatus("playing");
  } catch (playErr) {
    // Attempt 2: Mute and retry
    video.muted = true;
    setMuted(true);
    try {
      const played = await safePlay(video);
      if (played) setStatus("playing");
    } catch (_) {
      setStatus("error");
      setErrorMsg("Autoplay blocked. Tap the screen to play.");
    }
  }
};
```

---

### 5c. Shaka UI Overlay — `LivePlayer.jsx`

**File**: `src/components/LivePlayer.jsx`
**Lines**: 37
**Purpose**: Simple Shaka player wrapper using built-in UI controls

```javascript
import React, { useRef, useEffect } from "react";
import shaka from "shaka-player/dist/shaka-player.ui.js";
import "shaka-player/dist/controls.css";

export default function LivePlayerUI({ url }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    const player = new shaka.Player(video);

    // Attach Shaka's built-in UI overlay
    new shaka.ui.Overlay(player, container, video);

    player
      .load(url)
      .then(() => console.log("Loaded stream"))
      .catch((err) => console.error("Error loading stream", err));

    return () => { player.destroy(); };
  }, [url]);

  return (
    <div ref={containerRef} className="relative w-full bg-black rounded-xl overflow-hidden">
      <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain rounded-xl" />
    </div>
  );
}
```

#### Key Differences from PlayerPage

| Feature | PlayerPage.jsx | LivePlayer.jsx |
|---------|---------------|----------------|
| Controls | Custom React UI | Shaka built-in overlay |
| HLS Fallback | Native + Shaka | Shaka only |
| Auth Headers | Supported | Not supported |
| Error Handling | Comprehensive UI | Console only |
| Fullscreen | Custom with orientation lock | Shaka built-in |
| Lazy Loading | Yes (via `getShaka()`) | No (static import) |
| Bundle Impact | Deferred (~200KB) | Immediate (~200KB) |

#### When to Use

- **PlayerPage.jsx**: Primary player for production — use this for all user-facing playback
- **LivePlayer.jsx**: Quick prototyping or testing — useful for embedding a simple player with zero configuration

---

### 5d. Legacy Hook — `useShakaPlayer.js`

**File**: `src/hooks/useShakaPlayer.js`
**Lines**: 30
**Status**: **DEPRECATED** — Not actively used by `PlayerPage.jsx`

```javascript
import { useEffect } from "react";
import shaka from "shaka-player";

export default function useShakaPlayer(videoRef, src) {
  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const player = new shaka.Player(video);

    const onError = (e) => console.error("Shaka Error", e);
    player.addEventListener("error", onError);

    (async () => {
      try {
        const h3src = src + "?h3ts=" + Date.now();
        fetch(h3src, { method: "HEAD" }).catch(() => {});
        await player.load(h3src);
      } catch (err) {
        onError(err);
      }
    })();

    return () => { player.destroy(); };
  }, [videoRef, src]);
}
```

#### Notable Patterns (for reference)

- **Cache-busting**: Appends `?h3ts=<timestamp>` to the stream URL to bypass CDN caches
- **HEAD prefetch**: Sends a `HEAD` request before loading (warms server-side cache)
- **Static import**: Uses `import shaka from "shaka-player"` (adds ~200KB to initial bundle)

#### Why It Was Replaced

The `PlayerPage.jsx` implementation replaced this hook because:
1. The hook uses a static import (no lazy loading)
2. No native HLS fallback
3. No auth header support
4. No comprehensive error handling UI
5. No autoplay policy handling

---

## 6. End-to-End Streaming Flow

### Complete Flow: Channel Selection to Playback

```
Step 1                    Step 2                     Step 3
┌───────────────┐        ┌──────────────────┐       ┌──────────────────┐
│ ChannelsPage  │        │  Stream API Call  │       │  Navigate to     │
│               │        │                  │       │  /player         │
│ • Mount       │        │  getChannelStream│       │                  │
│ • preloadShaka│───►    │  ({mobile, chid})│───►   │  state: {        │
│ • User taps   │        │                  │       │    channel: {    │
│   channel     │        │  Response:       │       │      streamlink, │
│               │        │  • streamlink    │       │      authkey,    │
│               │        │  • authkey       │       │      authval,    │
│               │        │  • authval       │       │      chtitle,    │
│               │        │  • streamformat  │       │      chlogo,...  │
│               │        │  • epg           │       │    }             │
└───────────────┘        └──────────────────┘       │  }               │
                                                    └────────┬─────────┘
                                                             │
                                                             ▼
Step 4                    Step 5                     Step 6
┌───────────────┐        ┌──────────────────┐       ┌──────────────────┐
│ PlayerPage    │        │  Playback Engine │       │  Stream Playing  │
│               │        │                  │       │                  │
│ • Read channel│        │  IF native HLS:  │       │  • Status:       │
│   from route  │───►    │    video.src=url │───►   │    "playing"     │
│   state       │        │                  │       │  • Controls      │
│ • Show loading│        │  ELSE:           │       │    visible       │
│   overlay     │        │    getShaka()    │       │  • Auto-hide     │
│               │        │    → attach()    │       │    after 4s      │
│               │        │    → authFilter()│       │  • LIVE badge    │
│               │        │    → configure() │       │    shown         │
│               │        │    → load(url)   │       │                  │
└───────────────┘        └──────────────────┘       └──────────────────┘
```

### Detailed Step-by-Step

1. **ChannelsPage mounts** → Calls `preloadShaka()` to begin downloading Shaka in the background (line 129 of ChannelsPage.jsx)

2. **User browses channels** → Channel grid displayed with logos, names, and prices. Shaka module downloads in parallel.

3. **User taps a channel** → `handlePlayChannel()` fires:
   - Calls `getChannelStream({ mobile, chid, chno })` API
   - API returns: `streamlink`, `streamformat`, `authkey`, `authval`, `epg`

4. **Navigate to PlayerPage** → Route: `/player` with full channel data in `location.state`

5. **PlayerPage initializes**:
   - Reads `channel` from `location.state`
   - Shows loading overlay with channel logo and spinner
   - Checks `supportsNativeHLS()`

6. **Playback branch**:
   - **Native HLS** (Safari/iOS): Sets `video.src = streamUrl` directly
   - **Shaka Player** (Chrome/Firefox/Edge):
     - `getShaka()` returns cached module instantly (preloaded in step 1)
     - Creates `new shaka.Player()` and attaches to `<video>` element
     - Registers auth header filter if `authkey`/`authval` provided
     - Configures retry parameters
     - Calls `player.load(streamUrl)`

7. **Playback begins**:
   - `canplay` event fires → attempts autoplay
   - If autoplay blocked → mutes and retries
   - Status transitions: `"loading"` → `"playing"`
   - Controls auto-hide after 4 seconds

8. **User leaves** → Cleanup:
   - `cancelled = true` prevents stale state updates
   - `video.pause()` + `video.removeAttribute("src")` + `video.load()`
   - `player.destroy()` releases all Shaka resources

---

## 7. Player Features

### 7.1 Play/Pause Controls

**Center button**: Large 72px circular button overlaid on the video.

```javascript
const togglePlayPause = () => {
  const video = videoRef.current;
  if (video.paused) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
  resetHideTimer();
};
```

State is tracked via native video events:
```javascript
video.addEventListener("play", () => setPaused(false));
video.addEventListener("pause", () => setPaused(true));
```

### 7.2 Mute/Volume Toggle

**Bottom-right button**: Toggles between `Volume2` and `VolumeX` icons.

```javascript
const toggleMute = (e) => {
  e.stopPropagation();
  videoRef.current.muted = !videoRef.current.muted;
  setMuted(videoRef.current.muted);
};
```

### 7.3 Fullscreen with Orientation Lock

**Bottom-right button**: Toggles fullscreen and locks to landscape orientation.

```javascript
const toggleFullscreen = async (e) => {
  e.stopPropagation();
  const el = containerRef.current;

  if (!document.fullscreenElement) {
    await enterFullscreen(el);  // Uses Fullscreen API
  } else {
    await exitFullscreen();
  }
};
```

Orientation is managed via `fullscreenchange` event:
```javascript
const onFsChange = () => {
  const fs = !!document.fullscreenElement;
  setIsFullscreen(fs);
  if (fs) {
    screen.orientation.lock("landscape");  // Lock to landscape
  } else {
    screen.orientation.unlock();           // Restore default
  }
};
```

### 7.4 Auto-Hiding Controls

Controls overlay appears on tap/mouse-move and auto-hides after **4 seconds** of inactivity:

```javascript
const resetHideTimer = useCallback(() => {
  setShowControls(true);
  if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  hideTimerRef.current = setTimeout(() => {
    if (status === "playing") setShowControls(false);
  }, 4000);
}, [status]);
```

Controls are only hidden during `"playing"` status — they remain visible during loading and error states.

### 7.5 Loading Overlay

Semi-transparent overlay (`bg-black/70 backdrop-blur-sm`) with:
- Channel logo (or fallback TV icon)
- Channel title
- Spinning loading indicator

### 7.6 Error Overlay

Full-screen error display with:
- Channel logo with red error ring
- "Unable to Play" heading
- Error message text
- **Retry** button — re-navigates to `/player` with same state
- **External** button — opens `streamUrl` in a new tab
- **Back to channels** link

### 7.7 LIVE Badge

Red pulsing badge in the top-right corner during playback:
```html
<div className="bg-red-600 px-3 py-1.5 rounded-md">
  <span className="animate-ping ..."></span>  <!-- Pulsing dot -->
  <span>LIVE</span>
</div>
```

### 7.8 Playback Method Indicator

Bottom-left corner shows which engine is playing the stream:
- `"Native HLS"` — Safari/iOS using native `<video>` element
- `"Shaka Player"` — Chrome/Firefox/Edge using Shaka

### 7.9 Animated Transitions

All overlays use Framer Motion for smooth enter/exit animations:
```javascript
<AnimatePresence>
  {controlsVisible && (
    <motion.div
      initial={{ opacity: 0, y: -30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -30 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* ... controls content ... */}
    </motion.div>
  )}
</AnimatePresence>
```

---

## 8. Configuration Options

### 8.1 Streaming Retry Parameters

Configured in `PlayerPage.jsx` (lines 278-282):

```javascript
player.configure({
  streaming: {
    retryParameters: {
      maxAttempts: 2,        // Max retry attempts per request
      baseDelay: 500,        // Initial delay between retries (ms)
      backoffFactor: 1.5,    // Multiplier for delay on each retry
      timeout: 10000,        // Request timeout (ms)
    },
  },
});
```

| Parameter | Value | Description |
|-----------|-------|-------------|
| `maxAttempts` | 2 | Retry failed segment/manifest requests up to 2 times |
| `baseDelay` | 500ms | Wait 500ms before first retry |
| `backoffFactor` | 1.5 | Second retry waits 750ms (500 x 1.5) |
| `timeout` | 10000ms | Abort request after 10 seconds |

### 8.2 Network Request Filters

Auth headers are injected for protected streams:

```javascript
player.getNetworkingEngine().registerRequestFilter((_type, request) => {
  request.headers[authKey] = authVal;
});
```

- `_type`: Request type (ignored — filter applies to all requests including manifest, segment, license)
- `request.headers`: HTTP headers object — dynamically adds the auth header

### 8.3 Browser Support Check

Before creating a player instance:

```javascript
if (!shaka.Player.isBrowserSupported()) {
  throw new Error("Shaka Player is not supported in this browser.");
}
```

This checks for:
- `MediaSource` API availability
- EME (Encrypted Media Extensions) support
- Required codec support

### 8.4 Polyfill Installation

Called once during module preloading:

```javascript
shaka.polyfill.installAll();
```

Installs polyfills for:
- `MediaSource` (older browsers)
- `EME` (Encrypted Media Extensions)
- `VTTCue` (subtitle cues)
- `PatchedMediaKeysApple` (Safari DRM)

---

## 9. Error Handling Strategy

### Error Sources and Handlers

```
┌─────────────────────────────────┐
│         Error Sources           │
├─────────────────────────────────┤
│                                 │
│  1. Video Element Errors        │
│     video.addEventListener(     │
│       "error", onError)         │
│     → Media decode failures     │
│     → Network errors            │
│     → Unsupported formats       │
│                                 │
│  2. Shaka Player Errors         │
│     player.addEventListener(    │
│       "error", handler)         │
│     → Manifest parse failures   │
│     → Segment download failures │
│     → DRM errors                │
│     → CORS errors (7001/7002)   │
│                                 │
│  3. Autoplay Errors             │
│     video.play() rejected       │
│     → Browser policy blocks     │
│     → User interaction required │
│                                 │
│  4. Initialization Errors       │
│     getShaka() / player.load()  │
│     → Module load failure       │
│     → Browser not supported     │
│     → Stream URL invalid        │
│                                 │
└─────────────────────────────────┘
```

### CORS Error Detection

Shaka error codes 7001 and 7002 indicate CORS blocking:

```javascript
setErrorMsg(
  err.message?.includes("7001") || err.message?.includes("7002")
    ? "Stream blocked by CORS policy. Try opening externally."
    : err.message || "Failed to load stream."
);
```

- **7001**: `HTTP_ERROR` — network request failed (often CORS)
- **7002**: `BAD_HTTP_STATUS` — server returned an error status

### Autoplay Fallback Chain

```
Attempt 1: video.play()  ─── Success ──► Status: "playing"
     │
   Fails (NotAllowedError)
     │
     ▼
Attempt 2: video.muted = true; video.play()  ─── Success ──► Status: "playing" (muted)
     │
   Fails
     │
     ▼
Status: "error"
Message: "Autoplay blocked. Tap the screen to play."
```

### Error Recovery Options

| Action | Implementation | User Action |
|--------|---------------|-------------|
| Retry | Re-navigate to `/player` with same state | Tap "Retry" button |
| External | `window.open(streamUrl, "_blank")` | Tap "External" button |
| Go Back | `navigate(-1)` | Tap "Back to channels" |

### Safe Play Utility

```javascript
const safePlay = useCallback(async (video) => {
  try {
    await video.play();
    return true;
  } catch (err) {
    if (err.name === "AbortError") return false;  // Ignore non-critical AbortError
    throw err;
  }
}, []);
```

`AbortError` occurs when `play()` is interrupted by a new `load()` call — this is expected during fast navigation and is safely ignored.

---

## 10. Troubleshooting & Common Issues

### CORS Errors

**Symptom**: Stream fails with "Stream blocked by CORS policy" or Shaka error 7001/7002.

**Cause**: The streaming server doesn't include `Access-Control-Allow-Origin` headers.

**Solutions**:
1. **Development**: Use Vite proxy configuration:
   ```javascript
   // vite.config.js
   server: {
     proxy: {
       "/api": {
         target: "http://your-server",
         changeOrigin: true,
         rewrite: (path) => path.replace(/^\/api/, "/path"),
       },
     },
   }
   ```
2. **Production**: Configure the streaming server to send appropriate CORS headers
3. **Workaround**: Use the "External" button to open the stream directly in the browser

### Autoplay Blocked

**Symptom**: Video loads but doesn't play. Shows "Autoplay blocked" error.

**Cause**: Browsers require user interaction before playing media with sound.

**How it's handled**: The player automatically mutes and retries. If that also fails, it shows an error with a tap-to-play prompt.

**Prevention**: The `<video>` element includes `playsInline` and `autoPlay` attributes:
```html
<video ref={videoRef} playsInline autoPlay />
```

### Mobile Browser Limitations

**Symptom**: Orientation lock doesn't work, or fullscreen behaves unexpectedly.

**Cause**: Not all mobile browsers support `screen.orientation.lock()`.

**How it's handled**: All orientation/fullscreen calls are wrapped in try-catch:
```javascript
async function lockLandscape() {
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (_) {}
}
```

### Memory Cleanup

**Symptom**: Memory usage grows when navigating between channels repeatedly.

**Cause**: Shaka player or video element not properly destroyed.

**How it's handled**: Cleanup runs on every unmount:
```javascript
return () => {
  cancelled = true;
  video.pause();
  video.removeAttribute("src");
  video.load();                    // Reset the video element
  destroyShaka();                  // Destroy Shaka instance
};
```

### Stream Format Compatibility

**Symptom**: Stream doesn't play on certain browsers.

| Format | Native Support | Shaka Support |
|--------|---------------|---------------|
| HLS (`.m3u8`) | Safari only | All browsers |
| DASH (`.mpd`) | None | All browsers |
| MP4 (progressive) | All browsers | Not applicable |

### Shaka Module Load Failure

**Symptom**: Player shows "Failed to load stream" on first use.

**Cause**: Network issues during the ~200KB Shaka module download.

**Prevention**: `preloadShaka()` is called on the channels page, giving the module time to download while the user browses.

---

## 11. API Reference

### Shaka Loader Service

#### `preloadShaka(): Promise<ShakaModule>`

Starts downloading the Shaka Player module in the background. Returns the cached module if already loaded.

```javascript
import { preloadShaka } from "../services/shakaLoader";

// Call on page mount to preload
useEffect(() => { preloadShaka(); }, []);
```

#### `getShaka(): Promise<ShakaModule>`

Returns the Shaka Player module. If not yet preloaded, starts the import.

```javascript
import { getShaka } from "../services/shakaLoader";

const shaka = await getShaka();
const player = new shaka.Player();
```

### Native HLS Detection

#### `supportsNativeHLS(): boolean`

Checks if the current browser can play HLS streams natively.

```javascript
// Defined in PlayerPage.jsx
function supportsNativeHLS() {
  const video = document.createElement("video");
  return (
    video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    video.canPlayType("application/x-mpegURL") !== ""
  );
}
```

**Returns**: `true` on Safari/iOS, `false` on Chrome/Firefox/Edge.

### Stream API

#### `getChannelStream({ mobile, chid, chno, ip_address }): Promise<ApiResponse>`

Fetches the stream URL and authentication details for a channel.

```javascript
import { getChannelStream } from "../services/api";

const data = await getChannelStream({
  mobile: "9876543210",
  chid: "CH001",
  chno: "101",
  // ip_address is auto-detected if not provided
});

// Response structure:
// data.body[0].stream[0] = {
//   streamlink: "https://stream.example.com/live/ch1.m3u8",
//   streamformat: "hls",
//   authkey: "X-Custom-Auth",
//   authval: "token123",
//   epgid: "EPG001",
//   epg: [...]
// }
```

#### `getChannelList({ mobile, grid, bcid, langid, search }): Promise<ApiResponse>`

Fetches the list of available channels with optional filtering.

```javascript
import { getChannelList } from "../services/api";

const data = await getChannelList({
  mobile: "9876543210",
  langid: "subs",         // "subs" for subscribed, or language ID
  search: "news",          // Optional search term
});

// Response: data.body[0].channels = [{ chid, chno, chtitle, chlogo, chprice, streamlink, ... }]
```

### Shaka Player Core APIs Used

| API | Location | Purpose |
|-----|----------|---------|
| `new shaka.Player()` | PlayerPage.jsx:255 | Create player instance |
| `player.attach(video)` | PlayerPage.jsx:256 | Bind to `<video>` element |
| `player.load(url)` | PlayerPage.jsx:284 | Load and play stream |
| `player.destroy()` | PlayerPage.jsx:165 | Clean up resources |
| `player.configure(config)` | PlayerPage.jsx:278 | Set player options |
| `player.getNetworkingEngine()` | PlayerPage.jsx:273 | Access network layer |
| `.registerRequestFilter(fn)` | PlayerPage.jsx:273 | Inject custom headers |
| `player.addEventListener("error", fn)` | PlayerPage.jsx:262 | Listen for errors |
| `shaka.Player.isBrowserSupported()` | PlayerPage.jsx:251 | Check compatibility |
| `shaka.polyfill.installAll()` | shakaLoader.js:11 | Install browser polyfills |
| `new shaka.ui.Overlay(...)` | LivePlayer.jsx:18 | Attach built-in UI |

---

*End of Documentation*
