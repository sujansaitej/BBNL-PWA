/**
 * ontModel tests.
 *
 * The fixtures below mirror the GenieACS response shape: every leaf is
 * {_value,_type,_timestamp} and table rows are numeric keys sitting alongside
 * underscore-prefixed metadata.
 *
 * Most of these assertions exist because the PHP console got the same thing
 * wrong, so each one names the defect it pins down.
 */
import { describe, test, expect } from "vitest";
import {
  detectDataModel, resolveRadios, linkAccessPoints, resolveLanPorts,
  resolveOptical, deriveThroughput, computeOnline, onlineThresholdMinutes,
  buildDeviceModel, walk, leaf, tableRows, formatUptime,
} from "./ontModel";
import { DM181, DM098 } from "../constants/ontParams";

const L = (value, timestamp = "2026-08-13T09:00:00.000Z", type = "xsd:string") => ({
  _value: value, _type: type, _timestamp: timestamp,
});

// ── TR-098 device: 2.4GHz on index 6, 5GHz on index 1 ────────────────
// These are exactly the indices the PHP dictionary hardcoded, and exactly the
// case where its read and write disagreed.
const tr098 = {
  _id: "202BC1-XC220G3v-AA11",
  _deviceId: { _Manufacturer: "Realtek", _ProductClass: "XC220-G3v", _SerialNumber: "AA11", _OUI: "202BC1" },
  _lastInform: new Date(Date.now() - 3 * 60_000).toISOString(),
  _lastBoot: "2026-08-10T00:00:00.000Z",
  InternetGatewayDevice: {
    DeviceInfo: { SoftwareVersion: L("1.2.3"), HardwareVersion: L("v2"), UpTime: L(266400, undefined, "xsd:unsignedInt") },
    ManagementServer: { PeriodicInformInterval: L(300, undefined, "xsd:unsignedInt"), UDPConnectionRequestAddress: L("10.0.0.1:4000") },
    WANDevice: {
      1: {
        WANCommonInterfaceConfig: {
          TotalBytesReceived: L(1_000_000, undefined, "xsd:unsignedInt"),
          TotalBytesSent: L(500_000, undefined, "xsd:unsignedInt"),
        },
        WANConnectionDevice: {
          2: { WANPPPConnection: { 1: {
            Username: L("cust001@bbnl"), ConnectionStatus: L("Connected"),
            Uptime: L(600, undefined, "xsd:unsignedInt"), ExternalIPAddress: L("100.64.1.2"),
            LastConnectionError: L("ERROR_NONE"),
          } } },
        },
      },
    },
    LANDevice: {
      1: {
        WLANConfiguration: {
          _object: true,
          1: { _object: true, SSID: L("BBNL-5G"), Enable: L(true, undefined, "xsd:boolean"), Channel: L(36, undefined, "xsd:unsignedInt"), TotalAssociations: L(2, undefined, "xsd:unsignedInt"), SSIDAdvertisementEnabled: L(true, undefined, "xsd:boolean") },
          6: { _object: true, SSID: L("BBNL-Home"), Enable: L(true, undefined, "xsd:boolean"), Channel: L(6, undefined, "xsd:unsignedInt"), TotalAssociations: L(5, undefined, "xsd:unsignedInt"), SSIDAdvertisementEnabled: L(false, undefined, "xsd:boolean") },
        },
        LANEthernetInterfaceConfig: {
          _object: true,
          1: { _object: true, Enable: L(true, undefined, "xsd:boolean"), Status: L("Up") },
          2: { _object: true, Enable: L(false, undefined, "xsd:boolean"), Status: L("Disabled") },
        },
      },
    },
  },
};

// ── TR-181 device with TP-Link optical extension ─────────────────────
const tr181 = {
  _id: "AABBCC-EG8145-BB22",
  _deviceId: { _Manufacturer: "TP-Link", _ProductClass: "tp-link", _SerialNumber: "bb22lower", _OUI: "AABBCC" },
  _lastInform: new Date(Date.now() - 2 * 60_000).toISOString(),
  Device: {
    DeviceInfo: { SoftwareVersion: L("2.0.0"), UpTime: L(7200, undefined, "xsd:unsignedInt") },
    ManagementServer: { PeriodicInformInterval: L(1800, undefined, "xsd:unsignedInt") },
    PPP: { Interface: { 1: { Username: L("cust002@bbnl"), ConnectionStatus: L("Connected"), LastChange: L(60, undefined, "xsd:unsignedInt") } } },
    WiFi: {
      SSID: {
        _object: true,
        1: { _object: true, SSID: L("Home-24"), Enable: L(true, undefined, "xsd:boolean") },
        3: { _object: true, SSID: L("Home-5G"), Enable: L(true, undefined, "xsd:boolean") },
      },
      AccessPoint: {
        _object: true,
        1: { _object: true, SSIDReference: L("Device.WiFi.SSID.1"), AssociatedDeviceNumberOfEntries: L(4, undefined, "xsd:unsignedInt") },
        2: { _object: true, SSIDReference: L("Device.WiFi.SSID.3"), AssociatedDeviceNumberOfEntries: L(1, undefined, "xsd:unsignedInt") },
      },
    },
    Ethernet: { Interface: { _object: true, 1: { _object: true, Enable: L(true, undefined, "xsd:boolean"), Status: L("Up") } } },
    Optical: { Interface: { 1: { X_TP_GPON_Config: { RXPower: L(-22.5, undefined, "xsd:string"), TXPower: L(2.1), SupplyVottage: L(3300) } } } },
  },
};

describe("tree access", () => {
  test("walk returns undefined for a missing path instead of throwing", () => {
    expect(walk(tr098, "InternetGatewayDevice.Nope.Deeper")).toBeUndefined();
  });

  test("leaf carries the per-parameter timestamp, which is what makes the 'as of' stamp free", () => {
    const l = leaf(tr098, "InternetGatewayDevice.DeviceInfo.SoftwareVersion");
    expect(l.value).toBe("1.2.3");
    expect(l.asof).toBe("2026-08-13T09:00:00.000Z");
  });

  test("tableRows skips _object/_timestamp metadata and returns only numeric rows", () => {
    const rows = tableRows(tr098, "InternetGatewayDevice.LANDevice.1.WLANConfiguration");
    expect(rows.map((r) => r.index)).toEqual(["1", "6"]);
  });
});

describe("data model detection (WEB-06)", () => {
  // The console chose TR-181 vs TR-098 from a hardcoded two-model whitelist
  // ["tp-link","xc220-g3v"]; anything else fell through to TR-098 and, if it was
  // actually TR-181, rendered entirely blank.
  test("detects TR-098 from the response, not a model whitelist", () => {
    expect(detectDataModel(tr098)).toBe(DM098);
  });
  test("detects TR-181 from the response", () => {
    expect(detectDataModel(tr181)).toBe(DM181);
  });
  test("an unknown vendor still resolves correctly", () => {
    const unknown = { ...tr181, _deviceId: { ...tr181._deviceId, _Manufacturer: "BrandNew", _ProductClass: "NEVER-SEEN" } };
    expect(detectDataModel(unknown)).toBe(DM181);
  });
});

describe("radios (FMT-01)", () => {
  // The defect: the dictionary READ 2.4GHz from WLANConfiguration.6 while
  // configureSsids() WROTE it to index 1. The operator renamed the network, the
  // write landed on a different radio, and the screen kept showing the old name.
  test("indices come from the device's own table, so read and write agree", () => {
    const radios = resolveRadios(tr098, DM098);
    expect(radios.map((r) => r.index)).toEqual(["1", "6"]);
    const twoFour = radios.find((r) => r.ssid === "BBNL-Home");
    expect(twoFour.index).toBe("6");     // what we display AND what we write
  });

  test("band is inferred from the channel when the device does not name it", () => {
    const radios = resolveRadios(tr098, DM098);
    expect(radios.find((r) => r.index === "1").band).toBe("5GHz");
    expect(radios.find((r) => r.index === "6").band).toBe("2.4GHz");
  });

  test("client count reads TotalAssociations on TR-098", () => {
    const radios = resolveRadios(tr098, DM098);
    expect(radios.find((r) => r.index === "6").clients).toBe(5);
  });

  test("hidden is derived from SSIDAdvertisementEnabled", () => {
    const radios = resolveRadios(tr098, DM098);
    expect(radios.find((r) => r.index === "6").hidden).toBe(true);
    expect(radios.find((r) => r.index === "1").hidden).toBe(false);
  });

  test("TR-181 AccessPoint index is resolved via SSIDReference, not assumed equal", () => {
    // SSID.3 is served by AccessPoint.2 here. Assuming apIndex === index would
    // write the passphrase to the wrong radio.
    const radios = linkAccessPoints(tr181, resolveRadios(tr181, DM181), DM181);
    const fiveG = radios.find((r) => r.index === "3");
    expect(fiveG.apIndex).toBe("2");
    expect(fiveG.clients).toBe(1);
  });
});

describe("LAN ports", () => {
  test("reports enabled and link state separately", () => {
    const ports = resolveLanPorts(tr098, DM098);
    expect(ports).toHaveLength(2);
    expect(ports[0]).toMatchObject({ index: "1", enabled: true, up: true });
    expect(ports[1]).toMatchObject({ index: "2", enabled: false, up: false });
  });
});

describe("optical (FMT-02)", () => {
  test("reads the TP-Link vendor branch and bands the reading", () => {
    const o = resolveOptical(tr181, DM181);
    expect(o.vendor).toBe("tp-link");
    expect(o.rx).toBeCloseTo(-22.5);
    expect(o.band.level).toBe("ok");
  });

  test("an unconfirmed unit scale is flagged rather than presented as certain", () => {
    // Vendors report dBm, 0.1 dBm or microwatts. Reading 0.1-dBm as dBm turns a
    // healthy -22 into -220 and paints the whole fleet critical.
    const o = resolveOptical(tr181, DM181);
    expect(o.assumedUnit).toBe(true);
    expect(o.rawRx).toBe(-22.5);
  });

  test("returns null when the model publishes no optical branch", () => {
    expect(resolveOptical(tr098, DM098)).toBeNull();
  });

  test("critical band for a signal at loss-of-signal level", () => {
    const dark = JSON.parse(JSON.stringify(tr181));
    dark.Device.Optical.Interface[1].X_TP_GPON_Config.RXPower = L(-28.4);
    expect(resolveOptical(dark, DM181).band.level).toBe("critical");
  });
});

describe("online state (WEB-09)", () => {
  // The console built its cutoff as "Y-m-d H:i:s +0530" and compared it against
  // ISO-8601 UTC — a 5.5-hour skew that flips the entire fleet with no error.
  test("compares in UTC", () => {
    const p = computeOnline(tr098, DM098, 15);
    expect(p.online).toBe(true);
    expect(p.ageMin).toBeLessThan(5);
  });

  test("threshold scales with the device's own inform interval", () => {
    // 1800s interval => 30 min => x2.5 = 75 min. A fixed 15-minute threshold
    // would mark this healthy device offline for most of its cycle.
    expect(onlineThresholdMinutes(tr181, DM181)).toBeCloseTo(75);
  });

  test("falls back to the floor when the device reports no interval", () => {
    const bare = { _lastInform: new Date().toISOString(), Device: {} };
    expect(onlineThresholdMinutes(bare, DM181)).toBe(15);
  });

  test("a device that informed hours ago is offline", () => {
    const stale = { ...tr098, _lastInform: new Date(Date.now() - 6 * 3600_000).toISOString() };
    expect(computeOnline(stale, DM098, 15).online).toBe(false);
  });
});

describe("throughput (requirement #10)", () => {
  const sample = (rx, tx, at) => ({
    at,
    device: {
      InternetGatewayDevice: { WANDevice: { 1: { WANCommonInterfaceConfig: {
        TotalBytesReceived: L(rx, undefined, "xsd:unsignedInt"),
        TotalBytesSent: L(tx, undefined, "xsd:unsignedInt"),
      } } } },
    },
  });

  test("derives Mbps from two cumulative samples", () => {
    // 12.5 MB over 10s = 10 Mbps.
    const t = deriveThroughput(sample(0, 0, 0), sample(12_500_000, 0, 10_000), DM098);
    expect(t.rxMbps).toBeCloseTo(10, 1);
    expect(t.windowSeconds).toBe(10);
  });

  test("recovers from a 32-bit counter wrap instead of reporting a negative rate", () => {
    // TotalBytesReceived is 32-bit on many TR-098 CPEs — at 100 Mbps it wraps
    // every ~5.7 minutes, so naive deltas go negative several times an hour.
    const a = sample(4_294_967_000, 0, 0);
    const b = sample(1_000, 0, 10_000);   // wrapped past 2^32
    const t = deriveThroughput(a, b, DM098);
    expect(t.rxMbps).toBeGreaterThan(0);
  });

  test("flags a gap too long to trust", () => {
    // Beyond ~4 minutes a 32-bit counter can wrap more than once and we cannot
    // tell, so the number is marked rather than presented as fact.
    const t = deriveThroughput(sample(0, 0, 0), sample(1_000_000, 0, 600_000), DM098);
    expect(t.suspect).toBe(true);
  });

  test("returns null when a sample is missing", () => {
    expect(deriveThroughput(null, sample(1, 1, 1), DM098)).toBeNull();
  });
});

describe("buildDeviceModel", () => {
  test("assembles a TR-098 device end to end", () => {
    const m = buildDeviceModel(tr098);
    expect(m.dataModel).toBe(DM098);
    expect(m.identity.serial).toBe("AA11");
    expect(m.wan.pppoeUser).toBe("cust001@bbnl");
    expect(m.radios).toHaveLength(2);
    expect(m.wifiClients).toBe(7);          // 2 + 5
    expect(m.lanPorts).toHaveLength(2);
    expect(m.presence.online).toBe(true);
  });

  test("surfaces device and session uptime separately", () => {
    // High device uptime beside low session uptime is PPPoE flapping — the
    // actual diagnosis behind most "internet keeps cutting" tickets, and
    // invisible if the two are collapsed into one figure.
    const m = buildDeviceModel(tr098);
    expect(m.uptime.device).toBe(266400);   // ~3 days
    expect(m.uptime.session).toBe(600);     // 10 minutes
  });

  test("returns null for a null device rather than throwing", () => {
    expect(buildDeviceModel(null)).toBeNull();
  });
});

describe("formatting", () => {
  test("uptime reads in the largest useful unit", () => {
    expect(formatUptime(266400)).toBe("3d 2h");
    expect(formatUptime(7200)).toBe("2h 0m");
    expect(formatUptime(90)).toBe("1m");
    expect(formatUptime(null)).toBe("—");
  });
});
