/**
 * navigationController.js — Cancel in-flight API requests when navigating between service pages.
 *
 * Problem: When user navigates from InternetService → FoFiSmartBox, the old page's
 * API calls stay in-flight and saturate the browser's connection pool (~6 per origin).
 * The new page's requests queue behind them → slow loading.
 *
 * Solution: Each service page calls refreshServiceController() on mount, which aborts
 * all previous page's requests instantly, freeing connections for the new page.
 *
 * Background mode: Prefetch calls use enterBackgroundMode()/exitBackgroundMode() so
 * they are NOT aborted on navigation — the whole point of prefetch is to warm caches
 * before the user reaches the page.
 */

let _ctrl = new AbortController();
let _backgroundMode = false;

/**
 * Abort all in-flight service page requests and create a fresh controller.
 * Call this at the top of each service page's data-fetch useEffect.
 */
export function refreshServiceController() {
  _ctrl.abort();
  _ctrl = new AbortController();
  return _ctrl.signal;
}

/**
 * Get the current navigation signal. Both apiFetch and fofiApiFetch link to this
 * so they get automatically aborted on navigation.
 */
export function getServiceSignal() {
  return _ctrl.signal;
}

/**
 * Returns true if currently in background mode (prefetch).
 * apiFetch/fofiApiFetch skip navigation linking when true.
 */
export function isBackgroundMode() {
  return _backgroundMode;
}

/**
 * Enter background mode — API calls made while this is true will NOT be
 * linked to the navigation signal (won't be aborted on page navigation).
 * Used by prefetch.js to keep cache-warming alive across navigations.
 */
export function enterBackgroundMode() {
  _backgroundMode = true;
}

/**
 * Exit background mode — subsequent API calls will be linked to navigation again.
 */
export function exitBackgroundMode() {
  _backgroundMode = false;
}
