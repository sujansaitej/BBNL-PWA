import React, { useRef, useEffect, useState } from "react";
import { getShaka } from "../services/shakaLoader";

export default function LivePlayerUI({ url, authKey, authVal }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    let cancelled = false;

    const init = async () => {
      try {
        const shaka = await getShaka();
        if (cancelled) return;

        if (!shaka.Player.isBrowserSupported()) {
          setError("Browser not supported");
          return;
        }

        const player = new shaka.Player();
        await player.attach(video);
        if (cancelled) { player.destroy(); return; }

        playerRef.current = player;

        player.addEventListener("error", (event) => {
          console.error("[LivePlayer] Shaka error:", event.detail);
          if (!cancelled) setError(event.detail?.message || "Playback error");
        });

        if (authKey && authVal) {
          player.getNetworkingEngine().registerRequestFilter((_type, request) => {
            request.headers[authKey] = authVal;
          });
        }

        player.configure({
          streaming: {
            retryParameters: { maxAttempts: 3, baseDelay: 500, backoffFactor: 1.5, timeout: 15000 },
            bufferingGoal: 10,
            rebufferingGoal: 2,
          },
        });

        await player.load(url);
        if (cancelled) return;

        try { await video.play(); } catch (_) {}
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load stream");
      }
    };

    init();

    return () => {
      cancelled = true;
      if (playerRef.current) {
        playerRef.current.destroy().catch(() => {});
        playerRef.current = null;
      }
    };
  }, [url, authKey, authVal]);

  return (
    <div className="relative w-full bg-black rounded-xl overflow-hidden">
      <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain rounded-xl" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-white/60 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
