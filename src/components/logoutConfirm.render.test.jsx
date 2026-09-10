/** @vitest-environment jsdom */
/**
 * Logging out always asks first.
 *
 * QA, Aug 2026: "click the three dots on the right side and select Logout —
 * a logout confirmation popup is displayed. However, when clicking Logout
 * directly from the menu, the confirmation popup does not appear."
 *
 * Two doors led to the same destructive action and only one was guarded. The
 * header's 3-dot menu opened a confirm; the navigation drawer called logout()
 * straight out of the click handler — twice, once in the franchise branch and
 * once in the customer branch, so BOTH portals could end a session on a single
 * mis-tap with no way back.
 *
 * These tests assert the guard behaviourally rather than by reading the JSX,
 * because the thing that matters is that the session survives the first tap.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const endSession = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ logout: endSession }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

vi.mock("../services/generalApis", () => ({
  getWalBal: vi.fn().mockResolvedValue({ status: { err_code: 0 }, body: { wallet_balance: 0 } }),
  getCachedWalletBalance: () => null,
}));

vi.mock("../services/qrAuth", () => ({
  decodeQrLoginToken: () => "",
  getNetmonLoginLink: vi.fn(),
  verifyQrLogin: vi.fn(),
}));

vi.mock("../services/safeStorage", () => ({ getUser: () => ({ username: "superadmin" }) }));

import { ToastProvider } from "./ui/Toast";
import { ThemeContext } from "../ThemeContext.jsx";
import Sidebar from "./Sidebar";
import Header from "./Header";

const theme = { theme: "light", toggleTheme: () => {} };

// Header renders a <Link>, and Sidebar reads the theme toggle — both need a
// provider before either can be clicked.
const Providers = ({ children }) => (
  <MemoryRouter>
    <ThemeContext.Provider value={theme}>
      <ToastProvider>{children}</ToastProvider>
    </ThemeContext.Provider>
  </MemoryRouter>
);

const wrap = (ui) => render(<Providers>{ui}</Providers>);

/** The confirm dialog, identified by its question rather than its markup. */
const confirmDialog = () => screen.queryByText(/are you sure you want to log out/i);

/** The "Log out" that ENDS the session, not the one that opens the dialog. */
const confirmButton = () => {
  const dialog = confirmDialog().closest("div").parentElement;
  return within(dialog).getByRole("button", { name: /^log out$/i });
};

beforeEach(() => {
  localStorage.clear();
  endSession.mockClear();
  navigate.mockClear();
});
afterEach(cleanup);

describe.each([
  ["franchise", null],
  ["customer", "customer"],
])("the navigation drawer — %s", (_label, loginType) => {
  beforeEach(() => {
    if (loginType) localStorage.setItem("loginType", loginType);
  });

  test("the first tap on Log out asks instead of ending the session", () => {
    wrap(<Sidebar open onClose={() => {}} />);
    expect(confirmDialog()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /log out/i }));

    expect(confirmDialog()).not.toBeNull();
    // THE REGRESSION: this used to be 1 — the session was already gone.
    expect(endSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("Cancel leaves the operator signed in", () => {
    wrap(<Sidebar open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(confirmDialog()).toBeNull();
    expect(endSession).not.toHaveBeenCalled();
  });

  test("confirming actually logs out, through AuthContext", () => {
    wrap(<Sidebar open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    fireEvent.click(confirmButton());

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  // The drawer closes itself on the way to the dialog (onClose fires in the
  // same handler). The dialog is rendered OUTSIDE the drawer for exactly that
  // reason — inside it, closing the drawer would take the question with it.
  test("the dialog survives the drawer closing underneath it", () => {
    const onClose = vi.fn();
    const { rerender } = wrap(<Sidebar open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    expect(onClose).toHaveBeenCalled();

    rerender(<Providers><Sidebar open={false} onClose={onClose} /></Providers>);
    expect(confirmDialog()).not.toBeNull();
  });
});

// The door that was already guarded — kept so the two cannot drift apart
// again, which is how one of them ended up unguarded in the first place.
describe("the header's 3-dot menu", () => {
  test("still asks before logging out", () => {
    wrap(<Header onOpenSidebar={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /logout/i }));

    expect(confirmDialog()).not.toBeNull();
    expect(endSession).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    expect(endSession).toHaveBeenCalledTimes(1);
  });
});
