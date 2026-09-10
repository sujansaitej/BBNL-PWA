/**
 * Install-generation counting — the only thing standing between "uninstall,
 * reinstall, and you are still signed in as the previous operator" and the
 * login screen the reinstall is supposed to produce.
 *
 * Two failure modes are being guarded against at once, and they pull in
 * opposite directions:
 *
 *   • Too lax  — a reinstall is read as a first install, the session survives,
 *                and the Aug 2026 report ("it should have asked me to log in")
 *                stands.
 *   • Too eager — a first install is read as a reinstall and signs out an
 *                operator who just signed in inside Chrome, which is the
 *                previous BrowserGate bug being re-created.
 *
 * Every test below pins one side or the other.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordInstall,
  seedInstallGeneration,
  getInstallGeneration,
  isStandaloneDisplay,
  DUPLICATE_INSTALL_WINDOW_MS,
} from "./installGeneration";

/** Drive display-mode without jsdom; the module reads these two lazily. */
function setDisplayMode(standalone) {
  globalThis.window = {
    navigator: {},
    matchMedia: (q) => ({ matches: standalone && q.includes("standalone") }),
  };
}

beforeEach(() => {
  localStorage.clear();
  setDisplayMode(false);
});

afterEach(() => {
  delete globalThis.window;
});

describe("first install", () => {
  test("a browser-tab visitor who installs is generation 1, not a reinstall", () => {
    // The exact path the previous handler broke: open the site in Chrome,
    // sign in, then install. Nothing was uninstalled, so nothing is stale.
    expect(getInstallGeneration()).toBe(0);
    expect(seedInstallGeneration()).toBe(0); // a tab is not an install

    const result = recordInstall();

    expect(result).toMatchObject({ generation: 1, isReinstall: false });
    expect(getInstallGeneration()).toBe(1);
  });
});

describe("reinstall", () => {
  test("installing again after an install already exists is a reinstall", () => {
    recordInstall(1_000);              // install #1
    const again = recordInstall(500_000); // uninstall happened in between

    expect(again).toMatchObject({ generation: 2, isReinstall: true });
  });

  test("a QA-speed uninstall/reinstall still counts", () => {
    // The tester who filed this reproduces it in under a minute. A duplicate
    // window wide enough to swallow that would make the fix untestable by the
    // only person testing it.
    const first = 1_000;
    const second = first + DUPLICATE_INSTALL_WINDOW_MS + 1;

    recordInstall(first);
    expect(recordInstall(second)).toMatchObject({ generation: 2, isReinstall: true });
  });

  test("every later reinstall keeps counting", () => {
    recordInstall(0);
    recordInstall(100_000);
    expect(recordInstall(200_000)).toMatchObject({ generation: 3, isReinstall: true });
  });
});

describe("duplicate appinstalled events", () => {
  test("an echo of the same install does not count as a reinstall", () => {
    recordInstall(1_000);
    const echo = recordInstall(1_000 + DUPLICATE_INSTALL_WINDOW_MS - 1);

    expect(echo).toMatchObject({ generation: 1, isReinstall: false, duplicate: true });
    expect(getInstallGeneration()).toBe(1);
  });

  test("an echo of the FIRST install cannot promote it to a reinstall", () => {
    // Regression shape: if the echo guard only ran for generation >= 2, a
    // double-fired first install would land on generation 2 and sign out an
    // operator who never uninstalled anything.
    recordInstall(1_000);
    recordInstall(1_100);
    recordInstall(1_200);

    expect(getInstallGeneration()).toBe(1);
  });
});

describe("seeding devices that predate the counter", () => {
  test("a running installed app is backfilled to generation 1", () => {
    // Without this, everyone already on the old build sits at 0, their next
    // reinstall reads as a first install, and the bug outlives its own fix.
    setDisplayMode(true);

    expect(seedInstallGeneration()).toBe(1);
    expect(recordInstall(999_999)).toMatchObject({ generation: 2, isReinstall: true });
  });

  test("the legacy pwaInstalledOnce flag seeds it too", () => {
    // Set by BrowserGate on every install since long before generations, so
    // it covers devices that are currently viewing in a tab but have the app
    // installed elsewhere on the phone.
    localStorage.setItem("pwaInstalledOnce", "true");

    expect(seedInstallGeneration()).toBe(1);
  });

  test("seeding never invents an install for a first-time visitor", () => {
    expect(seedInstallGeneration()).toBe(0);
    expect(localStorage.getItem("pwaInstallGeneration")).toBeNull();
  });

  test("seeding is idempotent and never rewinds a real count", () => {
    recordInstall(0);
    recordInstall(100_000); // generation 2
    setDisplayMode(true);

    expect(seedInstallGeneration()).toBe(2);
    expect(getInstallGeneration()).toBe(2);
  });
});

describe("storage failures fail open", () => {
  test("an unwritable counter reports no reinstall rather than signing out", () => {
    // A quota error must never end a session — that is the failure mode the
    // Aug 2026 session work removed, and a counter that throws on every
    // launch would bring it straight back.
    localStorage.setItem("pwaInstallGeneration", "1");
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(recordInstall(999_999)).toMatchObject({ generation: 1, isReinstall: false });

    setItem.mockRestore();
  });

  test("a corrupt counter value is treated as no count, not as a reinstall", () => {
    localStorage.setItem("pwaInstallGeneration", "not-a-number");

    expect(getInstallGeneration()).toBe(0);
    expect(recordInstall(999_999)).toMatchObject({ generation: 1, isReinstall: false });
  });
});

describe("isStandaloneDisplay", () => {
  test("reads display-mode and the iOS navigator.standalone flag", () => {
    setDisplayMode(false);
    expect(isStandaloneDisplay()).toBe(false);

    setDisplayMode(true);
    expect(isStandaloneDisplay()).toBe(true);

    globalThis.window = { navigator: { standalone: true } }; // iOS, no matchMedia
    expect(isStandaloneDisplay()).toBe(true);
  });
});
