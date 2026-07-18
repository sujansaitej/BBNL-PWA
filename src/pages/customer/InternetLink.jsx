import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader, Modal, ConfirmDialog } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import {
  resolveService,
  linkServiceAccount,
  verifyServiceOtp,
  getLinkedAccounts,
  removeLinkedAccount,
  getActiveAccount,
  setActiveAccount,
  clearActiveAccount,
} from "../../services/customer/linkAccount";
import {
  GlobeAltIcon,
  UserCircleIcon,
  CheckCircleIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  BanknotesIcon,
  DocumentArrowUpIcon,
} from "@heroicons/react/24/outline";

const SERVICE_KEYWORD = "internet";

/**
 * Internet — link a service account.
 *
 * Port of Android's LinkCableAccounts_Fragment. A customer's app login carries
 * no service identity, so before anything service-specific works they enter
 * their Internet user id here. A successful link yields the userid / servid /
 * opid / address that every downstream service call needs.
 *
 * The backend decides whether an OTP is required (body.otpstatus === "yes").
 * Until that OTP is verified NOTHING is linked, so the two-step path is not
 * optional — accounts configured for OTP simply cannot link without it.
 */
export default function InternetLink() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const toast = useToast();
  const user = getUser();
  const appUsername = user?.username || "";

  // Service (id / title / icon) resolved from servServiceList by keyword.
  const [service, setService] = useState(null);
  const [svcLoading, setSvcLoading] = useState(true);
  const [svcError, setSvcError] = useState("");

  // Link form
  const [userId, setUserId] = useState("");
  const [linking, setLinking] = useState(false);

  // OTP step — populated only when the backend demands one
  const [otp, setOtp] = useState(null); // { otprefid, otpTotChars, otpDataType, userid }
  const [otpCode, setOtpCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  // Linked accounts
  const [accounts, setAccounts] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [active, setActive] = useState(getActiveAccount());

  // Row actions
  const [sheetFor, setSheetFor] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removing, setRemoving] = useState(false);

  // ── Resolve the service, then load its linked accounts ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSvcLoading(true);
      setSvcError("");
      try {
        const svc = await resolveService(SERVICE_KEYWORD);
        if (cancelled) return;
        if (!svc) {
          setSvcError("Internet service is not available on your account right now.");
          return;
        }
        setService(svc);
        loadAccounts(svc);
      } catch {
        if (!cancelled) setSvcError("Couldn't load the service. Please try again.");
      } finally {
        if (!cancelled) setSvcLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAccounts = async (svc) => {
    const s = svc || service;
    if (!s) return;
    setListLoading(true);
    try {
      const rows = await getLinkedAccounts({
        servid: s.servid,
        username: appUsername,
        servicekey: s.servicekey,
      });
      setAccounts(rows);
    } catch {
      // A failed list must not block linking — the form above still works.
      setAccounts([]);
    } finally {
      setListLoading(false);
    }
  };

  // ── Link ───────────────────────────────────────────────────────────
  const handleLink = async () => {
    if (!service) return;
    // Android validates on the trimmed value but sends the raw text. We trim
    // both — a trailing space in a user id is never intentional.
    const id = userId.trim();
    if (!id) {
      toast.add("Please enter the user id!", { type: "error" });
      return;
    }
    if (linking) return;

    setLinking(true);
    try {
      const res = await linkServiceAccount({
        username: appUsername,
        servicekey: service.servicekey,
        userid: id,
      });

      if (!res.ok) {
        toast.add(res.message || "Could not link this user id.", { type: "error" });
        return;
      }
      if (res.needsOtp) {
        setOtp({
          otprefid: res.otprefid,
          otpTotChars: res.otpTotChars,
          otpDataType: res.otpDataType,
          userid: id,
        });
        setOtpCode("");
        toast.add("Enter the OTP sent to your registered mobile.", { type: "info" });
        return;
      }
      onLinked(res.account, res.message);
    } catch (err) {
      toast.add(err?.message || "Could not link this user id.", { type: "error" });
    } finally {
      setLinking(false);
    }
  };

  // ── Verify OTP ─────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!service || !otp) return;
    if (!otpCode.trim()) {
      toast.add("Please enter the OTP.", { type: "error" });
      return;
    }
    if (verifying) return;

    setVerifying(true);
    try {
      const res = await verifyServiceOtp({
        username: appUsername,
        otprefid: otp.otprefid,
        otpcode: otpCode.trim(),
        servicekey: service.servicekey,
        userid: otp.userid,
      });
      if (!res.ok) {
        toast.add(res.message || "That OTP wasn't accepted. Please try again.", { type: "error" });
        return;
      }
      setOtp(null);
      setOtpCode("");
      onLinked(res.account, res.message);
    } catch (err) {
      toast.add(err?.message || "Could not verify the OTP.", { type: "error" });
    } finally {
      setVerifying(false);
    }
  };

  // Shared success path for both the direct and the OTP route.
  const onLinked = (account, message) => {
    setUserId("");
    if (account?.userid) {
      setActiveAccount(account);
      setActive(account);
    }
    toast.add(message || "Account linked successfully.", { type: "success" });
    loadAccounts();
  };

  // ── Row actions ────────────────────────────────────────────────────
  /**
   * Make `acc` the active account, then navigate.
   *
   * Android writes service_user_id / service_username / user_mobile /
   * cust_address / operatior_id to SharedPreferences before every one of
   * these jumps, because the destination fragments read prefs rather than
   * arguments. Persisting the whole account object is the same contract with
   * one write instead of five — and it cannot go half-applied.
   */
  const goWithAccount = (acc, path) => {
    if (!acc?.userid) return;
    setActiveAccount(acc);
    setActive(acc);
    setSheetFor(null);
    navigate(path);
  };

  /**
   * Upload Docs reuses the existing /upload-documents page, which is written
   * for the operator flow and reads its subject from `location.state.customer`.
   * We synthesise that shape from the linked account so the page works
   * unchanged — customer_id is the field it keys every KYC call on.
   */
  const goToUploadDocs = (acc) => {
    if (!acc?.userid) return;
    setActiveAccount(acc);
    setActive(acc);
    setSheetFor(null);
    navigate("/upload-documents", {
      state: {
        customer: {
          customer_id: acc.userid,
          username: acc.userid,
          name: acc.name,
          mobile: acc.mobileno,
          mobileno: acc.mobileno,
          address: acc.address,
          op_id: acc.opid,
        },
      },
    });
  };

  const doRemove = async () => {
    const acc = confirmRemove;
    setConfirmRemove(null);
    if (!acc) return;
    setRemoving(true);
    try {
      // delServRegCasNos keys on castregid, NOT userid.
      const res = await removeLinkedAccount({ regid: acc.castregid });
      if (res.ok) {
        toast.add(res.message || "Account removed.", { type: "success" });
        // If we just unlinked the active account, stop pointing at it.
        if (active?.userid === acc.userid) {
          clearActiveAccount();
          setActive(null);
        }
        loadAccounts();
      } else {
        toast.add(res.message || "Could not remove this account.", { type: "error" });
      }
    } catch (err) {
      toast.add(err?.message || "Could not remove this account.", { type: "error" });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {svcLoading ? (
          <div className="py-16 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading service…" />
          </div>
        ) : svcError ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center space-y-3">
            <ExclamationTriangleIcon className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="text-sm text-gray-700 dark:text-gray-300">{svcError}</p>
            <button
              onClick={() => navigate("/cust/dashboard")}
              className="text-sm font-medium text-indigo-600"
            >
              Back to dashboard
            </button>
          </div>
        ) : (
          <>
            {/* Service header */}
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-xl shadow p-4 flex items-center gap-3">
              {service?.iconUrl ? (
                <img
                  src={service.iconUrl}
                  alt=""
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  className="w-11 h-11 rounded-lg bg-white/20 object-contain p-1 flex-shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                  <GlobeAltIcon className="w-6 h-6 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-white">{service?.title || "Internet"}</h1>
                {service?.description && (
                  <p className="text-xs text-white/80 break-words">{service.description}</p>
                )}
              </div>
            </div>

            {/* Active account */}
            {active && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-3 flex items-center gap-2">
                <CheckCircleIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-gray-800 dark:text-gray-100 break-words">
                    Using {active.userid}
                  </p>
                  {active.name && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 break-words">{active.name}</p>
                  )}
                </div>
              </div>
            )}

            {/* Link form / OTP step */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
              {!otp ? (
                <>
                  <input
                    type="text"
                    value={userId}
                    maxLength={30}
                    onChange={(e) => setUserId(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleLink(); }}
                    placeholder="Enter User Id"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full text-center border rounded-lg py-2.5 px-3 text-sm bg-gray-100 dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white placeholder:text-indigo-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    onClick={handleLink}
                    disabled={linking || !userId.trim()}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {linking ? "Linking account…" : "Link account"}
                  </button>
                </>
              ) : (
                <>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Verify it's you
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      We sent a code to the mobile registered against{" "}
                      <span className="font-medium">{otp.userid}</span>.
                    </p>
                  </div>
                  <input
                    type="text"
                    value={otpCode}
                    maxLength={otp.otpTotChars || 6}
                    inputMode={otp.otpDataType === "numeric" ? "numeric" : "text"}
                    onChange={(e) => setOtpCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                    placeholder={"•".repeat(otp.otpTotChars || 4)}
                    autoComplete="one-time-code"
                    className="w-full text-center tracking-[0.5em] border rounded-lg py-2.5 px-3 text-base bg-gray-100 dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    onClick={handleVerify}
                    disabled={verifying || !otpCode.trim()}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {verifying ? "Verifying…" : "Verify & link"}
                  </button>
                  <button
                    onClick={() => { setOtp(null); setOtpCode(""); }}
                    className="w-full py-2 text-sm font-medium text-gray-500 dark:text-gray-400"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {/* Recently added */}
            <div>
              <p className="px-1 pb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Recently added account
              </p>
              {listLoading ? (
                <div className="py-8 flex justify-center">
                  <Loader size="md" color="indigo" text="Loading accounts…" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  No ids linked yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {accounts.map((a) => (
                    <button
                      key={a.userid}
                      onClick={() => setSheetFor(a)}
                      className="w-full text-left bg-white dark:bg-gray-800 rounded-xl shadow p-3 flex items-center gap-3 hover:ring-2 hover:ring-indigo-200 dark:hover:ring-indigo-800 transition"
                    >
                      <UserCircleIcon className="w-9 h-9 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 break-words">
                          {a.userid}
                        </p>
                        {a.name && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 break-words">{a.name}</p>
                        )}
                      </div>
                      {active?.userid === a.userid && (
                        <span className="text-[11px] font-semibold text-green-600 bg-green-50 dark:bg-green-900/30 rounded px-2 py-0.5 flex-shrink-0">
                          Active
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Row action sheet — Android's "Choose option" dialog.
          Same five entries, in the same order:
          Home Page / Remove Account / Payment History / Cancel / Upload Docs.
          Every destination needs this row to be the ACTIVE account first,
          because the downstream screens read it rather than taking params —
          the web equivalent of Android writing SharedPreferences before it
          navigates. */}
      <Modal isOpen={!!sheetFor} onClose={() => setSheetFor(null)} title="Choose option">
        <div className="space-y-2">
          <p className="pb-1 text-sm font-medium text-gray-500 dark:text-gray-400 break-words">
            {sheetFor?.userid}
          </p>

          <SheetButton
            Icon={HomeIcon}
            label="Home Page"
            primary
            onClick={() => goWithAccount(sheetFor, "/cust/internet/home")}
          />
          <SheetButton
            Icon={TrashIcon}
            label="Remove Account"
            danger
            disabled={removing}
            onClick={() => { const a = sheetFor; setSheetFor(null); setConfirmRemove(a); }}
          />
          <SheetButton
            Icon={BanknotesIcon}
            label="Payment History"
            onClick={() => goWithAccount(sheetFor, "/cust/internet/payments")}
          />
          <SheetButton
            Icon={DocumentArrowUpIcon}
            label="Upload Docs"
            onClick={() => goToUploadDocs(sheetFor)}
          />
          <SheetButton label="Cancel" onClick={() => setSheetFor(null)} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove ID"
        message={`Are you sure you want to remove ${confirmRemove?.userid || "this id"}?`}
        onConfirm={doRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </Layout>
  );
}

function SheetButton({ Icon, label, onClick, primary, danger, disabled }) {
  const tone = primary
    ? "bg-indigo-600 text-white"
    : danger
    ? "border border-red-500 text-red-600"
    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${tone}`}
    >
      {Icon && <Icon className="w-4 h-4" />} {label}
    </button>
  );
}
