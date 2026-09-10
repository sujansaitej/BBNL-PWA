/** @vitest-environment jsdom */
/**
 * Session teardown — who is allowed to end a session, and who is not.
 *
 * Reported Aug 2026: "the app is getting logged out frequently... once the user
 * has logged in it should not get logged out until the user logs out."
 *
 * authSession.test.jsx covers the AuthContext restore policy. This file covers
 * the two OTHER places that were ending sessions:
 *
 *   1. Header / Sidebar ran their own `localStorage.removeItem('user')`, which
 *      left AuthContext.user populated (so `isAuthenticated` stayed true until
 *      something forced a reload) and skipped the rest of SESSION_KEYS,
 *      leaking the previous operator's drafts on a shared phone.
 *   2. BrowserGate deleted the session on the `appinstalled` event — which
 *      fires on FIRST install and on re-add to home screen, not just on a
 *      reinstall. That was the "logged out when I reopen the app" half.
 *
 * The last describe block covers the OPPOSITE report, filed later: uninstall
 * the app, reinstall it, and it opens already signed in when it should ask for
 * credentials. Both reports are about the same event, which is why they live
 * together — the whole difficulty is that `appinstalled` alone cannot tell
 * "first install, leave the session alone" from "reinstall, end it", and
 * getting either direction wrong recreates the other bug. The install counter
 * in services/installGeneration.js is what separates them.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../services/iptvPrefetch", () => ({ runIptvPrefetch: () => {} }));
vi.mock("../services/prefetch", () => ({ invalidateIptvServiceStatusCache: () => {} }));
vi.mock("../services/qrAuth", () => ({
  decodeQrLoginToken: () => null,
  getNetmonLoginLink: vi.fn(),
  verifyQrLogin: vi.fn(),
}));
vi.mock("../services/generalApis", () => ({
  getWalBal: vi.fn().mockResolvedValue({ status: { err_code: 0 }, body: { wallet_balance: 0 } }),
  getCachedWalletBalance: () => null,
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

import { AuthProvider, useAuth } from "../context/AuthContext";
import { ThemeProvider } from "../ThemeContext";
import { ToastProvider } from "./ui/Toast";
import Header from "./Header";
import Sidebar from "./Sidebar";
import BrowserGate from "./BrowserGate";

// jsdom ships no matchMedia. BrowserGate and ThemeProvider both read it on
// their first render, so it has to exist before anything mounts.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

const CURRENT_SCHEMA = "2";
const USER = { username: "demopwa", firstname: "Demo", op_id: "BBNL_OP49" };

function seedSession() {
  localStorage.setItem("user", JSON.stringify(USER));
  localStorage.setItem("loginTimestamp", String(Date.now()));
  localStorage.setItem("authSchemaVersion", CURRENT_SCHEMA);
  localStorage.setItem("loginType", "franchisee");
}

/** Shows whether AuthContext still considers the session live. */
function AuthProbe() {
  const { isAuthenticated } = useAuth();
  return <div data-testid="auth">{isAuthenticated ? "in" : "out"}</div>;
}

const renderWith = (ui) =>
  render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AuthProbe />
            {ui}
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  navigate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("Header logout goes through AuthContext", () => {
  test("logging out clears the session AND flips isAuthenticated", async () => {
    seedSession();
    localStorage.setItem("register_form_draft", '{"name":"half typed"}');
    localStorage.setItem("custActiveAccount", '{"castregid":"1"}');

    renderWith(<Header onOpenSidebar={() => {}} />);
    expect(screen.getByTestId("auth").textContent).toBe("in");

    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /logout/i }));
    // Android confirms before logging out; so does this.
    fireEvent.click(screen.getByRole("button", { name: /^log out$/i }));

    // The regression: removing `user` by hand left this reading "in".
    expect(screen.getByTestId("auth").textContent).toBe("out");
    expect(localStorage.getItem("user")).toBeNull();
    // ...and left these behind for the next operator on a shared handset.
    expect(localStorage.getItem("register_form_draft")).toBeNull();
    expect(localStorage.getItem("custActiveAccount")).toBeNull();
    expect(localStorage.getItem("loginType")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  test("cancelling the confirm dialog leaves the session intact", () => {
    seedSession();
    renderWith(<Header onOpenSidebar={() => {}} />);

    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /logout/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByTestId("auth").textContent).toBe("in");
    expect(localStorage.getItem("user")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("Sidebar logout goes through AuthContext", () => {
  test("logging out clears the session AND flips isAuthenticated", () => {
    seedSession();
    renderWith(<Sidebar open={true} onClose={() => {}} />);
    expect(screen.getByTestId("auth").textContent).toBe("in");

    // Two taps now, not one. The drawer's Log out used to tear the session
    // down straight from the click while the header asked first (QA, Aug
    // 2026); it opens the same confirm dialog as the header. What this test
    // is actually about — that the teardown runs through AuthContext rather
    // than a hand-rolled localStorage.removeItem — is unchanged.
    // logoutConfirm.render.test.jsx covers the dialog itself.
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    expect(screen.getByTestId("auth").textContent).toBe("in");
    fireEvent.click(screen.getAllByRole("button", { name: /^log out$/i }).at(-1));

    expect(screen.getByTestId("auth").textContent).toBe("out");
    expect(localStorage.getItem("user")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});

describe("BrowserGate no longer ends the session on install", () => {
  test("the appinstalled event leaves a live session alone", () => {
    seedSession();
    render(
      <MemoryRouter>
        <AuthProvider>
          <BrowserGate>
            <AuthProbe />
          </BrowserGate>
        </AuthProvider>
      </MemoryRouter>
    );
    expect(screen.getByTestId("auth").textContent).toBe("in");

    // Fires on FIRST install too (browser → sign in → install). The old
    // handler deleted `user` every time, on the false premise that the event
    // only ever means "reinstalled". Nothing has been installed before here,
    // so this one is a first install and the session stands.
    act(() => { window.dispatchEvent(new Event("appinstalled")); });

    expect(localStorage.getItem("user")).toBeTruthy();
    expect(localStorage.getItem("loginTimestamp")).toBeTruthy();
    expect(localStorage.getItem("loginType")).toBe("franchisee");
    expect(screen.getByTestId("auth").textContent).toBe("in");
  });

  test("it still records the install and still drops a half-finished OTP challenge", () => {
    seedSession();
    // The OTP escrow lives in sessionStorage precisely so it cannot survive
    // into a fresh app context — that part of the handler is correct.
    sessionStorage.setItem("pendingOtpAuth", JSON.stringify({ user: USER }));

    render(
      <MemoryRouter>
        <AuthProvider>
          <BrowserGate><AuthProbe /></BrowserGate>
        </AuthProvider>
      </MemoryRouter>
    );
    act(() => { window.dispatchEvent(new Event("appinstalled")); });

    expect(localStorage.getItem("pwaInstalledOnce")).toBe("true");
    expect(sessionStorage.getItem("pendingOtpAuth")).toBeNull();
  });
});

describe("reinstalling the app DOES end the session", () => {
  /** Renders the real tree so AuthContext's own `appinstalled` listener runs. */
  function renderApp() {
    return render(
      <MemoryRouter>
        <AuthProvider>
          <BrowserGate>
            <AuthProbe />
          </BrowserGate>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  /** Makes the app look like it is running installed, for the seeding path. */
  function pretendStandalone() {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({
      ...original(query),
      matches: query.includes("standalone"),
    });
    return () => { window.matchMedia = original; };
  }

  test("install → log in → uninstall → reinstall lands on the login screen", () => {
    // The reported scenario. The first install is already on record, so the
    // install event arriving now can only be replacing a copy that was
    // removed — Chrome will not install over a live install.
    seedSession();
    localStorage.setItem("register_form_draft", '{"name":"half typed"}');
    localStorage.setItem("pwaInstallGeneration", "1");
    localStorage.setItem("pwaInstalledOnce", "true");
    localStorage.setItem("pwaInstalledAt", "1000"); // long before now

    renderApp();
    expect(screen.getByTestId("auth").textContent).toBe("in");

    act(() => { window.dispatchEvent(new Event("appinstalled")); });

    expect(screen.getByTestId("auth").textContent).toBe("out");
    expect(localStorage.getItem("user")).toBeNull();
    expect(localStorage.getItem("loginTimestamp")).toBeNull();
    // The previous operator's in-progress work goes with it — on a shared
    // handset a reinstall is exactly when someone else picks the phone up.
    expect(localStorage.getItem("register_form_draft")).toBeNull();
    // ...but the counter itself must survive its own purge, or the install
    // after this one would read as a first install all over again.
    expect(localStorage.getItem("pwaInstallGeneration")).toBe("2");
  });

  test("a device already running the installed app is counted, so its NEXT install is a reinstall", () => {
    // Covers every operator upgrading into this build: they installed under a
    // version that never wrote a generation, and without the standalone-launch
    // backfill their reinstall would still keep the session.
    const restore = pretendStandalone();
    try {
      seedSession();
      expect(localStorage.getItem("pwaInstallGeneration")).toBeNull();

      renderApp();
      // Backfilled on mount purely from "we are running installed".
      expect(localStorage.getItem("pwaInstallGeneration")).toBe("1");
      expect(screen.getByTestId("auth").textContent).toBe("in");

      act(() => { window.dispatchEvent(new Event("appinstalled")); });

      expect(screen.getByTestId("auth").textContent).toBe("out");
      expect(localStorage.getItem("user")).toBeNull();
    } finally {
      restore();
    }
  });

  test("a first install still keeps a session created moments earlier", () => {
    // Guard against over-correcting: signing this operator out is the older
    // bug, and it is one line away from the fix above.
    seedSession();

    renderApp();
    act(() => { window.dispatchEvent(new Event("appinstalled")); });

    expect(screen.getByTestId("auth").textContent).toBe("in");
    expect(localStorage.getItem("user")).toBeTruthy();
    expect(localStorage.getItem("pwaInstallGeneration")).toBe("1");
  });

  test("beforeinstallprompt after an uninstall offers Install, not the thank-you dead end", () => {
    // `pwaInstalledOnce` is origin data and outlives the uninstall, which used
    // to pin the operator on a thank-you screen with no button at the exact
    // moment they were trying to reinstall. The browser only offers this event
    // when the app is NOT installed, so it overrides the stale flag.
    //
    // BrowserGate short-circuits to `children` whenever import.meta.env.DEV is
    // true, and it is true under vitest — without this stub the gate renders
    // nothing and the test would pass or fail on the wrong thing entirely.
    vi.stubEnv("DEV", false);
    localStorage.setItem("pwaInstalledOnce", "true");

    renderApp();
    expect(screen.getByText(/Thank You for Installing/i)).toBeTruthy();

    const event = new Event("beforeinstallprompt");
    act(() => { window.dispatchEvent(event); });

    expect(screen.getByRole("button", { name: /install app/i })).toBeTruthy();
  });
});
