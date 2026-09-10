// SsidEditSheet — change an SSID name / passphrase / visibility on ONE radio.
//
// Modelled on ServiceHome.jsx's doResetMac flow, which is the codebase's
// existing precedent for a disruptive device write: confirm, busy, then a result
// panel that tells the user what they now have to do. A Wi-Fi passphrase change
// disconnects every client on that radio — including the operator's own phone if
// they are on the customer's Wi-Fi — so the warning is part of the form, not an
// afterthought in a toast.
//
// The radio passed in was resolved from the device's OWN WLANConfiguration /
// WiFi.SSID table, so the index written here is the index displayed. That is
// the fix for the defect where the console read 2.4GHz from index 6 and wrote it
// to index 1: the operator changed the name, the screen kept showing the old
// one, and the write may have landed on the 5GHz radio instead.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import useBodyScrollLock from "../../hooks/useBodyScrollLock";

export default function SsidEditSheet({ open, radio, busy, onClose, onSubmit }) {
  useBodyScrollLock(open);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [hidden, setHidden] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [touched, setTouched] = useState(false);

  // Re-seed whenever a different radio is opened. Keyed re-mount from the parent
  // handles the common case; this covers reopening the same sheet.
  const [seeded, setSeeded] = useState(null);
  if (open && radio && seeded !== radio.index) {
    setSeeded(radio.index);
    setSsid(radio.ssid || "");
    setPassword("");
    setHidden(!!radio.hidden);
    setTouched(false);
  }
  if (!open || !radio) return null;

  const nameChanged = ssid !== (radio.ssid || "");
  const hiddenChanged = hidden !== !!radio.hidden;
  const pwChanged = password.length > 0;
  const nothingToDo = !nameChanged && !hiddenChanged && !pwChanged;

  // WPA2 allows 8-63 characters. Caught here so the operator sees it instantly
  // rather than after a round trip — and because a rejected passphrase would
  // take the SSID rename down with it: SetParameterValues is atomic, so one bad
  // value discards every other parameter in the same task.
  const pwInvalid = pwChanged && (password.length < 8 || password.length > 63);
  const ssidInvalid = nameChanged && (ssid.trim().length === 0 || ssid.length > 32);

  const submit = () => {
    setTouched(true);
    if (nothingToDo || pwInvalid || ssidInvalid) return;
    onSubmit({
      ssid: nameChanged ? ssid.trim() : undefined,
      password: pwChanged ? password : undefined,
      hidden: hiddenChanged ? hidden : undefined,
    });
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="bg-white dark:bg-gray-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-4 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="text-white font-semibold">Edit Wi-Fi</h3>
              <p className="text-white/80 text-xs">
                {radio.band} · radio {radio.index}
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={busy}
              className="text-white/80 hover:text-white rounded-full p-1 disabled:opacity-40"
              aria-label="Close"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Network name (SSID)</span>
              <input
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                maxLength={32}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                placeholder="Network name"
              />
              {touched && ssidInvalid && (
                <span className="text-xs text-rose-600">Enter a name of 1 to 32 characters.</span>
              )}
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                New password <span className="font-normal text-gray-400">— leave blank to keep the current one</span>
              </span>
              <div className="relative">
                <input
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={63}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  placeholder="8 to 63 characters"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600"
                  aria-label={reveal ? "Hide password" : "Show password"}
                >
                  {reveal ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
              {touched && pwInvalid && (
                <span className="text-xs text-rose-600">Wi-Fi passwords must be 8 to 63 characters.</span>
              )}
              {/* The ACS can set a passphrase but never read one back — the CPE
                  does not expose it, and the read projection deliberately does
                  not ask for it. Say so, so nobody hunts for a "current
                  password" field that cannot exist. */}
              <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                The current password cannot be read back from the device — it can only be replaced.
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Hide this network from scans
              </span>
            </label>

            {pwChanged && (
              <p className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                Changing the password disconnects every device on this network. The customer will
                need to reconnect using the new password — including any phone you are using right now
                if it is on their Wi-Fi.
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || nothingToDo}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
