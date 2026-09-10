import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../services/safeStorage";
import { getCustomerDataUsage, toDMY, splitUsage } from "../services/operatorTools";
import {
  ChevronLeftIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * The API returns display strings ("29.3G") but a bare 0 when there is no
 * usage, so `value || "—"` would hide a genuine zero. Only null/undefined/
 * empty deserve the dash.
 */
const display = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * Operator data-usage report — port of the Android CRM app's
 * `dataUsageReport` fragment (employee flavour).
 *
 * Android's screen is: customer-id field + two date pickers + a "Get
 * Details" button, then a pie chart of download / upload / total. Nothing
 * loads on mount; the operator has to submit. Reproduced.
 *
 * Two of Android's behaviours are deliberately NOT reproduced:
 *
 *  - it echoes the response's `fromdate` into the To field and `todate` into
 *    the From field (dataUsageReport:400-401) — the bindings are crossed;
 *  - it labels any value with no G/M/T suffix as terabytes.
 *
 * Both are visible bugs on a screen an operator reads out to a customer.
 * The identifiers on the wire are unchanged.
 */
export default function DataUsageReport() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = getUser();

  const [cid, setCid] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState("");

  const run = async () => {
    const customerId = cid.trim();
    // Android's three guards, same order and same meaning.
    if (!customerId) {
      toast.add("Enter customer Id and get the details", { type: "error" });
      return;
    }
    if (!from || !to) {
      toast.add("Select both dates.", { type: "error" });
      return;
    }
    if (new Date(from) > new Date(to)) {
      toast.add("End date should come after start date", { type: "error" });
      return;
    }

    setLoading(true);
    setReport(null);
    setMessage("");
    try {
      const res = await getCustomerDataUsage({
        apiopid: user?.op_id || "",
        cid: customerId,
        adminuser: user?.username || "",
        from: toDMY(from),
        to: toDMY(to),
      });
      if (!res.ok) {
        // err_msg here is the backend's own wording ("no records found",
        // "user id not exists") — Android toasts it verbatim, so do the same
        // rather than inventing a friendlier but less accurate line.
        setMessage(res.message || "No usage data for this customer and period.");
        return;
      }
      setReport(res);
    } catch (err) {
      setMessage(err?.message || "Could not load the usage report.");
    } finally {
      setLoading(false);
    }
  };

  const up = splitUsage(report?.upload).num;
  const down = splitUsage(report?.download).num;
  const sum = up + down;
  const upPct = sum > 0 ? Math.round((up / sum) * 100) : 0;

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
            <ChartBarIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Data Usage Report</h1>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Customer Id</label>
            <input
              type="text"
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="e.g. bbnl_op49_c4491"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

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
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Please wait…" : "Get Details"}
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
            {(report.fromdate || report.todate) && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {display(report.fromdate)} &rarr; {display(report.todate)}
              </p>
            )}

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
              <Row label="Limit" value={display(report.limit)} />
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
      <p className="mt-1 text-base font-semibold text-gray-800 dark:text-gray-100 break-words">{value}</p>
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
