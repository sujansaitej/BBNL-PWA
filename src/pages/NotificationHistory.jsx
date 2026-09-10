import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, BellAlertIcon } from "@heroicons/react/24/outline";
import { Loader, Modal } from "@/components/ui";
import { getUser } from "../services/safeStorage";
import {
    getNotificationHistory,
    normaliseNotification,
    notificationPlainText,
    APP_TYPE_CRM,
    APP_TYPE_CUSTOMER,
} from "../services/notifications";

/**
 * Notification History — port of Android's NotificationHistory activity.
 *
 * Deliberately different from Android in one respect: Android's requestFailed()
 * only writes to logcat (NotificationHistory.java:107), so when the endpoint
 * fails the operator is left staring at a blank screen that is
 * indistinguishable from "you have no notifications". This screen separates
 * the two — an empty list says so, a failure says so, and the failure is
 * retryable. (The endpoint 500'd on every request on 2026-08-18 and was fixed
 * server-side on 2026-08-19; this handling stays so a regression is visible
 * rather than silent.)
 */
export default function NotificationHistory() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState([]);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState(null);

    // The signed-in login — what the backend matches the notification rows
    // against. Android passes the same stored app_username.
    const cid = getUser()?.username || "";

    // `app_type` SELECTS THE FEED, it is not decoration. One screen serves both
    // portals (the header menu offers it to operators and customers alike), and
    // this always asked for the operator feed, so a customer was looked up as an
    // `admin.user` and could only ever be told they had nothing.
    //
    // Verified live 2026-08-31 — the same cid, the two app_types, two different
    // sets of rows:
    //   cid=superadmin app_type=crm          → "Transaction success!!" …
    //   cid=superadmin app_type=customer_app → "Welcome" …
    //
    // It went unnoticed because the endpoint 500'd on everything until the
    // backend was fixed; now that it answers, the wrong feed is reachable.
    const appType = localStorage.getItem("loginType") === "customer"
        ? APP_TYPE_CUSTOMER
        : APP_TYPE_CRM;

    const load = useCallback(async () => {
        if (!cid) { setError("Please sign in again."); setLoading(false); return; }
        setLoading(true);
        setError("");
        try {
            const { ok, items: rows, message } = await getNotificationHistory({ cid, appType });
            if (ok) setItems(rows.map(normaliseNotification));
            else { setItems([]); setError(message); }
        } catch (err) {
            setItems([]);
            setError(err?.message || "Could not load notifications.");
        } finally {
            setLoading(false);
        }
    }, [cid, appType]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-900">
            <div
                className="sticky top-0 z-30 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 pb-4 flex items-center gap-3"
                style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}
            >
                <button onClick={() => navigate(-1)} className="p-1" aria-label="Go back">
                    <ChevronLeftIcon className="h-6 w-6" />
                </button>
                <h1 className="text-lg font-medium">Notification History</h1>
            </div>

            <div className="px-4 py-4">
                {loading ? (
                    <Loader text="Loading notifications..." />
                ) : error ? (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 text-center">
                        <p className="text-sm text-amber-800 dark:text-amber-200">{error}</p>
                        <button
                            onClick={load}
                            className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white"
                        >
                            Try again
                        </button>
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center py-16">
                        <BellAlertIcon className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600" />
                        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No notifications yet.</p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {items.map((n, i) => (
                            <li key={i}>
                                <button
                                    type="button"
                                    onClick={() => setSelected(n)}
                                    className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex gap-3 hover:border-indigo-300 transition-colors"
                                >
                                    {n.icon ? (
                                        // Server-rendered absolute URL. onError hides a broken
                                        // icon rather than leaving the browser's placeholder.
                                        <img
                                            src={n.icon}
                                            alt=""
                                            className="h-10 w-10 rounded-lg object-cover flex-shrink-0"
                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                        />
                                    ) : (
                                        <BellAlertIcon className="h-10 w-10 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 flex-shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-sm text-gray-800 dark:text-gray-100 truncate">
                                            {n.title || "Notification"}
                                        </p>
                                        <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{notificationPlainText(n.message)}</p>
                                        {n.time && (
                                            <p className="mt-1 text-xs text-gray-400">{n.time}</p>
                                        )}
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Android opens each row in a dialog (dialogOpenTop). */}
            <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.title || "Notification"}>
                {selected?.media && selected.fileType === "image" && (
                    <img src={selected.media} alt="" className="w-full rounded-lg mb-3" />
                )}
                {/* Android renders this with HtmlCompat.fromHtml
                    (NotificationHistory.java:135). The string is HTML, so
                    showing it verbatim would print raw tags. It is sanitised to
                    a formatting-only, attribute-free subset first — see
                    sanitiseNotificationHtml. */}
                <div
                    className="text-sm text-gray-700 dark:text-gray-300 [&_p]:mb-2 [&_b]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: selected?.messageHtml || "" }}
                />
                {selected?.time && <p className="mt-3 text-xs text-gray-400">{selected.time}</p>}
            </Modal>
        </div>
    );
}
