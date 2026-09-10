import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import BrandLogo from "./BrandLogo";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { Bars3Icon, EllipsisVerticalIcon, TvIcon } from '@heroicons/react/24/outline'
import { getUser } from "../services/safeStorage";
import { useAuth } from "../context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui";
import { decodeQrLoginToken, getNetmonLoginLink, verifyQrLogin } from "../services/qrAuth";

// Same lazy-loaded scanner FoFiSmartBox uses — the camera stack is ~145 kB and
// must not sit in the header's critical path.
const QRScanner = lazy(() => import("./QRScanner"));

export default function Header({ onOpenSidebar }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { logout: endSession } = useAuth();
  const headerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const setHeaderHeight = () => {
      document.documentElement.style.setProperty(
        "--app-header-height",
        `${header.getBoundingClientRect().height}px`
      );
    };

    setHeaderHeight();
    window.addEventListener("resize", setHeaderHeight);

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(setHeaderHeight)
      : null;
    resizeObserver?.observe(header);

    return () => {
      window.removeEventListener("resize", setHeaderHeight);
      resizeObserver?.disconnect();
    };
  }, []);

  // Dismiss on outside click / Escape, so the menu can't be left stranded open
  // over the page the operator is trying to use.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function openLiveTv() {
    navigate("/cust/livetv");
  }

  // Must go through AuthContext, not a hand-rolled localStorage.removeItem.
  // Removing the key directly left AuthContext.user still populated, so
  // `isAuthenticated` stayed true and PrivateRoute kept rendering the app
  // until something forced a reload — and it skipped the rest of
  // SESSION_KEYS, leaving the previous operator's registration drafts and
  // linked customer account on a shared phone.
  function logout() {
    endSession();
    navigate("/login", { replace: true });
  }

  const operatorRef = () => getUser()?.username || "";

  // ── Login To Netmon ────────────────────────────────────────────────
  // Opens the netmon web console already signed in as this operator.
  //
  // window.open is called BEFORE the await, with the real URL assigned after.
  // Opening it in the .then() instead would be a popup triggered outside the
  // click gesture, which mobile Safari and Chrome both block. The blank tab is
  // closed again if the request fails, so a rejection never strands one.
  //
  // NO "noopener" IN THE FEATURES STRING. Per the HTML spec, window.open()
  // returns NULL whenever noopener (or noreferrer, which implies it) is set —
  // the whole point is to deny the caller a handle. We need that handle, both
  // to navigate the tab once the link arrives and to close it if the request
  // fails. Passing it opened an about:blank that could never be driven or
  // closed: on failure it just sat there (exactly the QA report), and on
  // success the `else` branch navigated the DASHBOARD instead, leaving the
  // blank tab orphaned. The opener reference is severed below instead, which
  // gives the same protection without giving up control.
  async function handleNetmonLogin() {
    setMenuOpen(false);
    if (busy) return;
    const reference = operatorRef();
    if (!reference) { toast.add("Please sign in again.", { type: "warning" }); return; }
    const tab = window.open("", "_blank");
    setBusy("netmon");
    try {
      const { ok, link, message } = await getNetmonLoginLink(reference);
      if (ok && link) {
        // The link is a bearer credential — hand it to the browser and keep no
        // reference to it. Never logged, never stored.
        if (tab) {
          tab.location.replace(link);
          // Sever the back-reference now that we no longer need the handle, so
          // the netmon page cannot reach back into this window.
          try { tab.opener = null; } catch (_) {}
        } else {
          // Pop-up blocked: fall back to navigating this tab rather than
          // silently doing nothing.
          window.location.assign(link);
        }
      } else {
        tab?.close();
        toast.add(message || "Could not open Netmon.", { type: "error" });
      }
    } catch (err) {
      tab?.close();
      toast.add(err?.message || "Could not reach Netmon.", { type: "error" });
    } finally {
      setBusy("");
    }
  }

  // ── Scan To Login ──────────────────────────────────────────────────
  // Approves a netmon web session that was started on a computer: the login
  // page shows a QR, the operator scans it here, and this confirms it.
  async function handleScanned(scanned) {
    setScanning(false);
    const token = decodeQrLoginToken(scanned);
    if (!token) { toast.add("That QR code isn't a Netmon login code.", { type: "warning" }); return; }
    const reference = operatorRef();
    if (!reference) { toast.add("Please sign in again.", { type: "warning" }); return; }
    setBusy("scan");
    try {
      const { ok, message } = await verifyQrLogin({ reference, token });
      toast.add(message, { type: ok ? "success" : "error" });
    } catch (err) {
      toast.add(err?.message || "Could not approve this login.", { type: "error" });
    } finally {
      setBusy("");
    }
  }

  // OPERATOR-ONLY TOOLS.
  // One Header serves both portals (layout/Layout.jsx), so everything in this
  // menu was being offered to customers too. "Scan To Login" and "Login To
  // Netmon" are two halves of operator SSO into the netmon back-office console:
  // both post to QrcodeAuthentication with `reference` = the signed-in
  // OPERATOR's username, and both would fail for a customer — after handing
  // them a camera, or a blank tab pointed at a console they have no account on.
  // Same test the Sidebar and BottomNav already use.
  const isCustomer = localStorage.getItem("loginType") === "customer";

  const menuItems = [
    ...(isCustomer ? [] : [
      { id: "scan", label: "Scan To Login", onClick: () => { setMenuOpen(false); setScanning(true); } },
      { id: "netmon", label: busy === "netmon" ? "Opening Netmon…" : "Login To Netmon", onClick: handleNetmonLogin },
    ]),
    // Offered to BOTH portals, which is why the screen picks its feed from
    // loginType — `app_type` selects the notification set server-side, and it
    // used to always ask for the operator one. See NotificationHistory.jsx.
    //
    // This endpoint 500'd on every valid request when the screen was written;
    // re-verified 2026-08-31 as working, returning real rows for both feeds.
    // The failure handling stays — unlike Android, which swallows the error
    // and shows a permanently blank list, this reports a regression honestly.
    { id: "notifications", label: "Notification History", onClick: () => { setMenuOpen(false); navigate("/notifications"); } },
    { id: "logout", label: "Logout", onClick: () => { setMenuOpen(false); setConfirmLogout(true); }, danger: true },
  ];

  return (
    <>
      <header ref={headerRef} className="sticky top-0 z-40 flex items-center justify-between px-4 pb-3 shadow-lg bg-gradient-to-r from-indigo-600 to-blue-600" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
        {/* The bar is an indigo→blue gradient in BOTH themes, so nothing on
            it may carry a `dark:` variant — `dark:text-black` painted this
            icon near-invisible on the unchanged gradient. */}
        <button onClick={onOpenSidebar} className="p-2 rounded-lg white-icon">
          <Bars3Icon className="h-7 w-7 text-white" />
        </button>
        {/* Height alone left the width unconstrained, so this wide wordmark
            stretched across the bar and crowded the menu and action buttons.
            max-w caps it on narrow screens; object-contain keeps the aspect
            ratio so it scales down rather than squashing.
            No plateClassName: the bar is dark, so BrandLogo now serves the
            reversed lockup and the logo sits straight on the gradient. The
            white chip this used to draw was the only reason a background
            showed behind it — for the operator AND the customer, since both
            portals render this one header. */}
        <Link to="/" className="min-w-0 shrink">
          <BrandLogo
            onDark
            alt="BBNL"
            className="h-8 w-auto max-w-[140px] object-contain"
          />
        </Link>
        <div className="flex items-center gap-2">
          <button type="button" onClick={openLiveTv} className="p-2 rounded-full bg-gray-200 dark:bg-gray-700" aria-label="Open Live TV">
            <TvIcon className="h-6 w-6" />
          </button>

          {/* Overflow menu — mirrors the Android dashboard's 3-dot menu. */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="p-2 rounded-full bg-gray-200 dark:bg-gray-700"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <EllipsisVerticalIcon className="h-6 w-6" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 rounded-xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/10 dark:ring-white/10 overflow-hidden z-50"
              >
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    role="menuitem"
                    type="button"
                    onClick={item.onClick}
                    disabled={!!busy}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors disabled:opacity-50 ${
                      item.danger
                        ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {scanning && (
        <Suspense fallback={null}>
          <QRScanner
            onScan={handleScanned}
            onClose={() => setScanning(false)}
            onError={() => { setScanning(false); toast.add("Could not start the camera.", { type: "error" }); }}
          />
        </Suspense>
      )}

      {/* Android confirms before logging out (DashboardLatest.java:301-320). */}
      <Modal isOpen={confirmLogout} onClose={() => setConfirmLogout(false)} title="Log out?">
        <p className="text-sm text-gray-600 dark:text-gray-300">Are you sure you want to log out?</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmLogout(false)}
            className="px-4 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { setConfirmLogout(false); logout(); }}
            className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white font-semibold"
          >
            Log out
          </button>
        </div>
      </Modal>
    </>
  )
}
