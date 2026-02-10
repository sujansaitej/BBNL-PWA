import { Link } from "react-router-dom";
import {
  UserPlusIcon,
  UsersIcon,
  TicketIcon,
  Cog6ToothIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  CurrencyRupeeIcon,
  TvIcon
} from "@heroicons/react/24/outline";

function Grid3x3Icon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <circle cx="6" cy="6" r="2" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />

      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />

      <circle cx="6" cy="18" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

function comingsoon() {
  alert("The feature will be added very soon!");
}

export default function BottomBar() {
  return (
    <>
    {localStorage.getItem('loginType') !== 'customer' &&
    <div className="fixed bottom-0 left-0 w-full bg-white dark:bg-gray-900 shadow-md border-t border-gray-200 dark:border-gray-700 flex justify-around items-center py-2 z-50">
      {/* Add user */}
      <Link to="/register" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        <UserPlusIcon className="h-6 w-6" />
        <span className="text-xs">Add User</span>
      </Link>

      {/* Users */}
      <Link to="/customers" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        <UsersIcon className="h-6 w-6" />
        <span className="text-xs">Users</span>
      </Link>

      {/* <a href="/customers" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        <UsersIcon className="h-6 w-6" />
        <span className="text-xs">Users</span>
      </a> */}

      {/* Highlighted Dashboard (middle icon) */}
      <Link to="/" className="flex flex-col items-center -mt-6">
        <div className="bg-blue-600 rounded-full p-4 shadow-lg">
          <Grid3x3Icon className="h-7 w-7 text-white" />
        </div>
        <span className="text-xs mt-1 text-blue-600 font-medium">Dashboard</span>
      </Link>

      {/* Tickets */}
      <Link to="/tickets" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        <TicketIcon className="h-6 w-6" />
        <span className="text-xs">Tickets</span>
      </Link>

      {/* Support */}
      <Link to="/support" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        {/* <Cog6ToothIcon className="h-6 w-6" /> */}
        <ChatBubbleOvalLeftEllipsisIcon className="h-6 w-6" />
        <span className="text-xs">Support</span>
      </Link>
    </div>
    }
    {localStorage.getItem('loginType') === 'customer' &&
    <div className="fixed bottom-0 left-0 w-full bg-white dark:bg-gray-900 shadow-md border-t border-gray-200 dark:border-gray-700 flex justify-around items-center py-2 z-50">
      {/* Live TV */}
      <Link to="/cust/livetv" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        <TvIcon className="h-6 w-6" />
        <span className="text-xs">Live TV</span>
      </Link>

      {/* Renew */}
      <Link to="#" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        <CurrencyRupeeIcon className="h-6 w-6" />
        <span className="text-xs">Renew</span>
      </Link>

      {/* Highlighted Dashboard (middle icon) */}
      <Link to="/" className="flex flex-col items-center -mt-6">
        <div className="bg-blue-600 rounded-full p-4 shadow-lg">
          <Grid3x3Icon className="h-7 w-7 text-white" />
        </div>
        <span className="text-xs mt-1 text-blue-600 font-medium">Dashboard</span>
      </Link>

      {/* Tickets */}
      <Link to="#" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        <TicketIcon className="h-6 w-6" />
        <span className="text-xs">Tickets</span>
      </Link>

      {/* support */}
      <Link to="#" className="flex flex-col items-center text-gray-600 dark:text-gray-300 hover:text-blue-600">
        {/* <Cog6ToothIcon className="h-6 w-6" /> */}
        <ChatBubbleOvalLeftEllipsisIcon className="h-6 w-6" />
        <span className="text-xs">Support</span>
      </Link>
    </div>
    }
    </>
  );
}
