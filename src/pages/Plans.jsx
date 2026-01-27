import { useState, useEffect } from "react";
import Layout from "../layout/Layout";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlassIcon, ArrowRightIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { submitRegistrationNecessities } from "../services/registrationApis";
import { Loader, Badge } from "@/components/ui";

export default function Plans() {
  const navigate = useNavigate();
  const [allPlans, setAllPlans] = useState([]);
  const [plans, setPlans] = useState([]);
  const [groups, setGroups] = useState([]);
  const [plancount, setPlancount] = useState(0);
  const [loading, setLoading] = useState(true);

  const logUname = JSON.parse(localStorage.getItem('user')).username;

  useEffect(() => {
    getPlans();
  }, []);

  async function getPlans() {
    setLoading(true);
    try {
      const data = await submitRegistrationNecessities(logUname);
      if (data?.status?.err_code === 0 && Array.isArray(data?.body?.internet_plans)) {
        setAllPlans(data?.body?.internet_plans);
        setPlans(data?.body?.internet_plans);
        setPlancount(data?.body?.internet_plans.length);
        setGroups(data?.body?.groups || []);
        localStorage.setItem('groups', JSON.stringify(data?.body?.groups || []));
        // console.log(data?.body?.internet_plans);
      } else {
        console.error("Failed to fetch plans:", data?.status?.err_msg || "Unknown error");
      }
    } catch (err) {
      console.error("Error fetching plans:", err);
    }finally {
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

  function filterPlans(term) {
    if (!term) {
      setPlans(allPlans);
      setPlancount(allPlans.length);
      return;
    }

    const lowerTerm = term.toLowerCase();
    const filtered = allPlans.filter(
      (p) =>
        p.serv_name.toLowerCase().includes(lowerTerm) ||
        p.serv_desc.toLowerCase().includes(lowerTerm) ||
        (p.serv_rates?.prices &&
          p.serv_rates.prices.some((price) =>
            price.toString().includes(lowerTerm)
          ))
    );

    setPlans(filtered);
    setPlancount(filtered.length);
  }

  function selectPlan(plan) {
    const regData = localStorage.getItem('registrationData');
    const regDataObj = regData ? JSON.parse(regData) : {};
    const updatedRegDataObj = { ...regDataObj, ['internet_servid']: plan.servid };
    localStorage.setItem('registrationData', JSON.stringify(updatedRegDataObj));
    localStorage.setItem('selectedPlan', JSON.stringify(plan));
    // window.location.href = '/subscribe';
    navigate('/subscribe');
    // localStorage.setItem('internet_servid', plan.servid);
    // alert(`Selected plan: ${plan.serv_name} - ₹${plan.serv_rates?.prices[0]}`);
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-2 px-3 py-2">
        <h1 className="text-medium font-bold text-gray-900 dark:text-white">Select a plan <Badge color="grey">{plancount}</Badge></h1>
        {/* <p className="text-sm text-gray-500 dark:text-gray-400">Choose from our range of internet plans.</p> */}
        <div className="relative w-full">
          <input
            type="text"
            placeholder="Search plans..."
            className="w-full px-4 py-2 pr-10 border border-gray-300 bg-white dark:text-gray-700 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            // onChange={(e) => setPlans(filterPlans(e.target.value))}
            onChange={(e) => filterPlans(e.target.value)}
            disabled={loading}
          />
          <MagnifyingGlassIcon className="h-5 w-5 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {loading ? (
          <Loader size={10} color="indigo" text="Loading plans..." className="py-10" />
        ) : (
        <div className="space-y-3">
          {plans.map(p => (
            <div key={p.servid} className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl shadow cursor-pointer" onClick={() => selectPlan(p)}>
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-medium dark:text-white">{p.serv_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{p.serv_desc}</p>
                  
                  <div className="text-xs text-gray-500 dark:text-gray-500 gap-2 flex">
                    {/* <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 text-xs rounded-full">{p.serv_rates?.labels[0]}</span>
                    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 text-xs rounded-full">₹ {p.serv_rates?.prices[0]}</span> */}
                    <Badge color="indigo">{p.serv_rates?.labels[0]}</Badge>
                    <Badge color="purple" size="sm">{import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL+' '+p.serv_rates?.prices[0]}</Badge>
                  </div>
                </div>
              </div>
              <ArrowRightIcon className="h-6 w-6 text-gray-500" />
              {/* <span className={`font-semibold text-purple-600`}>₹ {p.serv_rates?.prices[0]}</span> */}
            </div>
          ))}
        </div>
        )}
      </div>
    </Layout>
  );
}
