import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../services/safeStorage";
import { getOrderHistory } from "../services/orderApis";
import { getServicesOrders } from "../services/generalApis";
import { toDMY, bareCustomerId } from "../services/operatorTools";
import {
  ChevronLeftIcon,
  ArchiveBoxIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

const todayISO = () => new Date().toISOString().slice(0, 10);
const CUR = import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL || "₹";

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? `${CUR} ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${CUR} ${v ?? "0.00"}`;
};

const text = (v) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || "—";
};

/**
 * `custdetails` on a servicesOrders row is a JSON STRING, not an object —
 * Android parses it with `new JSONObject(row.getCustdetails())` and reads
 * `fullname` / `mobileno` out of it (CommonOrderHistoryAdapter:84-118).
 * Every one of those reads there is individually try/caught, because rows
 * with an empty or malformed value are normal.
 */
function custDetails(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/** "DD-MM-YYYY HH:MM:SS" → Date, for newest-first sorting. */
function parseDMY(s) {
  const m = String(s || "").match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return new Date(0);
  const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +se);
}

/**
 * Operator Order History — port of the Android CRM app's
 * `OrderHistoryFragment`, which is a two-tab pager:
 *
 *   tab 0  "Internet Order History"  → PaymentHistroyFragement
 *                                      POST apis/custpayhistory {apiopid, cid}
 *   tab 1  "Other Order History"     → CommonOrderHistoryFragment
 *                                      POST ServiceApis/servicesOrders (JSON)
 *
 * They are two different backends with two different envelopes and two
 * different row shapes, which is exactly why Android keeps them in separate
 * tabs rather than merging them. Same here.
 *
 * DIVERGENCE, tab 0: Android buckets the response into a map keyed by
 * customer id and then by date, and renders only `list.get(0)` of each
 * bucket (PaymentHistroyFragement:186-216) — so a customer who paid twice on
 * one day loses a payment off the screen. An operator reconciling collections
 * needs every row, so all of them are rendered here, newest first.
 *
 * DIVERGENCE, tab 1: Android paginates on scroll with a 2-second artificial
 * delay before appending. This uses an explicit "Load more" button — same
 * `offset` page counter on the wire, no invented latency.
 */
export default function OrdersHistory() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("internet");

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
            <ArchiveBoxIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Order History</h1>
        </div>

        {/* Tabs — same two, same order, same names as Android's pager. */}
        <div className="grid grid-cols-2 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
          {[
            { id: "internet", label: "Internet" },
            { id: "other", label: "Other Services" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === t.id
                  ? "bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-300 shadow"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Both panels stay mounted so switching tabs does not throw away a
            loaded list and re-hit the backend. */}
        <div className={tab === "internet" ? "" : "hidden"}>
          <InternetOrders />
        </div>
        <div className={tab === "other" ? "" : "hidden"}>
          <OtherOrders />
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Tab 0 — Internet (apis/custpayhistory)
// ══════════════════════════════════════════════════════════════════════
function InternetOrders() {
  const user = getUser();
  const [cid, setCid] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(
    async (customerId) => {
      setLoading(true);
      setMessage("");
      try {
        // Android calls this on mount with whatever the search field holds —
        // an empty cid is legitimate and returns every customer's payments.
        // VERIFIED against netmontest: this endpoint returns `cid` in the
        // decorated "testrag7 [BBNL_OP49]" form but REJECTS that same string
        // as input ("No Payments History"). An operator searching for an id
        // they just read off a row would otherwise get an empty list.
        const data = await getOrderHistory({
          apiopid: user?.op_id || "",
          cid: bareCustomerId(customerId),
          servicekey: "operator-all",
        });
        const body = Array.isArray(data?.body) ? data.body : [];
        if (Number(data?.status?.err_code) !== 0 && body.length === 0) {
          setRows([]);
          setMessage(data?.status?.err_msg || "No payments found.");
          return;
        }
        setRows([...body].sort((a, b) => parseDMY(b.payment_date) - parseDMY(a.payment_date)));
        if (body.length === 0) setMessage("No payments found.");
      } catch (err) {
        setRows([]);
        setMessage(err?.message || "Could not load payment history.");
      } finally {
        setLoading(false);
      }
    },
    [user?.op_id]
  );

  useEffect(() => {
    load("");
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={cid}
          onChange={(e) => setCid(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(cid.trim()); }}
          placeholder="Search customer id"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
        <button
          onClick={() => load(cid.trim())}
          className="px-4 rounded-lg bg-indigo-600 text-white"
          aria-label="Search"
        >
          <MagnifyingGlassIcon className="w-5 h-5" />
        </button>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader size="lg" color="indigo" text="Loading payments…" />
        </div>
      ) : rows?.length ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={`${r.cid}-${r.payment_date}-${i}`} className="bg-white dark:bg-gray-800 rounded-xl shadow p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{text(r.name)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {text(bareCustomerId(r.cid))} · {text(r.mobile)}
                  </p>
                </div>
                <p className="font-semibold text-indigo-600 dark:text-indigo-300 whitespace-nowrap">
                  {money(r.total_amt)}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1 text-sm">
                <Field label="Plan" value={text(r.plan_name)} />
                <Field label="Paid on" value={text(r.payment_date)} />
                <Field
                  label="Mode"
                  value={r.pymt_type ? `${text(r.pymt_mode)} (${r.pymt_type})` : text(r.pymt_mode)}
                />
                <Field label="Paid" value={money(r.paid_amt)} />
                <Field label="Balance" value={money(r.balance_amt)} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty message={message || "No payments found."} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Tab 1 — Other services (ServiceApis/servicesOrders)
// ══════════════════════════════════════════════════════════════════════
function OtherOrders() {
  const user = getUser();
  const toast = useToast();

  const [servuserid, setServuserid] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");

  /**
   * `offset` is a PAGE index, not a row index — Android increments it by one
   * per page (`offSetValue++`) and never multiplies by a page size, so the
   * backend is doing the arithmetic. Send it the same way.
   *
   * `datesearch` is "1" only when a date range or a customer id was actually
   * submitted; the mount-time call sends "0". Sending "1" with empty dates
   * returns nothing.
   */
  const fetchPage = useCallback(
    async ({ page, filters, append }) => {
      const payload = {
        opid: user?.op_id || "",
        datesearch: filters.searched ? "1" : "0",
        offset: String(page),
        limit: "",
        fromdate: filters.from || "",
        todate: filters.to || "",
        servuserid: filters.servuserid || "",
        ordernumber: "",
        planname: "",
        servicename: "",
        paymentmode: "",
        gatewaytxnid: "",
        txnstatus: "",
        customised_data: "yes",
      };
      const data = await getServicesOrders(payload);
      const body = data?.body || {};
      const page_rows = Array.isArray(body.rows) ? body.rows : [];
      const code = Number(data?.status?.err_code);

      if (code !== 0) {
        // err_code 1 is "no (more) records", not a failure — Android toasts
        // err_msg and leaves whatever is already on screen in place.
        if (append) setExhausted(true);
        return { rows: page_rows, total: Number(body.total) || 0, ok: false, msg: data?.status?.err_msg || "" };
      }
      return { rows: page_rows, total: Number(body.total) || 0, ok: true, msg: "" };
    },
    [user?.op_id]
  );

  const search = useCallback(
    async (filters) => {
      setLoading(true);
      setMessage("");
      setExhausted(false);
      try {
        const res = await fetchPage({ page: 0, filters, append: false });
        setRows(res.rows);
        setTotal(res.total);
        setOffset(0);
        if (!res.rows.length) setMessage(res.msg || "No orders found.");
      } catch (err) {
        setRows([]);
        setMessage(err?.message || "Could not load orders.");
      } finally {
        setLoading(false);
      }
    },
    [fetchPage]
  );

  useEffect(() => {
    // Android's init() calls requestOrderList() once with no filters.
    search({ searched: false, from: "", to: "", servuserid: "" });
  }, [search]);

  const submit = () => {
    const id = servuserid.trim();
    // Android: either a date range OR a customer id must be present.
    if (!id && !(from && to)) {
      toast.add("Please Select Details", { type: "error" });
      return;
    }
    if (from && to && new Date(from) > new Date(to)) {
      toast.add("End date should come after start date", { type: "error" });
      return;
    }
    search({ searched: true, from: toDMY(from), to: toDMY(to), servuserid: id });
  };

  const reset = () => {
    setServuserid("");
    setFrom("");
    setTo("");
    search({ searched: false, from: "", to: "", servuserid: "" });
  };

  const loadMore = async () => {
    const next = offset + 1;
    setLoadingMore(true);
    try {
      const res = await fetchPage({
        page: next,
        filters: {
          searched: !!(servuserid.trim() || (from && to)),
          from: toDMY(from),
          to: toDMY(to),
          servuserid: servuserid.trim(),
        },
        append: true,
      });
      if (res.rows.length) {
        setRows((prev) => [...prev, ...res.rows]);
        setOffset(next);
        if (res.total) setTotal(res.total);
      } else {
        setExhausted(true);
      }
    } catch (err) {
      toast.add(err?.message || "Could not load more orders.", { type: "error" });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
        <input
          type="text"
          value={servuserid}
          onChange={(e) => setServuserid(e.target.value)}
          placeholder="Customer id (optional)"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full border rounded-lg py-2 px-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
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
        <div className="flex gap-2">
          <button
            onClick={submit}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
          >
            Order Details
          </button>
          <button
            onClick={reset}
            className="px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold"
          >
            Clear
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader size="lg" color="indigo" text="Loading orders…" />
        </div>
      ) : rows.length ? (
        <>
          {total > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {rows.length} of {total}
            </p>
          )}
          <div className="space-y-2">
            {rows.map((r, i) => {
              const cust = custDetails(r.custdetails);
              return (
                <div key={`${r.id || r.ordernumber}-${i}`} className="bg-white dark:bg-gray-800 rounded-xl shadow p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">
                        {text(cust.fullname)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {text(r.servuserid)} · {text(cust.mobileno)}
                      </p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <p className="font-semibold text-indigo-600 dark:text-indigo-300">{money(r.paidamount)}</p>
                      {r.txnstatus && (
                        <p
                          className={`text-[11px] font-semibold ${
                            String(r.txnstatus).toLowerCase().includes("success")
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {r.txnstatus}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <Field label="Service" value={text(r.servicename)} />
                    <Field label="Order no" value={text(r.ordernumber)} />
                    <Field label="Plan" value={text(r.planname)} />
                    <Field label="Date" value={text(r.txndate)} />
                    <Field label="Mode" value={text(r.paymentmode)} />
                    <Field label="Total" value={money(r.totalamount)} />
                  </div>
                </div>
              );
            })}
          </div>

          {!exhausted && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      ) : (
        <Empty message={message || "No orders found."} />
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex">
      <span className="w-20 flex-shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-700 dark:text-gray-300 break-words min-w-0">{value}</span>
    </div>
  );
}

function Empty({ message }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-gray-500 dark:text-gray-400">
      {message}
    </div>
  );
}
