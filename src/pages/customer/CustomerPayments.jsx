import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { getInternetPaymentHistory } from "../../services/customer/serviceHome";
import {
  ChevronLeftIcon,
  BanknotesIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

/**
 * Internet payment history — port of Android's InternetPaymentHistoryFragment
 * (apis/takebill/).
 *
 * Reached from the linked-account sheet → "Payment History". Android routes
 * non-internet services to a different screen (MyOrderHistory /
 * ServiceApis/ordersList); this page covers the internet path only, and says
 * so rather than showing an empty list for other services.
 */
export default function CustomerPayments() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const account = getActiveAccount();
  const servicekey = String(account?.servicekey || "").toLowerCase();
  const isInternet = servicekey === "internet";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account?.userid || !isInternet) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await getInternetPaymentHistory({
          apiopid: account.opid,
          apiuserid: account.userid,
        });
        if (cancelled) return;
        setRows(res.rows);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not load your payment history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.userid, isInternet]);

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
          onClick={() => navigate("/cust/internet")}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Accounts
        </button>

        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <BanknotesIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Payment History</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{account.userid}</p>
          </div>
        </div>

        {!isInternet ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Payment history is available for Internet accounts only.
          </div>
        ) : loading ? (
          <div className="py-10 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading payments…" />
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-red-500">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No payments found.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((p, i) => (
              <div key={p.trans_id || p.id || i} className="bg-white dark:bg-gray-800 rounded-xl shadow p-3 text-sm space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-gray-800 dark:text-gray-100 break-words min-w-0">
                    {p.planname || "Payment"}
                  </span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-300 flex-shrink-0">
                    ₹{p.paid_amt || "0"}
                  </span>
                </div>
                {p.payment_date && <Row label="Paid on" value={p.payment_date} />}
                {p.renewdate && <Row label="Renewed" value={p.renewdate} />}
                {p.expirydate && <Row label="Expires" value={p.expirydate} />}
                {p.pymt_mode && <Row label="Mode" value={p.pymt_mode} />}
                {p.trans_status && <Row label="Status" value={p.trans_status} />}
                {(p.bill_num || p.billnumber) && (
                  <Row label="Bill no." value={p.bill_num || p.billnumber} />
                )}

                {(p.receipt_link || p.invoice_link) && (
                  <div className="flex gap-2 pt-2">
                    {p.receipt_link && <DocLink href={p.receipt_link} label="Receipt" />}
                    {p.invoice_link && <DocLink href={p.invoice_link} label="Invoice" />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function DocLink({ href, label }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded border border-indigo-500 text-indigo-600 text-xs font-medium"
    >
      {label} <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
    </a>
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
