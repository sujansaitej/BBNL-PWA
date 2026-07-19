import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { getDataUsage, toUsageDate, usageToNumber } from "../../services/customer/serviceHome";
import {
  ChevronLeftIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  ChartPieIcon,
} from "@heroicons/react/24/outline";

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * The API returns these as display strings ("29.3 Gb") but sends a bare
 * numeric 0 when there is no usage — so `value || "—"` would hide a genuine
 * zero. Only null/undefined/empty deserve the dash.
 */
const display = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * Data usage report — port of Android's AverageUserReportFragment.
 *
 * No data loads on mount; the customer picks a date range and submits, which
 * matches Android. The report comes from a DIFFERENT HOST than the rest of
 * the app (see serviceHome.js).
 *
 * Android renders `upload` into the field labelled "Used", `total` into the
 * one labelled "Plan", and so on — the bindings there are visibly crossed.
 * We label each value with what the API actually calls it instead of
 * reproducing that.
 */
export default function DataUsage() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const toast = useToast();
  const account = getActiveAccount();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState("");

  const run = async () => {
    if (!from || !to) {
      toast.add("Please choose both dates.", { type: "error" });
      return;
    }
    if (new Date(from) > new Date(to)) {
      toast.add("The From date must be before the To date.", { type: "error" });
      return;
    }
    setLoading(true);
    setReport(null);
    setMessage("");
    try {
      const res = await getDataUsage({
        apiopid: account?.opid || "",
        apiuserid: account?.userid || "",
        fromdt: toUsageDate(from),
        todt: toUsageDate(to),
      });
      if (!res.ok) {
        // parseError = upstream sent HTML instead of JSON, which it does for
        // an account it does not recognise. Saying "no data for this period"
        // would send the customer off changing dates forever.
        setMessage(
          res.parseError
            ? "No usage data is available for this account."
            : "No data available for this period."
        );
        return;
      }
      // "Unlimited" is a legitimate balance value, not a number. Android
      // (AverageUserReportFragment:162-167) hides the chart and every value
      // row and shows the single line `balance + " Data"` — on an unlimited
      // plan the upload/download/total figures come back as 0 and mean
      // nothing, so rendering the usual card just yields a grid of dashes.
      // Match Android.
      if (String(res.balance).toLowerCase() === "unlimited") {
        setMessage(`${res.balance} Data`);
        return;
      }
      if (usageToNumber(res.total) === 0) {
        setMessage("No data available for this period.");
        return;
      }
      setReport(res);
    } catch (err) {
      setMessage(err?.message || "Could not load the usage report.");
    } finally {
      setLoading(false);
    }
  };

  const up = usageToNumber(report?.upload);
  const down = usageToNumber(report?.download);
  const sum = up + down;
  const upPct = sum > 0 ? Math.round((up / sum) * 100) : 0;

  if (!account?.userid) {
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
          onClick={() => navigate("/cust/internet/home")}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Home
        </button>

        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <ChartPieIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Data Usage</h1>
        </div>

        {/* Range picker */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">From</label>
              <input
                type="date"
                value={from}
                max={to || todayISO()}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">To</label>
              <input
                type="date"
                value={to}
                min={from || undefined}
                max={todayISO()}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={run}
            disabled={loading || !from || !to}
            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Please wait…" : "Check usage"}
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading report…" />
          </div>
        ) : message ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {message}
          </div>
        ) : report ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
            {/* Split bar — upload vs download */}
            {sum > 0 && (
              <div>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                  <div className="bg-indigo-500" style={{ width: `${upPct}%` }} />
                  <div className="bg-blue-400" style={{ width: `${100 - upPct}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <span>Upload {upPct}%</span>
                  <span>Download {100 - upPct}%</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Stat Icon={ArrowUpTrayIcon} label="Upload" value={display(report.upload)} />
              <Stat Icon={ArrowDownTrayIcon} label="Download" value={display(report.download)} />
            </div>

            <div className="border-t dark:border-gray-700 pt-3 text-sm space-y-1.5">
              <Row label="Total used" value={display(report.total)} />
              <Row label="Balance" value={display(report.balance)} />
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}

function Stat({ Icon, label, value }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
      <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 text-base font-semibold text-gray-800 dark:text-gray-100 break-words">
        {value}
      </p>
    </div>
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
