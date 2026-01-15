
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UsersIcon, BellAlertIcon, SignalIcon, TicketIcon, ChartBarIcon, ArchiveBoxIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { featuredAds, transactions } from '../data.js'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay } from 'swiper/modules'
import 'swiper/css'
import { getWalBal } from "../services/generalApis";
import { Modal } from "@/components/ui";

export default function Dashboard() {
  const logUname = JSON.parse(localStorage.getItem('user')).username;
  const [servkey, setServkey] = useState('');
  const [intWB, setIntWB] = useState(0);
  const [fofiWB, setFofiWB] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [greet, setGreet] = useState(false);
  localStorage.getItem('firstLogin') ? null : localStorage.setItem('firstLogin', 'true');
  if(localStorage.getItem('firstLogin') === 'true'){
    setTimeout(() => {
      setGreet(true);
      setModalOpen(true);
      localStorage.setItem('firstLogin', 'false');
    }, 1000);
  }
  useEffect(() => {
    getWalBalance();
  }, [servkey]);

  async function getWalBalance() {
    try {
      const payload = { loginuname: logUname, servicekey: servkey || 'internet' };
      const data = await getWalBal(payload);
      if (data?.status?.err_code === 0) {
        if(payload.servicekey === 'internet') 
          setIntWB((data?.body?.wallet_balance || 0).toFixed(2));
        else
          setFofiWB((data?.body?.wallet_balance || 0).toFixed(2));
        // console.log("Wallet Balance:", data?.body?.wallet_balance);
      } else {
        console.error("Failed to fetch wallet balance:", data?.status?.err_msg || "Unknown error");
      }
      setServkey('fofi');
    } catch (err) {
      console.error("Error fetching wallet balance:", err);
    }
  }

  const cardItems = [
    { id: 'addUser', title: 'Add User', Icon: UsersIcon, path: '/register' },
    { id: 'allUsers', title: 'All Users', Icon: UsersIcon, path: '/customers' },
    { id: 'todayExpiry', title: 'Today Expiry', Icon: BellAlertIcon, path: '/customers?filter=expiring' },
    { id: 'liveUsers', title: 'Live Users', Icon: SignalIcon, path: '/customers?filter=live' },
    { id: 'tickets', title: 'Tickets', Icon: TicketIcon, path: '/tickets' },
    { id: 'usage', title: 'Data Usage', Icon: ChartBarIcon, path: '#' },
    { id: 'orders', title: 'Order History', Icon: ArchiveBoxIcon, path: '#' },
    { id: 'reset', title: 'Reset Mac', Icon: ArrowPathIcon, path: '#' },
  ]

  const underDev = () => {
    setGreet(false);
    setModalOpen(true);
  };
  return (
    <div className="px-4 py-4 space-y-6">
      {/* Wallet Card */}
      <div className="rounded-2xl p-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-md/5 opacity-90 font-bold">Wallet Balance</p>
            <p className="text-3xl font-bold">{import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL +' '+ intWB}</p>
          </div>
          <button className="p-3 rounded bg-white/20 backdrop-blur">+</button>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-white/10 p-2 rounded-xl text-center"><p className="text-sm opacity-90">Internet</p><p className="text-sm font-semibold">{import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL +' '+ intWB}</p></div>
          <div className="bg-white/10 p-2 rounded-xl text-center"><p className="text-sm opacity-90">Fo‑Fi</p><p className="text-sm font-semibold">{import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL +' '+ fofiWB}</p></div>
          <div className="bg-white/10 p-2 rounded-xl text-center"><p className="text-sm opacity-90">OTT</p><p className="text-sm font-semibold">₹ 0.00</p></div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-3">
        {cardItems.map(({ id, title, Icon, path }) => (
          <Link to={path} key={id} className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow" onClick={path === '#' ? (e) => { e.preventDefault(); underDev(); } : null}>
            <div className="mx-auto w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center mb-1">
              <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
            </div>
            <p className="text-[13px] leading-tight font-semibold">{title}</p>
          </Link>
        ))}
      </div>

      {/* Featured Ads with Swiper */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Features & Offers</h2>
          <a href="#" className="text-sm text-indigo-600">View All</a>
        </div>
        <Swiper spaceBetween={12} slidesPerView={'auto'} loop modules={[Autoplay]} autoplay={{ delay: 2500 }}>
          {featuredAds.map(ad => (
            <SwiperSlide key={ad.id} style={{ width: 240 }}>
              <a href={ad.link} className="block bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                <img src={import.meta.env.VITE_API_APP_DIR_PATH + ad.image} alt={ad.title} className="h-32 w-full object-cover" />
                <div className="p-3">
                  <p className="font-medium">{ad.title}</p>
                </div>
              </a>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>

      {/* Transactions */}
      {/* <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Recent Transactions</h2>
          <a href="#" className="text-sm text-indigo-600">View All</a>
        </div>
        <div className="space-y-2">
          {transactions.map(tx => (
            <div key={tx.id} className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl shadow">
              <div className="flex items-center gap-3">
                <img src={import.meta.env.VITE_API_APP_DIR_PATH + tx.avatar} className="h-10 w-10 rounded-full object-cover" alt="avatar" />
                <div>
                  <p className="font-medium">{tx.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{tx.desc}</p>
                </div>
              </div>
              <span className={`font-semibold ${tx.amount.trim().startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>{tx.amount}</span>
            </div>
          ))}
        </div>
      </div> */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
        {greet ? (
          <>
          <h2 className="text-xl font-semibold text-center text-green-500 mb-2">Warm Welcome!</h2>
          <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/welcome.png'} alt="Modal Info" className="w-70 h-70 mx-auto" />
          <p className="text-center text-blue-600 mt-1">We’re thrilled to introduce our new platform independent app — designed to bring you a faster, smarter, and more seamless experience!</p>
          </>
        ):(
          <>
          <h2 className="text-xl font-semibold text-center text-red-500 mb-2">Coming Soon!</h2>
          <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/under_dev.jpg'} alt="Modal Info" className="w-70 h-70 mx-auto" />
          <p className="text-center text-violet-900 mt-1">We’re working on this feature — check back soon!</p>
          </>
        )
        }
      </Modal>

    </div>
  )
}
