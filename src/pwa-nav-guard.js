/**
 * PWA Navigation Guard
 *
 * In standalone PWA mode (installed to home screen), intercept clicks on
 * <a> tags that navigate to external URLs and open them in a new browser
 * tab instead.  This prevents the PWA from "breaking out" into the full
 * browser and showing the URL bar.
 */
export function setupPwaNavGuard() {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (!isStandalone) return;

  document.addEventListener(
    "click",
    (e) => {
      const anchor = e.target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href === "#" || href.startsWith("#") || href.startsWith("javascript:")) return;

      // Allow native protocol links (tel:, mailto:, sms:, etc.)
      if (/^(tel|mailto|sms|whatsapp|intent):/.test(href)) return;

      // Already opens in a new tab — no action needed
      if (anchor.target === "_blank") return;

      try {
        const url = new URL(href, window.location.origin);
        // External link — open in browser instead of navigating within PWA
        if (url.origin !== window.location.origin) {
          e.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
        }
      } catch {
        // Invalid URL (e.g. relative fragment), let browser handle it
      }
    },
    true // capture phase — runs before React event delegation
  );
}
