// FleetDashboard — every ONT this operator has, at a glance.
//
// Covers requirements #3 (registered on the ACS), #4 (offline count) and
// #5 (inventory), plus the filtered device list the operator works from.
//
// WHY THIS IS A FUNNEL AND NOT THREE COUNTERS
// -------------------------------------------
// The three numbers the client asked for describe the same fleet at three
// stages, and the GAPS between them are the actionable part:
//
//     Inventory 50  →  Registered 43  →  Online 39
//                  ↑ 7 never provisioned  ↑ 4 down right now
//
// "43 devices" tells an operator nothing they can act on. "Seven boxes you were
// issued have never contacted the server" is a job for this afternoon. So the
// tiles are laid out as a progression with the gaps called out, not as three
// unrelated figures.
//
// TWO NUMBERS THAT NEED HONESTY RATHER THAN A VALUE
// -------------------------------------------------
// * INVENTORY cannot come from the ACS at all. Inventory means ONTs allocated to
//   this operator INCLUDING boxes still in a bag that have never powered on, and
//   the ACS only knows devices that have informed at least once. It has to come
//   from netmon's stock table. Rather than substitute `registered` and quietly
//   show a wrong number, the tile says it is unavailable.
//
// * "FOR THIS OPERATOR" is only true when devices are tagged. GenieACS has no
//   op_id, so without tagging these counts cover every device on the ACS. When
//   scoping is off the page says so in a banner instead of presenting a
//   region-wide total as if it belonged to one franchise.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeftIcon, ArrowPathIcon, CpuChipIcon, MagnifyingGlassIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import BottomNav from "../../components/BottomNav";
import { PresencePill, FreshnessStamp, Card } from "../../components/ont/OntPieces";
import { getFleet, getFleetCounts, isScopedToOperator } from "../../services/ontApis";
import { buildFleetRow, formatAge } from "../../services/ontModel";
import { ONLINE_THRESHOLD_MIN } from "../../constants/ontParams";
import { getUser } from "../../services/safeStorage";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "online", label: "Online" },
  { id: "offline", label: "Offline" },
];

export default function FleetDashboard() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const user = getUser() || {};
  const opId = user.op_id || "";

  const filter = params.get("filter") || "all";
  const [counts, setCounts] = useState(null);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const scoped = isScopedToOperator(opId);

  const load = useCallback(async (skipCache = false) => {
    setLoading(true);
    setError(null);
    try {
      // Counts and list are separate queries on purpose. Deriving the counts by
      // measuring the list would mean pulling every device object just to
      // produce three integers — fine at pilot scale, a memory problem in
      // production on a screen that refetches whenever the window regains focus.
      const [c, list] = await Promise.all([
        getFleetCounts({ opId, thresholdMin: ONLINE_THRESHOLD_MIN, skipCache }),
        getFleet({ opId, filter, thresholdMin: ONLINE_THRESHOLD_MIN, skipCache }),
      ]);
      setCounts(c);
      setRows(list.map((d) => buildFleetRow(d, ONLINE_THRESHOLD_MIN)));
    } catch (err) {
      if (/navigated away/i.test(err.message || "")) return;
      setError(err.message || "Couldn't load the device list.");
    } finally {
      setLoading(false);
    }
  }, [opId, filter]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.serial, r.pppoeUser, r.model, r.manufacturer]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const setFilter = (id) => {
    const next = new URLSearchParams(params);
    if (id === "all") next.delete("filter"); else next.set("filter", id);
    setParams(next, { replace: true });
  };

  return (
    <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
      <header
        className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
      >
        <button onClick={() => navigate(-1)} className="p-1 mr-3" aria-label="Back">
          <ArrowLeftIcon className="h-6 w-6 text-white" />
        </button>
        <h1 className="text-lg font-medium text-white flex-1">Routers</h1>
        <button onClick={() => load(true)} className="p-1" aria-label="Refresh" disabled={loading}>
          <ArrowPathIcon className={`h-5 w-5 text-white ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-28">
        {/* Unscoped counts are a correctness caveat, not a nicety — an operator
            reading a region-wide total as their own will act on it. */}
        {!scoped && (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-3.5 py-2.5">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              These figures cover every router on this server, not just yours. Per-operator
              totals need each router tagged with its operator when it is installed.
            </p>
          </div>
        )}

        {/* ── The funnel — requirements #3, #4, #5 ── */}
        <div className="grid grid-cols-3 gap-2.5">
          <FunnelTile
            label="In inventory"
            value={counts?.inventory}
            unavailable={counts != null && counts.inventory == null}
            hint="From stock records"
          />
          <FunnelTile
            label="On the server"
            value={counts?.registered}
            loading={loading && !counts}
            hint="Have connected"
            onClick={() => setFilter("all")}
          />
          <FunnelTile
            label="Online now"
            value={counts?.online}
            loading={loading && !counts}
            tone="ok"
            hint={`Seen in ${ONLINE_THRESHOLD_MIN} min`}
            onClick={() => setFilter("online")}
          />
        </div>

        {/* The gaps are the point of the funnel, so they get their own row
            rather than being left for the operator to subtract. */}
        {counts && (
          <div className="grid grid-cols-2 gap-2.5">
            {counts.inventory != null && (
              <GapTile
                label="Never connected"
                value={Math.max(0, counts.inventory - counts.registered)}
                tone="warn"
              />
            )}
            <GapTile
              label="Offline now"
              value={counts.offline}
              tone={counts.offline > 0 ? "bad" : "ok"}
              onClick={() => setFilter("offline")}
            />
          </div>
        )}

        {counts && <FreshnessStamp asof={counts.asof} onRefresh={() => load(true)} refreshing={loading} />}

        {/* ── Filters + search ── */}
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === f.id
                  ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Serial number or PPPoE username"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* ── List ── */}
        {error ? (
          <Card className="p-6 text-center space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">{error}</p>
            <button
              onClick={() => load(true)}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
            >
              Try again
            </button>
          </Card>
        ) : loading && !rows ? (
          <div className="py-10 flex items-center justify-center">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" />
          </div>
        ) : visible.length === 0 ? (
          <Card className="p-8 text-center space-y-2">
            <CpuChipIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {search ? "No routers match that search." : "No routers to show."}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {visible.map((r) => (
              <button
                key={r.id}
                onClick={() =>
                  navigate("/devices/detail", { state: { deviceId: r.id, serial: r.serial } })
                }
                className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3.5 flex items-center gap-3"
              >
                <CpuChipIcon className={`w-5 h-5 shrink-0 ${r.online ? "text-indigo-500" : "text-gray-300 dark:text-gray-600"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-50 truncate font-mono">
                    {r.serial || r.id}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {r.pppoeUser || [r.manufacturer, r.model].filter(Boolean).join(" ") || "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right space-y-0.5">
                  <PresencePill online={r.online} size="sm" />
                  <p className="text-[11px] text-gray-400">{formatAge(r.ageMin)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

function FunnelTile({ label, value, hint, tone, loading, unavailable, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-left w-full ${
        onClick ? "active:scale-[0.98] transition-transform" : ""
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
      {loading ? (
        <span className="mt-1 block h-7 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      ) : unavailable ? (
        <p className="text-sm font-medium text-gray-400 dark:text-gray-500 mt-1.5">Not available</p>
      ) : (
        <p
          className={`text-2xl font-bold tabular-nums leading-tight ${
            tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-gray-50"
          }`}
        >
          {value ?? "—"}
        </p>
      )}
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
        {/* Inventory is genuinely outside the ACS's knowledge, so the tile
            explains where it would have to come from rather than showing a
            plausible-looking substitute. */}
        {unavailable ? "Needs stock records" : hint}
      </p>
    </Tag>
  );
}

function GapTile({ label, value, tone, onClick }) {
  const Tag = onClick ? "button" : "div";
  const cls = {
    ok: "bg-emerald-50 dark:bg-emerald-900/25 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-50 dark:bg-amber-900/25 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
    bad: "bg-rose-50 dark:bg-rose-900/25 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300",
  }[tone || "warn"];
  return (
    <Tag onClick={onClick} className={`rounded-xl border px-3.5 py-2.5 flex items-center gap-3 w-full text-left ${cls}`}>
      <span className="text-xl font-bold tabular-nums">{value ?? "—"}</span>
      <span className="text-xs font-medium leading-tight">{label}</span>
    </Tag>
  );
}
