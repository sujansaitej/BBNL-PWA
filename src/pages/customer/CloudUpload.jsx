import { useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { serviceRouteBase, serviceTitle } from "../../services/customer/serviceHome";
import {
  uploadImagesToCloud,
  partitionFiles,
  formatSize,
  MAX_FILES,
  MAX_FILE_BYTES,
} from "../../services/customer/cloudUpload";
import {
  ChevronLeftIcon,
  CloudArrowUpIcon,
  PhotoIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";

/**
 * FO-Fi Cloud — port of Android's UploadImagesToCloudStorage fragment.
 *
 * Reached from the cloud icon on the box selector bar of the service home
 * screen (fofi / cabletv only, exactly as Android gates it). The selected box
 * arrives in navigation state; there is no route param, so landing here
 * without one sends the customer back to pick a box.
 *
 * Android uploads straight off the gallery picker — no review step. That is
 * fine with a native multi-select that shows thumbnails as you tap them; in a
 * browser the file input hands back a silent list, so the picked files are
 * listed here for review and the customer presses Upload. It also means a
 * mis-tap can be undone before spending an upload of up to 20 originals.
 */
export default function CloudUpload() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const { state } = useLocation();
  const toast = useToast();
  const account = getActiveAccount();

  const servicekey = account?.servicekey || "fofi";
  const userId = account?.userid || "";
  const routeBase = serviceRouteBase(servicekey);

  // The box comes from ServiceHome's selector. `serialno` is what the API
  // wants as mac_address; `boxid` is only ever shown to the customer.
  const boxid = state?.boxid || "";
  const serialno = state?.serialno || "";
  const primary = state?.primary !== false;
  // Missing state (deep link / reload) is treated as eligible: the backend is
  // still the final judge and the toast below names the cause.
  const eligibility = state?.eligibility || { ok: true, reason: "" };

  const fileRef = useRef(null);
  const [picked, setPicked] = useState([]);   // File[]
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, rows, succeeded, failed }

  const totalBytes = useMemo(
    () => picked.reduce((sum, f) => sum + (f.size || 0), 0),
    [picked]
  );

  const onPick = (e) => {
    const { accepted, rejected, overflow } = partitionFiles(e.target.files);

    // Let the same file be picked twice in a row (browser fires no change
    // event otherwise), and never carry a stale selection into the next pick.
    e.target.value = "";

    if (rejected.length) {
      toast.add(
        rejected.length === 1
          ? `${rejected[0].file.name}: ${rejected[0].reason}`
          : `${rejected.length} files skipped — only JPG and PNG can be uploaded.`,
        { type: "error" }
      );
    }
    if (overflow.length) {
      toast.add(`Only ${MAX_FILES} images can be uploaded at a time.`, { type: "error" });
    }
    if (!accepted.length) return;

    setResult(null);
    setPicked(accepted);
  };

  const removeAt = (i) => setPicked((prev) => prev.filter((_, idx) => idx !== i));

  const upload = async () => {
    if (!picked.length) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await uploadImagesToCloud({ cid: userId, macAddress: serialno, files: picked });
      setResult(res);
      if (res.ok) {
        setPicked([]);
        toast.add(`${res.succeeded} image${res.succeeded === 1 ? "" : "s"} uploaded.`, {
          type: "success",
        });
      } else if (res.succeeded > 0) {
        // Partial success. Keep only the files that failed so a retry does not
        // re-send — and re-charge the customer's connection for — the ones
        // that already landed.
        const failedNames = new Set(
          res.rows
            .filter((r) => String(r.status).toLowerCase() !== "success")
            .map((r) => r.filename)
        );
        setPicked((prev) => prev.filter((f) => failedNames.has(f.name)));
        toast.add(`${res.succeeded} uploaded, ${res.failed} failed.`, { type: "error" });
      } else {
        // Nothing landed. The backend says "Invalid User ID" for a secondary
        // box no matter what was sent, which reads as an account problem —
        // name the real cause.
        const invalidUser = /invalid user/i.test(res.message);
        toast.add(
          invalidUser && !eligibility.ok
            ? eligibility.reason
            : invalidUser && !primary
              ? "This is a linked box. Photos can only be uploaded to your primary box."
              : res.message || "Upload failed. Please try again.",
          { type: "error" }
        );
      }
    } catch (err) {
      toast.add(err?.message || "Upload failed. Please try again.", { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // No box carried in — ServiceHome is the only entry point.
  if (!account?.userid || !serialno) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <PhotoIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Choose a box first to upload photos to its album.
          </p>
          <button
            onClick={() => navigate(`${routeBase}/home`)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
          >
            Go to {serviceTitle(servicekey)}
          </button>
        </div>
      </Layout>
    );
  }

  // A device that can never receive an upload gets an explanation, not a
  // picker that ends in "Invalid User ID".
  if (!eligibility.ok) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <CloudArrowUpIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            No photo album for {boxid || serialno}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{eligibility.reason}</p>
          <button
            onClick={() => navigate(`${routeBase}/home`)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
          >
            Back to {serviceTitle(servicekey)}
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate(`${routeBase}/home`)}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Back
        </button>

        {/* Header — which album these photos land in */}
        <div className="rounded-xl shadow overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-3">
            <p className="text-white font-semibold">FO-Fi Cloud</p>
            <p className="text-xs text-white/80 mt-0.5 break-words">
              Photo album for {boxid || serialno}
            </p>
          </div>
        </div>

        {!primary && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
            This is a linked box. The cloud album belongs to your primary box, so
            uploads here will be rejected.
          </div>
        )}

        {/* Picker */}
        <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-6 text-center">
          <CloudArrowUpIcon className="w-14 h-14 mx-auto text-indigo-500 dark:text-indigo-400" />
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Select {MAX_FILES} or fewer images at a time
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            JPG and PNG only, up to {formatSize(MAX_FILE_BYTES)} each
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            multiple
            onChange={onPick}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="mt-4 px-5 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {picked.length ? "Change Selection" : "Select Images"}
          </button>
        </div>

        {/* Review before sending */}
        {picked.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {picked.length} image{picked.length === 1 ? "" : "s"} selected
              </p>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatSize(totalBytes)}
              </span>
            </div>

            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {picked.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 py-2">
                  <PhotoIcon className="w-5 h-5 flex-shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="flex-1 min-w-0 truncate text-sm text-gray-700 dark:text-gray-300">
                    {f.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {formatSize(f.size)}
                  </span>
                  <button
                    onClick={() => removeAt(i)}
                    disabled={busy}
                    aria-label={`Remove ${f.name}`}
                    className="p-1 rounded text-gray-400 hover:text-red-500 disabled:opacity-50"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>

            <button
              onClick={upload}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Uploading…" : `Upload ${picked.length} image${picked.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {busy && (
          <div className="py-4 flex justify-center">
            {/* Large originals over a mobile uplink take a while, and the
                backend forwards each file onward before it answers — say so,
                or the customer assumes it hung and navigates away mid-upload. */}
            <Loader size="sm" color="indigo" text="Uploading — please keep this screen open…" />
          </div>
        )}

        {/* Per-file outcome — shown for partial failures too, which is
            precisely when Android shows nothing. */}
        {result && result.rows.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Upload result
            </p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {result.rows.map((r, i) => {
                const ok = String(r.status).toLowerCase() === "success";
                return (
                  <li key={`${r.filename}-${i}`} className="flex items-center gap-2 py-2">
                    <span className="flex-1 min-w-0 truncate text-sm text-gray-700 dark:text-gray-300">
                      {r.filename}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {r.filesize}
                    </span>
                    {ok ? (
                      <CheckCircleIcon className="w-5 h-5 flex-shrink-0 text-emerald-500" />
                    ) : (
                      <ExclamationCircleIcon className="w-5 h-5 flex-shrink-0 text-red-500" />
                    )}
                  </li>
                );
              })}
            </ul>
            {result.message && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{result.message}</p>
            )}
          </div>
        )}

        {/* err_code 1 with an empty body — auth, missing fields, unknown box.
            There is no per-file list to show, so show the reason. */}
        {result && result.rows.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            {result.message || "Nothing was uploaded."}
          </div>
        )}
      </div>
    </Layout>
  );
}
