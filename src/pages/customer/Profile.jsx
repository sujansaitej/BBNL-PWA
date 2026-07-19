import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ChevronLeftIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { fixImageUrl } from "../../services/iptvImage";
import { getProfile, editProfile } from "../../services/customer/profile";

/**
 * Customer profile — port of Android's ProfileFragment.
 *
 * Same four editable fields (first name, last name, mobile, email) and the
 * same read-only username. The avatar is display-only: the customer app
 * offers no way to change it, so neither do we. Android's per-field pencil
 * icons are decorative there (no listeners) so they aren't reproduced.
 *
 * Android does no validation beyond a dirty-check; we keep the dirty-check
 * and add mobile/email format checks, since a bad value here silently
 * breaks OTP login and billing mail.
 */
export default function Profile() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const toast = useToast();
  const username = JSON.parse(localStorage.getItem("user") || "{}").username || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState("");
  const [saved, setSaved] = useState(null); // last known server state, for the dirty-check
  const [form, setForm] = useState({ firstname: "", lastname: "", mobileno: "", emailid: "" });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const b = await getProfile(username);
      const next = {
        firstname: b.firstname || "",
        lastname: b.lastname || "",
        mobileno: b.mobileno || "",
        emailid: b.emailid || "",
      };
      setForm(next);
      setSaved(next);
      setPhoto(b.photo || "");
    } catch (err) {
      setError(err?.message || "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!username) {
      setError("You are not signed in.");
      setLoading(false);
      return;
    }
    load();
  }, [username]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const dirty = saved && Object.keys(form).some((k) => form[k].trim() !== saved[k]);

  const save = async () => {
    if (!dirty) {
      toast.add("No changes made.", { type: "info" });
      return;
    }
    if (!/^\d{10}$/.test(form.mobileno.trim())) {
      toast.add("Enter a valid 10-digit mobile number.", { type: "error" });
      return;
    }
    if (form.emailid.trim() && !/^\S+@\S+\.\S+$/.test(form.emailid.trim())) {
      toast.add("Enter a valid email address.", { type: "error" });
      return;
    }
    setSaving(true);
    try {
      const res = await editProfile({
        username,
        firstname: form.firstname.trim(),
        lastname: form.lastname.trim(),
        mobileno: form.mobileno.trim(),
        emailid: form.emailid.trim(),
      });
      toast.add(res?.status?.err_msg || "Profile updated.", { type: "success" });
      await load(); // Android re-fetches after a successful save
    } catch (err) {
      toast.add(err?.message || "Could not save your profile.", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, props = {}) => (
    <div>
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      <input
        value={form[key]}
        onChange={set(key)}
        className="mt-1 w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        {...props}
      />
    </div>
  );

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate("/cust/dashboard")}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Dashboard
        </button>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading profile…" />
          </div>
        ) : error ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
            <button onClick={load} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Avatar — display only, same as the customer app */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-24 h-24 rounded-full overflow-hidden bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
                {photo ? (
                  <img src={fixImageUrl(photo)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <UserCircleIcon className="w-16 h-16 text-indigo-600 dark:text-indigo-300" />
                )}
              </div>
              <p className="text-base font-semibold text-gray-800 dark:text-gray-100">{username}</p>
            </div>

            {/* Editable fields */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
              {field("First name", "firstname", { placeholder: "First name", autoComplete: "given-name" })}
              {field("Last name", "lastname", { placeholder: "Last name", autoComplete: "family-name" })}
              {field("Mobile", "mobileno", {
                placeholder: "Mobile",
                type: "tel",
                inputMode: "numeric",
                maxLength: 10,
                autoComplete: "tel",
              })}
              {field("Email", "emailid", { placeholder: "Email id", type: "email", autoComplete: "email" })}

              <button
                onClick={save}
                disabled={saving}
                className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Please wait…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
