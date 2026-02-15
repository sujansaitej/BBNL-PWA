// import DashboardContent from "../../components/Dashboard";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpOnSquareStackIcon, CurrencyRupeeIcon, ClipboardDocumentListIcon, ChartPieIcon, PhotoIcon, SignalIcon, TicketIcon, UserIcon } from '@heroicons/react/24/outline'
// import { featuredAds, transactions } from '../../data.js'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay } from 'swiper/modules'
import 'swiper/css'
import Layout from "../../layout/Layout";
import { getAdvertisements, getIptvMobile } from "../../services/iptvApi";
import { proxyImageUrl } from "../../services/iptvImage";
import { Modal } from "@/components/ui";

export default function Dashboard() {
    // const logUname = JSON.parse(localStorage.getItem('user')).username;
    const [Advertisement, setAdvertisement] = useState([]);
    const [adCnt, setAdCnt] = useState(0);
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
        getAds();
    }, []);
    
    useEffect(() => {
        const handlePopState = () => {
            window.history.go(1); // prevent going back
        };
    
        window.addEventListener('popstate', handlePopState);
    
        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);
    
    async function getAds() {
        try {
            const mobile = getIptvMobile();
            if (!mobile) return;
            const data = await getAdvertisements({ mobile });
            const list = (data?.body?.[0]?.ads || []).filter(a => a.content);
            if (list.length > 0) {
                setAdCnt(list.length);
                setAdvertisement(list);
            } else {
                // console.error("Advertisement not found:", data?.count || "No data");
            }
        } catch (err) {
            console.error("Error fetching advertisement:", err);
        }
    }
    
    const cardItems = [
        { id: 'renew', title: 'Renew', Icon: CurrencyRupeeIcon, path: '#' },
        { id: 'bills', title: 'Bills', Icon: ClipboardDocumentListIcon, path: '#' },
        { id: 'ticket', title: 'Tickets', Icon: TicketIcon, path: '#' },
        { id: 'profile', title: 'Profile', Icon: UserIcon, path: '#' },
        { id: 'album', title: 'Photo Album', Icon: PhotoIcon, path: '#' },
        { id: 'datausage', title: 'Data Usage', Icon: ChartPieIcon, path: '#' },
        { id: 'updateKyc', title: 'Update KYC', Icon: ArrowUpOnSquareStackIcon, path: '#' },
        { id: 'resetwifi', title: 'Reset WiFi', Icon: SignalIcon, path: '#' },
    ]
    
    const underDev = () => {
        setGreet(false);
        setModalOpen(true);
    };

    return (
        <Layout>
          <div className="px-4 py-4 space-y-6">
      
            {/* Featured Ads with Swiper */}
            {adCnt > 0 && 
            <div>
              {/* <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Offers & New Features</h2>
                <a href="#" className="text-sm text-indigo-600">View All</a>
              </div> */}
              <Swiper spaceBetween={12} slidesPerView={'auto'} loop={adCnt >= 3} modules={[Autoplay]} autoplay={{ delay: 2500 }}>
                {Advertisement.map(ad => (
                  <SwiperSlide key={ad.id} style={{ width: adCnt > 1 ? '90%' : '100%' }}>
                    <a href={ad.redirectlink} target="_blank" rel="noopener noreferrer" className="block bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                      <img src={proxyImageUrl(ad.content)} alt={ad.description} className="h-32 w-full object-cover" />
                      {/* <div className="p-3">
                        <p className="font-medium">{ad.description}</p>
                      </div> */}
                    </a>
                  </SwiperSlide>
                ))}
              </Swiper>
            </div>
            }
      
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
        </Layout>
    );
}
