import { Navigate, useNavigate, useLocation } from "react-router-dom";
import Layout from "../../layout/Layout";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { serviceRouteBase } from "../../services/customer/serviceHome";
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/solid";

/**
 * Payment result — port of Android's PaymentStatusFragment. Reached only via
 * PaymentSummary's navigate() (state carries the result); a direct visit with
 * no state sends the user back to their service home.
 */
export default function PaymentStatus() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const location = useLocation();
  const account = getActiveAccount();
  const routeBase = serviceRouteBase(account?.servicekey);

  const s = location.state;
  if (!s) return <Navigate to={`${routeBase}/home`} replace />;

  const { success, amount, orderMsg, receiptLink, invoiceLink } = s;

  return (
    <Layout>
      <div className="px-4 py-10 max-w-2xl mx-auto w-full">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6 text-center space-y-4">
          {success ? (
            <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto" />
          ) : (
            <XCircleIcon className="w-16 h-16 text-red-500 mx-auto" />
          )}

          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              {success ? "Payment Successful" : "Payment Failed"}
            </h1>
            {amount && (
              <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-300">₹{amount}</p>
            )}
            {orderMsg && (
              <p className="text-sm text-gray-500 dark:text-gray-400 break-words">{orderMsg}</p>
            )}
            {!success && !orderMsg && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Your payment could not be completed. If money was debited it will be refunded automatically.
              </p>
            )}
          </div>

          {success && (receiptLink || invoiceLink) && (
            <div className="flex gap-2">
              {receiptLink && <DocLink href={receiptLink} label="Receipt" />}
              {invoiceLink && <DocLink href={invoiceLink} label="Invoice" />}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={() => navigate(`${routeBase}/home`)}
              className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
            >
              Back to Home
            </button>
            <button
              onClick={() => navigate(`${routeBase}/orders`)}
              className="w-full py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold"
            >
              View Orders
            </button>
          </div>
        </div>
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
      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-indigo-500 text-indigo-600 text-sm font-medium"
    >
      {label} <ArrowTopRightOnSquareIcon className="w-4 h-4" />
    </a>
  );
}
