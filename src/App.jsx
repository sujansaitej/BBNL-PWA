
// import { useState } from 'react'
// import Header from './components/Header.jsx'
// import Dashboard from './components/Dashboard.jsx'
// import BottomNav from './components/BottomNav.jsx'
// import Sidebar from './components/Sidebar.jsx'

// export default function App() {
//   const [sidebarOpen, setSidebarOpen] = useState(false)
//   return (
//     <div className="min-h-screen flex flex-col">
//       <Header onOpenSidebar={() => setSidebarOpen(true)} />
//       <main className="flex-1 pb-20">
//         <Dashboard />
//       </main>
//       <BottomNav />
//       <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
//     </div>
//   )
// }

// import { BrowserRouter } from "react-router-dom";
// import { AuthProvider } from "./context/AuthContext";
// import AppRoutes from "./routes/Routes";

// export default function App() {
//   return (
//     <AuthProvider>
//       <BrowserRouter basename="/pwa/foficrm">
//         <AppRoutes />
//       </BrowserRouter>
//     </AuthProvider>
//   );
// }

import AppRoutes from "./routes/Routes";

export default function App() {
  return <AppRoutes />;
}

