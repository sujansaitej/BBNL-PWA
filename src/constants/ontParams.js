// ontParams — TR-069 parameter dictionary, ported from the PHP console's
// application/libraries/deviceFormat.php.
//
// WHAT THIS IS
// ------------
// GenieACS returns one large nested tree keyed by raw TR-069 parameter paths.
// This file is the translation table: friendly key -> which path to read, for
// each of the two data models a CPE may implement.
//
//   TR-181  ("Device.*")                — newer, `dm181` below
//   TR-098  ("InternetGatewayDevice.*") — older,  `dm098` below
//
// The PHP original called these "default" and "other" and chose between them
// with a hardcoded two-model whitelist:
//
//     $deviceArr = array("tp-link", "xc220-g3v");           // Welcome.php:356
//
// Anything not on that list fell through to TR-098 and, if it was actually a
// TR-181 device, rendered ENTIRELY BLANK — indistinguishable from a broken
// device. We detect the model from the response itself instead (see
// detectDataModel in ontModel.js), which is self-configuring and correct for
// hardware nobody has added to a list yet.
//
// AUDIT FIXES CARRIED HERE
//   FMT-01  SSID indices are NOT hardcoded. The PHP dictionary read 2.4GHz from
//           WLANConfiguration.6 while configureSsids() wrote it to index 1, so on
//           every non-Realtek TR-098 device the operator changed the SSID and the
//           screen kept showing the old one. Radios are enumerated from the
//           device's own table at runtime — one mapping, used by read and write.
//   FMT-03  uptime / session-uptime / wifi client-count added (were missing).
//   FMT-05  `supplyvottage` typo corrected; every entry declares `kind` so
//           consumers never have to guess scalar-vs-table.
//
// Each entry:
//   dm181 / dm098  parameter path, WITHOUT the trailing "._value"
//   kind           "scalar" — a leaf carrying {_value,_type,_timestamp}
//                  "table"  — an object whose numeric children are rows
//   label          operator-facing name
//   unit           optional; drives formatting only

export const DM181 = "tr181";
export const DM098 = "tr098";

/** The dictionary. Keys are stable — UI and tests reference them by name. */
export const ONT_PARAMS = {
  // ── Identity (ACS metadata, same on both models) ───────────────────
  manufacturer:  { dm181: "_deviceId._Manufacturer", dm098: "_deviceId._Manufacturer", kind: "scalar", label: "Manufacturer", meta: true },
  model:         { dm181: "_deviceId._ProductClass", dm098: "_deviceId._ProductClass", kind: "scalar", label: "Model", meta: true },
  serial:        { dm181: "_deviceId._SerialNumber", dm098: "_deviceId._SerialNumber", kind: "scalar", label: "Serial number", meta: true },
  oui:           { dm181: "_deviceId._OUI",          dm098: "_deviceId._OUI",          kind: "scalar", label: "OUI", meta: true },
  deviceId:      { dm181: "_id",                     dm098: "_id",                     kind: "scalar", label: "Device ID", meta: true },
  lastInform:    { dm181: "_lastInform",             dm098: "_lastInform",             kind: "scalar", label: "Last seen", meta: true },
  lastBoot:      { dm181: "_lastBoot",               dm098: "_lastBoot",               kind: "scalar", label: "Last boot", meta: true },
  registered:    { dm181: "_registered",             dm098: "_registered",             kind: "scalar", label: "First registered", meta: true },

  // ── Firmware / hardware ────────────────────────────────────────────
  hwVersion: {
    dm181: "Device.DeviceInfo.HardwareVersion",
    dm098: "InternetGatewayDevice.DeviceInfo.HardwareVersion",
    kind: "scalar", label: "Hardware version",
  },
  swVersion: {
    dm181: "Device.DeviceInfo.SoftwareVersion",
    dm098: "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
    kind: "scalar", label: "Firmware version",
  },

  // ── Uptime — requirement #7 ────────────────────────────────────────
  // NOT in the PHP dictionary (FMT-03). Two separate numbers, deliberately:
  // device uptime answers "has it rebooted?", session uptime answers "is PPPoE
  // flapping?". High device uptime + low session uptime is the actual diagnosis
  // behind most "internet keeps cutting" tickets, and a single number hides it.
  uptime: {
    dm181: "Device.DeviceInfo.UpTime",
    dm098: "InternetGatewayDevice.DeviceInfo.UpTime",
    kind: "scalar", label: "Device uptime", unit: "seconds",
  },
  pppUptime: {
    dm181: "Device.PPP.Interface.1.LastChange",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Uptime",
    kind: "scalar", label: "Session uptime", unit: "seconds",
  },

  // ── Management server ──────────────────────────────────────────────
  udpAddress: {
    dm181: "Device.ManagementServer.UDPConnectionRequestAddress",
    dm098: "InternetGatewayDevice.ManagementServer.UDPConnectionRequestAddress",
    kind: "scalar", label: "Connection request address",
  },
  // Read so the UI can sanity-check the online threshold against reality
  // rather than trusting a constant (see ONLINE_THRESHOLD_MIN below).
  informInterval: {
    dm181: "Device.ManagementServer.PeriodicInformInterval",
    dm098: "InternetGatewayDevice.ManagementServer.PeriodicInformInterval",
    kind: "scalar", label: "Inform interval", unit: "seconds",
  },

  // ── WAN / PPPoE ────────────────────────────────────────────────────
  wanIp: {
    dm181: "Device.IP.Interface.4.IPv4Address.1.IPAddress",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
    kind: "scalar", label: "WAN IP",
  },
  pppoeIp: {
    dm181: "Device.IP.Interface.5.IPv4Address.1.IPAddress",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress",
    kind: "scalar", label: "PPPoE IP",
  },
  pppoeGateway: {
    dm181: "Device.Routing.Router.1.IPv4Forwarding.3.GatewayIPAddress",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.DefaultGateway",
    kind: "scalar", label: "Gateway",
  },
  pppoeUser: {
    dm181: "Device.PPP.Interface.1.Username",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username",
    kind: "scalar", label: "PPPoE username",
  },
  pppoeStatus: {
    dm181: "Device.PPP.Interface.1.ConnectionStatus",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ConnectionStatus",
    kind: "scalar", label: "Connection status",
  },
  pppoeError: {
    dm181: "Device.PPP.Interface.1.LastConnectionError",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.LastConnectionError",
    kind: "scalar", label: "Last error",
  },
  pppoeEnabled: {
    dm181: "Device.PPP.Interface.1.Enable",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Enable",
    kind: "scalar", label: "Admin status",
  },

  // FMT-04: the PHP variants read DIFFERENT interfaces — TR-181 gave the LAN-side
  // Ethernet MAC, TR-098 gave the WAN connection MAC. Same key, different
  // hardware address depending on data model. Split into two explicit keys.
  lanMac: {
    dm181: "Device.Ethernet.Interface.1.MACAddress",
    dm098: "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress",
    kind: "scalar", label: "LAN MAC",
  },
  wanMac: {
    dm181: "Device.Ethernet.Link.1.MACAddress",
    dm098: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress",
    kind: "scalar", label: "WAN MAC",
  },

  // ── Tables — enumerated at runtime, never index-hardcoded ──────────
  wifiSsidTable: {
    dm181: "Device.WiFi.SSID",
    dm098: "InternetGatewayDevice.LANDevice.1.WLANConfiguration",
    kind: "table", label: "Wireless radios",
  },
  // TR-181 splits radio (SSID) from security/association (AccessPoint); TR-098
  // keeps both on WLANConfiguration, so dm098 points at the same table.
  wifiApTable: {
    dm181: "Device.WiFi.AccessPoint",
    dm098: "InternetGatewayDevice.LANDevice.1.WLANConfiguration",
    kind: "table", label: "Access points",
  },
  lanPortTable: {
    dm181: "Device.Ethernet.Interface",
    dm098: "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig",
    kind: "table", label: "LAN ports",
  },
  hostTable: {
    dm181: "Device.Hosts.Host",
    dm098: "InternetGatewayDevice.LANDevice.1.Hosts.Host",
    kind: "table", label: "Connected devices",
  },

  // ── Traffic counters — requirement #10 ─────────────────────────────
  // CUMULATIVE, not rates. See ontModel.deriveThroughput for the two-sample
  // delta and the 32-bit wrap handling these need.
  bytesReceived: {
    dm181: "Device.Optical.Interface.1.Stats.BytesReceived",
    dm098: "InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.TotalBytesReceived",
    kind: "scalar", label: "Bytes received", unit: "bytes",
  },
  bytesSent: {
    dm181: "Device.Optical.Interface.1.Stats.BytesSent",
    dm098: "InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.TotalBytesSent",
    kind: "scalar", label: "Bytes sent", unit: "bytes",
  },
  packetsReceived: {
    dm181: "Device.Optical.Interface.1.Stats.PacketsReceived",
    dm098: "InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.TotalPacketsReceived",
    kind: "scalar", label: "Packets received",
  },
  packetsSent: {
    dm181: "Device.Optical.Interface.1.Stats.PacketsSent",
    dm098: "InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.TotalPacketsSent",
    kind: "scalar", label: "Packets sent",
  },
  // Line sync rate — NOT utilisation. Kept separate so nothing confuses the two.
  lineRateDown: {
    dm181: "Device.Optical.Interface.1.LowerLayers",
    dm098: "InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.Layer1DownstreamMaxBitRate",
    kind: "scalar", label: "Line rate (down)", unit: "bps",
  },
};

// ── Optical / fiber loss — requirement #6 ────────────────────────────
//
// FMT-02. The PHP dictionary hardcoded ONE vendor:
//
//     Device.Optical.Interface.1.X_TP_GPON_Config.RXPower       (TP-Link)
//
// `X_*` is the TR-069 vendor-extension namespace, so that path exists ONLY on
// TP-Link. Every other ONT returns nothing, and fiber loss is the single field
// field-techs most want — shipping it blank is worse than not shipping it.
//
// We probe candidates in order and use the first that resolves. Add a vendor by
// appending its prefix here; nothing else changes.
//
// !! UNITS ARE NOT UNIFORM !!  Vendors report dBm, tenths of a dBm, or raw
// microwatts. Reading 0.1-dBm as dBm turns a healthy -22 into -220 and paints
// the whole fleet critical. `scale` is applied to reach dBm; it is a DECLARED
// ASSUMPTION per vendor and must be confirmed against real hardware before the
// banding below can be trusted. Until confirmed, ontModel marks the reading
// `assumedUnit: true` and the UI says so.
export const OPTICAL_SOURCES = [
  {
    vendor: "tp-link",
    // The only path proven in production (it is what the PHP console reads).
    base181: "Device.Optical.Interface.1.X_TP_GPON_Config",
    base098: "InternetGatewayDevice.Optical.Interface.1.X_TP_GPON_Config",
    rx: "RXPower", tx: "TXPower", voltage: "SupplyVottage", // sic — vendor's own spelling
    scale: 1, confirmed: false,
  },
  {
    vendor: "huawei",
    base181: "Device.Optical.Interface.1.X_HW_GponInterfaceConfig",
    base098: "InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig",
    rx: "RXPower", tx: "TXPower", voltage: "Voltage",
    scale: 0.1, confirmed: false,
  },
  {
    vendor: "zte",
    base181: "Device.Optical.Interface.1.X_ZTE-COM_GponInterfaceConfig",
    base098: "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig",
    rx: "RXPower", tx: "TXPower", voltage: "Voltage",
    scale: 0.1, confirmed: false,
  },
  {
    vendor: "ct-com",
    base181: "Device.Optical.Interface.1.X_CT-COM_GponInterfaceConfig",
    base098: "InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig",
    rx: "RXPower", tx: "TXPower", voltage: "Voltage",
    scale: 0.1, confirmed: false,
  },
  {
    vendor: "generic",
    // TR-181 standard object. Some ONTs populate it; many do not.
    base181: "Device.Optical.Interface.1",
    base098: "InternetGatewayDevice.Optical.Interface.1",
    rx: "OpticalSignalLevel", tx: "TransmitOpticalLevel", voltage: null,
    scale: 0.1, confirmed: false,
  },
];

// GPON ONT received-power bands, in dBm.
// DEFAULTS — confirm with the optical team before treating the colours as
// authoritative. Wrong bands are worse than no bands: techs stop trusting the
// screen and then ignore a real fault.
export const OPTICAL_BANDS = [
  { max: -27.0, level: "critical", label: "Critical — at or near loss of signal" },
  { max: -25.0, level: "warning",  label: "Marginal — will drop under load" },
  { max: -8.0,  level: "ok",       label: "Normal" },
  { max: Infinity, level: "warning", label: "Too hot — attenuator needed" },
];

/** Classify an RX power reading (dBm) into a band. */
export function opticalBand(dbm) {
  if (dbm == null || Number.isNaN(dbm)) return { level: "unknown", label: "No reading" };
  return OPTICAL_BANDS.find((b) => dbm <= b.max) || OPTICAL_BANDS[OPTICAL_BANDS.length - 1];
}

// ── Online threshold ─────────────────────────────────────────────────
//
// "Online" means _lastInform is recent. Recent RELATIVE TO WHAT is the whole
// question: the CPE only contacts the ACS every PeriodicInformInterval, so a
// threshold shorter than that interval marks a perfectly healthy fleet offline.
// ~2.5x the interval is the working rule.
//
// The PHP console used an external ONLINETHRESHOLD constant whose value we
// cannot see. We derive from the device's own reported interval when it is
// present and fall back to this floor when it is not.
export const ONLINE_THRESHOLD_MIN = Number(import.meta.env?.VITE_ONT_ONLINE_THRESHOLD_MIN) || 15;
export const ONLINE_THRESHOLD_FACTOR = 2.5;

// ── Projections ──────────────────────────────────────────────────────
// GenieACS reads the stored (last-informed) values straight from Mongo when you
// GET /devices — no CPE contact, milliseconds. Sending a projection keeps the
// payload to what we render instead of the device's entire parameter tree.

/** Everything the device detail screen renders. */
export const PROJECTION_FULL = [
  "_id", "_deviceId", "_lastInform", "_lastBoot", "_registered", "_tags",
  "Device.DeviceInfo", "InternetGatewayDevice.DeviceInfo",
  "Device.ManagementServer", "InternetGatewayDevice.ManagementServer",
  "Device.PPP", "InternetGatewayDevice.WANDevice",
  "Device.IP.Interface", "Device.Routing",
  "Device.WiFi", "InternetGatewayDevice.LANDevice",
  "Device.Ethernet", "Device.Hosts",
  "Device.Optical", "InternetGatewayDevice.Optical",
].join(",");

/** Fleet list / counts — just enough to render a row. */
export const PROJECTION_LIST = [
  "_id", "_deviceId", "_lastInform", "_tags",
  "Device.PPP.Interface.1.Username",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username",
].join(",");

/** Counting only — the smallest possible row. */
export const PROJECTION_COUNT = "_id,_lastInform";

/**
 * Parameter names for a live refresh.
 *
 * WEB-07: the PHP console refreshed with refreshDevice("Device,InternetGatewayDevice")
 * — a full-tree GetParameterValues across BOTH data models, thousands of
 * parameters over CWMP, to populate a page needing about twenty. Ironically the
 * same file already had _getProjectionString() computing exactly the right set
 * and used it correctly elsewhere; the refresh action just didn't call it.
 * Requesting only what we render is the largest single latency win available.
 */
export function refreshParameterNames(dataModel) {
  const key = dataModel === DM181 ? "dm181" : "dm098";
  const names = new Set();
  for (const p of Object.values(ONT_PARAMS)) {
    if (p.meta) continue;              // ACS metadata, not a CPE parameter
    if (p[key]) names.add(p[key]);
  }
  for (const src of OPTICAL_SOURCES) {
    const base = dataModel === DM181 ? src.base181 : src.base098;
    if (base) names.add(base);
  }
  return [...names];
}
