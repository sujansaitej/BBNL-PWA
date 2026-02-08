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

    return () => {
      player.destroy();
    };
  }, [videoRef, src]);
}
