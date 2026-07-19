import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { getMyPlanDetails } from "../../services/generalApis";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { serviceRouteBase, serviceTitle } from "../../services/customer/serviceHome";
import {
  getServicePaymentInfo,
  getPlanExtensionPeriods,
  getIptvLastSubscribed,
  killServiceTxn,
  generateServiceOrder,
  servidFor,
} from "../../services/customer/servicePayment";
import {
  buildPaymentHash,
  initiateLink,
  openCheckout,
  EZ_ENV,
  resolveCreds,
  readTids,
  addTid,
  removeTid,
} from "../../services/customer/easebuzz";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

const money = (v) => `₹${Number(v || 0).toFixed(2)}`;

/**
 * Payment summary + Pay Now — port of Android's CommonPaymentInfoFragment.
 *
 * Reached from ServiceHome's Proceed/Renew. Flow (cabletv adds two pre-steps):
 *   [cabletv] iptvLastSubscribedinfo → channel/package ids for the renewal
 *   [cabletv] planExtensionPeriods   → cblextenperiod = days_range.max
 *   paymentinfo/{service}            → bill + transactionid + easebuzz creds
 *   Pay Now → hash → initiateLink → checkout modal → generateorder → status
 */
export default function PaymentSummary() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const user = getUser();
  const account = getActiveAccount();

  const servicekey = String(account?.servicekey || "").toLowerCase();
  const isCabletv = servicekey === "cabletv";
  const routeBase = serviceRouteBase(servicekey);
  const servid = account?.serviceListId || servidFor(servicekey);
  const appUsername = user?.username || "";

  // Passed from ServiceHome (selected box + plan). Deep-links fall back to a
  // getMyPlanDetails fetch below.
  const nav = location.state || {};

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);   // paymentinfo body
  const [paying, setPaying] = useState(false);
  // Renewal context assembled before paymentinfo (ids + extension period).
  const ctx = useRef({ fofiBoxId: "", planid: "", priceid: "", cblextenperiod: "", channelid: [], packageid: [], lcochid: [], pkgcode: [] });

  useEffect(() => {
    if (!account?.userid) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const c = ctx.current;
        c.fofiBoxId = nav.fofiboxid || "";
        c.planid = nav.planid || "";
        c.priceid = nav.priceid || "";

        // Fallback: no plan passed (deep link) → fetch it.
        if (!c.planid) {
          const pd = await getMyPlanDetails({
            servicekey, userid: account.userid,
            fofiboxid: c.fofiBoxId, voipnumber: "",
          });
          c.planid = pd?.body?.planid || "";
          c.priceid = pd?.body?.priceid || "";
        }

        // cabletv: last-subscription ids + extension days (native pre-steps).
        if (isCabletv) {
          try {
            const last = await getIptvLastSubscribed({ userid: account.userid, itemid: c.fofiBoxId });
            const b = last?.body || {};
            const packageid = Array.isArray(b.packageid) ? b.packageid : [];
            const channelid = Array.isArray(b.channelid) ? b.channelid : [];
            c.packageid = packageid;
            // IPTV: package codes ARE the package ids ("package ids and package
            // codes are same in IPTV"). iptvLastSubscribedinfo has no pkgcode.
            c.pkgcode = packageid;
            // The backend renews by PACKAGE. iptvLastSubscribedinfo ALSO returns
            // the expanded channel list of those packages, but re-submitting it
            // is rejected ("Invalid channel id's") — verified live: packages-only
            // succeeds, channels+packages fails. So send channels ONLY for an
            // a-la-carte box (one with no packages).
            c.channelid = packageid.length > 0 ? [] : channelid;
            c.lcochid = [];
          } catch { /* best-effort — paymentinfo will report if nothing renewable */ }
          try {
            const ext = await getPlanExtensionPeriods({ userid: account.userid, itemid: c.fofiBoxId });
            c.cblextenperiod = ext?.body?.days_range?.max || "";
          } catch { /* best-effort */ }
        }

        let res = await fetchInfo(c);
        // Stale-txn guard: kill a previously-abandoned tid, then re-fetch once.
        const tid = res?.body?.transactionid;
        if (tid && readTids().includes(tid)) {
          try { await killServiceTxn({ userid: account.userid, username: appUsername, servid, transactionid: tid }); } catch { /* ignore */ }
          removeTid(tid);
          res = await fetchInfo(c);
        }
        if (cancelled) return;

        const code = Number(res?.status?.err_code);
        if (code !== 0 || !res?.body) {
          setError(res?.status?.err_msg || "Payment details are not available.");
          return;
        }
        setInfo(res.body);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Couldn't load the payment details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.userid, servicekey]);

  const fetchInfo = (c) =>
    getServicePaymentInfo({
      servicekey, userid: account.userid, username: appUsername, servid,
      planid: c.planid, priceid: c.priceid, fofiBoxId: c.fofiBoxId,
      channelid: c.channelid, packageid: c.packageid, lcochid: c.lcochid,
      pkgcode: c.pkgcode, cblextenperiod: c.cblextenperiod,
    });

  const handlePay = async () => {
    if (!info || paying) return;
    const amountStr = Number(info.total_amt || 0).toFixed(2);
    if (Number(amountStr) < 1) {
      toast.add("Amount should be greater than 1.", { type: "error" });
      return;
    }

    const { key, salt } = resolveCreds(info.easebuzzpay_cred);

    const txnid = info.transactionid;
    if (!txnid) { toast.add("Missing transaction reference. Please retry.", { type: "error" }); return; }

    const c = ctx.current;
    const firstname = String(account.name || "Customer").trim();
    // Easebuzz rejects an empty/invalid email or a non-10-digit phone at
    // initiateLink (verified via a live probe), so fall back to valid-format
    // placeholders when the account carries none.
    const email = account.emailid || user?.email || user?.emailid || "no-reply@bbnl.in";
    const rawPhone = String(account.mobileno || user?.mobile || user?.mobileno || "").replace(/\D/g, "");
    const phone = rawPhone.length === 10 ? rawPhone : "9999999999";
    const operatorId = account.opid || "";

    // udf5 — Base64 JSON, exactly the native field set (formUdf5JSON).
    const udf5 = btoa(JSON.stringify({
      fofiboxid: c.fofiBoxId, voipnumber: "", planid: c.planid, priceid: c.priceid,
      cblextenperiod: c.cblextenperiod, servid: String(servid),
      channelid: c.channelid, packageid: c.packageid, lcochid: c.lcochid, pkgcode: c.pkgcode,
      loginuname: appUsername, trialdays: "0",
    }));

    const udf = { udf1: "1", udf2: account.userid, udf3: "serviceapp", udf4: operatorId, udf5 };

    setPaying(true);
    try {
      const hash = await buildPaymentHash({
        key, txnid, amount: amountStr, productinfo: servicekey,
        firstname, email, ...udf, salt,
      });

      const params = {
        key, txnid, amount: amountStr, productinfo: servicekey,
        firstname, email, phone,
        surl: window.location.origin, furl: window.location.origin,
        ...udf, hash,
        // Revenue split — native passes body.bussinessshare_json as
        // split_payments (CommonPaymentInfoFragment:416,716). The FoFi Easebuzz
        // account is a split/marketplace merchant: WITHOUT this, a transaction
        // carries no settlement instruction and Easebuzz errors "Payment
        // settlement not set properly". Not part of the hash.
        ...(info.bussinessshare_json ? { split_payments: info.bussinessshare_json } : {}),
      };

      addTid(txnid);
      const accessKey = await initiateLink({ env: EZ_ENV, params });
      const response = await openCheckout({ key, env: EZ_ENV, accessKey });

      // Native parses payment_response for the gateway/bank ids.
      const pr = response?.payment_response || response || {};
      const result = String(response?.result || pr?.status || "").toLowerCase();
      const success = result === "payment_successfull" || result === "success";

      const order = await finalize({
        c, txnid, amountStr,
        gatewaytxnid: pr.easepayid || "",
        banktxnid: pr.bank_ref_num || "",
        bankname: pr.issuing_bank || "",
        payrequest: JSON.stringify(params),
        payresponse: JSON.stringify(response || {}),
        txnstatus: success ? "success" : "failed",
      });
      removeTid(txnid);

      navigate(`${routeBase}/pay/status`, {
        state: {
          success,
          amount: amountStr,
          orderMsg: order?.status?.err_msg || "",
          receiptLink: order?.body?.receipt_link || "",
          invoiceLink: order?.body?.invoice_link || "",
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

  const finalize = ({ c, txnid, amountStr, gatewaytxnid, banktxnid, bankname, payrequest, payresponse, txnstatus }) =>
    generateServiceOrder({
      userid: account.userid, username: appUsername, servid, paidamount: amountStr,
      gatewaytxnid, banktxnid, bankname, transactionid: txnid,
      fofiboxid: c.fofiBoxId, planid: c.planid, priceid: c.priceid,
      channelid: c.channelid, packageid: c.packageid, pkgcode: c.pkgcode, lcochid: c.lcochid,
      cblextenperiod: c.cblextenperiod, payrequest, payresponse, txnstatus,
    });

  if (!account?.userid) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">No account selected.</p>
          <button onClick={() => navigate(routeBase)} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">
            Link an account
          </button>
        </div>
      </Layout>
    );
  }

  const taxes = Array.isArray(info?.tax_details) ? info.tax_details : [];
  const showNcf = String(info?.ncf_display || "").toLowerCase() === "yes";

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button onClick={() => navigate(`${routeBase}/home`)} className="flex items-center gap-1 text-sm font-medium text-indigo-600">
          <ChevronLeftIcon className="w-4 h-4" /> Back
        </button>

        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Payment</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {serviceTitle(servicekey)} · {account.userid}
          </p>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading payment details…" />
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-red-500">{error}</div>
        ) : info ? (
          <>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 text-sm">
              {info.planname && <SummaryRow label="Plan" value={info.planname} />}
              <SummaryRow label="Plan rate" value={money(info.planrate)} />
              {taxes.map((t, i) => (
                <SummaryRow key={i} label={`${t.title}${t.percent ? ` (${t.percent})` : ""}`} value={money(t.amt)} />
              ))}
              {showNcf && <SummaryRow label="NCF" value={money(info.ncf)} />}
              {Number(info.other_amt) > 0 && <SummaryRow label="Other" value={money(info.other_amt)} />}
              {Number(info.discount_amt) > 0 && <SummaryRow label="Discount" value={`- ${money(info.discount_amt)}`} />}
              {Number(info.balance_amt) > 0 && <SummaryRow label="Balance" value={money(info.balance_amt)} />}
              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-baseline justify-between">
                <span className="font-semibold text-gray-800 dark:text-gray-100">Total</span>
                <span className="text-lg font-bold text-indigo-600 dark:text-indigo-300">{money(info.total_amt)}</span>
              </div>
            </div>

            <button
              onClick={handlePay}
              disabled={paying}
              className="w-full py-3 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {paying ? "Processing…" : `Pay ${money(info.total_amt)}`}
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
