import { useState } from "react";
import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import BottomNav from "../components/BottomNav";

export default function Layout({ children, hideHeader = false, hideBottomNav = false }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-dvh flex flex-col overflow-x-clip">
      {/* Header */}
      {!hideHeader && <Header onOpenSidebar={() => setSidebarOpen(true)} />}

      {/* Main Content */}
      <main className={`flex-1 ${!hideBottomNav ? 'pb-bottomnav' : ''}`}>
        {children}
      </main>

      {/* Bottom Navigation */}
      {!hideBottomNav && <BottomNav />}

      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </div>
  );
}
