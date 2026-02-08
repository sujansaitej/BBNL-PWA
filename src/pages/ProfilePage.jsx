import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  User,
  Phone,
  MessageSquareText,
  Info,
  ChevronRight,
} from "lucide-react";
import AppLayout from "../components/AppLayout";

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const menuItems = [
    {
      icon: MessageSquareText,
      label: "Feedback",
      desc: "Share your thoughts with us",
      color: "text-pink-600",
      bg: "bg-pink-50",
      path: "/feedback",
    },
    {
      icon: Info,
      label: "App Info",
      desc: "Version & company details",
      color: "text-sky-600",
      bg: "bg-sky-50",
      path: "/app-info",
    },
  ];

  return (
    <AppLayout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        {/* ───── Profile Card ───── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md">
              <User className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-800 truncate">
                {user.name || "User"}
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Phone className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-sm text-gray-500">
                  +91 {user.mobile || ""}
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ───── Menu Items ───── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 mb-5"
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              className="flex items-center gap-3 px-4 py-4 w-full text-left hover:bg-gray-50 active:bg-gray-100 transition-colors min-h-[56px]"
            >
              <div
                className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center flex-shrink-0`}
              >
                <item.icon className={`w-5 h-5 ${item.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-800">
                  {item.label}
                </h4>
                <p className="text-[11px] text-gray-400">{item.desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </motion.div>

      </div>
    </AppLayout>
  );
}
