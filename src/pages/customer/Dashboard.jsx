// import DashboardContent from "../../components/Dashboard";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowUpOnSquareStackIcon, CurrencyRupeeIcon, ClipboardDocumentListIcon, ChartPieIcon, PhotoIcon, SignalIcon, TicketIcon, UserIcon } from '@heroicons/react/24/outline'
import { PlayCircleIcon } from '@heroicons/react/24/solid'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay, Pagination } from 'swiper/modules'
import 'swiper/css'
import 'swiper/css/pagination'
import Layout from "../../layout/Layout";
import { getIptvMobile, getPromoStream } from "../../services/iptvApi";
import { ads } from "../../services/customer/apis";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui";

export default function Dashboard() {
    if (localStorage.getItem('loginType') !== 'customer') {
        return <Navigate to="/" replace />;
    }

    // const logUname = JSON.parse(localStorage.getItem('user')).username;
    const [Advertisement, setAdvertisement] = useState([]);
    const [adCnt, setAdCnt] = useState(0);
    const [adLoading, setAdLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [greet, setGreet] = useState(false);
    const [promoLoading, setPromoLoading] = useState(null);
    const navigate = useNavigate();
    const toast = useToast();

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
            const data = await ads("custapp");
            const list = (data?.imglist || []).filter(a => a.content);
            if (list.length > 0) {
                setAdCnt(list.length);
                setAdvertisement(list);
            }
        } catch (err) {
            console.error("Error fetching advertisement:", err);
        } finally {
            setAdLoading(false);
        }
    }

    async function handleAdClick(ad) {
        if (ad.redirectlink !== "yes") return;
        if (promoLoading) return;

        const mobile = getIptvMobile();
        if (!mobile) {
            toast.add("Please log in to watch this channel.", { type: "error" });
            return;
        }

        setPromoLoading(ad.id);
        try {
            const data = await getPromoStream({ mobile, id: ad.id });

            const stream = data?.data || data;
            if (!stream.streamlink) {
                throw new Error("Stream link not available.");
            }

            let meta = {};
            try { meta = stream.meta ? JSON.parse(stream.meta) : {}; } catch (_) { /* meta is optional */ }

            const channel = {
                streamlink: stream.streamlink,
                chid: meta.chid || ad.id,
                chtitle: meta.chtitle || ad.description || "Promo",
                chlogo: meta.chlogo || ad.content,
            };
            navigate("/cust/livetv/player", { state: { channel } });
        } catch (err) {
            toast.add(err.message || "Stream unavailable", { type: "error" });
        } finally {
            setPromoLoading(null);
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
      
            {/* Hero Ad Banner — Hotstar Style */}
            {adLoading ? (
              <div className="-mx-4 px-4">
                <div className="aspect-[16/9] rounded-2xl skeleton dark:skeleton-dark" />
              </div>
            ) : adCnt > 0 && (
              <div className={adCnt > 1 ? "-mx-4" : ""}>
                <Swiper
                  spaceBetween={10}
                  slidesPerView={adCnt > 1 ? 1.08 : 1}
                  centeredSlides
                  loop={adCnt >= 3}
                  speed={500}
                  grabCursor
                  modules={[Autoplay, Pagination]}
                  autoplay={{ delay: 3500, disableOnInteraction: false, pauseOnMouseEnter: true }}
                  pagination={adCnt > 1 ? { clickable: true, dynamicBullets: true } : false}
                  className="ad-swiper"
                >
                  {Advertisement.map(ad => (
                    <SwiperSlide key={ad.id}>
                      <div
                        onClick={() => handleAdClick(ad)}
                        className={`relative aspect-[16/9] rounded-2xl overflow-hidden shadow-lg ${
                          ad.redirectlink === "yes" ? "cursor-pointer active:scale-[0.98] transition-transform duration-200" : ""
                        }`}
                      >
                        <img
                          src={ad.content}
                          alt={ad.description || "Advertisement"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />

                        {/* Gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none" />

                        {/* Bottom content */}
                        <div className="absolute bottom-0 inset-x-0 p-4">
                          {ad.description && (
                            <p className="text-white font-semibold text-sm leading-snug line-clamp-2 drop-shadow-lg">
                              {ad.description}
                            </p>
                          )}
                          {ad.redirectlink === "yes" && (
                            <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                              <PlayCircleIcon className="w-4 h-4 text-white" />
                              <span className="text-white text-[11px] font-semibold tracking-wider uppercase">Watch Now</span>
                            </div>
                          )}
                        </div>

                        {/* Loading overlay */}
                        {promoLoading === ad.id && (
                          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                            <div className="w-10 h-10 border-[3px] border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                    </SwiperSlide>
                  ))}
                </Swiper>
              </div>
            )}
      
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
                <p className="text-center text-blue-600 mt-1">We're thrilled to introduce our new platform independent app — designed to bring you a faster, smarter, and more seamless experience!</p>
                </>
              ):(
                <>
                <h2 className="text-xl font-semibold text-center text-red-500 mb-2">Coming Soon!</h2>
                <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/under_dev.jpg'} alt="Modal Info" className="w-70 h-70 mx-auto" />
                <p className="text-center text-violet-900 mt-1">We're working on this feature — check back soon!</p>
                </>
              )
              }
              <button
                onClick={() => setModalOpen(false)}
                className="mt-4 w-full py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium transition"
              >
                Cancel
              </button>
            </Modal>
      
          </div>
        </Layout>
    );
}
