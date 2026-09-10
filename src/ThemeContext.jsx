import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * The app's single source of truth for light/dark.
 *
 * Three things have to agree, or the UI contradicts itself:
 *
 *   1. Tailwind's `dark:` variants — driven by the `dark` class on <html>
 *      (tailwind.config.js sets darkMode:'class').
 *   2. The user agent — it paints <input>, <select>, scrollbars, autofill and
 *      the iOS form accessory bar from the CSS `color-scheme` property, which
 *      knows nothing about our classes. Left unpinned it follows the OS, which
 *      is how a dark-mode phone ended up rendering charcoal input boxes inside
 *      a white login card with near-black text in them.
 *   3. Anything that swaps an ASSET rather than a colour — the BBNL lockup has
 *      a light and a dark variant, and picking the white one against a white
 *      card makes the logo vanish. That was the reported login bug: the logo
 *      read the OS media query while the card read the (persisted) app theme.
 *
 * `mode` is what the user chose — 'system' | 'light' | 'dark'.
 * `theme` is what is actually rendered — 'light' | 'dark'.
 * Everything downstream must consume `theme`, never the media query directly.
 */

const STORAGE_KEY = "theme";
export const THEME_COLORS = { light: "#ffffff", dark: "#0f172a" };
const MODES = ["system", "light", "dark"];

export const ThemeContext = createContext(null);

const MQ = "(prefers-color-scheme: dark)";

function mediaQueryList() {
  try {
    return typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(MQ)
      : null;
  } catch {
    return null; // some embedded webviews throw on matchMedia
  }
}

export function systemPrefersDark() {
  return !!mediaQueryList()?.matches;
}

/** Read the persisted choice. Never throws — private mode / disabled storage. */
export function readStoredMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (MODES.includes(raw)) return raw;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function resolveTheme(mode) {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

/**
 * Push the resolved theme onto the document. Kept as a free function so the
 * pre-paint script in index.html and this provider apply it identically.
 */
export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  // Pin the UA widget palette to the theme we render, NOT to the OS.
  root.style.colorScheme = theme;
  root.dataset.theme = theme;

  // Android's status/URL bar and iOS's standalone status bar read
  // <meta name="theme-color">. Media-scoped copies follow the OS, so they
  // would contradict an explicit in-app choice — drop them and manage one.
  try {
    document
      .querySelectorAll('meta[name="theme-color"][media]')
      .forEach((m) => m.remove());
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", THEME_COLORS[theme] || THEME_COLORS.light);
  } catch {
    /* head not writable — cosmetic only */
  }
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const theme = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // Follow the OS live while on 'system'. The old provider snapshotted the
  // media query once at mount and immediately persisted the result, which
  // permanently froze every install into whatever the phone happened to be
  // set to on first launch.
  useEffect(() => {
    const mq = mediaQueryList();
    if (!mq) return;
    const onChange = (e) => setSystemDark(e.matches);
    // Safari < 14 (iOS 13) only has the deprecated addListener.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Persist only real user choices. Writing on mount is what used to convert
  // "no preference yet" into a locked-in one.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* preference is in-memory only this session */
    }
  }, [mode]);

  const setMode = useCallback((next) => {
    setModeState(MODES.includes(next) ? next : "system");
  }, []);

  // Kept binary on purpose: the sidebar control is a two-state switch, and
  // flipping it is an explicit choice, so it leaves 'system'.
  const toggleTheme = useCallback(() => {
    setModeState((m) =>
      (m === "system" ? (systemPrefersDark() ? "dark" : "light") : m) === "dark"
        ? "light"
        : "dark"
    );
  }, []);

  const value = useMemo(
    () => ({ mode, theme, isDark: theme === "dark", setMode, toggleTheme }),
    [mode, theme, setMode, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Consume the resolved theme. Falls back to the OS query when rendered
 * outside the provider (tests, isolated stories) so callers never crash.
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  const [fallbackDark, setFallbackDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (ctx) return;
    const mq = mediaQueryList();
    if (!mq) return;
    const onChange = (e) => setFallbackDark(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, [ctx]);

  if (ctx) return ctx;
  const theme = fallbackDark ? "dark" : "light";
  return {
    mode: "system",
    theme,
    isDark: fallbackDark,
    setMode: () => {},
    toggleTheme: () => {},
  };
}
