/** @vitest-environment jsdom */
/**
 * The header's 3-dot menu is shared — its contents are not.
 *
 * QA, Aug 2026: "Scan to Login, Login to Netmon should not be displayed for
 * Customer."
 *
 * There is one Header (layout/Layout.jsx renders it for both portals), so
 * every item in this menu was offered to customers too. Those two are halves
 * of operator SSO into the netmon back-office: both post to
 * QrcodeAuthentication with `reference` = the signed-in OPERATOR's username.
 * For a customer they cannot succeed — "Scan To Login" opens the camera before
 * failing, and "Login To Netmon" opens a blank tab pointed at a console they
 * have no account on.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => vi.fn(),
}));
vi.mock("../services/qrAuth", () => ({
  decodeQrLoginToken: () => "",
  getNetmonLoginLink: vi.fn(),
  verifyQrLogin: vi.fn(),
}));
vi.mock("../services/safeStorage", () => ({ getUser: () => ({ username: "someone" }) }));

import { ToastProvider } from "./ui/Toast";
import { ThemeContext } from "../ThemeContext.jsx";
import Header from "./Header";

const theme = { theme: "light", toggleTheme: () => {} };

function openMenuAs(loginType) {
  if (loginType) localStorage.setItem("loginType", loginType);
  render(
    <MemoryRouter>
      <ThemeContext.Provider value={theme}>
        <ToastProvider><Header onOpenSidebar={() => {}} /></ToastProvider>
      </ThemeContext.Provider>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: /more options/i }));
  return screen.getAllByRole("menuitem").map((b) => b.textContent.trim());
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("a customer", () => {
  test("is not offered the operator SSO tools", () => {
    const items = openMenuAs("customer");
    expect(items).not.toContain("Scan To Login");
    expect(items).not.toContain("Login To Netmon");
  });

  test("still gets the items that are theirs", () => {
    const items = openMenuAs("customer");
    expect(items).toContain("Notification History");
    expect(items).toContain("Logout");
  });

  // Hiding the entry has to hide the ACTION, not just the label — a menu that
  // renders nothing but still leaves a reachable handler is not scoped.
  test("the menu has no other entries", () => {
    expect(openMenuAs("customer")).toEqual(["Notification History", "Logout"]);
  });
});

describe("an operator", () => {
  test.each([["franchisee"], [null]])("keeps both SSO tools (loginType %s)", (loginType) => {
    const items = openMenuAs(loginType);
    expect(items).toContain("Scan To Login");
    expect(items).toContain("Login To Netmon");
    expect(items).toContain("Logout");
  });
});
