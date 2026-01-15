
import { useContext } from 'react'
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from '../ThemeContext.jsx'
import { SunIcon, MoonIcon, BellIcon, Bars3Icon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'

export default function Header({ onOpenSidebar }) {
  const { theme, toggleTheme } = useContext(ThemeContext)
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem('user');
    navigate("/login");
  }
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-2 shadow" style={{ background: '#6d67ff' }}>
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
        <button onClick={toggleTheme} className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">
          {theme === 'dark' ? <SunIcon className="h-6 w-6" /> : <MoonIcon className="h-6 w-6" />}
        </button>
        <button onClick={logout} className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">
          <ArrowRightOnRectangleIcon className="h-6 w-6" />
        </button>
      </div>
    </header>
  )
}
