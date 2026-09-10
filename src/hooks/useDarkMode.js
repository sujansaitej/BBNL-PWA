import { useTheme } from "../ThemeContext.jsx";

/**
 * True when the app is CURRENTLY rendering dark — not when the phone is set
 * to dark.
 *
 * These are different things and conflating them was a shipped bug: the login
 * screen picked the white BBNL lockup from the OS media query while the card
 * behind it stayed white (Tailwind's `dark:` variants follow the app theme
 * class, and the user's persisted choice was light), so the logo disappeared.
 *
 * Callers that swap an asset or an inline colour must use this, so they can
 * never disagree with the `dark:` utilities rendered around them.
 */
export function useDarkMode() {
  return useTheme().isDark;
}

export default useDarkMode;
