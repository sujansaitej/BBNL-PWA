import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, Pagination } from "swiper/modules";
// Swiper ships no global stylesheet in this app — Dashboard.jsx imports these
// per-page. Without them here the carousel renders as an unstyled stack of
// full-width images whenever this page is the first one to mount Swiper.
import "swiper/css";
import "swiper/css/pagination";
import Layout from "../../layout/Layout";
import { Loader, ConfirmDialog, Alert } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { useAds } from "../../hooks/useAds";
import { fixImageUrl } from "../../services/iptvImage";
import { getUserAssignedItems, getMyPlanDetails } from "../../services/generalApis";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { isPrimaryBox, cloudUploadEligibility } from "../../services/customer/cloudUpload";
import {
  resetMac,
  connectionsFor,
  planRowFor,
  formatExpiry,
  isRenewEnabled,
  isPkgSelectionEnabled,
  serviceTitle,
  showsInternetActions,
  serviceRouteBase,
} from "../../services/customer/serviceHome";
import {
  TicketIcon,
  ClipboardDocumentListIcon,
  ArrowPathIcon,
  ChartPieIcon,
  GlobeAltIcon,
  ChevronLeftIcon,
  CloudArrowUpIcon,
} from "@heroicons/react/24/outline";

/**
 * Service home — port of Android's CommonHomeScreenFragment.
 *
 * Reached from the linked-account "Choose option" sheet → "Home Page". The
 * active account (set by InternetLink) supplies every identifier; there is no
 * route param, so deep-linking here without a linked account sends the user
 * back to link one.
 *
 * Load order mirrors Android: ads and connections fire together, then the
 * connection selection drives the plan-details call. Plan details is a
 * SECOND-ORDER call — it depends on which connection is selected, so it
 * cannot be fired in parallel with the rest.
 */
export default function ServiceHome() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const toast = useToast();
  const user = getUser();
  const account = getActiveAccount();

  const servicekey = account?.servicekey || "internet";
  const userId = account?.userid || "";

  // Ads — same operator-managed feed the dashboard shows; the hook
  // revalidates it, so added/removed banners appear without a reload.
  const { adList, adCount, adLoading } = useAds("custapp");

  // Connections
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState("");
  const [connLoading, setConnLoading] = useState(true);

  // Plan
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");

  // Reset MAC
  const [confirmMac, setConfirmMac] = useState(false);
  const [macBusy, setMacBusy] = useState(false);
  const [macResult, setMacResult] = useState(null); // { type, title, message }

  // ── Connections ────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setConnLoading(true);
      try {
        const res = await getUserAssignedItems(servicekey, userId);
        if (cancelled) return;
        const rows = connectionsFor(res?.body, servicekey);
        setConnections(rows);
        // Android auto-selects index 0, which is what triggers plan details.
        setSelectedConn(rows[0]?.product_name || "");
      } catch {
        if (!cancelled) setConnections([]);
      } finally {
        if (!cancelled) setConnLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, servicekey]);

  // ── Plan details — depends on the selected connection ──────────────
  useEffect(() => {
    if (!userId || connLoading) return;
    let cancelled = false;
    (async () => {
      setPlanLoading(true);
      setPlanError("");
      try {
        const isFofiLike = servicekey === "fofi" || servicekey === "cabletv";
        const isVoice = servicekey === "voicecall" || servicekey === "voice";
        const res = await getMyPlanDetails({
          servicekey,
          userid: userId,
          // Android sends the selected connection only for fofi/cabletv
          // (fofiboxid) and voicecall (voipnumber). For internet BOTH stay
          // empty — the selected internet id is deliberately not sent.
          fofiboxid: isFofiLike ? selectedConn : "",
          voipnumber: isVoice ? selectedConn : "",
        });
        if (cancelled) return;
        setPlan(res?.body || null);
        if (!res?.body) setPlanError(res?.status?.err_msg || "Plan details are not available.");
      } catch (err) {
        if (!cancelled) setPlanError(err?.message || "Couldn't load your plan details.");
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, servicekey, selectedConn, connLoading]);

  const planRow = useMemo(() => planRowFor(plan, servicekey), [plan, servicekey]);

  // The cloud album is addressed by the box's SERIAL NUMBER (fserialno), not
  // by the box id the selector displays — see services/customer/cloudUpload.js
  // for why that column is misnamed. So the upload screen needs the whole row,
  // not just `selectedConn`.
  const selectedRow = useMemo(
    () => connections.find((c) => c.product_name === selectedConn) || connections[0] || null,
    [connections, selectedConn]
  );

  // Android gates the cloud icon on exactly these two service keys
  // (CommonHomeScreenFragment: `serviceKey.equals("fofi") ||
  // serviceKey.equals("cabletv")`); every other service hides it.
  const showsCloudUpload = servicekey === "fofi" || servicekey === "cabletv";

  const title = serviceTitle(servicekey);
  const showActions = showsInternetActions(servicekey);
  // Direct "Proceed"/Renew shows ONLY when other_service_renewal is enabled
  // (native: proceed_btn_rl). cabletv's package/channel selection is a SEPARATE
  // single button below, gated on chnls_pkgs_selection.
  const canRenew = isRenewEnabled(plan);
  const routeBase = serviceRouteBase(servicekey);
  // Every service now opens its live payment screen at {base}/pay. Internet →
  // InternetPaymentSummary (makepayment/savePaymentApi); FoFi/IPTV →
  // PaymentSummary (paymentinfo/generateorder). Both share the Easebuzz layer.
  const proceedPath = `${routeBase}/pay`;

  const doResetMac = async () => {
    setConfirmMac(false);
    setMacBusy(true);
    try {
      const res = await resetMac({ userid: userId });
      setMacResult(
        res.ok
          ? { type: "success", title: "Mac reset successful", message: "Please reconnect your device to continue." }
          : { type: "error", title: "Sorry!", message: res.message || "Could not reset the MAC." }
      );
    } catch (err) {
      setMacResult({ type: "error", title: "Sorry!", message: err?.message || "Could not reset the MAC." });
    } finally {
      setMacBusy(false);
    }
  };

  // No linked account → nothing to show. Send them to link one.
  if (!account?.userid) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <GlobeAltIcon className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No account selected yet.
          </p>
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

  const ACTIONS = [
    { id: "raise", label: "Raise Ticket", Icon: TicketIcon, onClick: () => navigate("/cust/internet/raise-ticket") },
    { id: "status", label: "Ticket Status", Icon: ClipboardDocumentListIcon, onClick: () => navigate("/cust/internet/ticket-status") },
    { id: "mac", label: "Reset Mac", Icon: ArrowPathIcon, onClick: () => setConfirmMac(true) },
    { id: "usage", label: "Data Usage", Icon: ChartPieIcon, onClick: () => navigate("/cust/internet/usage") },
  ];

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate(routeBase)}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Accounts
        </button>

        {/* Header — Name / User Id / Service */}
        <div className="rounded-xl shadow overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-4 flex items-center gap-3">
            {/* SOLID white plate, not bg-white/20.
                This tile sits on the indigo→blue gradient, and what goes in it
                is operator-uploaded plan artwork — in practice a dark navy
                logo. A 20% white tint over indigo is still a dark surface, so
                a dark logo landed on it almost invisibly, which is what the
                header looked "not clearly visible" from.
                A solid plate makes ANY artwork legible regardless of its
                colours — the same reasoning BrandLogo uses for the app logo,
                and the reason it cannot just be a lighter tint. */}
            {planRow?.imgurl ? (
              <img
                src={planRow.imgurl}
                alt=""
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                className="w-12 h-12 rounded-lg bg-white dark:bg-gray-800 object-contain p-1 flex-shrink-0 ring-1 ring-black/5"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                <GlobeAltIcon className="w-6 h-6 text-white" />
              </div>
            )}
            <div className="min-w-0 text-sm space-y-0.5">
              <div className="flex gap-2">
                <span className="w-14 flex-shrink-0 text-white/70">Name</span>
                <span className="text-white font-medium break-words min-w-0">
                  {account.name || `${user?.firstname || ""} ${user?.lastname || ""}`.trim() || "—"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="w-14 flex-shrink-0 text-white/70">User Id</span>
                <span className="text-white font-medium break-words min-w-0">{account.userid}</span>
              </div>
            </div>
          </div>
          <div className="bg-indigo-700/90 py-2 text-center text-sm font-medium text-white">
            Service : {title}
          </div>
        </div>

        {/* Ad carousel */}
        {adLoading ? (
          <div className="aspect-[16/9] rounded-2xl skeleton dark:skeleton-dark" />
        ) : adCount > 0 ? (
          <Swiper
            /* Re-key on the slide count so a changed banner list
               re-initialises loop + pagination instead of leaving
               stale dots behind. */
            key={adCount}
            spaceBetween={10}
            slidesPerView={1}
            centeredSlides
            loop={adCount >= 3}
            speed={500}
            grabCursor
            observer
            observeParents
            modules={[Autoplay, Pagination]}
            autoplay={{ delay: 3000, disableOnInteraction: false, pauseOnMouseEnter: true }}
            pagination={adCount > 1 ? { clickable: true } : false}
            className="ad-swiper"
          >
            {adList.map((ad, i) => (
              <SwiperSlide key={ad.id || i}>
                <img
                  src={fixImageUrl(ad.content)}
                  alt=""
                  className="w-full aspect-[16/9] object-cover rounded-2xl"
                  loading="lazy"
                />
              </SwiperSlide>
            ))}
          </Swiper>
        ) : null}

        {/* Four action icons — internet only, exactly as Android gates them */}
        {showActions && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
            <div className="grid grid-cols-4 gap-2">
              {ACTIONS.map(({ id, label, Icon, onClick }) => (
                <button
                  key={id}
                  onClick={onClick}
                  disabled={id === "mac" && macBusy}
                  className="flex flex-col items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-indigo-600 dark:text-indigo-300" />
                  </span>
                  <span className="text-[11px] leading-tight text-center text-gray-600 dark:text-gray-300">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Service label + connection selector */}
        <div>
          <p className="px-1 pb-1.5 text-sm font-semibold text-orange-500">{title}</p>
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-lg px-3 py-2.5 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {connLoading ? (
                <p className="text-sm text-white/80">Fetching connection details…</p>
              ) : connections.length === 0 ? (
                // Android dereferences a null list here and crashes.
                <p className="text-sm text-white/90">{account.userid}</p>
              ) : connections.length === 1 ? (
                <p className="text-sm font-medium text-white break-words">
                  {connections[0].product_name || account.userid}
                </p>
              ) : (
                <select
                  value={selectedConn}
                  onChange={(e) => setSelectedConn(e.target.value)}
                  className="w-full bg-transparent text-sm font-medium text-white focus:outline-none [&>option]:bg-white dark:bg-gray-800 [&>option]:text-gray-800 dark:text-gray-100 dark:[&>option]:bg-gray-900 dark:[&>option]:text-white"
                >
                  {connections.map((c, i) => (
                    <option key={c.fserialno || i} value={c.product_name}>
                      {c.product_name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Cloud album upload — Android's img_upload_screen_saver, in the
                same place: the right edge of the box selector bar.
                Disabled rather than hidden until the connection list resolves,
                so the bar does not reflow when it does. Without fserialno the
                upload endpoint cannot address a box at all, so there is nothing
                to navigate to. */}
            {showsCloudUpload && (
              <button
                onClick={() =>
                  navigate(`${routeBase}/cloud`, {
                    state: {
                      boxid: selectedRow?.product_name || "",
                      serialno: selectedRow?.fserialno || "",
                      primary: isPrimaryBox(selectedRow),
                      // Decided HERE, from the row, so the upload screen can
                      // explain a TV-app device instead of uploading into
                      // "Invalid User ID".
                      eligibility: cloudUploadEligibility(selectedRow),
                    },
                  })
                }
                disabled={connLoading || !selectedRow?.fserialno}
                aria-label="Upload photos to cloud album"
                title="Upload photos to cloud album"
                className="flex-shrink-0 p-1.5 rounded-lg text-white hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <CloudArrowUpIcon className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>

        {/* Plan details */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <p className="text-center text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
            Plan Details
          </p>
          {planLoading ? (
            <div className="py-4 flex justify-center">
              <Loader size="sm" color="indigo" text="Fetching plan details…" />
            </div>
          ) : planError ? (
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">{planError}</p>
          ) : (
            <div className="text-sm space-y-1.5">
              <Row label="Plan Name" value={planRow?.planname || "Not Available"} />
              <Row label="Exp Date" value={formatExpiry(planRow?.expirydate, servicekey) || "Not Available"} />
            </div>
          )}

          {canRenew && (
            <button
              onClick={() => navigate(proceedPath, {
                // FoFi/IPTV summary needs the selected box + plan; internet's
                // history screen ignores state.
                state: { fofiboxid: selectedConn, planid: plan?.planid, priceid: plan?.priceid },
              })}
              className="mt-4 w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-semibold"
            >
              Proceed
            </button>
          )}

          {/* cabletv — one merged button to the selection screen, matching
              native's single "Select Packages and Channels" (package_selection_tv;
              the separate "Select Channels" button is hidden in native too). */}
          {servicekey === "cabletv" && isPkgSelectionEnabled(plan) && (
            <button
              onClick={() => navigate("/cust/iptv/select", { state: { fofiboxid: selectedConn } })}
              className={`w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-semibold ${canRenew ? "mt-3" : "mt-4"}`}
            >
              Select Packages and Channels
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmMac}
        title="Reset Mac"
        message="This will clear the MAC bound to your connection and may disconnect the device you're using right now. Continue?"
        onConfirm={doResetMac}
        onCancel={() => setConfirmMac(false)}
      />

      <Alert
        isOpen={!!macResult}
        onClose={() => setMacResult(null)}
        type={macResult?.type}
        title={macResult?.title}
        message={macResult?.message}
      />
    </Layout>
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
