import { useState, useEffect, useCallback, memo } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { PlayCircleIcon } from "@heroicons/react/24/solid";
import { FilmIcon, TvIcon, MagnifyingGlassIcon, XMarkIcon, StarIcon } from "@heroicons/react/24/outline";
import Layout from "../../layout/Layout";
import { getOTTContentList, getOTTCategories, getOTTEntitlement, getOttMobile } from "../../services/ottApi";

// ── OTT Partners ──
const OTT_PARTNERS = [
  {
    id: "watcho",
    name: "Watcho",
    tagline: "Movies, Shows & Live TV",
    webUrl: "https://www.watcho.com",
    features: ["Live TV", "Movies", "Web Series", "News", "Originals"],
  },
];

// ── Quick Category Config ──
const QUICK_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "movies", label: "Movies" },
  { id: "series", label: "Web Series" },
  { id: "live", label: "Live TV" },
  { id: "trending", label: "Trending" },
];

// ── Skeleton Shimmer ──
function ContentSkeleton({ count = 4 }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-shrink-0 w-28">
          <div className="aspect-[2/3] rounded-xl skeleton dark:skeleton-dark" />
          <div className="h-3 skeleton dark:skeleton-dark rounded mt-2 w-3/4" />
          <div className="h-2.5 skeleton dark:skeleton-dark rounded mt-1 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// ── Content Card ──
const ContentCard = memo(function ContentCard({ item, onPlay, isEntitled }) {
  const locked = !isEntitled && item.premium;
  return (
    <div
      onClick={() => onPlay(item)}
      className="relative flex-shrink-0 w-28 cursor-pointer active:scale-[0.97] transition-transform duration-150"
    >
      <div className="aspect-[2/3] rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-md">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-100 to-blue-100 dark:from-indigo-900 dark:to-blue-900 flex items-center justify-center">
            <FilmIcon className="w-8 h-8 text-indigo-300 dark:text-indigo-600" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent rounded-xl" />

        {/* Play icon center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-9 h-9 rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center shadow">
            {locked ? (
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : (
              <PlayCircleIcon className="w-5 h-5 text-white" />
            )}
          </div>
        </div>

        {/* Premium badge */}
        {item.premium && (
          <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-gradient-to-r from-yellow-500 to-amber-500 text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full">
            <StarIcon className="w-2 h-2" />
            PRO
          </div>
        )}

        {/* Bottom title */}
        <div className="absolute bottom-0 inset-x-0 p-2">
          <p className="text-[10px] font-semibold text-white leading-tight line-clamp-2 drop-shadow">
            {item.title}
          </p>
        </div>
      </div>

      {item.genre && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 truncate px-0.5">{item.genre}</p>
      )}
    </div>
  );
});

// ── Category Row ──
function CategoryRow({ title, items, onPlay, isEntitled }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <div className="flex items-center gap-2">
          <FilmIcon className="w-3.5 h-3.5 text-indigo-500" />
          <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h3>
        </div>
        <span className="text-[11px] text-gray-400 font-medium">{items.length} titles</span>
      </div>
      <div
        className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
      >
        {items.map((item) => (
          <ContentCard
            key={item.contentid || item.id}
            item={item}
            onPlay={onPlay}
            isEntitled={isEntitled}
          />
        ))}
      </div>
    </div>
  );
}

export default function OTTHub() {
  if (localStorage.getItem("loginType") !== "customer") {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const mobile = getOttMobile();

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [contentByCategory, setContentByCategory] = useState({});
  const [entitlement, setEntitlement] = useState(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    if (!mobile) { setLoading(false); return; }
    loadContent();
  }, []);

  async function loadContent() {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        getOTTCategories({ mobile }),
        getOTTContentList({ mobile }),
        getOTTEntitlement({ mobile }),
      ]);

      if (results[0].status === "fulfilled") {
        const cats = results[0].value?.body?.categories || results[0].value?.categories || results[0].value?.body || [];
        if (Array.isArray(cats)) setCategories(cats);
      }

      if (results[1].status === "fulfilled") {
        const allContent = results[1].value?.body?.content || results[1].value?.content || results[1].value?.body || [];
        if (Array.isArray(allContent) && allContent.length > 0) {
          const grouped = {};
          allContent.forEach((item) => {
            const cat = item.category || item.genre || "Other";
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
          });
          setContentByCategory(grouped);
        }
      }

      if (results[2].status === "fulfilled") {
        setEntitlement(results[2].value?.body || results[2].value);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }

  // Debounced search
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await getOTTContentList({ mobile, search: search.trim() });
        const r = data?.body?.content || data?.content || data?.body || [];
        setSearchResults(Array.isArray(r) ? r : []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [search, mobile]);

  const isEntitled = useCallback(
    (item) => {
      if (!item?.premium) return true;
      if (!entitlement) return false;
      return entitlement.subscribed === true || entitlement.status === "active" || entitlement.is_subscribed === true;
    },
    [entitlement]
  );

  function handlePlay(item) {
    navigate("/cust/ott/player", {
      state: { content: item, locked: item.premium && !isEntitled(item) },
    });
  }

  function handleExplorePartner(partner) {
    window.open(partner.webUrl, "_blank", "noopener,noreferrer");
  }

  const displayContent = activeCategory === "all"
    ? contentByCategory
    : { [activeCategory]: contentByCategory[activeCategory] || [] };

  const hasContent = Object.values(contentByCategory).some((arr) => arr.length > 0);

  return (
    <Layout>
      <div className="px-4 pt-4 pb-2 max-w-lg mx-auto">
        {/* ── Header Row (matches LiveTvPage) ── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate("/cust/dashboard")} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm shadow-indigo-200">
              <FilmIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">OTT</h2>
              <p className="text-[11px] text-gray-400">{loading ? "Loading..." : "Movies, Shows & More"}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-full">
            <TvIcon className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 tracking-wider">STREAM</span>
          </div>
        </div>

        {/* ── Search Bar (matches LiveTvPage) ── */}
        <div className="relative mb-4">
          <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-3 shadow-sm focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200 transition-[border-color,box-shadow] min-h-[48px]">
            <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 mr-2 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search movies, shows, series..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full outline-none text-sm text-gray-700 dark:text-white bg-transparent placeholder-gray-400"
            />
            {search && (
              <button onClick={() => setSearch("")} className="ml-2 flex-shrink-0">
                <XMarkIcon className="w-5 h-5 text-gray-400" />
              </button>
            )}
          </div>
        </div>

        {/* ── Search Results ── */}
        {search.trim() ? (
          <div>
            <div className="flex items-center gap-2 mb-3 px-0.5">
              <MagnifyingGlassIcon className="w-3.5 h-3.5 text-gray-400" />
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                {searching ? "Searching..." : `Results (${searchResults.length})`}
              </h3>
            </div>
            {searchResults.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {searchResults.map((item) => (
                  <ContentCard key={item.contentid || item.id} item={item} onPlay={handlePlay} isEntitled={isEntitled(item)} />
                ))}
              </div>
            ) : !searching && (
              <div className="flex flex-col items-center py-16">
                <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                  <FilmIcon className="w-7 h-7 text-gray-300 dark:text-gray-600" />
                </div>
                <p className="text-sm text-gray-500 font-medium">No results found</p>
                <p className="text-xs text-gray-400 mt-1">Try a different search</p>
                <button onClick={() => setSearch("")} className="mt-3 text-sm text-indigo-600 font-semibold hover:underline">Clear search</button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ── Category Filter Tabs ── */}
            <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {QUICK_CATEGORIES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveCategory(id)}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    activeCategory === id
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                      : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                  }`}
                >
                  {label}
                </button>
              ))}
              {categories.map((cat) => {
                const catName = cat.name || cat.title || cat;
                return (
                  <button
                    key={cat.id || cat.categoryid || catName}
                    onClick={() => setActiveCategory(catName)}
                    className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      activeCategory === catName
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {catName}
                  </button>
                );
              })}
            </div>

            {/* ── Partner Card (Watcho) ── */}
            {OTT_PARTNERS.map((partner) => (
              <div key={partner.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden mb-5 border border-gray-100 dark:border-gray-700">
                {/* Banner */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-5 relative overflow-hidden">
                  <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full blur-xl" />
                  <div className="relative flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-extrabold text-white">{partner.name}</h3>
                      <p className="text-white/70 text-xs mt-0.5">{partner.tagline}</p>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <PlayCircleIcon className="w-6 h-6 text-white" />
                    </div>
                  </div>
                </div>

                {/* Features + CTA */}
                <div className="px-5 py-4">
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {partner.features.map((f) => (
                      <span key={f} className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold px-2.5 py-1 rounded-full">
                        {f}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => handleExplorePartner(partner)}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold text-sm py-3 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-200 flex items-center justify-center gap-2"
                  >
                    <PlayCircleIcon className="w-5 h-5" />
                    Explore {partner.name}
                  </button>
                </div>
              </div>
            ))}

            {/* ── Loading Skeletons ── */}
            {loading && (
              <div className="space-y-5">
                {[1, 2].map((i) => (
                  <div key={i}>
                    <div className="h-3 skeleton dark:skeleton-dark rounded w-24 mb-3" />
                    <ContentSkeleton />
                  </div>
                ))}
              </div>
            )}

            {/* ── API Content Rows ── */}
            {!loading && hasContent && (
              Object.entries(displayContent).map(([category, items]) => (
                <CategoryRow
                  key={category}
                  title={category}
                  items={items}
                  onPlay={handlePlay}
                  isEntitled={(item) => !item?.premium || isEntitled(item)}
                />
              ))
            )}

            {/* ── Empty State ── */}
            {!loading && !hasContent && (
              <div>
                {/* Placeholder cards */}
                <div className="flex items-center gap-2 mb-2.5 px-0.5">
                  <FilmIcon className="w-3.5 h-3.5 text-gray-400" />
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Coming Soon</h3>
                </div>
                <div className="flex gap-3 overflow-hidden mb-5 -mx-4 px-4">
                  {["Movies", "Series", "Live TV", "Originals"].map((label, i) => (
                    <div key={i} className="flex-shrink-0 w-28">
                      <div className="aspect-[2/3] rounded-xl bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-850 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                        <FilmIcon className="w-7 h-7 text-gray-200 dark:text-gray-700" />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1.5 text-center font-medium">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Info card */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-5 text-center">
                  <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <TvIcon className="w-7 h-7 text-indigo-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    In-App Streaming Coming Soon
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                    Stream movies, web series, and live TV directly inside the app.
                    Explore content on our OTT partner above until then.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
