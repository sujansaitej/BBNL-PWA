import { useState, useEffect, useMemo } from "react";
import Layout from "../layout/Layout";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlassIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { submitRegistrationNecessities } from "../services/registrationApis";
import {
  buildRegistrationPlans,
  serviceLabels,
  planHasVoice,
} from "../services/registrationPlans";
import { Loader, Badge } from "@/components/ui";
import { getUser, safeGetJSON } from "../services/safeStorage";

export default function Plans() {
  const navigate = useNavigate();
  const [allPlans, setAllPlans] = useState([]);
  const [term, setTerm] = useState("");
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const logUname = getUser().username || "";

  useEffect(() => {
    getPlans();
  }, []);

  async function getPlans() {
    setLoading(true);
    setError("");
    try {
      const data = await submitRegistrationNecessities(logUname);
      if (data?.status?.err_code === 0) {
        // Android's registration list: fofi_plans + multi_plans +
        // internet_plans (ServicePlansListAdapter.java:46-57). Reading only
        // internet_plans — as this screen used to — made every bundled plan
        // invisible, and with it the only route to registering a VOIP line.
        const rows = buildRegistrationPlans(data);
        setAllPlans(rows);
        setGroups(data?.body?.groups || []);
        localStorage.setItem("groups", JSON.stringify(data?.body?.groups || []));
        if (rows.length === 0) {
          setError("No registration plans are configured for this operator.");
        }
      } else {
        setError(data?.status?.err_msg || "Could not load plans. Please try again.");
      }
    } catch (err) {
      setError(err?.message || "Could not load plans. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Derived, not stored: a second `plans` state drifted out of step with
  // `allPlans` whenever a refetch landed while a search term was active.
  const plans = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return allPlans;
    return allPlans.filter((p) =>
      [p.name, p.description, String(p.price), ...serviceLabels(p)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q))
    );
  }, [allPlans, term]);

  function selectPlan(plan) {
    const regDataObj = safeGetJSON("registrationData", {});
    // Mirrors ServicePlansListAdapter's per-bucket click handlers: an internet
    // plan sets internet_servid and blanks the plan ids; a bundle plan does the
    // reverse. Both are already resolved on the normalised row.
    const updated = {
      ...regDataObj,
      internet_servid: plan.internet_servid,
      planid: plan.planid,
      priceid: plan.priceid,
      planname: plan.planname,
      payurl: plan.payurl,
      servid_pay: plan.servid_pay,
    };
    localStorage.setItem("registrationData", JSON.stringify(updated));
    localStorage.setItem("selectedPlan", JSON.stringify(plan));
    navigate("/subscribe");
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-2 px-3 py-2">
        <h1 className="text-medium font-bold text-gray-900 dark:text-white">
          Select a plan <Badge color="grey">{plans.length}</Badge>
        </h1>
        <div className="relative w-full">
          <input
            type="text"
            placeholder="Search plans..."
            className="w-full px-4 py-2 pr-10 border border-gray-300 bg-white dark:bg-gray-800 text-gray-800 dark:text-white dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            disabled={loading}
          />
          <MagnifyingGlassIcon className="h-5 w-5 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {loading ? (
          <Loader size={10} color="indigo" text="Loading plans..." className="py-10" />
        ) : error ? (
          <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow text-center space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={getPlans}
              className="rounded-lg border border-indigo-500 px-4 py-2 text-sm text-indigo-600 dark:text-indigo-400"
            >
              Retry
            </button>
          </div>
        ) : plans.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No plans match “{term}”.
          </p>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <div
                key={p.key}
                className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl shadow cursor-pointer"
                onClick={() => selectPlan(p)}
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-medium dark:text-white">{p.name}</p>
                    {p.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{p.description}</p>
                    )}

                    <div className="text-xs text-gray-500 dark:text-gray-500 gap-2 flex flex-wrap items-center">
                      {p.label && <Badge color="indigo">{p.label}</Badge>}
                      <Badge color="purple" size="sm">
                        {import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL + " " + p.price}
                      </Badge>
                    </div>

                    {/* Which services this plan actually registers. Without
                        this the operator cannot tell a plain FoFi package from
                        one that also provisions a VOIP line — and the VOIP
                        number is allocated by the backend, so the plan is the
                        only place that choice is ever made. */}
                    {p.services.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {serviceLabels(p).map((label) => (
                          <span
                            key={label}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              label === "Voice / VOIP"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                    {planHasVoice(p) && (
                      <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                        A VOIP number is allocated automatically on registration.
                      </p>
                    )}
                  </div>
                </div>
                <ArrowRightIcon className="h-6 w-6 text-gray-500 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
