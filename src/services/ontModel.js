// ontModel — turns a raw GenieACS device object into something renderable.
//
// A GenieACS device is a nested tree where every leaf is
// `{_value, _type, _timestamp}` and every branch carries `_object: true` plus
// its own `_timestamp`. Table rows are numeric keys mixed in among those
// underscore-prefixed metadata keys.
//
// Two things this file exists to get right:
//
// 1. FRESHNESS IS PER-PARAMETER. That `_timestamp` on each leaf is free
//    provenance — no extra call needed to tell the operator that the SSID they
//    are looking at was last reported at 14:32. A cached read showing "3 devices
//    connected" with no timestamp is a claim the operator will make to a
//    customer's face and be wrong about, so every value carries its own asof.
//
// 2. INDICES ARE DISCOVERED, NEVER ASSUMED. See resolveRadios.

import {
  ONT_PARAMS, OPTICAL_SOURCES, OPTICAL_BANDS,
  DM181, DM098, ONLINE_THRESHOLD_MIN, ONLINE_THRESHOLD_FACTOR,
} from "../constants/ontParams";

// ── Tree access ──────────────────────────────────────────────────────

/**
 * Walk a dotted path.
 *
 * WEB-04: the console did this with eval() —
 *
 *     $formVar  = '$getDetails["'.str_replace(".", '"]["', $getParam).'"]';
 *     $getValue = @eval("return {$formVar};");
 *
 * — which is RCE the moment the dictionary becomes configurable, and whose `@`
 * swallowed every missing-path error so a broken mapping was indistinguishable
 * from an empty value. Plain traversal, and it can tell those two apart.
 */
export function walk(obj, path) {
  if (!obj || !path) return undefined;
  let cur = obj;
  for (const seg of String(path).split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Read a leaf as `{value, asof}`. Returns null when the path is absent. */
export function leaf(obj, path) {
  const node = walk(obj, path);
  if (node == null) return null;
  if (typeof node === "object" && "_value" in node) {
    return { value: node._value, asof: node._timestamp || null, type: node._type || null };
  }
  // ACS metadata (_id, _lastInform, _deviceId.*) are bare values, not leaves.
  if (typeof node !== "object") return { value: node, asof: null, type: null };
  return null;
}

/** Leaf value only, or `fallback`. */
export function val(obj, path, fallback = null) {
  const l = leaf(obj, path);
  return l ? l.value : fallback;
}

/**
 * Numeric children of a table object, ascending.
 * Skips `_object`, `_timestamp`, `_writable` and friends.
 */
export function tableRows(obj, path) {
  const node = walk(obj, path);
  if (!node || typeof node !== "object") return [];
  return Object.keys(node)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => ({ index: k, node: node[k] }));
}

// ── Data model detection ─────────────────────────────────────────────

/**
 * WEB-06. The console decided TR-181 vs TR-098 from a hardcoded two-model
 * whitelist:
 *
 *     $deviceArr = array("tp-link", "xc220-g3v");
 *
 * Everything else fell through to TR-098, so a TR-181-only device nobody had
 * added rendered ENTIRELY BLANK — no IP, no SSID, no status — and looked like
 * broken hardware rather than a missing list entry.
 *
 * The response says which model it is. Ask it.
 */
export function detectDataModel(dev) {
  if (!dev) return DM098;
  const has181 = dev.Device && typeof dev.Device === "object";
  const has098 = dev.InternetGatewayDevice && typeof dev.InternetGatewayDevice === "object";
  if (has181 && !has098) return DM181;
  if (has098 && !has181) return DM098;
  if (has181 && has098) {
    // Both roots present (some CPEs expose a stub). Prefer whichever actually
    // carries a populated DeviceInfo.
    const d181 = val(dev, "Device.DeviceInfo.SoftwareVersion");
    return d181 != null ? DM181 : DM098;
  }
  return DM098;
}

/** Resolve a dictionary key against the detected model. */
export function param(dev, key, dataModel) {
  const spec = ONT_PARAMS[key];
  if (!spec) return null;
  const path = dataModel === DM181 ? spec.dm181 : spec.dm098;
  if (!path) return null;
  return spec.meta ? leaf(dev, path) : leaf(dev, path);
}

export function paramValue(dev, key, dataModel, fallback = null) {
  const l = param(dev, key, dataModel);
  return l ? l.value : fallback;
}

// ── Online state — requirement #1 ────────────────────────────────────

/**
 * "Online" means the CPE informed recently. Recent RELATIVE TO WHAT matters:
 * a device that informs once a day is perfectly healthy and will read offline
 * against a 15-minute threshold. We derive the window from the device's own
 * PeriodicInformInterval when it reports one.
 *
 * Comparison is in UTC. WEB-09: the console built its cutoff as
 * "Y-m-d H:i:s +0530" and compared it against ISO-8601 UTC, a 5.5-hour skew
 * that flips the whole fleet with no error surfaced anywhere.
 */
export function onlineThresholdMinutes(dev, dataModel) {
  const interval = Number(paramValue(dev, "informInterval", dataModel));
  if (Number.isFinite(interval) && interval > 0) {
    return Math.max(ONLINE_THRESHOLD_MIN, (interval / 60) * ONLINE_THRESHOLD_FACTOR);
  }
  return ONLINE_THRESHOLD_MIN;
}

export function computeOnline(dev, dataModel, thresholdMin) {
  const lastInform = dev?._lastInform ? new Date(dev._lastInform) : null;
  if (!lastInform || Number.isNaN(lastInform.getTime())) {
    return { online: false, lastInform: null, ageMin: null, thresholdMin: thresholdMin ?? null };
  }
  const th = thresholdMin ?? onlineThresholdMinutes(dev, dataModel);
  const ageMin = (Date.now() - lastInform.getTime()) / 60_000;
  return { online: ageMin <= th, lastInform, ageMin, thresholdMin: th };
}

// ── Wireless — requirement #2 ────────────────────────────────────────

/**
 * Enumerate the radios the device actually has.
 *
 * FMT-01, the most user-visible defect in the audit. The PHP dictionary READ
 * 2.4GHz from WLANConfiguration.6 and 5GHz from .1, while configureSsids() WROTE
 * 2.4GHz to index 1 and 5GHz to index 3 — with a per-vendor override
 * ({5g:1, 2.4g:6}) that made read and write agree on Realtek/HomeFiber and
 * DISAGREE on every other TR-098 device. The operator changed the 2.4GHz SSID,
 * the write landed on index 1, the screen kept reading index 6 and showed the
 * old name. It looked like the feature was broken; worse, the write may have
 * landed on the 5GHz radio.
 *
 * There is no index to hardcode. The device publishes its own table — read it,
 * and hand the same resolved index to both the display and the write.
 *
 * @returns {Array<{index,apIndex,dataModel,ssid,enabled,band,hidden,clients,asof}>}
 */
export function resolveRadios(dev, dataModel) {
  const spec = ONT_PARAMS.wifiSsidTable;
  const tablePath = dataModel === DM181 ? spec.dm181 : spec.dm098;
  const rows = tableRows(dev, tablePath);

  return rows.map(({ index, node }) => {
    const ssid = node?.SSID?._value ?? null;
    const asof = node?.SSID?._timestamp ?? node?._timestamp ?? null;
    const enabled = node?.Enable?._value ?? null;
    const status = node?.Status?._value ?? null;

    // Band. TR-181 puts it on the radio behind SSID.LowerLayers; TR-098 exposes
    // Standard / OperatingFrequencyBand / Channel. Fall back to the channel
    // number, which is unambiguous: >= 32 is 5GHz in every regulatory domain.
    let band = node?.OperatingFrequencyBand?._value
      || node?.X_BAND?._value
      || null;
    if (!band) {
      const ch = Number(node?.Channel?._value);
      if (Number.isFinite(ch) && ch > 0) band = ch >= 32 ? "5GHz" : "2.4GHz";
    }
    if (!band) {
      const std = String(node?.Standard?._value || "");
      if (/ac|ax|a\b/i.test(std)) band = "5GHz";
      else if (/b|g|n/i.test(std)) band = "2.4GHz";
    }

    const advertised = node?.SSIDAdvertisementEnabled?._value;
    const hidden = advertised == null ? null : !advertised;

    // Client count. Three sources, best first — the counters are only accurate
    // as of the last inform, which is why `asof` travels with the number.
    let clients = node?.TotalAssociations?._value
      ?? node?.AssociatedDeviceNumberOfEntries?._value
      ?? null;
    let clientsAsof = node?.TotalAssociations?._timestamp
      ?? node?.AssociatedDeviceNumberOfEntries?._timestamp
      ?? null;
    if (clients == null) {
      const assoc = tableRows({ x: node }, "x.AssociatedDevice");
      if (assoc.length) { clients = assoc.length; clientsAsof = node?._timestamp ?? null; }
    }

    return {
      index,
      // TR-181 security lives on AccessPoint, whose index normally mirrors the
      // SSID index. Resolved properly below when SSIDReference is published.
      apIndex: index,
      dataModel,
      ssid,
      enabled: enabled == null ? null : !!enabled,
      status,
      band: band || "Unknown",
      hidden,
      clients: clients == null ? null : Number(clients),
      clientsAsof,
      asof,
    };
  });
}

/**
 * TR-181 only: AccessPoint.{i}.SSIDReference points at a Device.WiFi.SSID.{j}
 * path, and i does not have to equal j. Rewrites apIndex where it is published
 * so the passphrase write lands on the same radio the operator is looking at.
 */
export function linkAccessPoints(dev, radios, dataModel) {
  if (dataModel !== DM181) return radios;
  const aps = tableRows(dev, ONT_PARAMS.wifiApTable.dm181);
  if (!aps.length) return radios;

  const bySsidIndex = new Map();
  for (const { index, node } of aps) {
    const ref = String(node?.SSIDReference?._value || "");
    const m = ref.match(/SSID\.(\d+)/);
    if (m) bySsidIndex.set(m[1], index);
  }
  if (!bySsidIndex.size) return radios;

  return radios.map((r) => {
    const ap = bySsidIndex.get(String(r.index));
    if (!ap) return r;
    const apNode = aps.find((a) => a.index === ap)?.node;
    const clients = apNode?.AssociatedDeviceNumberOfEntries?._value;
    return {
      ...r,
      apIndex: ap,
      clients: r.clients ?? (clients == null ? null : Number(clients)),
      clientsAsof: r.clientsAsof ?? apNode?.AssociatedDeviceNumberOfEntries?._timestamp ?? null,
    };
  });
}

// ── LAN ports ────────────────────────────────────────────────────────

export function resolveLanPorts(dev, dataModel) {
  const spec = ONT_PARAMS.lanPortTable;
  const path = dataModel === DM181 ? spec.dm181 : spec.dm098;
  return tableRows(dev, path).map(({ index, node }) => {
    const status = node?.Status?._value ?? null;
    const enable = node?.Enable?._value ?? null;
    return {
      index,
      enabled: enable == null ? null : !!enable,
      // TR-181 says "Up"/"Down"; TR-098 LANEthernetInterfaceConfig says
      // "Up"/"NoLink"/"Disabled". Both are truthy-Up.
      up: status == null ? null : /^up$/i.test(String(status)),
      status,
      speed: node?.MaxBitRate?._value ?? node?.CurrentBitRate?._value ?? null,
      asof: node?.Status?._timestamp ?? node?._timestamp ?? null,
    };
  });
}

/** Hosts currently attached, split by how they are connected. */
export function resolveHosts(dev, dataModel) {
  const spec = ONT_PARAMS.hostTable;
  const path = dataModel === DM181 ? spec.dm181 : spec.dm098;
  return tableRows(dev, path)
    .map(({ index, node }) => {
      const iface = String(node?.InterfaceType?._value || node?.Layer1Interface?._value || "");
      return {
        index,
        name: node?.HostName?._value || node?.X_HostName?._value || null,
        mac: node?.PhysAddress?._value || null,
        ip: node?.IPAddress?._value || null,
        active: node?.Active?._value ?? null,
        wireless: /802\.11|wifi|wlan/i.test(iface),
        iface: iface || null,
      };
    })
    .filter((h) => h.mac || h.ip);
}

// ── Optical / fiber loss — requirement #6 ────────────────────────────

/**
 * Probe each known vendor path and use the first that resolves.
 *
 * FMT-02. The dictionary hardcoded X_TP_GPON_Config — a TP-Link vendor
 * extension — so RX/TX power is blank on every other ONT. Fiber loss is the
 * field techs ask for most, and a blank field reads as "the tool is broken".
 *
 * The unit trap matters as much as the path. Vendors report dBm, tenths of a
 * dBm, or raw microwatts, and reading 0.1-dBm as dBm turns a healthy -22 into
 * -220 — every device paints critical, techs stop trusting the colours, and a
 * real fault gets ignored. `scale` in OPTICAL_SOURCES is a DECLARED ASSUMPTION,
 * not a measurement, so anything from an unconfirmed source is flagged
 * `assumedUnit` and the UI says so rather than implying certainty.
 */
export function resolveOptical(dev, dataModel) {
  for (const src of OPTICAL_SOURCES) {
    const base = dataModel === DM181 ? src.base181 : src.base098;
    if (!base) continue;

    const rxLeaf = leaf(dev, `${base}.${src.rx}`);
    const txLeaf = src.tx ? leaf(dev, `${base}.${src.tx}`) : null;
    if (!rxLeaf && !txLeaf) continue;

    const num = (l) => {
      if (!l || l.value == null || l.value === "") return null;
      const n = Number(l.value);
      return Number.isFinite(n) ? n : null;
    };

    const rawRx = num(rxLeaf);
    const rawTx = num(txLeaf);
    if (rawRx == null && rawTx == null) continue;

    const rx = rawRx == null ? null : rawRx * src.scale;
    const tx = rawTx == null ? null : rawTx * src.scale;

    return {
      vendor: src.vendor,
      rx, tx,
      rawRx, rawTx,
      scale: src.scale,
      assumedUnit: !src.confirmed,
      voltage: src.voltage ? num(leaf(dev, `${base}.${src.voltage}`)) : null,
      band: bandFor(rx),
      asof: rxLeaf?.asof || txLeaf?.asof || null,
    };
  }
  return null;
}

function bandFor(dbm) {
  if (dbm == null || Number.isNaN(dbm)) return { level: "unknown", label: "No reading" };
  return OPTICAL_BANDS.find((b) => dbm <= b.max) || OPTICAL_BANDS[OPTICAL_BANDS.length - 1];
}

// ── Throughput — requirement #10 ─────────────────────────────────────

const WRAP32 = 4294967296; // 2^32

/**
 * Derive Mbps from two counter samples.
 *
 * The ACS exposes CUMULATIVE byte counters; there is no rate parameter. Two
 * things make the naive delta wrong:
 *
 *   - On many TR-098 CPEs TotalBytesReceived is a 32-BIT counter. It wraps at
 *     4 GiB, which at 100 Mbps is every 5.7 minutes, so deltas go negative
 *     several times an hour. A single wrap is recoverable (add 2^32); we cannot
 *     detect a double wrap at all, so a long gap between samples is rejected
 *     rather than reported as a plausible-looking wrong number.
 *   - Counters only advance when the CPE reports, so both samples must be
 *     forced with a connection request — see ontApis.sampleCounters.
 *
 * This is the honest ceiling of what the ACS can answer. RADIUS interim-update
 * accounting (Acct-Input-Octets / Acct-Output-Octets) gives the same number
 * per subscriber with no CPE contact, no wrap, and no two-sample wait — worth
 * moving to if the RADIUS side can expose it.
 */
export function deriveThroughput(sampleA, sampleB, dataModel) {
  if (!sampleA?.device || !sampleB?.device) return null;

  const seconds = (sampleB.at - sampleA.at) / 1000;
  if (!(seconds > 0)) return null;

  const read = (s, key) => {
    const v = paramValue(s.device, key, dataModel);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const delta = (a, b) => {
    if (a == null || b == null) return null;
    let d = b - a;
    if (d < 0) {
      // Assume exactly one 32-bit wrap. Reject if that still looks impossible.
      d += WRAP32;
      if (d < 0 || d > WRAP32) return null;
    }
    return d;
  };

  const rxD = delta(read(sampleA, "bytesReceived"), read(sampleB, "bytesReceived"));
  const txD = delta(read(sampleA, "bytesSent"), read(sampleB, "bytesSent"));
  if (rxD == null && txD == null) return null;

  // A 32-bit counter can wrap more than once across a long gap and we cannot
  // tell. Beyond this window the answer is unknowable, so say so.
  const maxTrustedGap = 240;
  const suspect = seconds > maxTrustedGap;

  const mbps = (bytes) => (bytes == null ? null : (bytes * 8) / seconds / 1_000_000);

  return {
    rxMbps: mbps(rxD),
    txMbps: mbps(txD),
    windowSeconds: Math.round(seconds),
    suspect,
    asof: new Date(sampleB.at).toISOString(),
  };
}

// ── Assembly ─────────────────────────────────────────────────────────

/**
 * Raw ACS device -> the shape every franchise ONT screen renders.
 * Nothing here fetches; it is pure so the tests can drive it with fixtures.
 */
export function buildDeviceModel(dev) {
  if (!dev) return null;
  const dataModel = detectDataModel(dev);
  const thresholdMin = onlineThresholdMinutes(dev, dataModel);
  const presence = computeOnline(dev, dataModel, thresholdMin);

  const radios = linkAccessPoints(dev, resolveRadios(dev, dataModel), dataModel);
  const lanPorts = resolveLanPorts(dev, dataModel);
  const hosts = resolveHosts(dev, dataModel);

  const uptimeLeaf = param(dev, "uptime", dataModel);
  const pppUptimeLeaf = param(dev, "pppUptime", dataModel);

  return {
    id: dev._id,
    dataModel,
    identity: {
      manufacturer: dev?._deviceId?._Manufacturer ?? null,
      model: dev?._deviceId?._ProductClass ?? null,
      serial: dev?._deviceId?._SerialNumber ?? null,
      oui: dev?._deviceId?._OUI ?? null,
      hwVersion: paramValue(dev, "hwVersion", dataModel),
      swVersion: paramValue(dev, "swVersion", dataModel),
      registered: dev?._registered ?? null,
    },
    presence: {
      ...presence,
      lastBoot: dev?._lastBoot ?? null,
      informInterval: paramValue(dev, "informInterval", dataModel),
    },
    uptime: {
      device: uptimeLeaf ? Number(uptimeLeaf.value) : null,
      deviceAsof: uptimeLeaf?.asof ?? null,
      // TR-181 exposes PPP.LastChange (seconds since the interface last changed
      // state) rather than an uptime; same practical meaning for flap detection.
      session: pppUptimeLeaf ? Number(pppUptimeLeaf.value) : null,
      sessionAsof: pppUptimeLeaf?.asof ?? null,
    },
    wan: {
      pppoeUser: paramValue(dev, "pppoeUser", dataModel),
      status: paramValue(dev, "pppoeStatus", dataModel),
      lastError: paramValue(dev, "pppoeError", dataModel),
      enabled: paramValue(dev, "pppoeEnabled", dataModel),
      ip: paramValue(dev, "pppoeIp", dataModel) || paramValue(dev, "wanIp", dataModel),
      gateway: paramValue(dev, "pppoeGateway", dataModel),
      lanMac: paramValue(dev, "lanMac", dataModel),
      wanMac: paramValue(dev, "wanMac", dataModel),
      asof: param(dev, "pppoeStatus", dataModel)?.asof ?? null,
    },
    radios,
    lanPorts,
    hosts,
    wifiClients: radios.reduce((n, r) => n + (r.clients || 0), 0),
    optical: resolveOptical(dev, dataModel),
    counters: {
      bytesReceived: paramValue(dev, "bytesReceived", dataModel),
      bytesSent: paramValue(dev, "bytesSent", dataModel),
      asof: param(dev, "bytesReceived", dataModel)?.asof ?? null,
    },
    tags: Array.isArray(dev?._tags) ? dev._tags : [],
    lastInformRaw: dev?._lastInform ?? null,
  };
}

/** Compact row model for the fleet list — PROJECTION_LIST only. */
export function buildFleetRow(dev, thresholdMin) {
  const dataModel = detectDataModel(dev);
  const presence = computeOnline(dev, dataModel, thresholdMin);
  return {
    id: dev._id,
    serial: dev?._deviceId?._SerialNumber ?? null,
    manufacturer: dev?._deviceId?._Manufacturer ?? null,
    model: dev?._deviceId?._ProductClass ?? null,
    pppoeUser: paramValue(dev, "pppoeUser", dataModel),
    online: presence.online,
    lastInform: presence.lastInform,
    ageMin: presence.ageMin,
    tags: Array.isArray(dev?._tags) ? dev._tags : [],
  };
}

// ── Formatting ───────────────────────────────────────────────────────

// Number(null) and Number("") are both 0, so a device that never reported a
// value would render as "0m" / "0 B" / "0.00 dBm" — which reads as a real
// measurement ("just rebooted", "no signal") rather than as missing data. On a
// screen whose whole job is telling an operator what is actually true, absent
// and zero must not look the same.
function absent(v) {
  return v == null || v === "" || Number.isNaN(Number(v));
}

export function formatUptime(seconds) {
  if (absent(seconds)) return "—";
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatAge(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return "—";
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatClock(iso) {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatBytes(n) {
  if (absent(n)) return "—";
  const b = Number(n);
  if (!Number.isFinite(b)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDbm(v) {
  if (absent(v)) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} dBm`;
}
