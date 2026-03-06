
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UsersIcon, BellAlertIcon, SignalIcon, TicketIcon, ChartBarIcon, ArchiveBoxIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { getAdvertisements, getIptvMobile } from "../services/iptvApi"
import { proxyImageUrl } from "../services/iptvImage"
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay } from 'swiper/modules'
import 'swiper/css'
import { getWalBal } from "../services/generalApis";
import { Modal } from "@/components/ui";
import { getUser } from "../services/safeStorage";

export default function Dashboard() {
  const logUname = getUser().username || "";
  const [intWB, setIntWB] = useState(0);
  const [fofiWB, setFofiWB] = useState(0);
  const [adList, setAdList] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [greet, setGreet] = useState(false);

  // Show welcome greeting on first login (once)
  useEffect(() => {
    if (!localStorage.getItem('firstLogin')) {
      localStorage.setItem('firstLogin', 'true');
    }
    if (localStorage.getItem('firstLogin') === 'true') {
      const timer = setTimeout(() => {
        setGreet(true);
        setModalOpen(true);
        localStorage.setItem('firstLogin', 'false');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    // Fetch everything in parallel — wallet balances + ads all at once
    const mobile = getIptvMobile();
    Promise.all([
      getWalBal({ loginuname: logUname, servicekey: 'internet' }).catch(() => null),
      getWalBal({ loginuname: logUname, servicekey: 'fofi' }).catch(() => null),
      mobile ? getAdvertisements({ mobile }).catch(() => null) : Promise.resolve(null),
    ]).then(([intData, fofiData, adData]) => {
      if (intData?.status?.err_code === 0)
        setIntWB((intData?.body?.wallet_balance || 0).toFixed(2));
      if (fofiData?.status?.err_code === 0)
        setFofiWB((fofiData?.body?.wallet_balance || 0).toFixed(2));
      const list = (adData?.body?.[0]?.ads || []).filter(a => a.content);
      if (list.length > 0) setAdList(list);
    });
  }, []);

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
      {adList.length > 0 && (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Features & Offers</h2>
        </div>
        <Swiper spaceBetween={12} slidesPerView={'auto'} loop={adList.length >= 3} modules={[Autoplay]} autoplay={{ delay: 2500 }}>
          {adList.map(ad => (
            <SwiperSlide key={ad.id} style={{ width: adList.length > 1 ? '90%' : '100%' }}>
              <a href={ad.redirectlink} target="_blank" rel="noopener noreferrer" className="block bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                <img src={proxyImageUrl(ad.content)} alt={ad.description} className="h-32 w-full object-cover" loading="lazy" />
              </a>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
      )}

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
              <span className={`font-semibold ${tx.amount.trim().startsWith('+') ? 'text-purple-600' : 'text-red-600'}`}>{tx.amount}</span>
            </div>
          ))}
        </div>
      </div> */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
        {greet ? (
          <>
          <h2 className="text-xl font-semibold text-center text-purple-500 mb-2">Warm Welcome!</h2>
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
