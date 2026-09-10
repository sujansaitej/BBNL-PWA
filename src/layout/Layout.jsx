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

      {/* Main Content.
          With the nav: pb-bottomnav already clears both the nav chrome and the
          home indicator. Without it, nothing did — the last row of content sat
          under the iPhone home-indicator bar, so page-safe-bottom pays that
          inset instead. */}
      <main className={`flex-1 ${!hideBottomNav ? 'pb-bottomnav' : 'pb-safe'}`}>
        {children}
      </main>

      {/* Bottom Navigation */}
      {!hideBottomNav && <BottomNav />}

      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </div>
  );
}
