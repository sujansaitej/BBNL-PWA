import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { Bars3Icon, ArrowRightOnRectangleIcon, TvIcon } from '@heroicons/react/24/outline'
import { lsClearAll } from "../services/lsCache";

export default function Header({ onOpenSidebar }) {
  const navigate = useNavigate();
  const headerRef = useRef(null);

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

  function openLiveTv() {
    navigate("/cust/livetv");
  }

  function logout() {
    lsClearAll();
    localStorage.removeItem('user');
    navigate("/login");
  }
  return (
    <header ref={headerRef} className="sticky top-0 z-40 flex items-center justify-between px-4 pb-3 shadow-lg bg-gradient-to-r from-indigo-600 to-blue-600" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
      <button onClick={onOpenSidebar} className="p-2 rounded-lg white-icon">
        <Bars3Icon className="h-7 w-7 text-white dark:text-black" />
      </button>
      <Link to="/"><img src={import.meta.env.VITE_API_APP_DIR_PATH + import.meta.env.VITE_API_APP_LOGO_WHITE} alt="Fo-Fi" className="h-10" /></Link>
      <div className="flex items-center gap-2">
        {/* <div id="google_translate_element"></div> */}
        {/* <div className="relative">

          <button className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">
            <BellIcon className="h-6 w-6 text-gray-900 dark:text-gray-100" />
          </button>
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 w-4 text-[10px] rounded-full bg-red-600 text-white">4</span>
        </div> */}
        <button type="button" onClick={openLiveTv} className="p-2 rounded-full bg-gray-200 dark:bg-gray-700" aria-label="Open Live TV">
          <TvIcon className="h-6 w-6" />
        </button>
        <button onClick={logout} className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">
          <ArrowRightOnRectangleIcon className="h-6 w-6" />
        </button>
      </div>
    </header>
  )
}
