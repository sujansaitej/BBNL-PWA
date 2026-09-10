// OntDevice — the franchise ONT screen. One customer's router, everything the
// operator can see and do about it.
//
// Covers requirements: #1 live/off, #2 SSIDs + client count, #6 fiber loss,
// #7 uptime, #8 probe, #9 reboot, #10 throughput, plus LAN port status/control.
//
// THE ONE DESIGN RULE THAT SHAPES THIS WHOLE FILE
// -----------------------------------------------
// GenieACS reads are two-speed and the UI has to respect that or it feels
// broken:
//
//   cached read   GET /devices?query=… hits GenieACS's own store. No CPE
//                 contact. Milliseconds. Returns whatever the device last
//                 reported, which may be hours old.
//   live read     anything carrying `connection_request` reaches across the
//                 last mile to the CPE. 5-15 seconds, and it simply fails when
//                 the device is offline.
//
// So: paint the cached read instantly with a visible "as of" stamp, and make
// live reads an explicit tap. This is the same lsGetStale-then-refetch shape
// InternetService.jsx and Customerlist.jsx already use, and it is why the
// screen appears immediately rather than after a 10-second spinner.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftIcon, ArrowPathIcon, BoltIcon, SignalIcon,
  WifiIcon, CpuChipIcon, PencilSquareIcon, ChartBarIcon,
} from "@heroicons/react/24/outline";
import BottomNav from "../../components/BottomNav";
import { ConfirmDialog } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import SsidEditSheet from "../../components/ont/SsidEditSheet";
import {
  FreshnessStamp, PresencePill, TaskResult, Section, Card, Row, OpticalGauge,
} from "../../components/ont/OntPieces";
import {
  findDevice, getDeviceById, refreshDevice, probeDevice, rebootDevice,
  setSsid, setLanPorts, sampleCounters, OntError, ONT_ERR,
} from "../../services/ontApis";
import {
  buildDeviceModel, deriveThroughput, formatUptime, formatBytes, formatAge,
} from "../../services/ontModel";
import { refreshParameterNames } from "../../constants/ontParams";

export default function OntDevice() {
  const { customerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const customer = location.state?.customer || null;
  // The CRM knows a customer id and an internet username; the ACS keys on serial
  // and PPPoE username. Hand ontApis everything we have and let it try each.
  const seedSerial = location.state?.serial || null;
  const seedPppoe = location.state?.pppoeUser || location.state?.internetId || customerId || null;
  const seedDeviceId = location.state?.deviceId || null;

  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState(null);

  const [confirmReboot, setConfirmReboot] = useState(false);
  const [confirmLan, setConfirmLan] = useState(null);   // {port, enable}
  const [editRadio, setEditRadio] = useState(null);
  const [busy, setBusy] = useState(false);

  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);
  const [throughput, setThroughput] = useState(null);
  const [measuring, setMeasuring] = useState(false);

  // One guard for every write. Same reason payBillInFlightRef exists in
  // InternetService: a double-tap or a StrictMode double-invoke would otherwise
  // queue two reboots.
  const writeLock = useRef(false);

  const model = useMemo(() => buildDeviceModel(raw), [raw]);

  // ── Initial resolve ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const dev = seedDeviceId
          ? await getDeviceById(seedDeviceId)
          : await findDevice({ serial: seedSerial, pppoeUser: seedPppoe });
        if (cancelled) return;
        if (!dev) {
          // Distinguishing "no such device" from "the ACS is down" is the whole
          // point of OntError. The console conflated them and told operators a
          // device did not exist when the real problem was infrastructure —
          // which sends a technician to site for nothing.
          setLoadError({ code: ONT_ERR.NOT_FOUND, message: "No ONT is mapped to this account on the ACS." });
        } else {
          setRaw(dev);
        }
      } catch (err) {
        if (cancelled || /navigated away/i.test(err.message || "")) return;
        setLoadError({
          code: err instanceof OntError ? err.code : ONT_ERR.UNREACHABLE,
          message: err.message || "Could not reach the ACS server.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seedDeviceId, seedSerial, seedPppoe]);

  // ── Live refresh ───────────────────────────────────────────────────
  /**
   * Asks the CPE for current values, then re-reads the ACS store.
   *
   * Only the parameters this screen renders are requested. The old console
   * refreshed with parameterNames ["Device", "InternetGatewayDevice"] — a
   * full-tree read across both data models, thousands of parameters over CWMP,
   * to populate a page needing about twenty.
   */
  const doRefresh = useCallback(async () => {
    if (!model?.id || refreshing) return;
    setRefreshing(true);
    setResult(null);
    try {
      const res = await refreshDevice(model.id, refreshParameterNames(model.dataModel));
      const fresh = await getDeviceById(model.id, { skipCache: true });
      if (fresh) setRaw(fresh);
      if (res.state === "queued") {
        setResult({
          kind: "queued",
          title: "Device did not answer",
          message: "Showing the last values it reported. It will send fresh ones when it next connects.",
        });
      }
    } catch (err) {
      setResult({ kind: "error", title: "Couldn't refresh", message: err.message });
    } finally {
      setRefreshing(false);
    }
  }, [model?.id, model?.dataModel, refreshing]);

  // ── Probe — requirement #8 ─────────────────────────────────────────
  /**
   * A CWMP connection request, not an ICMP ping.
   *
   * The console's ping helper is dead code aimed at the WAN IP, which is
   * frequently CGNAT and unroutable, and most ONTs drop WAN ICMP anyway — it
   * would ship false negatives. A connection request that returns 200 proves the
   * device is alive AND that the ACS can reach it right now, which is a stronger
   * claim than a ping makes.
   */
  const doProbe = async () => {
    if (!model?.id || probing) return;
    setProbing(true);
    setProbe(null);
    try {
      const p = await probeDevice(model.id, model.dataModel);
      setProbe(p);
    } catch (err) {
      setProbe({ alive: false, state: "error", error: err.message });
    } finally {
      setProbing(false);
    }
  };

  // ── Reboot — requirement #9 ────────────────────────────────────────
  const doReboot = async () => {
    setConfirmReboot(false);
    if (writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    setResult(null);
    try {
      const res = await rebootDevice(model.id);
      // 200 means the device took the command; 202 means GenieACS queued it
      // because the device never answered. Reporting both as success is the
      // single most misleading thing the old console did.
      setResult(res.state === "done"
        ? { kind: "done", title: "Reboot sent", message: "The device is restarting. It will be back in one to two minutes." }
        : { kind: "queued", title: "Reboot queued", message: "The device didn't answer. It will restart the next time it connects to the server." });
    } catch (err) {
      setResult({ kind: "error", title: "Reboot failed", message: err.message });
    } finally {
      setBusy(false);
      writeLock.current = false;
    }
  };

  // ── Wi-Fi — requirement #2 ─────────────────────────────────────────
  const doSsid = async (changes) => {
    if (writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    setResult(null);
    try {
      const res = await setSsid(model.id, editRadio, changes);
      setEditRadio(null);
      const changedPw = changes.password != null;
      setResult(res.state === "done"
        ? {
            kind: "done",
            title: "Wi-Fi updated",
            message: changedPw
              ? "Every device on this network has been disconnected. Reconnect using the new password."
              : "The change has been applied to the router.",
          }
        : {
            kind: "queued",
            title: "Change queued",
            message: "The device didn't answer. The new settings will apply the next time it connects.",
          });
      // Give the CPE a moment to apply before re-reading, otherwise the screen
      // shows the pre-change value and reads as a failure.
      setTimeout(() => { getDeviceById(model.id, { skipCache: true }).then((d) => d && setRaw(d)).catch(() => {}); }, 2500);
    } catch (err) {
      setResult({ kind: "error", title: "Couldn't update Wi-Fi", message: err.message });
    } finally {
      setBusy(false);
      writeLock.current = false;
    }
  };

  // ── LAN ports ──────────────────────────────────────────────────────
  const doLanPort = async () => {
    const req = confirmLan;
    setConfirmLan(null);
    if (!req || writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    setResult(null);
    try {
      const res = await setLanPorts(model.id, [req.port], req.enable, {
        dataModel: model.dataModel,
        // Whitelist from the device's own port table — the console interpolated
        // raw POST input straight into the parameter path.
        validPorts: model.lanPorts.map((p) => p.index),
      });
      setResult(res.state === "done"
        ? { kind: "done", title: `LAN port ${req.port} ${req.enable ? "enabled" : "disabled"}`, message: "" }
        : { kind: "queued", title: "Change queued", message: "The device didn't answer. It will apply the next time it connects." });
      setTimeout(() => { getDeviceById(model.id, { skipCache: true }).then((d) => d && setRaw(d)).catch(() => {}); }, 2000);
    } catch (err) {
      setResult({ kind: "error", title: "Couldn't change the port", message: err.message });
    } finally {
      setBusy(false);
      writeLock.current = false;
    }
  };

  // ── Throughput — requirement #10 ───────────────────────────────────
  /**
   * The ACS publishes CUMULATIVE byte counters and no rate parameter, so a
   * throughput figure needs two samples with a gap between them. That is
   * genuinely a ~15 second operation, so it is an explicit "Measure" button with
   * visible progress rather than a number that silently appears and implies it
   * is live.
   *
   * If RADIUS accounting can expose Acct-Input-Octets / Acct-Output-Octets per
   * subscriber, that answers the same question with no CPE contact, no counter
   * wrap and no waiting — this becomes a fallback rather than the mechanism.
   */
  const doMeasure = async () => {
    if (!model?.id || measuring) return;
    setMeasuring(true);
    setThroughput(null);
    try {
      const a = await sampleCounters(model.id, model.dataModel);
      await new Promise((r) => setTimeout(r, 10000));
      const b = await sampleCounters(model.id, model.dataModel);
      const t = deriveThroughput(a, b, model.dataModel);
      if (b.device) setRaw(b.device);
      setThroughput(t || { unavailable: true });
    } catch (err) {
      setThroughput({ unavailable: true, error: err.message });
    } finally {
      setMeasuring(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────
  const header = (
    <header
      className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
    >
      <button onClick={() => navigate(-1)} className="p-1 mr-3" aria-label="Back">
        <ArrowLeftIcon className="h-6 w-6 text-white" />
      </button>
      <h1 className="text-lg font-medium text-white flex-1 truncate">Router / ONT</h1>
      {model && <PresencePill online={model.presence.online} size="sm" />}
    </header>
  );

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
        {header}
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">Finding this customer's router…</span>
        </div>
        <BottomNav />
      </div>
    );
  }

  if (loadError || !model) {
    const notFound = loadError?.code === ONT_ERR.NOT_FOUND;
    // A missing proxy is a server-config problem, not something the operator can
    // retry their way out of — offering "Try again" would just loop them.
    const proxyMissing = loadError?.code === ONT_ERR.PROXY_MISSING;
    return (
      <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
        {header}
        <div className="flex-1 px-4 py-10 max-w-2xl mx-auto w-full text-center space-y-4">
          <CpuChipIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto" />
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {loadError?.message || "Couldn't load this device."}
          </p>
          {/* Never a dead end: not-found and ACS-down need different next steps,
              so each gets its own actionable button rather than a bare message. */}
          {notFound ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              The ACS finds devices by serial number or PPPoE username. If this customer's
              router is installed, check that its PPPoE username matches their internet ID.
            </p>
          ) : proxyMissing ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
              Router management needs the <code className="font-mono">/acs-api</code> path
              routed to the ACS on this server. Ask your admin to apply the proxy
              configuration — retrying won't help until then.
            </p>
          ) : (
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
            >
              Try again
            </button>
          )}
          <button
            onClick={() => navigate(-1)}
            className="block mx-auto text-sm text-indigo-600 dark:text-indigo-400 font-semibold"
          >
            Back to customer
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const { presence, identity, uptime, wan, radios, lanPorts, hosts, optical } = model;

  return (
    <div className="min-h-dvh flex flex-col bg-gray-50 dark:bg-gray-900 pb-safe">
      {header}

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-6 pb-28">
        {result && <TaskResult result={result} onDismiss={() => setResult(null)} />}

        {/* ── Status — requirement #1 + #7 ── */}
        <Section title="Status">
          <Card className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <PresencePill online={presence.online} ageMin={presence.ageMin} />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Last contacted the server {formatAge(presence.ageMin)}
                </p>
              </div>
              <button
                onClick={doProbe}
                disabled={probing}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold disabled:opacity-50"
              >
                <SignalIcon className={`w-4 h-4 ${probing ? "animate-pulse" : ""}`} />
                {probing ? "Checking…" : "Check now"}
              </button>
            </div>

            {/* The probe answers a different question from the pill above it, so
                it gets its own line rather than overwriting the presence state. */}
            {probe && (
              <div
                className={`rounded-lg px-3 py-2 text-xs ${
                  probe.alive
                    ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200"
                    : "bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200"
                }`}
              >
                {probe.alive
                  ? `Responding now — answered in ${(probe.rttMs / 1000).toFixed(1)}s.`
                  : probe.state === "queued"
                    ? "No response. The device is not reachable from the server right now."
                    : `Check failed — ${probe.error || "no response"}.`}
              </div>
            )}

            {/* Requirement #7 — two uptimes, deliberately. Device uptime answers
                "has it rebooted?"; session uptime answers "is PPPoE flapping?".
                A high device uptime beside a low session uptime IS the diagnosis
                for most "internet keeps cutting" complaints, and one combined
                number hides it completely. */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Device uptime</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-50 tabular-nums">
                  {formatUptime(uptime.device)}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Session uptime</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-50 tabular-nums">
                  {formatUptime(uptime.session)}
                </p>
              </div>
            </div>
            {uptime.device > 3600 && uptime.session != null && uptime.session < 900 && (
              <p className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 rounded-lg px-3 py-2">
                The router has been up a while but the internet session restarted recently — this
                usually means the connection is dropping and re-dialling.
              </p>
            )}

            <FreshnessStamp asof={presence.lastInform} onRefresh={doRefresh} refreshing={refreshing} />
          </Card>
        </Section>

        {/* ── Fiber — requirement #6 ── */}
        <Section title="Fiber signal">
          <OpticalGauge optical={optical} />
        </Section>

        {/* ── Wi-Fi — requirement #2 ── */}
        <Section
          title="Wi-Fi"
          aside={
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {model.wifiClients} connected
            </span>
          }
        >
          {radios.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This device hasn't reported any wireless radios to the server.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {radios.map((r) => (
                <Card key={r.index} className="p-4 space-y-2">
                  <div className="flex items-start gap-3">
                    <WifiIcon className={`w-5 h-5 mt-0.5 shrink-0 ${r.enabled === false ? "text-gray-300" : "text-indigo-500"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 dark:text-gray-50 truncate">
                        {r.ssid || <span className="text-gray-400 font-normal">No name reported</span>}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {r.band}
                        {r.enabled === false && " · disabled"}
                        {r.hidden && " · hidden"}
                        {r.clients != null && ` · ${r.clients} connected`}
                      </p>
                    </div>
                    <button
                      onClick={() => setEditRadio(r)}
                      className="shrink-0 p-2 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40"
                      aria-label={`Edit ${r.ssid || "network"}`}
                    >
                      <PencilSquareIcon className="w-5 h-5" />
                    </button>
                  </div>
                  {/* The client count is only as fresh as the last inform. An
                      operator will read this number out loud to a customer, so
                      it does not get to appear without a timestamp. */}
                  <FreshnessStamp asof={r.clientsAsof || r.asof} />
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* ── LAN ports ── */}
        <Section title="LAN ports">
          {lanPorts.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This device hasn't reported its LAN ports to the server.
              </p>
            </Card>
          ) : (
            <Card className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {lanPorts.map((p) => (
                  <button
                    key={p.index}
                    onClick={() => setConfirmLan({ port: p.index, enable: !p.enabled })}
                    disabled={busy}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                      p.up
                        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/25"
                        : p.enabled === false
                          ? "border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900"
                          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                    }`}
                  >
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Port {p.index}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {p.enabled === false ? "Turned off" : p.up ? "Connected" : "No cable"}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
                Tap a port to turn it on or off.
              </p>
            </Card>
          )}
        </Section>

        {/* ── Connected devices ── */}
        {hosts.length > 0 && (
          <Section title={`Connected devices (${hosts.length})`}>
            <Card className="divide-y divide-gray-100 dark:divide-gray-700">
              {hosts.slice(0, 20).map((h) => (
                <div key={h.index} className="px-4 py-2.5 flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${h.active === false ? "bg-gray-300" : "bg-emerald-500"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                      {h.name || h.mac || h.ip}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                      {h.ip} {h.mac ? `· ${h.mac}` : ""}
                    </p>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0">{h.wireless ? "Wi-Fi" : "LAN"}</span>
                </div>
              ))}
            </Card>
          </Section>
        )}

        {/* ── Throughput — requirement #10 ── */}
        <Section title="Traffic">
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Total downloaded</p>
                <p className="text-base font-semibold text-gray-900 dark:text-gray-50 tabular-nums">
                  {formatBytes(model.counters.bytesReceived)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Total uploaded</p>
                <p className="text-base font-semibold text-gray-900 dark:text-gray-50 tabular-nums">
                  {formatBytes(model.counters.bytesSent)}
                </p>
              </div>
            </div>

            {throughput && !throughput.unavailable && (
              <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg px-3 py-2.5">
                <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200 tabular-nums">
                  ↓ {throughput.rxMbps?.toFixed(2) ?? "—"} Mbps · ↑ {throughput.txMbps?.toFixed(2) ?? "—"} Mbps
                </p>
                <p className="text-[11px] text-indigo-700 dark:text-indigo-300">
                  Measured over {throughput.windowSeconds}s
                  {throughput.suspect && " · gap too long to be reliable"}
                </p>
              </div>
            )}
            {throughput?.unavailable && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Couldn't measure — the device didn't report usable counters.
              </p>
            )}

            <button
              onClick={doMeasure}
              disabled={measuring || !presence.online}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm font-semibold disabled:opacity-50"
            >
              <ChartBarIcon className="w-4 h-4" />
              {measuring ? "Measuring… (about 15s)" : "Measure current speed"}
            </button>
            {/* The counters are cumulative — there is no live-rate parameter to
                read — so a speed figure genuinely requires two samples with a
                gap. Saying so beats a spinner the operator thinks has hung. */}
            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
              The router only reports running totals, so measuring takes two readings ten seconds apart.
            </p>
          </Card>
        </Section>

        {/* ── Connection detail ── */}
        <Section title="Connection">
          <Card className="p-4 space-y-2">
            <Row label="Status" value={wan.status} />
            <Row label="PPPoE username" value={wan.pppoeUser} mono />
            <Row label="IP address" value={wan.ip} mono />
            <Row label="Gateway" value={wan.gateway} mono />
            {wan.lastError && wan.lastError !== "ERROR_NONE" && (
              <Row label="Last error" value={wan.lastError} />
            )}
            <FreshnessStamp asof={wan.asof} />
          </Card>
        </Section>

        {/* ── Hardware ── */}
        <Section title="Hardware">
          <Card className="p-4 space-y-2">
            <Row label="Make / model" value={[identity.manufacturer, identity.model].filter(Boolean).join(" ")} />
            <Row label="Serial number" value={identity.serial} mono />
            <Row label="Firmware" value={identity.swVersion} />
            <Row label="LAN MAC" value={wan.lanMac} mono />
            {/* Which TR-069 data model the CPE speaks decides which parameter
                paths resolve. Detected from the response, not from a model
                whitelist — surfaced because it is the first thing to check when
                a field reads blank. */}
            <Row label="Data model" value={model.dataModel === "tr181" ? "TR-181" : "TR-098"} />
          </Card>
        </Section>

        {/* ── Reboot — requirement #9 ── */}
        <button
          onClick={() => setConfirmReboot(true)}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-rose-500 to-red-600 text-white font-semibold text-sm shadow-md disabled:opacity-50"
        >
          <BoltIcon className="w-5 h-5" />
          Restart router
        </button>
      </div>

      <ConfirmDialog
        open={confirmReboot}
        title="Restart router?"
        message="The customer's internet, Wi-Fi and TV will go down for one to two minutes."
        onConfirm={doReboot}
        onCancel={() => setConfirmReboot(false)}
      />

      <ConfirmDialog
        open={!!confirmLan}
        title={confirmLan?.enable ? "Turn on LAN port?" : "Turn off LAN port?"}
        message={
          confirmLan?.enable
            ? `Port ${confirmLan?.port} will be switched back on.`
            : `Anything plugged into port ${confirmLan?.port} will lose its connection.`
        }
        onConfirm={doLanPort}
        onCancel={() => setConfirmLan(null)}
      />

      <SsidEditSheet
        key={editRadio?.index || "none"}
        open={!!editRadio}
        radio={editRadio}
        busy={busy}
        onClose={() => setEditRadio(null)}
        onSubmit={doSsid}
      />

      <BottomNav />
    </div>
  );
}
