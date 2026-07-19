import { useEffect, useState } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { servidFor, killServiceTxn } from "../../services/customer/servicePayment";
import { getInternetMakePayment, saveInternetPayment } from "../../services/customer/internetPayment";
import {
  buildPaymentHash, initiateLink, openCheckout,
  EZ_ENV, resolveCreds, readTids, addTid, removeTid,
} from "../../services/customer/easebuzz";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const num = (v) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;

/**
 * Internet payment — port of Android's InternetPaymentDetailsFragment.
 *
 * Reached from ServiceHome's Proceed (internet). Flow:
 *   apis/makepayment → server-priced month plans + merchanttxnid + ispending
 *   pick a month → Easebuzz (shared) → Apis/savePaymentApi → status
 *
 * Months are fully server-priced (planrates_android[]); we never recompute tax
 * or total. Finalize is savePaymentApi, NOT cabletv/generateorder.
 */
export default function InternetPaymentSummary() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const user = getUser();
  const account = getActiveAccount();
  const appUsername = user?.username || "";
  const userId = account?.userid || "";
  const operatorId = account?.opid || "";
  const servid = account?.serviceListId || servidFor("internet", account?.servid);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);      // makepayment result
  const [months, setMonths] = useState([]);        // planrates_android[]
  const [selIdx, setSelIdx] = useState(0);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        let res = await getInternetMakePayment({ apiuserid: userId, apiopid: operatorId });
        // Stale-txn guard: kill a previously-abandoned merchanttxnid, refetch once.
        const tid = res?.result?.merchanttxnid;
        if (tid && readTids().includes(tid)) {
          try { await killServiceTxn({ userid: userId, username: appUsername, servid, transactionid: tid }); } catch { /* ignore */ }
          removeTid(tid);
          res = await getInternetMakePayment({ apiuserid: userId, apiopid: operatorId });
        }
        if (cancelled) return;
        if (String(res?.error) !== "0" || !res?.result) {
          setError(res?.result || "Payment details are not available.");
          return;
        }
        const list = Array.isArray(res.result.planrates_android) ? res.result.planrates_android : [];
        setResult(res.result);
        setMonths(list);
        setSelIdx(0);
        if (list.length === 0) setError("No plans are available to renew right now.");
      } catch (err) {
        if (!cancelled) setError(err?.message || "Couldn't load the payment details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const sel = months[selIdx] || null;
  const sgst = sel?.taxdetails?.subtaxes?.SGST || {};
  const cgst = sel?.taxdetails?.subtaxes?.CGST || {};

  const handlePay = async () => {
    if (!sel || paying) return;
    const amountStr = Number(num(sel.total)).toFixed(2);
    // Native gates internet pay ONLY on amount > 50
    // (InternetPaymentDetailsFragment.java:407-415). There is no required usage
    // question — native pre-defaults "Is data finished?" to No and never blocks
    // on it, so we don't either.
    if (Number(amountStr) <= 50) {
      toast.add("Amount should be greater than 50 rupees.", { type: "error" });
      return;
    }

    const txnid = result?.merchanttxnid;
    if (!txnid) { toast.add("Missing transaction reference. Please retry.", { type: "error" }); return; }

    const { key, salt } = resolveCreds(undefined); // makepayment ships no creds block
    const month = String(sel.month || "1");
    const firstname = String(account.name || "Customer").trim();
    const email = account.emailid || user?.email || user?.emailid || "no-reply@bbnl.in";
    const rawPhone = String(account.mobileno || user?.mobile || user?.mobileno || "").replace(/\D/g, "");
    const phone = rawPhone.length === 10 ? rawPhone : "9999999999";

    // udf5 — internet shape: empty box/voip/arrays; carries plan + months.
    const st = location.state || {};
    const udf5 = btoa(JSON.stringify({
      fofiboxid: "", voipnumber: "", planid: st.planid || "", priceid: st.priceid || "",
      cblextenperiod: month, servid: String(servid),
      channelid: [], packageid: [], lcochid: [], pkgcode: [],
      loginuname: appUsername, trialdays: "0",
    }));
    const udf = { udf1: month, udf2: userId, udf3: "serviceapp", udf4: operatorId, udf5 };

    setPaying(true);
    try {
      const hash = await buildPaymentHash({
        key, txnid, amount: amountStr, productinfo: "internet",
        firstname, email, ...udf, salt,
      });
      const params = {
        key, txnid, amount: amountStr, productinfo: "internet",
        firstname, email, phone,
        surl: window.location.origin, furl: window.location.origin,
        ...udf, hash,
        ...(sel.split ? { split_payments: sel.split } : {}),
      };

      addTid(txnid);
      const accessKey = await initiateLink({ env: EZ_ENV, params });
      const response = await openCheckout({ key, env: EZ_ENV, accessKey });

      const pr = response?.payment_response || response || {};
      const rslt = String(response?.result || pr?.status || "").toLowerCase();
      const success = rslt === "payment_successfull" || rslt === "success";
      const gatewaycharges = pr.net_amount_debit
        ? (num(pr.net_amount_debit) - num(amountStr)).toFixed(2)
        : "";

      const saved = await saveInternetPayment({
        noofmonth: month,
        onl_pymt_typ: pr.mode || "",
        banktransid: pr.bank_ref_num || "",
        gatewaycharges,
        gatewaytransid: pr.easepayid || "",
        bank_name: pr.issuing_bank || "",
        cashpaid: amountStr,
        paydoneby: userId,
        transstatus: success ? "success" : "failed",
        renewstatus: success ? "success" : "failed",
        apiopid: operatorId,
        apiuserid: userId,
        gtwy_postvals: JSON.stringify(response || {}),
      });
      removeTid(txnid);

      navigate("/cust/internet/pay/status", {
        state: {
          success: success && String(saved?.error) === "0",
          amount: amountStr,
          orderMsg: saved?.result || "",
          receiptLink: saved?.receipt_link || "",
          invoiceLink: saved?.invoice_link || "",
        },
        replace: true,
      });
    } catch (err) {
      removeTid(txnid);
      toast.add(err?.message || "Payment could not be completed.", { type: "error" });
    } finally {
      setPaying(false);
    }
  };

  if (!userId) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">No account selected.</p>
          <button onClick={() => navigate("/cust/internet")} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">
            Link an account
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button onClick={() => navigate("/cust/internet/home")} className="flex items-center gap-1 text-sm font-medium text-indigo-600">
          <ChevronLeftIcon className="w-4 h-4" /> Back
        </button>

        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Payment</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Internet · {userId}</p>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading payment details…" />
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-red-500">{error}</div>
        ) : result ? (
          <>
            {String(result.ispending).toLowerCase() === "yes" && (
              <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-300">
                You have a pending payment.
              </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 text-sm space-y-1.5">
              {result.planname && <SummaryRow label="Plan" value={result.planname} />}
              {result.current_expiry && <SummaryRow label="Current expiry" value={String(result.current_expiry).slice(0, 10)} />}
              {num(result.prevbalance) > 0 && <SummaryRow label="Previous balance" value={money(result.prevbalance)} />}
            </div>

            {/* Month selector (server-priced) */}
            {months.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
                <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Duration</label>
                <select
                  value={selIdx}
                  onChange={(e) => setSelIdx(Number(e.target.value))}
                  className="w-full border rounded-lg py-2.5 px-3 text-sm bg-gray-100 dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white focus:outline-none [&>option]:text-gray-800"
                >
                  {months.map((m, i) => (
                    <option key={i} value={i}>{m.title || `${m.month} month(s)`}</option>
                  ))}
                </select>

                {sel && (
                  <div className="text-sm space-y-1.5 pt-1">
                    <SummaryRow label="Plan rate" value={money(sel.planrate)} />
                    {sgst.value != null && <SummaryRow label={`SGST${sgst.perc ? ` (${sgst.perc})` : ""}`} value={money(sgst.value)} />}
                    {cgst.value != null && <SummaryRow label={`CGST${cgst.perc ? ` (${cgst.perc})` : ""}`} value={money(cgst.value)} />}
                    {sel.validity && <SummaryRow label="Next expiry" value={sel.validity} />}
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-baseline justify-between">
                      <span className="font-semibold text-gray-800 dark:text-gray-100">Total</span>
                      <span className="text-lg font-bold text-indigo-600 dark:text-indigo-300">{money(sel.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handlePay}
              disabled={paying || !sel}
              className="w-full py-3 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {paying ? "Processing…" : sel ? `Pay ${money(sel.total)}` : "Pay"}
            </button>
            <p className="text-center text-[11px] text-gray-400">Secured by Easebuzz</p>
          </>
        ) : null}
      </div>
    </Layout>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-gray-500 dark:text-gray-400 break-words min-w-0 pr-2">{label}</span>
      <span className="text-gray-800 dark:text-gray-200 flex-shrink-0">{value}</span>
    </div>
  );
}
