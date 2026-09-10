/** @vitest-environment jsdom */
/**
 * The sign-up screen, and the route that reaches it.
 *
 * "New Connection" for customers = self sign-up, ported from the Android
 * customer flavour: LoginActivity's "Sign Up" link -> RegistrationActivity ->
 * POST ServiceApis/custRegistration -> back to the login screen.
 *
 * Two things here are easy to get wrong and impossible to see in a unit test of
 * the service alone:
 *
 *  - The route must be PUBLIC. Every other route in this app is PrivateRoute or
 *    OtpRoute, so the default instinct is to guard it — which would make the
 *    screen unreachable by exactly the people it exists for.
 *  - The link must appear on the CUSTOMER tab only. Franchisees are created by
 *    BBNL, and the Android operator flavour has no self-registration at all.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const registerCustomer = vi.fn();
vi.mock("../../services/customer/registration", async (orig) => ({
  ...(await orig()),
  registerCustomer: (...a) => registerCustomer(...a),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

import SignUp from "./SignUp";
import PublicRoute from "../../routes/PublicRoute";

const mount = () => render(<MemoryRouter><SignUp /></MemoryRouter>);

const fill = (label, value) =>
  fireEvent.change(screen.getByLabelText(new RegExp(label, "i")), { target: { value } });

const fillValidForm = () => {
  fill("First Name", "Asha");
  fill("Last Name", "Rao");
  fill("Mobile Number", "9000000001");
  fill("Email ID", "asha@example.com");
  fill("Address", "12 Main Road");
  fill("Pincode", "560001");
  fill("Username", "asharao");
  fill("Password", "Passw0rd1");
};

const submit = () => fireEvent.click(screen.getByRole("button", { name: /create account/i }));

beforeEach(() => {
  localStorage.clear();
  navigate.mockClear();
  registerCustomer.mockReset().mockResolvedValue({ ok: true, message: "Registration successful." });
});
afterEach(cleanup);

describe("the form collects exactly what Android collects", () => {
  test("all eight fields are present", () => {
    mount();
    for (const label of [
      "First Name", "Last Name", "Mobile Number", "Email ID",
      "Address", "Pincode", "Username", "Password",
    ]) {
      expect(screen.getByLabelText(new RegExp(label, "i")), label).toBeTruthy();
    }
  });

  test("a valid form submits the collected values", async () => {
    mount();
    fillValidForm();
    submit();
    await waitFor(() => expect(registerCustomer).toHaveBeenCalled());
    expect(registerCustomer).toHaveBeenCalledWith(expect.objectContaining({
      firstname: "Asha", lastname: "Rao", mobileno: "9000000001",
      emailid: "asha@example.com", username: "asharao",
      password: "Passw0rd1", address: "12 Main Road", pincode: "560001",
    }));
  });
});

describe("nothing is sent until the form is valid", () => {
  test("an empty submit shows errors and calls no API", async () => {
    mount();
    submit();
    await waitFor(() => expect(screen.getByText(/first name is required/i)).toBeTruthy());
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  // Android surfaces one Toast at a time, so the customer discovers one broken
  // field per attempt. This shows them together.
  test("every broken field is reported at once", async () => {
    mount();
    fillValidForm();
    fill("Username", "ab");
    fill("Password", "short");
    submit();
    // "should be at least" and not just "at least" — the password hint text
    // under the field says "At least 8 characters" too, so the looser pattern
    // matches the help text and the error indistinguishably.
    await waitFor(() => expect(screen.getByText(/should be at least 5 characters/i)).toBeTruthy());
    expect(screen.getByText(/should be at least 8 characters/i)).toBeTruthy();
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  test("editing a field clears its error", async () => {
    mount();
    submit();
    await waitFor(() => expect(screen.getByText(/first name is required/i)).toBeTruthy());
    fill("First Name", "Asha");
    expect(screen.queryByText(/first name is required/i)).toBeNull();
  });
});

describe("the server's answer reaches the customer", () => {
  // Android finish()es back to LoginActivity with a Toast. Same destination,
  // but the message travels as router state so it survives the redirect.
  test("success returns to login and carries the message across", async () => {
    mount();
    fillValidForm();
    submit();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/login", {
      replace: true,
      state: { signupMessage: "Registration successful." },
    });
  });

  // The one class of failure the client cannot predict — it must land under the
  // input, not only in a banner the customer has to map back to a field.
  test("a uniqueness failure is shown under the field it concerns", async () => {
    registerCustomer.mockResolvedValue({ ok: false, message: "Username already exists, enter different username." });
    mount();
    fillValidForm();
    submit();
    await waitFor(() => expect(screen.getByText(/username already exists/i)).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
  });

  test("an unrecognised failure is shown as a form-level alert", async () => {
    registerCustomer.mockResolvedValue({ ok: false, message: "Something unexpected happened" });
    mount();
    fillValidForm();
    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/something unexpected/i);
  });

  test("a thrown transport error does not strand the button in 'creating'", async () => {
    registerCustomer.mockRejectedValue(new Error("Network error"));
    mount();
    fillValidForm();
    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
  });
});

describe("the route is public", () => {
  const authed = (isAuthenticated) => {
    vi.doMock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthenticated }) }));
  };

  test("a signed-out visitor gets through — this is the whole point", async () => {
    vi.resetModules();
    authed(false);
    const { default: Route } = await import("../../routes/PublicRoute");
    render(<MemoryRouter><Route><p>signup form</p></Route></MemoryRouter>);
    expect(screen.getByText("signup form")).toBeTruthy();
  });

  // A signed-in customer landing here from a bookmark or the back button must
  // not be offered an account-creation form while holding a session.
  test("a signed-in visitor is sent to the dashboard instead", async () => {
    vi.resetModules();
    authed(true);
    const { default: Route } = await import("../../routes/PublicRoute");
    render(<MemoryRouter><Route><p>signup form</p></Route></MemoryRouter>);
    expect(screen.queryByText("signup form")).toBeNull();
  });

  test("PublicRoute is the wrapper actually used for /signup", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const routes = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../routes/Routes.jsx"),
      "utf8"
    );
    expect(routes).toMatch(/path="\/signup"[\s\S]{0,160}<PublicRoute>/);
    expect(routes).not.toMatch(/path="\/signup"[\s\S]{0,160}<PrivateRoute>/);
  });
});

// PublicRoute is imported at the top purely so an unused-import lint would
// flag a rename; the behavioural checks above use the dynamic import so they
// can vary the auth state.
expect(PublicRoute).toBeTypeOf("function");
