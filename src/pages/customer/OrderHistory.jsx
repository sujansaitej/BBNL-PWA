import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { getUser } from "../../services/safeStorage";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { serviceRouteBase } from "../../services/customer/serviceHome";
import {
  getOrderHistoryFor,
  mapOrderView,
  getReceiptUrl,
  getInvoiceUrl,
} from "../../services/orderApis";
import {
  ChevronLeftIcon,
  ClipboardDocumentListIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

/**
 * FoFi / IPTV order history — port of Android's MyOrderHistory
 * (ServiceApis/ordersList, keyed by servid: fofi=3, cabletv=1).
 *
 * Reached from the linked-account "Choose option" sheet → "Payment History".
 * Internet uses a different screen (CustomerPayments / apis/takebill); this
 * page covers the fofi/cabletv path. Row list mirrors native's Order List —
 * order no. / dates / amounts / status, with the server receipt & invoice
 * links opened in a browser tab (no auth), exactly as native does.
 */
export default function OrderHistory() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const account = getActiveAccount();
  const appUsername = getUser()?.username || "";
  const servicekey = String(account?.servicekey || "").toLowerCase();
  const routeBase = serviceRouteBase(servicekey);
  // Only FoFi (servid 3) and IPTV/cabletv (servid 1) use ordersList.
  const supported = servicekey === "fofi" || servicekey === "cabletv";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account?.userid || !supported) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await getOrderHistoryFor(servicekey, {
          userid: account.userid,
          username: appUsername,
          cid: account.userid,
        });
        if (cancelled) return;
        const list = Array.isArray(res?.body) ? res.body : [];
        setRows(list.map(mapOrderView));
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not load your order history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.userid, servicekey, supported]);

  if (!account?.userid) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">No account selected.</p>
          <button
            onClick={() => navigate(routeBase)}
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
          onClick={() => navigate(routeBase)}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Accounts
        </button>

        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <ClipboardDocumentListIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Payment History</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{account.userid}</p>
          </div>
        </div>

        {!supported ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Order history is available for FoFi and IPTV accounts here.
          </div>
        ) : loading ? (
          <div className="py-10 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading orders…" />
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-red-500">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No orders found.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((o, i) => (
              <div key={o.orderNumber || i} className="bg-white dark:bg-gray-800 rounded-xl shadow p-3 text-sm space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-gray-800 dark:text-gray-100 break-words min-w-0">
                    {o.orderNumber || "Order"}
                  </span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-300 flex-shrink-0">
                    ₹{o.totalAmount}
                  </span>
                </div>
                {o.orderDate && <Row label="Date" value={o.orderDate} />}
                {o.paymentMode && <Row label="Mode" value={o.paymentMode} />}
                {o.status && <Row label="Status" value={o.status} />}

                {o.orderNumber && (
                  <div className="flex gap-2 pt-2">
                    <DocLink href={getReceiptUrl(o.orderNumber)} label="Receipt" />
                    <DocLink href={getInvoiceUrl(o.orderNumber)} label="Invoice" />
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
