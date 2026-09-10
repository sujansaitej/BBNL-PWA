// import DashboardContent from "../../components/Dashboard";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowUpOnSquareStackIcon, ChartPieIcon, SignalIcon, GlobeAltIcon, UserIcon, TvIcon, CpuChipIcon, PlusCircleIcon } from '@heroicons/react/24/outline'
import { PlayCircleIcon } from '@heroicons/react/24/solid'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay, Pagination } from 'swiper/modules'
import 'swiper/css'
import 'swiper/css/pagination'
import Layout from "../../layout/Layout";
import { getIptvMobile, getPromoStream } from "../../services/iptvApi";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { fixImageUrl } from "../../services/iptvImage";
import { useAds } from "../../hooks/useAds";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui";

export default function Dashboard() {
    if (localStorage.getItem('loginType') !== 'customer') {
        return <Navigate to="/" replace />;
    }

    // const logUname = JSON.parse(localStorage.getItem('user')).username;
    // Ad banners are operator-managed and revalidate themselves, so the
    // carousel tracks additions/removals without a reload. adCnt is DERIVED —
    // it can never drift out of sync with the slides actually rendered.
    const { adList: Advertisement, adCount: adCnt, adLoading } = useAds("custapp");
    const [modalOpen, setModalOpen] = useState(false);
    const [promoLoading, setPromoLoading] = useState(null);
    const navigate = useNavigate();
    const toast = useToast();

    useEffect(() => {
        if (!localStorage.getItem('firstLogin')) {
            localStorage.setItem('firstLogin', 'true');
        }
        if (localStorage.getItem('firstLogin') === 'true') {
            const timer = setTimeout(() => {
                setModalOpen(true);
                localStorage.setItem('firstLogin', 'false');
            }, 1000);
            return () => clearTimeout(timer);
        }
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
                chlogo: meta.chlogo || fixImageUrl(ad.content),
            };
            navigate("/cust/livetv/player", { state: { channel } });
        } catch (err) {
            toast.add(err.message || "Stream unavailable", { type: "error" });
        } finally {
            setPromoLoading(null);
        }
    }
    
    // The last three act on a LINKED SERVICE ACCOUNT, which a customer may
    // not have yet — an app login carries no service identity at all (see
    // services/customer/linkAccount.js). `needsAccount` marks those so the
    // tile sends the customer to link one instead of opening a screen that
    // can only render an empty state. Reset Mac is Android's `mac_reset`;
    // the tile used to be labelled "Reset WiFi", which is not what it does.
    const cardItems = [
        { id: 'internet', title: 'Internet', Icon: GlobeAltIcon, path: '/cust/internet' },
        { id: 'fofi', title: 'FoFi Smart Box', Icon: CpuChipIcon, path: '/cust/fofi' },
        { id: 'iptv', title: 'IPTV', Icon: TvIcon, path: '/cust/iptv' },
        // Profile moved to the bottom nav.
        { id: 'datausage', title: 'Data Usage', Icon: ChartPieIcon, path: '/cust/internet/usage', needsAccount: true },
        { id: 'updateKyc', title: 'Update KYC', Icon: ArrowUpOnSquareStackIcon, path: '/cust/kyc', needsAccount: true },
        { id: 'resetmac', title: 'Reset Mac', Icon: SignalIcon, path: '/cust/internet/reset-mac', needsAccount: true },
        // NO needsAccount: asking for a NEW connection is exactly the case
        // where the customer may not have a linked one yet, so gating it on
        // an existing account would hide it from the people who want it.
        { id: 'newconnection', title: 'New Connection', Icon: PlusCircleIcon, path: '/cust/new-connection' },
    ]

    /**
     * Open a tile that needs a linked account.
     *
     * Update KYC reuses the operator document screen, which reads its
     * customer from route state (`location.state.customer.customer_id`) —
     * so the linked account's service user id is handed over the same way
     * the operator surface hands over a selected customer. Android does the
     * equivalent with `args.putString("userid", userId)`.
     */
    const openLinked = (e, item) => {
        if (!item.needsAccount) return;
        e.preventDefault();
        const account = getActiveAccount();
        if (!account?.userid) {
            toast.add("Link your account first to use this.", { type: "error" });
            navigate("/cust/internet");
            return;
        }
        if (item.id === 'updateKyc') {
            navigate(item.path, { state: { customer: { customer_id: account.userid } } });
            return;
        }
        navigate(item.path);
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
                  /* Slide count drives slidesPerView, loop and pagination.
                     Re-key on it so a changed banner list re-initialises
                     Swiper cleanly instead of leaving stale dots behind. */
                  key={adCnt}
                  spaceBetween={10}
                  slidesPerView={adCnt > 1 ? 1.08 : 1}
                  centeredSlides
                  loop={adCnt >= 3}
                  speed={500}
                  grabCursor
                  observer
                  observeParents
                  modules={[Autoplay, Pagination]}
                  autoplay={{ delay: 3500, disableOnInteraction: false, pauseOnMouseEnter: true }}
                  pagination={adCnt > 1 ? { clickable: true } : false}
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
                        {/* NOTHING MAY BE PAINTED OVER THIS ARTWORK.
                            These banners are finished designs, not photos: the
                            operator uploads a 16:9 composition that already
                            carries the BBNL logo, a headline, body copy and —
                            critically — the support phone numbers along the
                            bottom edge. This slide used to lay a
                            `from-black/80` gradient over the lower half and
                            print `ad.description` on top of it, which is
                            exactly where that content sits: "Best Support" was
                            being stamped across the two numbers customers are
                            meant to call.

                            `description` is a LABEL, not a caption — the
                            operator dashboard has always used it as alt text
                            and drawn no overlay. Same here now. */}
                        <img
                          src={fixImageUrl(ad.content)}
                          alt={ad.description || "Advertisement"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />

                        {/* The one exception: a tappable banner still needs to
                            look tappable. Kept to a small corner chip with its
                            own backdrop instead of a full-width gradient, so it
                            covers a badge-sized area rather than a third of the
                            design. Only rendered when the ad actually links
                            somewhere. */}
                        {ad.redirectlink === "yes" && (
                          <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm pointer-events-none">
                            <PlayCircleIcon className="w-3.5 h-3.5 text-white" />
                            <span className="text-white text-[10px] font-semibold tracking-wider uppercase">Watch Now</span>
                          </div>
                        )}

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
              {cardItems.map((item) => {
                const { id, title, Icon, path } = item;
                return (
                <Link to={path} key={id} className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow" onClick={(e) => openLinked(e, item)}>
                  <div className="mx-auto w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center mb-1">
                    <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
                  </div>
                  <p className="text-[13px] leading-tight font-semibold">{title}</p>
                </Link>
                );
              })}
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
            {/* Welcome only — every tile routes somewhere real now, so the
                "Coming Soon" arm of this modal has no caller left. */}
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
              <h2 className="text-xl font-semibold text-center text-green-500 mb-2">Warm Welcome!</h2>
              <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/welcome.png'} alt="Modal Info" className="w-70 h-70 mx-auto" />
              <p className="text-center text-blue-600 mt-1">We're thrilled to introduce our new platform independent app — designed to bring you a faster, smarter, and more seamless experience!</p>
              <button
                onClick={() => setModalOpen(false)}
                className="mt-4 w-full py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 dark:text-gray-300 font-medium transition"
              >
                Cancel
              </button>
            </Modal>
      
          </div>
        </Layout>
    );
}
