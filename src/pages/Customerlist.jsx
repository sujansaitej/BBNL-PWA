import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from 'react-router-dom';
import Layout from "../layout/Layout";
import { MagnifyingGlassIcon, ArrowRightIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { getCustList, getServiceList } from "../services/generalApis";
import { lsGet, lsGetStale } from "../services/lsCache";
import { prefetchCustomerData } from "../services/prefetch";
import { formatCustomerId } from "../services/helpers";
import { Loader, Badge } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../services/safeStorage";

const PAGE_SIZE = 20;
const CUSTLIST_TTL = 10 * 60 * 1000; // matches getCustList cache TTL

// Read the cached customer list synchronously so the initial render has
// real data + count. Without this, useState defaults ([], 0, loading=true)
// paint first and the count flashes 0 with a full-screen loader on every
// navigation return — even when the cache is warm.
function readCachedCustomers(status) {
  const cached = lsGetStale(`custlist_${status || 'all'}`, CUSTLIST_TTL);
  const body = cached?.data?.status?.err_code === 0 && Array.isArray(cached?.data?.body)
    ? cached.data.body
    : null;
  return { body, fresh: !!cached?.fresh };
}

export default function Customerlist() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const searchTerm = searchParams.get('filter') || '';

  const _seed = readCachedCustomers(searchTerm);
  const [allCustomers, setAllCustomers] = useState(_seed.body || []);
  const [customers, setCustomers] = useState(_seed.body || []);
  const [customercount, setCustomercount] = useState(_seed.body?.length || 0);
  // Only show the full loader when we truly have nothing to render.
  // If we have any cached data (even stale) we render it immediately
  // and refresh in the background so the count never flashes to 0.
  const [loading, setLoading] = useState(!_seed.body);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [page, setPage] = useState(1);
  const title = (searchTerm === 'expiring' ? "Today's Expiry" : (searchTerm === 'live' ? "Live Customers" : "All Customers"));

  const logUname = getUser().username || "";

  useEffect(() => {
    // If the cached snapshot for this filter is fresh, skip the fetch
    // entirely — getCustList's in-flight dedup will collapse duplicate
    // hits, but we can skip the round trip altogether.
    const seed = readCachedCustomers(searchTerm);
    if (seed.body) {
      if (allCustomers !== seed.body) {
        setAllCustomers(seed.body);
        setCustomers(seed.body);
        setCustomercount(seed.body.length);
      }
      if (seed.fresh) return; // nothing to do — cache is within TTL
    }
    getData(!!seed.body); // pass true to run as a background refresh
  }, [title]);

  async function getData(isBackground = false) {
    if (isBackground) setRefreshing(true);
    else setLoading(true);
    try {
      const payload = { username: logUname, servid: 1, search: [{ platform: "iptv", providerid: 5 }] };
      const data = await getCustList(payload, searchTerm);
      if (data?.status?.err_code === 0 && Array.isArray(data?.body)) {
        setAllCustomers(data?.body);
        setCustomers(data?.body);
        setCustomercount(data?.body?.length);
      } else {
        console.error("Failed to get customers:", data?.status?.err_msg || "Unknown error");
      }
    } catch (err) {
      console.error("Error in getting customers:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // function filterPlans1(term) {console.log(term);
  //   if (!term) {
  //     return plans;
  //   }
  //   const lowerTerm = term.toLowerCase();
  //   return plans.filter(p =>
  //     p.serv_name.toLowerCase().includes(lowerTerm) ||
  //     p.serv_desc.toLowerCase().includes(lowerTerm) ||
  //     (p.serv_rates?.prices && p.serv_rates.prices.some(price => price.toString().includes(lowerTerm)))
  //   );
  // }

  function filterCustomers(term) {
    setPage(1);
    if (!term) {
      setCustomers(allCustomers);
      setCustomercount(allCustomers.length);
      return;
    }

    const lowerTerm = term.toLowerCase();
    const filtered = allCustomers.filter(
      (d) =>
        (d.customer_id || '').toLowerCase().includes(lowerTerm) ||
        (d.name || '').toLowerCase().includes(lowerTerm) ||
        (d.mobile || '').toLowerCase().includes(lowerTerm) ||
        (d.email || '').toLowerCase().includes(lowerTerm) ||
        (d.address || '').toLowerCase().includes(lowerTerm)
    );

    setCustomers(filtered);
    setCustomercount(filtered.length);
  }

  const totalPages = Math.ceil(customers.length / PAGE_SIZE);
  const paginatedCustomers = customers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function selectCustomer(customer) {
    // Start prefetching customer service data in background (cache warming).
    // This fires-and-forgets — does NOT block the navigation.
    prefetchCustomerData(customer.customer_id, logUname);

    // Try to get services from cache *synchronously* — getServiceList's
    // lsGet path returns instantly when the 10-min cache is warm. Most
    // taps hit this path. If the cache is cold we navigate WITHOUT
    // waiting — Services.jsx hydrates from stale cache (24h window)
    // and falls back to its hardcoded ALLOWED_SERVICES list, then
    // refreshes display names in the background.
    //
    // Why this matters: the previous version awaited the API. On a
    // cold cache + slow network the tap appeared frozen for several
    // seconds and operators clicked the customer 2-3 times. Now the
    // navigation paints in the same frame as the tap.
    let services = [];
    try {
      // Read directly from the lsCache without awaiting the network.
      const cached = lsGet('svclist_all', 10 * 60 * 1000);
      if (cached?.body) services = cached.body;
    } catch (_) {}

    navigate(`/customer/${customer.customer_id}/services`, {
      state: { customer, services }
    });

    // Kick a background refresh so the next tap has a warm cache.
    // No await — this returns immediately.
    if (services.length === 0) {
      getServiceList().catch(() => {});
    }
  }

  return (
    <Layout>
      {/* Removed fullscreen loader — navigation is now instant */}
      <div className="max-w-2xl mx-auto space-y-2 px-3 py-2">
        <h1 className="text-medium font-bold text-gray-900 dark:text-white">
          {title} <Badge color="grey">{customercount}</Badge>
          {refreshing && (
            <span className="ml-2 text-xs text-gray-400 font-normal">Refreshing…</span>
          )}
        </h1>
        {/* <p className="text-sm text-gray-500 dark:text-gray-400">Choose from our range of internet plans.</p> */}
        <div className="sticky z-20 -mx-3 px-3 py-2 bg-gray-50 dark:bg-gray-900 shadow-[0_2px_4px_-1px_rgba(0,0,0,0.08)]" style={{ top: 'calc(4rem + env(safe-area-inset-top, 0px))' }}>
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Search customer..."
              className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-[border-color,box-shadow] duration-200"
              // onChange={(e) => setPlans(filterPlans(e.target.value))}
              onChange={(e) => filterCustomers(e.target.value)}
              disabled={loading}
            />
            <MagnifyingGlassIcon className="h-5 w-5 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {loading ? (
          <Loader text="Loading customers..." />
        ) : (
          <div className="space-y-3">
            {customercount === 0 && <div className="text-center text-gray-500 dark:text-gray-400 py-10">No customers found</div>}
            {paginatedCustomers.map(d => (
              <div key={d.customer_id} className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 cursor-pointer border border-gray-100 dark:border-gray-700" onClick={() => selectCustomer(d)}>
                <div className="flex flex-col gap-2 text-sm min-w-0 flex-1 overflow-hidden">
                  <div className={`flex min-w-0`}>
                    <span className={`w-28 flex-shrink-0 text-gray-700 dark:text-gray-400 font-semibold`}>Username</span>
                    <span className={`min-w-0 truncate text-indigo-600 dark:text-gray-400 font-bold`}>{formatCustomerId(d.customer_id)}</span>
                  </div>
                  <div className={`flex min-w-0`}>
                    <span className={`w-28 flex-shrink-0 text-gray-700 dark:text-gray-400 font-semibold`}>Name</span>
                    <span className={`min-w-0 truncate text-gray-700 dark:text-gray-400`}>{d.name}</span>
                  </div>
                  <div className={`flex min-w-0`}>
                    <span className={`w-28 flex-shrink-0 text-gray-700 dark:text-gray-400 font-semibold`}>Mobile No.</span>
                    <span className={`min-w-0 truncate text-gray-700 dark:text-gray-400`}>{d.mobile}</span>
                  </div>
                  <div className={`flex min-w-0`}>
                    <span className={`w-28 flex-shrink-0 text-gray-700 dark:text-gray-400 font-semibold`}>Email ID</span>
                    <span className={`min-w-0 truncate text-gray-700 dark:text-gray-400`}>{d.email}</span>
                  </div>
                  {d.address && (
                    <div className={`flex min-w-0`}>
                      <span className={`w-28 flex-shrink-0 text-gray-700 dark:text-gray-400 font-semibold`}>Address</span>
                      <span className={`min-w-0 truncate text-gray-700 dark:text-gray-400`}>{d.address}</span>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 ml-2 self-center">
                  <ChevronRightIcon className="h-6 w-6 text-indigo-500" />
                </div>
              </div>
            ))}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 pb-4">
                <button
                  onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  disabled={page === 1}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  disabled={page === totalPages}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
