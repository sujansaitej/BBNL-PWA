import { useDarkMode } from "../hooks/useDarkMode";

/**
 * The BBNL lockup, rendered so it is legible on whatever is behind it.
 *
 * Two things made the logo disappear before this existed:
 *
 *   1. Every call site did `isDark ? LOGO_WHITE : LOGO_BLACK`, but both env
 *      vars point at the SAME file — the navy wordmark. There is no white
 *      lockup shipped, so the "swap" was a no-op and dark theme put a navy
 *      wordmark on a near-black card.
 *   2. Some surfaces behind the logo are theme-driven (the login card is
 *      white → gray-900) and some are FIXED (the header bar and the auth
 *      background are an indigo/purple gradient in both themes). Reading the
 *      theme is right for the first kind and wrong for the second.
 *
 * So: `onDark` states what the surface actually is — pass it explicitly for a
 * fixed surface, omit it to follow the app theme. When the art has no white
 * variant, a dark surface gets a light plate under the wordmark instead.
 */

const BASE =
  import.meta.env.BASE_URL || import.meta.env.VITE_API_APP_DIR_PATH || "/";

function assetUrl(path) {
  return `${BASE.replace(/\/?$/, "/")}${String(path || "").replace(/^\/+/, "")}`;
}

const LIGHT_ART = import.meta.env.VITE_API_APP_LOGO_BLACK || "/img/logo.png";
const DARK_ART = import.meta.env.VITE_API_APP_LOGO_WHITE || LIGHT_ART;

/**
 * Is DARK_ART actually a light-on-transparent lockup?
 *
 * Today: YES. /img/logo-white.png is a real reversed lockup — the wordmark
 * knocked out to white with the brand-red mark kept — so dark surfaces use the
 * art itself and the plate below is never drawn.
 *
 * It was false until 2026-08-26, when both env vars pointed at BYTE-IDENTICAL
 * copies of the navy wordmark (/img/logo.png and /icons/logo.png). Because the
 * two PATHS differed, "pick the white one in dark mode" looked correct while
 * shipping a navy wordmark onto a black card — which is why this is a
 * deliberate constant and not derived from the paths. src/theme.test.js
 * asserts the two files now differ AND that the dark one is genuinely light,
 * so it fails loudly and points here if the asset is ever reverted.
 */
export const HAS_DARK_ART = true;

function applyLogoFallback(event) {
  const img = event.currentTarget;
  const index = Number(img.dataset.fallbackIndex || "0");
  const fallbacks = [assetUrl("icons/logo.png"), assetUrl("icons/icon-192.png")];
  const next = fallbacks[index];
  if (!next || img.src.endsWith(next)) return;
  img.dataset.fallbackIndex = String(index + 1);
  img.src = next;
}

export default function BrandLogo({
  /** true = the surface behind the logo is dark. Omit to follow the theme. */
  onDark,
  className = "h-12",
  plateClassName = "inline-flex rounded-xl bg-white px-3 py-2",
  alt = "BBNL",
  ...rest
}) {
  const themeIsDark = useDarkMode();
  const dark = onDark === undefined ? themeIsDark : !!onDark;

  const src = assetUrl(dark && HAS_DARK_ART ? DARK_ART : LIGHT_ART);
  const needsPlate = dark && !HAS_DARK_ART;

  const img = (
    <img
      src={src}
      onError={applyLogoFallback}
      alt={alt}
      className={className}
      {...rest}
    />
  );

  return needsPlate ? <span className={plateClassName}>{img}</span> : img;
}
