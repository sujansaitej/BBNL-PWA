
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

    new shaka.ui.Overlay(player, container, video);

    player
      .load(url)
      .then(() => console.log("Loaded stream"))
      .catch((err) => console.error("Error loading stream", err));

    return () => {
      player.destroy();
    };
  }, [url]);

  return (
    <div ref={containerRef} className="relative w-full bg-black rounded-xl overflow-hidden">
      <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain rounded-xl" />
    </div>
  );
}

