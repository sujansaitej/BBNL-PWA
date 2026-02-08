import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader, ConfirmDialog, TicketDialog } from "@/components/ui";
import { useToast } from "../../components/ui/Toast";
import { Search, MapPin, ClipboardList } from "lucide-react";
import { livetvTabs, formatTo12Hour } from "../../services/helpers";
import { useOpenMap } from "../../hooks/useOpenMap";
import { getTickets, pickTicket } from "../../services/generalApis";
import LivePlayer from "../../components/LivePlayer";

const LiveTV = () => {
  const toast = useToast();
  const { openMap } = useOpenMap();
  const getInitialTab = () => {
    let hash = decodeURIComponent(window.location.hash.toUpperCase().replace("#", ""));
    hash = hash.includes('_') ? hash.replace("_", " "): hash;
    return livetvTabs().includes(hash) ? hash : "LIVE TV";
  };
  const [activeTab, setActiveTab] = useState(getInitialTab());
  const [showHeader, setShowHeader] = useState(true);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);
  const tabContainerRef = useRef(null);
  const tabRefs = useRef({});

  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tktdialogOpen, setTktdialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState("close");
  const [selectedDept, setSelectedDept] = useState('');
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);

  const userdet = JSON.parse(localStorage.getItem('user'));
  const deptsAllowedTabs = ['LIVE TV', 'YouTube', 'FB Live'];

  const employees = [
    { id: "EMP101", name: "Manjunath" },
    { id: "EMP102", name: "Rajaram" },
    { id: "EMP103", name: "David Wilson" },
  ];


  // 🟢 Sync tab when hash changes (browser navigation)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = decodeURIComponent(window.location.hash.replace("#", ""));
      if (livetvTabs().includes(hash)) setActiveTab(hash);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    setSelectedDept('');setLoading(false);
  }, [activeTab, dialogOpen, tktdialogOpen]);

  async function getTkts(tabKey) {
    const params = { user: userdet?.username, op_id: userdet?.op_id, dept: selectedDept };
    try {
      setLoading(true);
      tickets.length = 0;
      const data = await getTickets(tabKey, params);
      const statusKey = tabKey === 'OPEN' ? 'ticketstatus' : 'status';
      const statusObj = data?.[statusKey];
      if (statusObj?.err_code === 0 && Array.isArray(data?.body)) {
        let cleanedTickets = data?.body;
        if(tabKey === "OPEN" || tabKey === "PENDING" || tabKey === "NEW CONNECTIONS" || tabKey === "DISCONNECTIONS") {
          const nameKey = tabKey === 'OPEN' ? 'customername' : tabKey === 'PENDING' ? 'custname' : 'name';
          const risedTimeKey = tabKey === 'DISCONNECTIONS' || tabKey === 'NEW CONNECTIONS' ? 'risedTime' : 'risedtime';
          cleanedTickets = data?.body.map(ticket => ({
            ...ticket,
            tid: tabKey === 'DISCONNECTIONS' || tabKey === 'NEW CONNECTIONS' ? ticket.ticketId : ticket.tid,
            customername: ticket[nameKey],
            mobile: ticket.mobile.replace(/\(\d+\)/, "").trim(),
            risedtime: ticket[risedTimeKey] ? formatTo12Hour(ticket[risedTimeKey]) : '',
            group: tabKey === 'PENDING' ? ticket.group1 : ticket.group
          }));
        }else if(tabKey === "JOB DONE") {
          cleanedTickets = data?.body.map(ticket => ({
            ...ticket,
            cid: ticket.User_Name,
            customername: ticket.name,
            mobile: ticket.cust_mob.replace(/\(\d+\)/, "").trim(),
            resolved_time: ticket.resolved_time ? formatTo12Hour(ticket.resolved_time) : '',
          }));
        }
        setTickets(cleanedTickets);
        setLoading(false);
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error("Error in getting tickets:", err);
    }
  }

  async function pickTkt(tkt) {
    var params = {};
    if(tkt.action === 'close')
      params = { apiopid: userdet?.username, ticketid: tkt.tid, empname: userdet?.username, empcontact: tkt.mobile, opid: userdet?.op_id, reason: tkt.reason };
    else
      params = { apiopid: userdet?.username, ticketid: tkt.tid, empname: userdet?.username, empcontact: tkt.mobile };
    
    try {
      const data = await pickTicket(params, tkt.action);
      if (data?.status?.err_code === 0) {
        toast.add(data?.status?.err_msg, { type: "success" });
      } else {
        toast.add(data?.status?.err_msg, { type: "error", duration: 3000 });
      }
      setTktdialogOpen(false);
    } catch (err) {
      console.error("Error in getting tickets:", err);
    }
  }

  const confirmPickTkt = (ticket) => {
    setSelectedTicket(ticket);
    setDialogOpen(true);
  }

  const handleConfirm = () => {
    setDialogOpen(false);
    pickTkt(selectedTicket);
  };

  const handleCancel = () => {
    setDialogOpen(false);
  };

  const tktDialog = (type, ticket) => {
    setDialogType(type);
    setSelectedTicket(ticket);
    setTktdialogOpen(true);
  };
  const handleSubmit = (data) => {
    const action = {action: dialogType};
    pickTkt({...selectedTicket, ...data, ...action});
  };

  // Hide header on scroll down, show on scroll up
  useEffect(() => {
    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY;
          if (currentY > lastScrollY.current + 20) {
            setShowHeader(false);
          } else if (currentY < lastScrollY.current - 20) {
            setShowHeader(true);
          }
          lastScrollY.current = currentY;
          ticking.current = false;
        });
        ticking.current = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);


  // 🟢 Scroll to active tab when tab changes
  useEffect(() => {
    const activeEl = tabRefs.current[activeTab];
    const container = tabContainerRef.current;

    if (activeEl && container) {
      const activeRect = activeEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollLeft =
        container.scrollLeft +
        (activeRect.left - containerRect.left) -
        containerRect.width / 2 +
        activeRect.width / 2;

      const start = container.scrollLeft;
      const distance = scrollLeft - start;
      const duration = 600; // 🕒 scroll duration in ms
      const startTime = performance.now();

      const animateScroll = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 0.5 - Math.cos(progress * Math.PI) / 2; // smooth easing
        container.scrollLeft = start + distance * ease;
        if (elapsed < duration) requestAnimationFrame(animateScroll);
      };

      requestAnimationFrame(animateScroll);
    }
  }, [activeTab]);

  const openMap2 = (ticket) => {
    var lat  = ticket.latitude ? parseFloat(ticket.latitude) : 13.0278502;
    var long = ticket.longitude ? parseFloat(ticket.longitude) : 77.5889958;
    openMap({ latitude: lat, longitude: long });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col relative">
      {/* Animated HEADER */}
      <header
        className={`fixed top-0 left-0 right-0 z-40 bg-blue-600 text-white px-4 flex items-center justify-between shadow-md
          transition-all duration-500 ease-in-out transform origin-top ${
            showHeader
              ? "translate-y-0 opacity-100"
              : "-translate-y-full opacity-0"
          }`}
        style={{ height: "3rem", background: "rgb(109, 103, 255)" }}
      >
        <button
          onClick={() => window.history.back()}
          className="text-white mr-3 text-xl" style={{ fontSize: '1.5rem' }}
        >
          ←
        </button>
        <h1 className="text-lg font-semibold">Live TV</h1>
        <div className="w-6" /> {/* spacer */}
      </header>

      {/* Tabs + Filters fixed below header */}
      <div
        className={`fixed left-0 right-0 z-30 bg-white shadow-sm transition-all duration-500 ease-in-out ${
          showHeader ? "top-12" : "top-0"
        }`}
      >

        {/* Filters */}
        <div className="px-4 py-1 bg-white border-b border-gray-100 space-y-2">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by Channel Name..."
              className="w-full border rounded-lg py-2 pl-10 pr-3 text-sm dark:text-gray-600 bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <Search className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Ticket list */}
      <main
        className={`flex-1 overflow-y-auto px-4 pb-4 transition-all duration-500 ${
          showHeader ? (deptsAllowedTabs.includes(activeTab) ? "pt-[200px]" : "pt-[150px]") : "pt-[150px]"
        }`}
      >
        {tickets.length > 0 && (
          <div className="text-sm text-gray-600 mb-2 flex">
            <span>Total Jobs: {tickets.length}</span>
            <span className="ml-auto"><Link to={`/smart-map#${activeTab}`}><MapPin className="h-5 w-5" /> </Link></span>
          </div>
        )}
        {loading ? (
          <Loader size={10} color="indigo" text="Loading channels..." className="py-10" />
        ) : (
        <div>
        {tickets.length === 0 && (
          <div className="text-center text-gray-500 mt-10">
            <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
              <LivePlayer url="https://livestream.bbnl.in/colorskannadahd/index.m3u8" />
            </div>
          </div>
        )}
        {tickets.map((t, i) => (
          <div key={i} className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 mb-5 rounded-xl shadow hover:shadow-cyan-500/100 hover:scale-[1.01] transition-all duration-300">
            <div className="flex flex-col gap-2 text-sm w-full">
              <div className="flex items-center text-blue-800 font-medium">
                <ClipboardList className="w-5 h-5 text-blue-700 font-semibold mr-2" />
                Job #{t.tid}
              </div>
              <div className={`flex`}>
                  <span className={`w-[33%] text-gray-700 dark:text-gray-400 font-semibold`}>Customer ID</span>
                  <span className={`text-gray-700 dark:text-gray-400 font-semibold break-words`}>{t.cid}</span>
              </div>
              <div className={`flex`}>
                  <span className={`w-[34%] text-gray-700 dark:text-gray-400 font-semibold`}>Name</span>
                  <span className={`text-gray-700 dark:text-gray-400 text-wrap`}>{t.customername}</span>
              </div>
              <div className={`flex`}>
                  <span className={`w-[34%] text-gray-700 dark:text-gray-400 font-semibold`}>Mobile No.</span>
                  <span className={`text-gray-700 dark:text-gray-400`}>{t.mobile}</span>
              </div>
              <div className={`flex`}>
                  <span className={`w-[34%] text-gray-700 dark:text-gray-400 font-semibold`}>Complaint</span>
                  <span className={`w-[75%] text-gray-700 dark:text-gray-400 break-words pl-2`}>{t.subject}</span>
              </div>
              <div className={`flex`}>
                  <span className={`w-[34%] text-gray-700 dark:text-gray-400 font-semibold`}>{activeTab !== 'JOB DONE' ? 'Raised Time' : 'Resolved At'}</span>
                  <span className={`text-gray-700 dark:text-gray-400 break-words`}>{activeTab !== 'JOB DONE' ? t.risedtime : t.resolved_time}</span>
              </div>
              {(activeTab !== 'JOB DONE') &&
              <>
              <div className={`flex`}>
                  <span className={`w-[34%] text-gray-700 dark:text-gray-400 font-semibold`}>Address</span>
                  <span className={`w-[75%] text-gray-700 dark:text-gray-400 break-words pl-2`}>{t.address}</span>
              </div>
              <div className={`flex`}>
                  <span className={`w-[34%] text-gray-700 dark:text-gray-400 font-semibold`}>Department</span>
                  <span className={`text-gray-700 dark:text-gray-400 break-words`}>{t.group}</span>
              </div>
              </>
              }
              {activeTab === 'JOB DONE' &&
              <div className={`flex`}>
                  <span className={`w-[34%] text-gray-700 dark:text-gray-400 font-semibold`}>Resolved By</span>
                  <span className={`text-gray-700 dark:text-gray-400 word-wrap`}>{t.resolvedby || ''}</span>
              </div>
              }
              <div className="flex gap-3">
                {(activeTab === 'OPEN' || activeTab === 'NEW CONNECTIONS' || activeTab === 'DISCONNECTIONS') &&
                <>
                  <button className="flex-1 bg-transparent text-sm font-medium text-blue-700 hover:text-white hover:bg-indigo-500 border border-blue-500 hover:border-transparent rounded p-1.5" onClick={() => confirmPickTkt(t)}>Pick Job</button>
                  <button className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-blue-700 hover:text-white hover:bg-indigo-500 border border-blue-500 hover:border-transparent rounded p-1.5" onClick={() => openMap2(t)}>
                    <MapPin className="w-4 h-4" /> View Map
                  </button>
                </>
                }
                {activeTab === 'PENDING' &&
                <>
                  <button className="flex-1 bg-transparent text-sm font-medium text-blue-700 hover:text-white hover:bg-indigo-500 border border-blue-500 hover:border-transparent rounded p-1.5" onClick={() => tktDialog('close', t)}>Close Job</button>
                </>
                }
              </div>
            </div>
          </div>
          ))}
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={dialogOpen}
        message={`Are you sure, you want to pick the ${selectedTicket ? ` job #${selectedTicket.tid}` : ""}?`}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      {/* Ticket Action Dialog */}
      <TicketDialog
        open={tktdialogOpen}
        type={dialogType}
        ticket={selectedTicket}
        employees={employees}
        onSubmit={handleSubmit}
        onCancel={() => setTktdialogOpen(false)}
      />
    </div>
  );
};

export default LiveTV;
