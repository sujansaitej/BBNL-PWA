import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout from "../../layout/Layout";
import { Loader, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { ChevronLeftIcon, MagnifyingGlassIcon, TvIcon } from "@heroicons/react/24/outline";
import { getUser } from "../../services/safeStorage";
import { getActiveAccount } from "../../services/customer/linkAccount";
import { proxyImageUrl } from "../../services/iptvImage";
import {
  getPkgCategories,
  getPackagesList,
  getChannelsList,
  getPkgChannelsList,
} from "../../services/generalApis";
import { getIptvLastSubscribed } from "../../services/customer/servicePayment";
import {
  togglePackage,
  toggleChannel,
  applyMandatoryBasePacks,
  isPackageSubscribed,
  isChannelSubscribed,
  isMandatoryBasePack,
  isPackageSelected,
  isChannelSelected,
  assembleSelectionIds,
  canProceed,
} from "../../services/customer/cableSelect";

// ── response-shape adapters (backend fields vary; keep these thin) ──
const toIdArray = (v) =>
  Array.isArray(v) ? v.filter((x) => x != null && x !== "").map(String) : [];

function normalizeCategories(res) {
  const body = res?.body;
  const raw = Array.isArray(body) ? body : Array.isArray(body?.categories) ? body.categories : [];
  return raw
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      ...c,
      id: String(c.id ?? c.categoryid ?? c.category_id ?? ""),
      name: c.name || c.title || c.category || "Category",
    }))
    .filter((c) => c.id);
}

function parsePackages(res, subscribedIds) {
  const body = res?.body;
  let arr = Array.isArray(body) ? body : body?.result || body?.packages || body?.data || [];
  if (!Array.isArray(arr)) arr = [];
  const sub = new Set(subscribedIds.map(String));
  // Mark rows the box already carries so the pure helpers lock + ribbon them
  // consistently, even if the backend omitted issubscribed for a row.
  return arr
    .filter((p) => p && typeof p === "object")
    .map((p) => (sub.has(String(p.pkgid ?? p.packageid ?? p.id)) ? { ...p, issubscribed: "yes" } : p));
}

function parseChannels(res, subscribedIds) {
  let arr = res?.body?.result || res?.body || [];
  if (!Array.isArray(arr)) arr = [];
  const sub = new Set(subscribedIds.map(String));
  return arr
    .filter((c) => c && typeof c === "object")
    .map((c) => (sub.has(String(c.chid ?? c.lcochid)) ? { ...c, issubscribed: "yes" } : c));
}

export default function CableSelect() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const account = getActiveAccount();
  const user = getUser();
  const userid = account?.userid;
  const username = user?.username;
  const fofiboxid = location.state?.fofiboxid || "";
  const initialView = location.state?.view === "channels" ? "channels" : "packages";

  const [view, setView] = useState(initialView);

  // Subscribed id sets (drive the backend's issubscribed flags + ribbons).
  const [activePkgIds, setActivePkgIds] = useState([]);
  const [activeChanIds, setActiveChanIds] = useState([]);

  // Packages
  const [categories, setCategories] = useState([]);
  const [activeCatId, setActiveCatId] = useState("");
  const [packagesByCategory, setPackagesByCategory] = useState({}); // keyed by String(cat.id)
  const [catLoading, setCatLoading] = useState(false);
  const [pkgSearch, setPkgSearch] = useState("");

  // Channels
  const [channels, setChannels] = useState(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [chanSearch, setChanSearch] = useState("");

  // Selection (shapes defined in cableSelect.js).
  const [selectedPackages, setSelectedPackages] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);

  // Package-detail modal
  const [detailPkg, setDetailPkg] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false); // subscribed sets resolved
  const [error, setError] = useState("");

  async function fetchPackagesFor(catId, pkgIds) {
    const res = await getPackagesList({ category: catId, packageid: pkgIds, userid, username });
    return parsePackages(res, pkgIds);
  }

  // ── Mount: subscribed sets + categories + first category's packages ──
  useEffect(() => {
    if (!userid) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [subRes, catRes] = await Promise.all([
          getIptvLastSubscribed({ userid, itemid: fofiboxid }),
          getPkgCategories({ username, userid }),
        ]);
        if (cancelled) return;

        const pkgIds = toIdArray(subRes?.body?.packageid);
        const chIds = toIdArray(subRes?.body?.channelid);
        setActivePkgIds(pkgIds);
        setActiveChanIds(chIds);

        const cats = normalizeCategories(catRes);
        setCategories(cats);

        const first = cats[0];
        if (first) {
          setActiveCatId(first.id);
          const pkgs = await fetchPackagesFor(first.id, pkgIds);
          if (cancelled) return;
          const byCat = { [first.id]: pkgs };
          setPackagesByCategory(byCat);
          // Auto-add every mandatory category's base pack.
          setSelectedPackages((prev) => applyMandatoryBasePacks(prev, cats, byCat));
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not load the channel packages.");
      } finally {
        if (!cancelled) { setLoading(false); setReady(true); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userid, fofiboxid]);

  // ── Lazy-load the alacarte channel grid the first time the view opens ──
  useEffect(() => {
    if (view !== "channels" || channels !== null || channelsLoading || !ready) return;
    let cancelled = false;
    (async () => {
      setChannelsLoading(true);
      try {
        const res = await getChannelsList({ alacarte: "yes", channelid: activeChanIds, userid, username });
        if (!cancelled) setChannels(parseChannels(res, activeChanIds));
      } catch (err) {
        if (!cancelled) { setChannels([]); toast.add(err?.message || "Could not load channels.", { type: "error" }); }
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ready]);

  async function selectCategory(cat) {
    setActiveCatId(cat.id);
    setPkgSearch("");
    if (packagesByCategory[cat.id]) return; // cached — no refetch
    setCatLoading(true);
    try {
      const pkgs = await fetchPackagesFor(cat.id, activePkgIds);
      setPackagesByCategory((prev) => ({ ...prev, [cat.id]: pkgs }));
    } catch (err) {
      setPackagesByCategory((prev) => ({ ...prev, [cat.id]: [] }));
      toast.add(err?.message || "Could not load packages.", { type: "error" });
    } finally {
      setCatLoading(false);
    }
  }

  async function openDetail(pkg) {
    setDetailPkg(pkg);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const res = await getPkgChannelsList({ packageid: pkg.pkgid, pkgcode: pkg.pkgcode, userid, username });
      setDetailData(res?.body || {});
    } catch (err) {
      setDetailData({});
      toast.add(err?.message || "Could not load package channels.", { type: "error" });
    } finally {
      setDetailLoading(false);
    }
  }

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeCatId) || null,
    [categories, activeCatId]
  );

  const visiblePackages = useMemo(() => {
    const list = packagesByCategory[activeCatId] || [];
    if (!pkgSearch) return list;
    const q = pkgSearch.toLowerCase();
    return list.filter((p) => String(p.pkgname || p.packagename || p.name || "").toLowerCase().includes(q));
  }, [packagesByCategory, activeCatId, pkgSearch]);

  const visibleChannels = useMemo(() => {
    const list = channels || [];
    if (!chanSearch) return list;
    const q = chanSearch.toLowerCase();
    return list.filter((c) =>
      String(c.chtitle || c.chnlname || c.name || "").toLowerCase().includes(q) ||
      String(c.chid ?? "").toLowerCase().includes(q)
    );
  }, [channels, chanSearch]);

  const proceed = () => {
    const ids = assembleSelectionIds(selectedPackages, selectedChannels);
    navigate("/cust/iptv/pay", { state: { selection: true, fofiboxid, ...ids } });
  };

  if (!userid) {
    return (
      <Layout>
        <div className="px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">No account selected.</p>
          <button
            onClick={() => navigate("/cust/iptv")}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
          >
            Link an account
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto w-full">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2">
          <button
            onClick={() => navigate("/cust/iptv/home")}
            className="flex items-center gap-1 text-sm font-medium text-indigo-600"
          >
            <ChevronLeftIcon className="w-5 h-5" /> Back
          </button>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100 ml-1">Create Your Package</h1>
        </div>

        {/* Segmented control — Packages / Channels (both selections persist) */}
        <div className="px-4">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1 text-sm font-medium">
            {[
              { key: "packages", label: `Packages (${selectedPackages.length})` },
              { key: "channels", label: `Channels (${selectedChannels.length})` },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`flex-1 py-2 rounded-md transition-colors ${
                  view === t.key
                    ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-300 shadow"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader size="lg" color="indigo" text="Loading packages…" />
          </div>
        ) : error ? (
          <div className="m-4 bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center text-sm text-red-500">
            {error}
          </div>
        ) : view === "packages" ? (
          <PackagesView
            categories={categories}
            activeCatId={activeCatId}
            activeCategory={activeCategory}
            selectCategory={selectCategory}
            catLoading={catLoading}
            pkgSearch={pkgSearch}
            setPkgSearch={setPkgSearch}
            visiblePackages={visiblePackages}
            selectedPackages={selectedPackages}
            setSelectedPackages={setSelectedPackages}
            openDetail={openDetail}
          />
        ) : (
          <ChannelsView
            channelsLoading={channelsLoading}
            chanSearch={chanSearch}
            setChanSearch={setChanSearch}
            visibleChannels={visibleChannels}
            selectedChannels={selectedChannels}
            setSelectedChannels={setSelectedChannels}
          />
        )}
      </div>

      {/* Sticky footer — counts + Proceed to Pay (sits above the bottom nav) */}
      <div
        className="fixed left-0 right-0 z-30 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-3"
        style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-2xl mx-auto w-full flex items-center gap-3">
          <div className="text-xs text-gray-600 dark:text-gray-300 leading-tight">
            <div>Packages: <span className="font-semibold text-indigo-600 dark:text-indigo-300">{selectedPackages.length}</span></div>
            <div>Channels: <span className="font-semibold text-orange-500">{selectedChannels.length}</span></div>
          </div>
          <button
            onClick={proceed}
            disabled={!canProceed(selectedPackages, selectedChannels)}
            className="flex-1 py-3 rounded-lg text-white text-sm font-semibold bg-gradient-to-r from-orange-500 to-orange-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed"
          >
            Proceed to Pay
          </button>
        </div>
      </div>

      {/* Package channels detail modal (read-only) */}
      <Modal
        isOpen={!!detailPkg}
        onClose={() => { setDetailPkg(null); setDetailData(null); }}
        title={detailPkg?.pkgname || detailPkg?.packagename || "Package Channels"}
      >
        <div className="p-5">
          {detailLoading ? (
            <div className="py-8 flex justify-center">
              <Loader size="sm" color="indigo" text="Loading channels…" />
            </div>
          ) : (
            <PackageDetail data={detailData} />
          )}
        </div>
      </Modal>
    </Layout>
  );
}

function PackagesView({
  categories, activeCatId, activeCategory, selectCategory, catLoading,
  pkgSearch, setPkgSearch, visiblePackages, selectedPackages, setSelectedPackages, openDetail,
}) {
  return (
    <div className="px-4 pt-3 pb-56">
      {/* Category tabs */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => selectCategory(cat)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                activeCatId === cat.id
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative my-3">
        <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search packages…"
          value={pkgSearch}
          onChange={(e) => setPkgSearch(e.target.value)}
          className="w-full bg-white dark:bg-gray-800 text-gray-800 dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {catLoading ? (
        <div className="py-10 flex justify-center">
          <Loader size="sm" color="indigo" text="Loading packages…" />
        </div>
      ) : visiblePackages.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          {pkgSearch ? "No packages match your search." : "No packages in this category."}
        </div>
      ) : (
        <div className="space-y-3">
          {visiblePackages.map((pkg, idx) => {
            const pkgId = String(pkg.pkgid ?? pkg.packageid ?? pkg.id ?? idx);
            const name = pkg.pkgname || pkg.packagename || pkg.name || "Package";
            const price = Number(pkg.pkgprice ?? pkg.price ?? 0);
            const count = pkg.totchnls;
            const subscribed = isPackageSubscribed(pkg);
            const mandatory = isMandatoryBasePack(pkg, categories);
            const selected = isPackageSelected(selectedPackages, pkgId);
            const locked = subscribed || mandatory;

            return (
              <div
                key={pkgId}
                className="bg-white dark:bg-gray-800 rounded-lg p-3 flex items-center gap-3 border border-gray-200 dark:border-gray-700"
              >
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0 disabled:opacity-60"
                  checked={selected || subscribed}
                  disabled={locked}
                  onChange={() =>
                    setSelectedPackages((prev) => togglePackage(prev, pkg, activeCategory, categories))
                  }
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-tight break-words">
                    {name}{count ? ` (${count})` : ""}
                  </h4>
                  {subscribed ? (
                    <span className="mt-1 inline-block bg-green-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded">
                      Subscribed
                    </span>
                  ) : mandatory ? (
                    <span className="mt-1 inline-block bg-indigo-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded">
                      Included
                    </span>
                  ) : null}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">₹ {price.toFixed(2)}</p>
                  <button
                    onClick={() => openDetail(pkg)}
                    className="text-xs text-orange-500 font-semibold"
                  >
                    View channels
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChannelsView({
  channelsLoading, chanSearch, setChanSearch, visibleChannels, selectedChannels, setSelectedChannels,
}) {
  return (
    <div className="px-4 pt-3 pb-56">
      {/* Search */}
      <div className="relative my-3">
        <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search channels…"
          value={chanSearch}
          onChange={(e) => setChanSearch(e.target.value)}
          className="w-full bg-white dark:bg-gray-800 text-gray-800 dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {channelsLoading ? (
        <div className="py-10 flex justify-center">
          <Loader size="sm" color="indigo" text="Loading channels…" />
        </div>
      ) : visibleChannels.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          {chanSearch ? "No channels match your search." : "No channels available."}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {visibleChannels.map((ch, idx) => {
            const chId = String(ch.chid ?? ch.lcochid ?? idx);
            const title = ch.chtitle || ch.chnlname || ch.name || `Channel ${idx + 1}`;
            const price = Number(ch.chmrp ?? ch.chnlprice ?? ch.price ?? 0);
            const type = String(ch.chtype || "").toUpperCase();
            const logo = ch.chlogo || ch.logo || "";
            const hasLogo = logo && !String(logo).includes("chnlnoimage");
            const subscribed = isChannelSubscribed(ch);
            const selected = isChannelSelected(selectedChannels, chId);

            return (
              <button
                key={chId}
                type="button"
                onClick={() => {
                  if (subscribed) return;
                  setSelectedChannels((prev) => toggleChannel(prev, ch));
                }}
                className={`bg-white dark:bg-gray-800 rounded-lg overflow-hidden border text-left min-h-[150px] ${
                  selected ? "border-indigo-600 ring-2 ring-indigo-300" : "border-gray-200 dark:border-gray-700"
                } ${subscribed ? "cursor-default" : "cursor-pointer"}`}
              >
                <div className="relative aspect-square w-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden p-1.5">
                  {hasLogo ? (
                    <img
                      src={proxyImageUrl(logo)}
                      alt={title}
                      className="w-full h-full object-contain"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : (
                    <TvIcon className="w-8 h-8 text-gray-400" />
                  )}
                </div>
                {subscribed ? (
                  <span className="m-1 inline-block bg-green-500 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded">
                    Subscribed
                  </span>
                ) : selected ? (
                  <span className="m-1 inline-block bg-indigo-600 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded">
                    Selected
                  </span>
                ) : null}
                <div className="px-2 pb-2 text-center">
                  <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate" title={title}>
                    {title}-{chId}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    ₹{price.toFixed(2)}{type ? ` · ${type}` : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PackageDetail({ data }) {
  const channels = Array.isArray(data?.result) ? data.result : [];
  const totals = data?.totals || {};

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        {totals.pkgprice != null && <span>Price: <b>₹ {Number(totals.pkgprice).toFixed(2)}</b></span>}
        {totals.totalchnls != null && <span>Channels: <b>{totals.totalchnls}</b></span>}
        {totals.totpaidchnls != null && <span>Paid: <b>{totals.totpaidchnls}</b></span>}
        {totals.totftachnls != null && <span>FTA: <b>{totals.totftachnls}</b></span>}
      </div>

      {channels.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">No channel details available.</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {channels.map((ch, i) => {
            const title = ch.chtitle || ch.chnlname || ch.name || "Channel";
            const hasLogo = ch.chlogo && !String(ch.chlogo).includes("chnlnoimage");
            return (
              <div key={ch.chid ?? ch.lcochid ?? i} className="flex items-center gap-2 py-1.5 px-2 bg-gray-50 dark:bg-gray-700/40 rounded-lg text-xs">
                {hasLogo ? (
                  <img
                    src={proxyImageUrl(ch.chlogo)}
                    alt={title}
                    className="w-7 h-7 rounded object-contain bg-white border border-gray-100 flex-shrink-0"
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                  />
                ) : (
                  <span className="w-7 h-7 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                    {title.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 min-w-0 text-gray-700 dark:text-gray-200 truncate">{title}</span>
                {ch.chmrp != null && ch.chmrp !== "" && (
                  <span className="text-gray-500 dark:text-gray-400 font-medium flex-shrink-0">₹{ch.chmrp}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
