// Shared presentational pieces for the franchise ONT screens.
//
// The through-line in this file is that ACS data is ALWAYS as-of something.
// GenieACS serves the values a CPE last reported, which may be minutes or hours
// old, and an operator standing in a customer's house will read a number off
// this screen and say it out loud. So nothing renders a bare figure: presence,
// SSID client counts, optical readings and port states all carry the timestamp
// they were true at. That timestamp is free — every parameter leaf in a GenieACS
// response ships its own `_timestamp` alongside `_value`.

import {
  CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon,
  ArrowPathIcon, ClockIcon, SignalIcon, SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { formatClock, formatAge, formatDbm } from "../../services/ontModel";

// ── Freshness ────────────────────────────────────────────────────────
/**
 * "as of 14:32 · Refresh". `asof` may be an ISO string or a Date.
 * When it is missing we say so rather than implying the value is current.
 */
export function FreshnessStamp({ asof, onRefresh, refreshing, className = "" }) {
  const clock = formatClock(asof);
  return (
    <div className={`flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 ${className}`}>
      <ClockIcon className="w-3.5 h-3.5 shrink-0" />
      <span>{clock ? `as of ${clock}` : "no timestamp reported"}</span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium disabled:opacity-50"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Reading device…" : "Refresh"}
        </button>
      )}
    </div>
  );
}

// ── Presence ─────────────────────────────────────────────────────────
/**
 * Requirement #1.
 *
 * Deliberately says "last seen", not "online", in the sub-line. This value is
 * derived from _lastInform — when the device last CONTACTED THE ACS — which is
 * not the same claim as "it is reachable right now". The Probe button on the
 * device page answers that stronger question; conflating the two is how an
 * operator ends up telling a customer their line is fine when it is not.
 */
export function PresencePill({ online, ageMin, size = "md" }) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs";
  const Icon = online ? SignalIcon : SignalSlashIcon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad} ${
        online
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {online ? "Online" : "Offline"}
      {ageMin != null && <span className="font-normal opacity-80">· {formatAge(ageMin)}</span>}
    </span>
  );
}

// ── Task outcome ─────────────────────────────────────────────────────
/**
 * Reboot / SSID / LAN results.
 *
 * The three states exist because GenieACS distinguishes them and the old PHP
 * console did not: it checked only whether the response body was non-empty, so
 * a 202 ("queued — the device never answered") was reported to the operator as
 * "Device has been rebooted successfully". `queued` is the state that matters
 * most on a phone, because the operator is usually standing next to the
 * customer when they read it.
 */
export function TaskResult({ result, onDismiss }) {
  if (!result) return null;
  const map = {
    done:   { Icon: CheckCircleIcon,          cls: "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-200" },
    queued: { Icon: ClockIcon,                cls: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-200" },
    error:  { Icon: XCircleIcon,              cls: "bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-900/30 dark:border-rose-800 dark:text-rose-200" },
    warn:   { Icon: ExclamationTriangleIcon,  cls: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-200" },
  };
  const { Icon, cls } = map[result.kind] || map.error;
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${cls}`}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold text-sm">{result.title}</p>
        {result.message && <p className="text-xs leading-relaxed opacity-90">{result.message}</p>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-xs font-semibold opacity-70 hover:opacity-100 shrink-0">
          Dismiss
        </button>
      )}
    </div>
  );
}

// ── Section shell ────────────────────────────────────────────────────
export function Section({ title, children, aside }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full" />
        <h3 className="text-indigo-600 dark:text-indigo-400 font-semibold text-lg flex-1">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Row({ label, value, mono }) {
  return (
    <div className="flex text-sm gap-2">
      <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`min-w-0 break-all text-gray-800 dark:text-gray-200 ${mono ? "font-mono text-[13px]" : ""}`}>
        {value == null || value === "" ? "—" : String(value)}
      </span>
    </div>
  );
}

// ── Optical / fiber loss ─────────────────────────────────────────────
/**
 * Requirement #6.
 *
 * Two honesty rules are enforced here rather than left to the caller:
 *
 * 1. When no vendor path resolved, this says the model does not publish optical
 *    data — it does not render an empty gauge that reads as "0 dBm" or as a
 *    fault. The PHP dictionary only ever knew TP-Link's X_TP_GPON_Config, so on
 *    most of the fleet there is genuinely nothing to show.
 *
 * 2. When the reading came from a vendor whose unit scaling is not yet confirmed
 *    against real hardware, the banding is labelled unverified. Vendors report
 *    dBm, tenths of a dBm, or microwatts; reading 0.1-dBm as dBm turns a healthy
 *    -22 into -220 and paints everything critical. A confidently wrong colour is
 *    worse than an honest caveat — techs stop trusting the screen and then
 *    ignore a real fault.
 */
export function OpticalGauge({ optical }) {
  if (!optical) {
    return (
      <Card className="p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This model does not publish optical readings to the ACS.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          RX/TX power lives in a vendor-specific parameter branch. Add this model's
          branch to <code className="font-mono">OPTICAL_SOURCES</code> once its parameter
          list has been captured from a real device.
        </p>
      </Card>
    );
  }

  const tone = {
    ok:       "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/25 dark:border-emerald-800",
    warning:  "bg-amber-50 border-amber-200 dark:bg-amber-900/25 dark:border-amber-800",
    critical: "bg-rose-50 border-rose-200 dark:bg-rose-900/25 dark:border-rose-800",
    unknown:  "bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700",
  }[optical.band?.level || "unknown"];

  const dot = {
    ok: "bg-emerald-500", warning: "bg-amber-500", critical: "bg-rose-500", unknown: "bg-gray-400",
  }[optical.band?.level || "unknown"];

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${tone}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">
          {optical.band?.label || "No reading"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">RX power</p>
          <p className="text-xl font-semibold text-gray-900 dark:text-gray-50 tabular-nums">
            {formatDbm(optical.rx)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">TX power</p>
          <p className="text-xl font-semibold text-gray-900 dark:text-gray-50 tabular-nums">
            {formatDbm(optical.tx)}
          </p>
        </div>
      </div>

      {optical.voltage != null && (
        <Row label="Supply voltage" value={optical.voltage} />
      )}

      {optical.assumedUnit && (
        <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-900/40 rounded-lg px-2.5 py-1.5 leading-relaxed">
          Unverified scale — read from the <span className="font-mono">{optical.vendor}</span> branch
          assuming a ×{optical.scale} factor to dBm. Raw value {optical.rawRx}. Confirm against a
          calibrated meter before treating the colour band as authoritative.
        </p>
      )}
    </div>
  );
}
