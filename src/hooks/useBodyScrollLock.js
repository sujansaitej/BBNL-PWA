import { useEffect } from "react";

// Locks background scroll while an overlay (modal / dialog / drawer) is open.
// iOS Safari ignores `body { overflow: hidden }` for touch scrolling, so we
// pin the body with position:fixed and restore the scroll position on release.
// Reference-counted so nested overlays (e.g. Sidebar opening a Modal) don't
// unlock the page while an outer overlay is still open.
let lockCount = 0;
let savedScrollY = 0;

export default function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      const b = document.body;
      b.style.position = "fixed";
      b.style.top = `-${savedScrollY}px`;
      b.style.left = "0";
      b.style.right = "0";
      b.style.width = "100%";
      b.style.overflow = "hidden";
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount === 0) {
        const b = document.body;
        b.style.position = "";
        b.style.top = "";
        b.style.left = "";
        b.style.right = "";
        b.style.width = "";
        b.style.overflow = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}
