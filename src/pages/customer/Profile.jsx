import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ChevronLeftIcon, UserCircleIcon, CameraIcon } from "@heroicons/react/24/outline";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { fixImageUrl } from "../../services/iptvImage";
import { getProfile, editProfile, uploadProfilePhoto } from "../../services/customer/profile";
import { isDirty } from "./profileDirty";

/**
 * Customer profile — port of Android's ProfileFragment.
 *
 * Same four editable fields (first name, last name, mobile, email), same
 * read-only username, same tap-avatar-to-upload. Android's per-field pencil
 * icons are decorative there (no listeners) so they aren't reproduced.
 *
 * Deliberately as permissive as Android: the ONLY client-side check is the
 * dirty-check, values are sent untrimmed, and every outcome is the server's
 * own err_msg. Don't add format validation here without adding it to the
 * app too — the two must accept exactly the same input.
 *
 * Like Android, a successful save updates ONLY the login-account record
 * (custeEditProfile). The name/mobile shown on service screens comes from
 * the separate linked-subscriber record, which no customer-side endpoint
 * can edit. That divergence is native behaviour, not a bug here.
 */
export default function Profile() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);
  const username = JSON.parse(localStorage.getItem("user") || "{}").username || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState("");
  // Android renders body.username, not the cached login value.
  const [shownUsername, setShownUsername] = useState(username);
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
      setShownUsername(b.username || username);
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

  const save = async () => {
    if (!isDirty(form, saved)) {
      toast.add("No changes made!", { type: "info" });
      return;
    }
    setSaving(true);
    try {
      const res = await editProfile({ username, ...form });
      toast.add(res?.status?.err_msg || "Profile updated.", { type: "success" });
      await load(); // Android re-fetches after a successful save
    } catch (err) {
      toast.add(err?.message || "Could not save your profile.", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.add("Please choose an image under 5 MB.", { type: "error" });
      return;
    }
    setUploading(true);
    try {
      const url = await uploadProfilePhoto({ username, file });
      // Android disables image caching entirely; a cache-buster is enough here.
      setPhoto(url ? `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}` : "");
      toast.add("Photo updated.", { type: "success" });
    } catch (err) {
      toast.add(err?.message || "Could not upload the photo.", { type: "error" });
    } finally {
      setUploading(false);
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
            {/* Avatar */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="relative w-24 h-24 rounded-full overflow-hidden bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center"
                aria-label="Change profile photo"
              >
                {photo ? (
                  <img src={fixImageUrl(photo)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <UserCircleIcon className="w-16 h-16 text-indigo-600 dark:text-indigo-300" />
                )}
                <span className="absolute bottom-0 inset-x-0 py-1 bg-black/50 flex justify-center">
                  {uploading ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CameraIcon className="w-4 h-4 text-white" />
                  )}
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
              <p className="text-base font-semibold text-gray-800 dark:text-gray-100">{shownUsername}</p>
            </div>

            {/* Editable fields */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
              {field("First name", "firstname", { placeholder: "First name", autoComplete: "given-name" })}
              {field("Last name", "lastname", { placeholder: "Last name", autoComplete: "family-name" })}
              {/* No maxLength/pattern — Android accepts any text here. */}
              {field("Mobile", "mobileno", { placeholder: "Mobile", type: "tel", autoComplete: "tel" })}
              {field("Email", "emailid", { placeholder: "Email id", type: "email", autoComplete: "email" })}

              <button
                onClick={save}
                disabled={saving || uploading}
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
