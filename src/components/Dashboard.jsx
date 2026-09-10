
import { useEffect, useState, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { UsersIcon, BellAlertIcon, SignalIcon, TicketIcon, ChartBarIcon, ArchiveBoxIcon, ArrowPathIcon, CpuChipIcon } from '@heroicons/react/24/outline'
import { getAdvertisements, getIptvMobile } from "../services/iptvApi"
import { proxyImageUrl } from "../services/iptvImage"
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay } from 'swiper/modules'
import 'swiper/css'
import { getCustList, getTickets, getWalBal, getCachedWalletBalance } from "../services/generalApis";
import { getFleetCounts } from "../services/ontApis";
import { ONLINE_THRESHOLD_MIN } from "../constants/ontParams";
import { Modal } from "@/components/ui";
import { getUser } from "../services/safeStorage";

export default function Dashboard() {
  const user = getUser();
  const logUname = user.username || "";
  const opId = user.op_id || "";
  const location = useLocation();
  // null = nothing to show yet (renders the pulsing skeleton), string = a figure.
  //
  // Seeded from the LAST KNOWN balance so the card paints immediately instead
  // of pulsing through the whole round trip. getWalBal caches for 5 minutes,
  // so every visit past that TTL used to be a cold miss: the operator watched
  // an empty box for the full myWallet call, which runs 4–45s on this backend.
  // Reading a stale value first is safe — it is the same number the operator
  // saw a moment ago, and the network result overwrites it as soon as it
  // lands. The rest of this app already seeds from lsGetStale for exactly
  // this reason (Customerlist, IPTVService plan card, FoFiSmartBox overview).
  const [intWB, setIntWB] = useState(() => getCachedWalletBalance(logUname, 'internet'));
  const [fofiWB, setFofiWB] = useState(() => getCachedWalletBalance(logUname, 'fofi'));
  const [adList, setAdList] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [comingSoonOpen, setComingSoonOpen] = useState(false);
  const [dashboardCounts, setDashboardCounts] = useState({
    todayExpiry: 0,
    liveUsers: 0,
    tickets: 0,
  });
  // ONT fleet counts come from the ACS, which is a different backend to
  // everything else on this screen. null = not loaded yet; the tile stays usable
  // either way, so an ACS outage never blocks the dashboard.
  const [ontCounts, setOntCounts] = useState(null);

  // Show welcome greeting on first login (once)
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

  // Refresh wallet balances - called on mount and when page regains focus.
  // skipCache=true bypasses the localStorage cache so the balance is fresh
  // (e.g. after a payment that changed the actual balance on the server).
  function refreshWalletBalances(skipCache = false) {
    if (!logUname) return;
    // Independent, NOT Promise.all. These are two separate myWallet calls and
    // one is routinely much slower than the other; batching them made the fast
    // figure wait for the slow one, so both boxes sat empty for the duration of
    // the worst call. Each now paints the moment its own call lands.
    const apply = (servicekey, setter) =>
      getWalBal({ loginuname: logUname, servicekey }, skipCache)
        .then((data) => {
          if (data?.status?.err_code === 0) setter((data?.body?.wallet_balance ?? 0).toFixed(2));
        })
        .catch(() => { /* keep the seeded figure rather than blanking it */ });

    apply('internet', setIntWB);
    apply('fofi', setFofiWB);
    // Warm the cabletv wallet cache too (not displayed here). The cable
    // Checkout screen reads walbal_*_cabletv; without this prefetch its first
    // open is a cold miss and shows "Wallet Balance: Loading…" for the whole
    // 4–45s round trip on the slow backend. Fire-and-forget — getWalBal lsSets
    // the result, so Checkout paints instantly from cache.
    getWalBal({ loginuname: logUname, servicekey: 'cabletv' }, skipCache).catch(() => null);
  }

  function refreshDashboardCounts(skipCache = false) {
    if (!logUname) return;

    const customerPayload = { username: logUname, servid: 1, search: [{ platform: "iptv", providerid: 5 }] };
    const ticketPayload = { user: logUname, op_id: opId, dept: '' };

    Promise.all([
      getCustList(customerPayload, 'expiring').catch(() => null),
      getCustList(customerPayload, 'live').catch(() => null),
      getTickets('PENDING', ticketPayload).catch(() => null),
    ]).then(([expiringData, liveData, ticketData]) => {
      setDashboardCounts({
        todayExpiry: expiringData?.status?.err_code === 0 && Array.isArray(expiringData?.body) ? expiringData.body.length : 0,
        liveUsers: liveData?.status?.err_code === 0 && Array.isArray(liveData?.body) ? liveData.body.length : 0,
        tickets: ticketData?.status?.err_code === 0 && Array.isArray(ticketData?.body) ? ticketData.body.length : 0,
      });
    });

    // Fired separately from the batch above: the ACS is a different backend on
    // a different host, so a slow or down ACS must not hold up the customer and
    // ticket counts that share the Promise.all. Failure is swallowed — the tile
    // simply shows no figure.
    getFleetCounts({ opId, thresholdMin: ONLINE_THRESHOLD_MIN, skipCache })
      .then(setOntCounts)
      .catch(() => setOntCounts(null));
  }

  useEffect(() => {
    // Fetch everything in parallel - wallet balances + ads all at once
    const mobile = getIptvMobile();
    refreshWalletBalances();
    refreshDashboardCounts();
    if (mobile) {
      getAdvertisements({ mobile }).then(adData => {
        const list = (adData?.body?.[0]?.ads || []).filter(a => a.content);
        if (list.length > 0) setAdList(list);
      }).catch(() => {});
    }

    // Pre-warm the full "All Customers" list in the background so tapping
    // "All Users" loads from the 10-min cache instead of a cold network
    // fetch. Deferred ~1.5s so this big payload doesn't compete with the
    // dashboard's own data on first paint. getCustList caches and returns
    // the cache on hit, so it's network-free when already warm.
    // Fire-and-forget — never blocks the dashboard.
    let warmAllCustomersTimer = null;
    if (logUname) {
      warmAllCustomersTimer = setTimeout(() => {
        getCustList({ username: logUname, servid: 1, search: [{ platform: "iptv", providerid: 5 }] }, '').catch(() => {});
      }, 1500);
    }

    // Re-fetch wallet balances when user navigates back to this page
    // (e.g. after payment, the app navigates to '/' but the balance is stale)
    // skipCache=true so we always hit the API, not the 5-min localStorage cache
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshWalletBalances(true);
        refreshDashboardCounts(true);
      }
    };
    const onPageShow = () => {
      refreshWalletBalances(true);
      refreshDashboardCounts(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onPageShow);
      if (warmAllCustomersTimer) clearTimeout(warmAllCustomersTimer);
    };
  }, []);

  // Re-fetch wallet when navigating back to dashboard (e.g. after payment)
  // location.key changes on each navigation - skip cache to get fresh balance
  useEffect(() => {
    refreshWalletBalances(true);
    refreshDashboardCounts(true);
  }, [location.key]);

  const cardItems = [
    { id: 'addUser', title: 'Add User', Icon: UsersIcon, path: '/register' },
    { id: 'allUsers', title: 'All Users', Icon: UsersIcon, path: '/customers' },
    { id: 'todayExpiry', title: 'Today Expiry', Icon: BellAlertIcon, path: '/customers?filter=expiring' },
    { id: 'liveUsers', title: 'Live Users', Icon: SignalIcon, path: '/customers?filter=live' },
    { id: 'tickets', title: 'Tickets', Icon: TicketIcon, path: '/tickets' },
    // Parked 5 Sep 2026: the fleet screen needs more work before operators
    // see it, so the tile opens the Coming Soon card instead of /devices.
    // The route itself stays for direct links and for when this flips back.
    { id: 'devices', title: 'Routers', Icon: CpuChipIcon, path: '/devices', comingSoon: true },
    { id: 'usage', title: 'Data Usage', Icon: ChartBarIcon, path: '/data-usage' },
    { id: 'orders', title: 'Order History', Icon: ArchiveBoxIcon, path: '/orders' },
    { id: 'reset', title: 'Reset Mac', Icon: ArrowPathIcon, path: '/reset-mac' },
  ]

  return (
    <div className="px-4 py-4 space-y-6">
      {/* Wallet Card */}
      <div className="rounded-2xl p-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-md/5 opacity-90 font-bold">Wallet Balance</p>
            <p className="text-3xl font-bold">
              {intWB === null
                ? <span className="inline-block h-8 w-32 align-middle rounded-md bg-white/30 animate-pulse" />
                : import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL + ' ' + intWB}
            </p>
          </div>
          <button className="p-3 rounded bg-white/20 backdrop-blur">+</button>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-white/10 p-2 rounded-xl text-center"><p className="text-sm opacity-90">Internet</p><p className="text-sm font-semibold">{intWB === null ? <span className="inline-block h-4 w-14 rounded bg-white/30 animate-pulse" /> : import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL + ' ' + intWB}</p></div>
          <div className="bg-white/10 p-2 rounded-xl text-center"><p className="text-sm opacity-90">Fo-Fi</p><p className="text-sm font-semibold">{fofiWB === null ? <span className="inline-block h-4 w-14 rounded bg-white/30 animate-pulse" /> : import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL + ' ' + fofiWB}</p></div>
          <div className="bg-white/10 p-2 rounded-xl text-center"><p className="text-sm opacity-90">OTT</p><p className="text-sm font-semibold">{import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL + ' 0.00'}</p></div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-3">
        {cardItems.map(({ id, title, Icon, path, comingSoon }) => (
          <Link
            to={path}
            key={id}
            onClick={comingSoon ? (e) => { e.preventDefault(); setComingSoonOpen(true); } : undefined}
            aria-haspopup={comingSoon ? "dialog" : undefined}
            className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow"
          >
            <div className="mx-auto w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center mb-1">
              <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
            </div>
            <p className="text-[13px] leading-tight font-semibold">{title}</p>
            {id === 'todayExpiry' && <p className="mt-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-300">{dashboardCounts.todayExpiry}</p>}
            {id === 'liveUsers' && <p className="mt-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-300">{dashboardCounts.liveUsers}</p>}
            {id === 'tickets' && <p className="mt-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-300">P-{dashboardCounts.tickets}</p>}
            {/* Online/offline rather than a single total — the offline figure is
                the one that needs acting on, and burying it inside a total hides
                exactly the thing worth surfacing on a home screen. */}
            {id === 'devices' && ontCounts && !comingSoon && (
              <p className="mt-1 text-[12px] font-semibold">
                <span className="text-emerald-600 dark:text-emerald-400">{ontCounts.online}</span>
                <span className="text-gray-400"> / </span>
                <span className={ontCounts.offline > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400'}>{ontCounts.offline}</span>
              </p>
            )}
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
      {/* Coming Soon — the SAME card the sidebar shows (Sidebar.jsx), so the
          two cannot drift apart in wording or artwork. Currently only the
          Routers tile opens it. */}
      <Modal isOpen={comingSoonOpen} onClose={() => setComingSoonOpen(false)}>
        <h2 className="text-xl font-semibold text-center text-red-500 mb-2">Coming Soon!</h2>
        <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/under_dev.jpg'} alt="Modal Info" className="w-70 h-70 mx-auto" />
        <p className="text-center text-violet-900 dark:text-violet-300 mt-1">We're working on this feature — check back soon!</p>
        <button
          onClick={() => setComingSoonOpen(false)}
          className="mt-4 w-full py-2 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium transition"
        >
          Cancel
        </button>
      </Modal>

      {/* Welcome. */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
        <h2 className="text-xl font-semibold text-center text-purple-500 mb-2">Warm Welcome!</h2>
        <img src={import.meta.env.VITE_API_APP_DIR_PATH + 'img/welcome.png'} alt="Modal Info" className="w-70 h-70 mx-auto" />
        <p className="text-center text-blue-600 mt-1">We're thrilled to introduce our new platform independent app - designed to bring you a faster, smarter, and more seamless experience!</p>
      </Modal>

    </div>
  )
}
