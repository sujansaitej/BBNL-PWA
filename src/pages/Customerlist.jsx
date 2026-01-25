import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from 'react-router-dom';
import Layout from "../layout/Layout";
import { MagnifyingGlassIcon, ArrowRightIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { getCustList, getServiceList } from "../services/generalApis";
import { formatCustomerId } from "../services/helpers";
import { Loader, Badge } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function Customerlist() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const searchTerm = searchParams.get('filter') || '';

  const [allCustomers, setAllCustomers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customercount, setCustomercount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingServices, setLoadingServices] = useState(false);
  const title = (searchTerm === 'expiring' ? "Today's Expiry" : (searchTerm === 'live' ? "Live Customers" : "All Customers"));

  const logUname = JSON.parse(localStorage.getItem('user')).username;

  useEffect(() => {
    getData();
  }, [title]);

  async function getData() {
    setLoading(true);
    try {
      const payload = { username: logUname, servid: 1, search: [{ platform: "iptv", providerid: 5 }] };
      const data = await getCustList(payload, searchTerm);
      if (data?.status?.err_code === 0 && Array.isArray(data?.body)) {
        setAllCustomers(data?.body);
        setCustomers(data?.body);
        setCustomercount(data?.body?.length);
        // console.log(data?.body);
      } else {
        console.error("Failed to get customers:", data?.status?.err_msg || "Unknown error");
      }
    } catch (err) {
      console.error("Error in getting customers:", err);
    } finally {
      setLoading(false);
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
    if (!term) {
      setCustomers(allCustomers);
      setCustomercount(allCustomers.length);
      return;
    }

    const lowerTerm = term.toLowerCase();
    const filtered = allCustomers.filter(
      (d) =>
        d.customer_id.toLowerCase().includes(lowerTerm) ||
        d.name.toLowerCase().includes(lowerTerm) ||
        d.mobile.toLowerCase().includes(lowerTerm) ||
        d.email.toLowerCase().includes(lowerTerm) ||
        d.address.toLowerCase().includes(lowerTerm)
    );

    setCustomers(filtered);
    setCustomercount(filtered.length);
  }

  async function selectCustomer(customer) {
    console.log('🟢 [selectCustomer] Customer selected:', customer.customer_id);
    setLoadingServices(true);
    try {
      // Call API to get service list
      console.log('🟢 [selectCustomer] Calling getServiceList API...');
      const servicesData = await getServiceList();
      console.log('🟢 [selectCustomer] API response received:', servicesData);
      console.log('🟢 [selectCustomer] err_code:', servicesData?.status?.err_code);
      console.log('🟢 [selectCustomer] err_msg:', servicesData?.status?.err_msg);
      console.log('🟢 [selectCustomer] body:', servicesData?.body);

      if (servicesData?.status?.err_code === 0) {
        console.log('🟢 [selectCustomer] Success! Services:', servicesData?.body);
        // Navigate with customer data and services list
        navigate(`/customer/${customer.customer_id}/service/iptv`, {
          state: {
            customer,
            showServiceModal: true,
            services: servicesData?.body || []
          }
        });
      } else {
        // API returned error, show toast and navigate with default behavior
        toast.add(servicesData?.status?.err_msg || 'Failed to load services', { type: 'error' });
        navigate(`/customer/${customer.customer_id}/service/iptv`, {
          state: { customer, showServiceModal: true }
        });
      }
    } catch (error) {
      console.error("Error fetching services:", error);
      // On error, show toast and navigate with default behavior
      toast.add('Failed to load services. Using default options.', { type: 'error' });
      navigate(`/customer/${customer.customer_id}/service/iptv`, {
        state: { customer, showServiceModal: true }
      });
    } finally {
      setLoadingServices(false);
    }
  }

  return (
    <Layout>
      {loadingServices && (
        <Loader fullScreen showHeader headerTitle="Customer OverView" text="Loading services..." />
      )}
      <div className="max-w-2xl mx-auto space-y-2 px-3 py-2">
        <h1 className="text-medium font-bold text-gray-900 dark:text-white">{title} <Badge color="grey">{customercount}</Badge></h1>
        {/* <p className="text-sm text-gray-500 dark:text-gray-400">Choose from our range of internet plans.</p> */}
        <div className="relative w-full">
          <input
            type="text"
            placeholder="Search customer..."
            className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-700 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
            // onChange={(e) => setPlans(filterPlans(e.target.value))}
            onChange={(e) => filterCustomers(e.target.value)}
            disabled={loading}
          />
          <MagnifyingGlassIcon className="h-5 w-5 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {loading ? (
          <Loader text="Loading customers..." />
        ) : (
          <div className="space-y-3">
            {customercount === 0 && <div className="text-center text-gray-500 dark:text-gray-400 py-10">No customers found</div>}
            {customers.map(d => (
              <div key={d.customer_id} className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer border border-gray-100 dark:border-gray-700" onClick={() => selectCustomer(d)}>
                <div className="flex flex-col gap-2 text-sm">
                  <div className={`flex`}>
                    <span className={`w-28 text-gray-700 dark:text-gray-400 font-semibold`}>Username</span>
                    <span className={`text-indigo-600 dark:text-gray-400 font-bold break-words`}>{formatCustomerId(d.customer_id)}</span>
                  </div>
                  <div className={`flex`}>
                    <span className={`w-28 text-gray-700 dark:text-gray-400 font-semibold`}>Name</span>
                    <span className={`text-gray-700 dark:text-gray-400 text-wrap`}>{d.name}</span>
                  </div>
                  <div className={`flex`}>
                    <span className={`w-28 text-gray-700 dark:text-gray-400 font-semibold`}>Mobile No.</span>
                    <span className={`text-gray-700 dark:text-gray-400`}>{d.mobile}</span>
                  </div>
                  <div className={`flex`}>
                    <span className={`w-28 text-gray-700 dark:text-gray-400 font-semibold`}>Email ID</span>
                    <span className={`text-gray-700 dark:text-gray-400 break-words`}>{d.email}</span>
                  </div>
                </div>
                <ArrowRightIcon className="h-6 w-6 text-gray-500" />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
