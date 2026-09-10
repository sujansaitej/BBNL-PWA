import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Alert, ConfirmDialog } from "@/components/ui";
import { getUser } from "../../services/safeStorage";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { resetMac } from "../../services/customer/serviceHome";
import { ChevronLeftIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

/**
 * Customer Reset Mac — port of the Android customer app's
 * `ResetMacFragment` (customer flavour).
 *
 * Android's screen is a card showing the linked service id and account name
 * plus a single OK button, which calls `apis/cust/resetmac/` with only
 * `userid` — the customer never types an id, it comes from the linked
 * account. Same here: the id is read from the active linked account, so
 * arriving without one sends the customer to link one rather than showing a
 * field they could get wrong.
 *
 * The same action also lives on the service home screen (ServiceHome.jsx);
 * this page is the dashboard-tile entry point to it. Both call the one
 * `resetMac` in services/customer/serviceHome.js — do not fork the wire call.
 */
export default function CustomerResetMac() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const user = getUser();
  const account = getActiveAccount();

  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { type, title, message }

  const userid = account?.userid || "";

  const run = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      const res = await resetMac({ userid });
      setResult({
        type: res.ok ? "success" : "error",
        title: res.ok ? "Mac reset successful" : "Sorry!",
        message:
          res.message ||
          (res.ok
            ? "Your MAC has been reset. Reconnect your device to get back online."
            : "Failed to reset the mac"),
      });
    } catch (err) {
      setResult({
        type: "error",
        title: "Sorry!",
        message: err?.message || "Failed to reset the mac",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!userid) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">No account selected.</p>
          <button
            onClick={() => navigate("/cust/internet")}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
          >
            Link an account
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate("/cust/dashboard")}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Dashboard
        </button>

        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <ArrowPathIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Reset Mac</h1>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <div className="text-sm space-y-1.5">
            <Row label="Name" value={account?.name || `${user?.firstname || ""} ${user?.lastname || ""}`.trim() || "—"} />
            <Row label="User id" value={userid} />
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Resetting clears the device currently bound to your connection so you can
            connect a different one. Your session may drop while it reconnects.
          </p>

          <button
            onClick={() => setConfirm(true)}
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Please wait…" : "Reset Mac"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Reset Mac"
        message="Reset the MAC on your connection? Your current session may drop."
        onConfirm={run}
        onCancel={() => setConfirm(false)}
      />

      <Alert
        isOpen={!!result}
        onClose={() => setResult(null)}
        type={result?.type || "success"}
        title={result?.title || ""}
        message={result?.message || ""}
      />
    </Layout>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex">
      <span className="w-24 flex-shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-700 dark:text-gray-300 break-words min-w-0">{value}</span>
    </div>
  );
}
