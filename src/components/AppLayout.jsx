import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, LogOut } from "lucide-react";
import BottomNav from "./BottomNav";
import InstallPrompt from "./InstallPrompt";
import { getCachedLogo, cacheLogoFromUrl } from "../services/imageStore";

export default function AppLayout({ children }) {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const firstName = (user.name || "User").split(" ")[0];
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // ── Cached app logo (base64 in localStorage) ──
  const [logoSrc, setLogoSrc] = useState(() => getCachedLogo("logo-white") || "/logo-white.png");

  useEffect(() => {
    // If already cached, still refresh in background (silent update)
    cacheLogoFromUrl("logo-white", "/logo-white.png").then((dataUrl) => {
      if (dataUrl) setLogoSrc(dataUrl);
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleLogout = () => {
    localStorage.clear();
    navigate("/home", { replace: true });
    window.location.reload();
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-gray-50">
      {/* ───── Header ───── */}
      <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-3 flex items-center justify-between shadow-lg sticky top-0 z-40 safe-top">
        <div className="flex items-center gap-2">
          <img
            src={logoSrc}
            alt="Fo-Fi"
            className="h-9 w-auto object-contain flex-shrink-0"
          />
        </div>
        <button
          ref={menuRef}
          onClick={() => setShowMenu((v) => !v)}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 active:scale-95 transition-all flex-shrink-0"
        >
          <span className="text-white text-sm font-bold">
            {firstName.charAt(0).toUpperCase()}
          </span>
        </button>
      </header>

      {/* ───── Profile Dropdown ───── */}
      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setShowMenu(false)}
          />
          <div className="fixed right-3 top-14 w-44 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 z-50">
            <button
              onClick={() => { setShowMenu(false); navigate("/profile"); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors rounded-t-xl"
            >
              <Settings className="w-[18px] h-[18px] text-gray-500" />
              <span className="text-sm font-medium">Settings</span>
            </button>
            <div className="mx-3 border-t border-gray-100" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-red-600 hover:bg-red-50 active:bg-red-100 transition-colors rounded-b-xl"
            >
              <LogOut className="w-[18px] h-[18px] text-red-400" />
              <span className="text-sm font-medium">Logout</span>
            </button>
          </div>
        </>
      )}

      {/* ───── Page Content ───── */}
      <main className="pb-20">{children}</main>

      {/* ───── Bottom Navigation ───── */}
      <BottomNav />

      {/* ───── PWA Install Prompt ───── */}
      <InstallPrompt />
    </div>
  );
}
