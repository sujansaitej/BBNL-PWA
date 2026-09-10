import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import BrandLogo from "../../components/BrandLogo";
import { FloatingInput } from "@/components/ui";
import {
  registerCustomer,
  validateSignUp,
  fieldForServerError,
  SIGNUP_LIMITS,
} from "../../services/customer/registration";

/**
 * Customer self sign-up — the "New Connection" funnel.
 *
 * 1:1 with the Android customer flavour's RegistrationActivity, reached from
 * LoginActivity's "Sign Up" link. Same eight fields, same single screen, no OTP
 * and no auto-login. Android hardcodes latitude/longitude to "" because the
 * form has no map, and so does this.
 *
 * TWO DELIBERATE DIFFERENCES FROM ANDROID, both about not losing information:
 *
 * 1. Android validates with a nine-deep nested if and Toasts one message at a
 *    time, so the customer discovers one broken field per attempt. This
 *    validates every field at once and shows the errors inline.
 *
 * 2. The backend returns only its FIRST error (`$error[0]`), and Android shows
 *    it in a Toast that disappears. Here it is mapped back onto the field it
 *    belongs to — uniqueness failures on username / mobile / email are
 *    server-only, so that is the one class of error the customer cannot be
 *    warned about in advance.
 *
 * On success Android does `finish()` back to LoginActivity with a Toast. We go
 * to the same destination but hand the message over as router state, so the
 * login screen can show it instead of it vanishing.
 */
export default function SignUp() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    firstname: "", lastname: "", mobileno: "", emailid: "",
    username: "", password: "", address: "", pincode: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const set = (name) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [name]: value }));
    // Clear the field's error as soon as it is edited — leaving a stale
    // message under a field the customer has already fixed reads as a bug.
    setErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
    setFormError("");
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const found = validateSignUp(form);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setErrors({});
    setFormError("");
    setSubmitting(true);

    try {
      const { ok, message } = await registerCustomer(form);
      if (ok) {
        navigate("/login", { replace: true, state: { signupMessage: message } });
        return;
      }
      // One message, possibly about a specific field.
      const field = fieldForServerError(message);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    } catch (err) {
      setFormError(err?.message || "Could not create the account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 px-4 py-8 pt-safe pb-safe">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8">
        <div className="flex justify-center mb-6">
          <BrandLogo className="h-12 w-auto max-w-[224px] object-contain" alt="App Logo" />
        </div>

        <h2 className="text-center text-2xl font-extrabold text-gray-900 dark:text-white mb-2">
          Create your account
        </h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-6">
          Sign up for a new connection
        </p>

        {formError && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs"
          >
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <FloatingInput
            label="First Name" name="firstname" value={form.firstname}
            onChange={set("firstname")} error={errors.firstname} onlyLetters required
          />
          <FloatingInput
            label="Last Name" name="lastname" value={form.lastname}
            onChange={set("lastname")} error={errors.lastname} onlyLetters required
          />
          <FloatingInput
            label="Mobile Number" name="mobileno" type="tel" value={form.mobileno}
            len={SIGNUP_LIMITS.mobileLength} onChange={set("mobileno")}
            error={errors.mobileno} onlyNumbers required
          />
          <FloatingInput
            label="Email ID" name="emailid" type="email" value={form.emailid}
            onChange={set("emailid")} error={errors.emailid} required
          />
          <FloatingInput
            label="Address" name="address" value={form.address}
            onChange={set("address")} error={errors.address} required
          />
          <FloatingInput
            label="Pincode" name="pincode" type="tel" value={form.pincode}
            len={SIGNUP_LIMITS.pincodeLength} onChange={set("pincode")}
            error={errors.pincode} onlyNumbers required
          />
          <FloatingInput
            label="Username" name="username" cls="lowercase" value={form.username}
            onChange={set("username")} error={errors.username} required
          />
          <FloatingInput
            label="Password" name="password" type="password" value={form.password}
            onChange={set("password")} error={errors.password} required
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            At least {SIGNUP_LIMITS.passwordMin} characters. Cannot contain
            {" "}<span className="font-mono">&quot; ~ + | {"{ }"} [ ] ; &apos;</span>
          </p>

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors ${
              submitting ? "opacity-60 cursor-not-allowed" : ""
            }`}
          >
            {submitting ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
            Sign in
          </Link>
        </p>

        <Link
          to="/login"
          className="mt-4 flex items-center justify-center gap-1 text-sm text-gray-500 dark:text-gray-400"
        >
          <ChevronLeftIcon className="h-4 w-4" /> Back
        </Link>
      </div>
    </div>
  );
}
