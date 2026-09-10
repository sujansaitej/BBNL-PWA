/**
 * Which installation of the PWA the stored session belongs to.
 *
 * ── The problem ────────────────────────────────────────────────────────────
 * Reported Aug 2026: install the app, log in, uninstall it, reinstall it — and
 * the app comes back already logged in instead of asking for credentials.
 *
 * That is Chrome behaving as designed, not a bug in the session code. An
 * installed PWA on Android is a WebAPK, and a WebAPK does not own its storage:
 * `localStorage`, IndexedDB and CacheStorage all live in the Chrome profile,
 * keyed by ORIGIN. Uninstalling the WebAPK removes the launcher entry and the
 * Android package; it leaves the origin's data exactly where it was, the same
 * way uninstalling Chrome shortcuts does not log you out of a website. So the
 * session AuthContext restores on the next launch is genuinely still there.
 *
 * ── Why there is no "is this a fresh install?" API ─────────────────────────
 * Nothing exposed to a page is scoped to the installation rather than the
 * origin, so there is no storage slot that a reinstall resets and no flag that
 * says "you are running a copy that was installed after your data was written".
 * The one and only installation signal the platform gives is the `appinstalled`
 * event — and it does not say whether this is the first install or the fifth.
 *
 * ── What this module does ──────────────────────────────────────────────────
 * It makes `appinstalled` say that, by counting installs in a key that the
 * session purge deliberately does not touch:
 *
 *   generation 1  — the first install this origin has ever seen on this device.
 *                   Nothing was uninstalled, so a session created just before
 *                   it (the ordinary "open the site in Chrome, sign in, then
 *                   install" path) is still that operator's own session and is
 *                   left alone. Signing them out here was the Aug 2026
 *                   "app logs itself out when I reopen it" bug.
 *   generation 2+ — the app is being installed while a previous install was
 *                   already recorded. You cannot install over a live install;
 *                   Chrome offers "Open app" instead. So an increment past 1
 *                   means the previous copy was UNINSTALLED at some point, and
 *                   any session left behind belongs to that removed copy. It is
 *                   ended and the operator logs in again.
 *
 * ── Known limits, stated rather than papered over ──────────────────────────
 * • It triggers at reinstall time, not uninstall time. There is no uninstall
 *   event; between the two the data simply sits there unreachable.
 * • A reinstall performed with no page of ours open anywhere (nothing running
 *   to hear `appinstalled`) is not seen. In practice BrowserGate forces the
 *   reinstall through our own page, so this is the normal path, not a lucky
 *   one.
 * • iOS Safari never fires `appinstalled`, so nothing here runs there. It also
 *   does not need to: a home-screen web app on iOS gets its own storage and
 *   deleting it takes the data with it, which is the behaviour being asked for.
 */

const GENERATION_KEY = "pwaInstallGeneration";
const INSTALLED_AT_KEY = "pwaInstalledAt";

/**
 * The pre-existing "this device has installed the app at least once" flag,
 * written by BrowserGate long before generations existed. Read here so a phone
 * that installed the app under the old build starts at generation 1 instead of
 * treating its next reinstall as a first install.
 */
const LEGACY_INSTALLED_KEY = "pwaInstalledOnce";

/**
 * Two `appinstalled` events closer together than this are one install being
 * announced twice (it has been observed firing from more than one context for
 * a single install), not two installs.
 *
 * Kept deliberately short. A real uninstall/reinstall involves several taps
 * through the launcher and Chrome's install dialog and cannot complete inside
 * it — including in the QA loop that reproduces the bug, where the tester
 * uninstalls and immediately reinstalls.
 */
export const DUPLICATE_INSTALL_WINDOW_MS = 5000;

function lsGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
}

/** True when this page is running as the installed app rather than in a tab. */
export function isStandaloneDisplay() {
  try {
    if (window.navigator?.standalone === true) return true;
    if (typeof window.matchMedia !== "function") return false;
    return ["standalone", "fullscreen", "minimal-ui"].some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
    );
  } catch (_) {
    return false;
  }
}

/** Installs recorded on this device so far. 0 = none recorded. */
export function getInstallGeneration() {
  const value = Number(lsGet(GENERATION_KEY));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Backfill generation 1 for a device that is ALREADY running an installed copy
 * but predates this counter.
 *
 * Without it every currently-installed operator would sit at generation 0, so
 * their next reinstall would count as a first install and keep the session —
 * i.e. the reported bug would survive the fix for exactly the people who
 * reported it. Called on startup.
 *
 * Only ever writes when the app really is installed: standalone display mode,
 * or the legacy flag from a previous install. A first-time visitor in a browser
 * tab stays at 0 so that their eventual first install is still a first install.
 *
 * @returns {number} the generation in force after seeding.
 */
export function seedInstallGeneration() {
  const existing = getInstallGeneration();
  if (existing > 0) return existing;

  const installed = isStandaloneDisplay() || lsGet(LEGACY_INSTALLED_KEY) === "true";
  if (!installed) return 0;

  if (!lsSet(GENERATION_KEY, "1")) return 0;
  lsSet(LEGACY_INSTALLED_KEY, "true");
  // Deliberately does NOT stamp INSTALLED_AT_KEY. That timestamp exists only
  // to recognise a duplicate `appinstalled`, and seeding is a backfill, not an
  // install event. Stamping it here would start the duplicate window at app
  // startup, so an operator who opens the site after uninstalling and taps
  // Install within a few seconds would have that install dismissed as an echo
  // and keep the session — the very case this module is for.
  return 1;
}

/**
 * Record an `appinstalled` event.
 *
 * @returns {{generation: number, isReinstall: boolean, duplicate: boolean}}
 *   `isReinstall` is the caller's cue to end the stored session.
 *
 * Fails OPEN: if the new generation cannot be persisted (quota, private mode)
 * the install is not treated as a reinstall. A storage error must not sign an
 * operator out — that failure mode is what the Aug 2026 session work removed,
 * and an un-writable counter would reintroduce it on every single launch.
 */
export function recordInstall(now = Date.now()) {
  const previous = getInstallGeneration();
  const lastInstalledAt = Number(lsGet(INSTALLED_AT_KEY));

  const isEcho =
    previous > 0 &&
    Number.isFinite(lastInstalledAt) &&
    lastInstalledAt > 0 &&
    now - lastInstalledAt >= 0 &&
    now - lastInstalledAt < DUPLICATE_INSTALL_WINDOW_MS;

  if (isEcho) {
    return { generation: previous, isReinstall: false, duplicate: true };
  }

  const generation = previous + 1;
  const persisted = lsSet(GENERATION_KEY, String(generation));
  lsSet(INSTALLED_AT_KEY, String(now));
  lsSet(LEGACY_INSTALLED_KEY, "true");

  return {
    generation: persisted ? generation : previous,
    isReinstall: persisted && generation > 1,
    duplicate: false,
  };
}
