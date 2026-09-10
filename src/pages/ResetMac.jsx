import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../layout/Layout";
import { Alert, ConfirmDialog } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../services/safeStorage";
import { resetCustomerMac } from "../services/operatorTools";
import { ChevronLeftIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

/**
 * Operator Reset Mac — port of the Android CRM app's `ResetMacFragment`
 * (employee flavour).
 *
 * Android is a single customer-id field and a Reset button, then a dialog
 * carrying `status.err_msg` verbatim. It clears the field as soon as the
 * request is fired, and also clears it when the field was empty.
 *
 * ONE DELIBERATE DIVERGENCE: Android fires immediately on tap. This drops
 * the MAC binding and can knock the customer's live session offline, and a
 * customer id is a free-text field one character away from somebody else's
 * connection — so it asks first. Everything on the wire is unchanged.
 */
export default function ResetMac() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = getUser();

  const [cid, setCid] = useState("");
  const [confirmFor, setConfirmFor] = useState("");   // "" = dialog closed
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);         // { type, title, message }

  const ask = () => {
    const customerId = cid.trim();
    if (!customerId) {
      toast.add("Please select the customer Id to change the Mac!", { type: "error" });
      setCid("");
      return;
    }
    setConfirmFor(customerId);
  };

  const run = async () => {
    const customerId = confirmFor;
    setConfirmFor("");
    setBusy(true);
    try {
      const res = await resetCustomerMac({
        apiopid: user?.op_id || "",
        cid: customerId,
        adminuser: user?.username || "",
      });
      // Android shows err_msg on BOTH branches of its err_code check — the
      // two arms are identical — so the backend's own wording is always what
      // the operator sees. Only the styling depends on err_code.
      setResult({
        type: res.ok ? "success" : "error",
        title: "Reset Mac",
        message: res.message || (res.ok ? "Mac reset successful." : "Failed to reset the Mac."),
      });
      if (res.ok) setCid("");
    } catch (err) {
      setResult({
        type: "error",
        title: "Reset Mac",
        message: err?.message || "Could not reset the MAC. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate("/")}
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
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Customer Id</label>
            <input
              type="text"
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="e.g. 118c1373"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <button
            onClick={ask}
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Please wait…" : "Reset"}
          </button>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Clearing the MAC binding lets the customer connect a different device. Their
            current session may drop while the connection re-authenticates.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmFor}
        title="Reset Mac"
        message={`Reset the MAC binding for ${confirmFor}? Their current session may drop.`}
        onConfirm={run}
        onCancel={() => setConfirmFor("")}
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
