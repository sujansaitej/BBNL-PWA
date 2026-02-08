import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Tv, Play, LayoutGrid, User } from "lucide-react";

const tabs = [
  { icon: Tv, label: "Home", path: "/home" },
  { icon: Play, label: "Live TV", path: "/live-tv" },
  { icon: LayoutGrid, label: "Channels", path: "/channels" },
  { icon: User, label: "Profile", path: "/profile" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-lg border-t border-gray-200/80 safe-bottom">
      <div className="max-w-lg mx-auto flex items-center justify-around px-1">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <button
              key={tab.label}
              onClick={() => navigate(tab.path)}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[48px] px-3 py-1.5 rounded-xl transition-colors ${
                isActive
                  ? "text-purple-600"
                  : "text-gray-400 active:text-gray-500"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="navIndicator"
                  className="absolute -top-1.5 w-8 h-1 rounded-full bg-gradient-to-r from-blue-500 to-purple-600"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <tab.icon
                className={`w-5 h-5 transition-transform ${
                  isActive ? "stroke-[2.5] scale-110" : ""
                }`}
              />
              <span
                className={`text-[10px] leading-tight ${
                  isActive ? "font-bold" : "font-medium"
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
