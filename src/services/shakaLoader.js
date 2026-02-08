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
  // If already preloaded, returns instantly from cache.
  // If not, starts the import now.
  return preloadShaka();
}
