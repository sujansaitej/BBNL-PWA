
import { XMarkIcon, GlobeAltIcon, Cog6ToothIcon, UsersIcon, BellAlertIcon, ArchiveBoxIcon, ChatBubbleOvalLeftEllipsisIcon, ArrowRightOnRectangleIcon, WifiIcon, FilmIcon, TicketIcon, UserIcon, CurrencyRupeeIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "@/components/ui";
import { useNavigate } from "react-router-dom";
import { getWalBal } from "../services/generalApis";
export default function Sidebar({ open, onClose }) {
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const user   = JSON.parse(localStorage.getItem('user') || 'null');
  const fname  = user?.firstname ? user.firstname.charAt(0).toUpperCase() + user.firstname.slice(1) : '';
  const lname  = user?.lastname ? user.lastname.charAt(0).toUpperCase() + user.lastname.slice(1) : '';
  const name   = fname || lname ? `${fname} ${lname}`.trim() : 'User';
  const mobile = user?.mobileno || 'N/A';
  const photo  = (user?.photo && user?.photo !='path') ? import.meta.env.VITE_API_BASE_URL + import.meta.env.VITE_API_APP_USER_IMG_PATH + user?.photo : import.meta.env.VITE_API_APP_DIR_PATH + import.meta.env.VITE_API_APP_DEFAULT_USER_IMG_PATH;

  const logUname = user?.username || '';
  const [servkey, setServkey] = useState('');
  const [intWB, setIntWB] = useState(0);
  // const [fofiWB, setFofiWB] = useState(0);
  const isCustomer = localStorage.getItem('loginType') === 'customer'? true : false;
  useEffect(() => {
    if (logUname) getWalBalance();
  }, []);

  async function getWalBalance() {
    try {
      const payload = { loginuname: logUname, servicekey: servkey || 'internet' };
      const data = await getWalBal(payload);
      if (data?.status?.err_code === 0) {
        if(payload.servicekey === 'internet')
          setIntWB((data?.body?.wallet_balance || 0).toFixed(2));
        // console.log("Wallet Balance:", data?.body?.wallet_balance);
      } else {
        console.error("Failed to fetch wallet balance:", data?.status?.err_msg || "Unknown error");
      }
      setServkey('fofi');
    } catch (err) {
      console.error("Error fetching wallet balance:", err);
    }
  }

  function logout() {
    localStorage.removeItem('user');
    navigate("/login");
  }
  function comingsoon() {
    // alert("The feature will be added very soon!");
    setModalOpen(true);
  }
  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
      <div onClick={onClose} className={`absolute inset-0 bg-black/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside className={`absolute left-0 top-0 h-full w-70 bg-white dark:bg-gray-900 shadow-xl transform transition-transform ${open ? 'translate-x-0' : '-translate-x-full'}`}>

        <div className="flex items-center justify-between p-4 border-b dark:border-gray-800">
          <div className="flex items-center gap-3">
            <img src={photo} className="h-10 w-10 rounded-full" alt="user" />
            <div>
              <p className="font-semibold text-purple-700 dark:text-purple-500">{name}</p>
              <p className="text-xs text-teal-500 dark:text-gray-400">{import.meta.env.VITE_API_APP_DEFAULT_MOB_NO_PREFIX + ' ' + mobile}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><XMarkIcon className="h-6 w-6" /></button>
        </div>
        {!isCustomer &&
        <div className="bg-blue-600 text-white mt-1 p-4 shadow"> {/* rounded-xl mx-4 */}
          <h3 className="text-sm font-medium">Wallet Balance</h3>
          <p className="text-2xl font-semibold mt-1">{import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL +' '+ intWB}</p>

          {/* Quick Actions */}
          <div className="flex justify-around mt-4">
            <button
              // onClick={() => alert("Go to Internet Wallet")}
              className="flex flex-col items-center focus:outline-none"
            >
              <div className="bg-blue-500 rounded-full p-2 shadow-md hover:bg-blue-700 transition">
                <GlobeAltIcon className="h-6 w-6 text-white" />
              </div>
              <span className="text-xs mt-1">Internet</span>
            </button>

            <button
              // onClick={() => alert("Go to FOFI Wallet")}
              className="flex flex-col items-center focus:outline-none"
            >
              <div className="bg-blue-500 rounded-full p-2 shadow-md hover:bg-blue-700 transition">
                <WifiIcon className="h-6 w-6 text-white" />
              </div>
              <span className="text-xs mt-1">FOFI</span>
            </button>

            <button
              // onClick={() => alert("Go to OTT Wallet")}
              className="flex flex-col items-center focus:outline-none"
            >
              <div className="bg-blue-500 rounded-full p-2 shadow-md hover:bg-blue-700 transition">
                <FilmIcon className="h-6 w-6 text-white" />
              </div>
              <span className="text-xs mt-1">OTT</span>
            </button>
          </div>
        </div>
        }
        <div className="p-4">
          {/* <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Wallet Balance</p>
          <h3 className="text-2xl font-bold mb-4">₹ 2,562.50</h3>
          <div className="space-y-2">
            <a href="#" className="flex items-center gap-3 p-3 rounded-xl bg-gray-100 dark:bg-gray-800"><GlobeAltIcon className="h-6 w-6" /> Internet</a>
            <a href="#" className="flex items-center gap-3 p-3 rounded-xl bg-gray-100 dark:bg-gray-800"><CreditCardIcon className="h-6 w-6" /> Fo‑Fi</a>
            <a href="#" className="flex items-center gap-3 p-3 rounded-xl bg-gray-100 dark:bg-gray-800"><SparklesIcon className="h-6 w-6" /> OTT</a>
          </div> */}
          <p className="text-xs uppercase text-gray-500 dark:text-gray-400 mt-2 mb-2">Menu</p>
          <nav className="space-y-1">
            {!isCustomer ? (
            <>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="/customers"><UsersIcon className="h-5 w-5 text-blue bg-blue" /> All Users {/*<span className="ml-auto text-xs bg-green-600 text-white rounded px-2">10</span>*/}</Link>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="/customers?filter=expiring"><BellAlertIcon className="h-5 w-5" /> Today's Expiry {/*<span className="ml-auto text-xs bg-yellow-500 text-white rounded px-2">5</span>*/}</Link>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="/tickets"><TicketIcon className="h-5 w-5" /> Tickets</Link>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><ArchiveBoxIcon className="h-5 w-5" /> Order History</Link>
            {/* <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><Cog6ToothIcon className="h-5 w-5" /> Settings</Link> */}
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="/support"><ChatBubbleOvalLeftEllipsisIcon className="h-5 w-5" /> Support</Link>
            <a className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" href="" onClick={logout}><ArrowRightOnRectangleIcon className="h-5 w-5" /> Log out</a>
            </>
            ) : (
            <>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><UserIcon className="h-5 w-5 text-blue bg-blue" /> Profile {/*<span className="ml-auto text-xs bg-green-600 text-white rounded px-2">10</span>*/}</Link>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><CurrencyRupeeIcon className="h-5 w-5" /> Renew {/*<span className="ml-auto text-xs bg-yellow-500 text-white rounded px-2">5</span>*/}</Link>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><ClipboardDocumentListIcon className="h-5 w-5" /> Bills</Link>
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><TicketIcon className="h-5 w-5" /> Tickets</Link>
            {/* <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><Cog6ToothIcon className="h-5 w-5" /> Settings</Link> */}
            <Link className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" to="#" onClick={comingsoon}><ChatBubbleOvalLeftEllipsisIcon className="h-5 w-5" /> Support</Link>
            <a className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" href="" onClick={logout}><ArrowRightOnRectangleIcon className="h-5 w-5" /> Log out</a>
            </>
            )}
          </nav>
          {/* <nav className="mt-6 space-y-1">
            {[
              { name: "Users", icon: UserIcon },
              { name: "Expiry", icon: ClockIcon },
              { name: "Tickets", icon: TicketIcon },
              { name: "Order History", icon: CreditCardIcon },
              { name: "Settings", icon: Cog6ToothIcon },
              { name: "Support", icon: LifebuoyIcon },
            ].map((item) => (
              <button
                key={item.name}
                onClick={() => alert(`Go to ${item.name}`)}
                className="flex items-center w-full px-3 py-2 rounded-lg text-gray-800 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-gray-800 transition"
              >
                <item.icon className="h-6 w-6 text-blue-600 mr-3" />
                <span className="font-medium">{item.name}</span>
              </button>
            ))}
          </nav> */}
        </div>

          {/* Copyright & Version */}
        <div className="absolute bottom-0 w-full">  
          <div className="text-center text-xs text-gray-500 dark:text-gray-400 px-2 pb-3">
            <p>© 2025 <a href='https://fofilabs.com' target='_blank'>Fo-Fi IoT Labs.</a> All rights reserved.</p>
            <p className="mt-1">Version {import.meta.env.VITE_API_APP_VERSION}</p>
          </div>
        </div>
      </aside>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
        <h2 className="text-xl font-semibold text-center text-red-500 mb-2">Coming Soon!</h2>
        <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/under_dev.jpg'} alt="Modal Info" className="w-70 h-70 mx-auto" />
        <p className="text-center text-violet-900 mt-1">We’re working on this feature — check back soon!</p>
      </Modal>
      
    </div>
  )
}
