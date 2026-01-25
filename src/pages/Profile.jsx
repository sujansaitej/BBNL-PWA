import { useNavigate } from "react-router-dom";
import { ArrowLeftIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import BottomNav from "../components/BottomNav";

export default function Profile() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Blue Gradient Header - Matching dashboard design */}
      <header className="sticky top-0 z-40 flex items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white">My Profile</h1>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
        {/* Profile Icon */}
        <div className="flex justify-center mb-4">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-blue-400 rounded-full blur-xl opacity-50"></div>
            <UserCircleIcon className="h-28 w-28 text-indigo-600 relative" />
          </div>
        </div>

        {/* User Details Section */}
        <div className="space-y-3">
          <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
            User Details
          </h3>
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 dark:border-gray-700 space-y-3 text-sm">
            <div className="flex">
              <span className="w-36 text-gray-600 dark:text-gray-400">Username</span>
              <span className="text-gray-600 dark:text-gray-400">: {user.username || 'N/A'}</span>
            </div>
            <div className="flex">
              <span className="w-36 text-gray-600 dark:text-gray-400">Name</span>
              <span className="text-gray-600 dark:text-gray-400">: {user.name || 'N/A'}</span>
            </div>
            <div className="flex">
              <span className="w-36 text-gray-600 dark:text-gray-400">Role</span>
              <span className="text-gray-600 dark:text-gray-400">: {user.role || 'Operator'}</span>
            </div>
          </div>
        </div>

        {/* Account Settings Section */}
        <div className="space-y-3">
          <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
            Account Settings
          </h3>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 dark:border-gray-700 overflow-hidden">
            <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-indigo-50 dark:hover:bg-gray-750 transition-all duration-200 border-b border-gray-200 dark:border-gray-700 group">
              <span className="text-gray-700 dark:text-gray-300 font-medium">Change Password</span>
              <svg className="h-5 w-5 text-indigo-600 group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-red-50 dark:hover:bg-gray-750 transition-all duration-200 group">
              <span className="text-gray-700 dark:text-gray-300 font-medium group-hover:text-red-600">Logout</span>
              <svg className="h-5 w-5 text-red-600 group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
