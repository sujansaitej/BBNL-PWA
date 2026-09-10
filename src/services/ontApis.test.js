/**
 * ontApis wire-contract tests.
 *
 * These pin the shape of what we send to the GenieACS NBI and how we read what
 * comes back. They do NOT prove the ACS accepts any of it — they encode the
 * contract derived from Ontconflib.php so that a drift shows up as a failing
 * test rather than as a blank screen in the field.
 *
 * Several assertions exist specifically because the PHP client got them wrong.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./apiCore", async () => {
  const actual = await vi.importActual("./apiCore");
  return { ...actual, apiFetch: vi.fn(), dedupe: (_k, fn) => fn() };
});
vi.mock("./lsCache", () => ({
  lsGet: () => null,          // always cold, so every test exercises the network path
  lsSet: () => {},
  lsRemove: vi.fn(),
}));

import { apiFetch } from "./apiCore";
import {
  findDevice, getFleetCounts, rebootDevice, probeDevice, setSsid, setLanPorts,
  setPppoe, normalizeSerial, isoUtcMinutesAgo, operatorScope, OntError, ONT_ERR,
} from "./ontApis";

const ok = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const lastCall = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
const lastUrl = () => decodeURIComponent(lastCall()[0]);
const lastBody = () => JSON.parse(lastCall()[1].body);

beforeEach(() => { apiFetch.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("serial normalisation (ONT-05)", () => {
  // _sanitizeMac() uppercased its input and stripped only ":". GenieACS stores
  // _deviceId._SerialNumber exactly as the CPE reported it, so any vendor
  // reporting a lowercase serial was NEVER found — and the UI blamed the device.
  test("strips every separator format, not just colons", () => {
    expect(normalizeSerial("AA:BB:CC:DD")).toBe("AABBCCDD");
    expect(normalizeSerial("AA-BB-CC-DD")).toBe("AABBCCDD");
    expect(normalizeSerial("aabb.ccdd")).toBe("aabbccdd");
    expect(normalizeSerial("  AABB CCDD ")).toBe("AABBCCDD");
  });

  test("preserves case rather than forcing uppercase", () => {
    expect(normalizeSerial("abc123")).toBe("abc123");
  });
});

describe("findDevice", () => {
  test("queries the serial exactly as given, then tries the other casings", async () => {
    apiFetch.mockResolvedValue(ok([]));
    await findDevice({ serial: "bb22lower" });
    const urls = apiFetch.mock.calls.map((c) => decodeURIComponent(c[0]));
    expect(urls[0]).toContain('{"_deviceId._SerialNumber":"bb22lower"}');
    expect(urls.some((u) => u.includes('"BB22LOWER"'))).toBe(true);
  });

  test("tries both data models' PPPoE username paths", async () => {
    apiFetch.mockResolvedValue(ok([]));
    await findDevice({ pppoeUser: "cust001@bbnl" });
    const urls = apiFetch.mock.calls.map((c) => decodeURIComponent(c[0]));
    expect(urls.some((u) => u.includes("Device.PPP.Interface.1.Username._value"))).toBe(true);
    expect(urls.some((u) => u.includes("WANPPPConnection.1.Username._value"))).toBe(true);
  });

  test("stops at the first hit instead of running every lookup", async () => {
    apiFetch.mockResolvedValue(ok([{ _id: "X" }]));
    const dev = await findDevice({ serial: "AA11", pppoeUser: "u@bbnl" });
    expect(dev._id).toBe("X");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  test("every query is bounded by a limit (ONT-06)", async () => {
    // getDeviceList() never sent a limit, so counting three integers pulled the
    // entire fleet into memory.
    apiFetch.mockResolvedValue(ok([]));
    await findDevice({ serial: "AA11" });
    expect(lastUrl()).toMatch(/limit=\d+/);
  });

  test("returns null when nothing matches", async () => {
    apiFetch.mockResolvedValue(ok([]));
    expect(await findDevice({ serial: "NOPE" })).toBeNull();
  });
});

describe("error classification (WEB-08)", () => {
  // The console could not distinguish "no such device" from "ACS unreachable"
  // and reported the latter as the former — which sends a technician to site
  // for an infrastructure problem.
  test("a transport failure is UNREACHABLE, not NOT_FOUND", async () => {
    apiFetch.mockRejectedValue(new Error("Network error: connect ECONNREFUSED"));
    await expect(findDevice({ serial: "AA11" })).rejects.toMatchObject({
      code: ONT_ERR.UNREACHABLE,
    });
  });

  test("a non-JSON body is BAD_RESPONSE (this is what ONT-01 emitted)", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "Array\n(\n  [error] => timeout\n)" });
    await expect(findDevice({ serial: "AA11" })).rejects.toMatchObject({
      code: ONT_ERR.BAD_RESPONSE,
    });
  });

  test("an HTML body is PROXY_MISSING, not a fault of the ACS", async () => {
    // Apache's SPA fallback rewrites any unmatched path to index.html and
    // answers HTTP 200, so a missing /acs-api proxy entry is indistinguishable
    // from a healthy request until JSON.parse fails. Calling that "the ACS
    // returned an invalid response" sends people to debug a machine that was
    // never contacted.
    apiFetch.mockResolvedValue({
      ok: true, status: 200,
      text: async () => '<!doctype html><html><head><title>BBNL</title></head><body></body></html>',
    });
    await expect(findDevice({ serial: "AA11" })).rejects.toMatchObject({
      code: ONT_ERR.PROXY_MISSING,
    });
  });

  test("detects the SPA shell regardless of leading whitespace or casing", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '\n  <HTML><HEAD></HEAD></HTML>' });
    await expect(findDevice({ serial: "AA11" })).rejects.toMatchObject({
      code: ONT_ERR.PROXY_MISSING,
    });
  });

  test("a 5xx is UNREACHABLE", async () => {
    apiFetch.mockResolvedValue(ok({}, 502));
    await expect(findDevice({ serial: "AA11" })).rejects.toBeInstanceOf(OntError);
  });
});

describe("task status (ONT-03)", () => {
  // GenieACS answers 200 when a task EXECUTED and 202 when it was only QUEUED
  // because the device was unreachable — both with a non-empty body. The console
  // checked !empty($result), which is why it reported "rebooted successfully"
  // for offline devices.
  test("200 means the device actually did it", async () => {
    apiFetch.mockResolvedValue(ok({ name: "reboot" }, 200));
    expect((await rebootDevice("dev1")).state).toBe("done");
  });

  test("202 means queued, not success", async () => {
    apiFetch.mockResolvedValue(ok({ name: "reboot" }, 202));
    expect((await rebootDevice("dev1")).state).toBe("queued");
  });

  test("a 4xx raises rather than reporting success", async () => {
    apiFetch.mockResolvedValue(ok({ message: "no such device" }, 404));
    await expect(rebootDevice("dev1")).rejects.toMatchObject({ code: ONT_ERR.TASK_FAILED });
  });

  test("reboot posts the exact payload Ontconflib used", async () => {
    apiFetch.mockResolvedValue(ok({}, 200));
    await rebootDevice("dev1");
    expect(lastBody()).toEqual({ name: "reboot" });
    expect(lastCall()[0]).toContain("/tasks?");
    expect(lastCall()[0]).toContain("connection_request");
  });

  test("writes are not cancelled by navigation", async () => {
    // A queued reboot must survive the operator swiping back.
    apiFetch.mockResolvedValue(ok({}, 200));
    await rebootDevice("dev1");
    expect(lastCall()[3]).toMatchObject({ linkNavigation: false });
  });
});

describe("probe (requirement #8)", () => {
  test("uses a CWMP connection request on one cheap parameter, not ICMP", async () => {
    apiFetch.mockResolvedValue(ok({}, 200));
    const p = await probeDevice("dev1", "tr181");
    expect(lastBody()).toMatchObject({
      name: "getParameterValues",
      parameterNames: ["Device.DeviceInfo.UpTime"],
    });
    expect(p.alive).toBe(true);
    expect(p.method).toBe("cwmp");
  });

  test("a queued task means not reachable right now", async () => {
    apiFetch.mockResolvedValue(ok({}, 202));
    const p = await probeDevice("dev1", "tr098");
    expect(p.alive).toBe(false);
    expect(p.state).toBe("queued");
  });
});

describe("setSsid", () => {
  const radio = { index: "6", apIndex: "6", dataModel: "tr098", ssid: "Old" };

  test("writes only the reported data model's paths (ONT-08)", async () => {
    // SetParameterValues is atomic: Ontconflib wrote TR-181 + TR-098 + a third
    // family in one task, so any unimplemented path faulted the WHOLE task and
    // nothing was written at all.
    apiFetch.mockResolvedValue(ok({}, 200));
    await setSsid("dev1", radio, { ssid: "New", password: "supersecret" });
    const paths = lastBody().parameterValues.map((v) => v[0]);
    expect(paths.every((p) => p.startsWith("InternetGatewayDevice.LANDevice"))).toBe(true);
    expect(paths.some((p) => p.startsWith("Device.WiFi"))).toBe(false);
  });

  test("writes to the index resolved from the device's own table (FMT-01)", async () => {
    apiFetch.mockResolvedValue(ok({}, 200));
    await setSsid("dev1", radio, { ssid: "New" });
    expect(lastBody().parameterValues[0][0])
      .toBe("InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.SSID");
  });

  test("booleans are xsd:boolean, never xsd:bool (ONT-09)", async () => {
    apiFetch.mockResolvedValue(ok({}, 200));
    await setSsid("dev1", radio, { hidden: true });
    const bools = lastBody().parameterValues.filter((v) => typeof v[1] === "boolean");
    expect(bools.length).toBeGreaterThan(0);
    expect(bools.every((v) => v[2] === "xsd:boolean")).toBe(true);
  });

  test("the non-standard LANInterfaces path is off by default (ONT-11)", async () => {
    // InternetGatewayDevice.LANInterfaces.WLANConfiguration is not in TR-098. If
    // nothing implements it, that one path faults every SSID task fleet-wide.
    apiFetch.mockResolvedValue(ok({}, 200));
    await setSsid("dev1", radio, { ssid: "New" });
    const paths = lastBody().parameterValues.map((v) => v[0]);
    expect(paths.some((p) => p.includes("LANInterfaces"))).toBe(false);
  });

  test("rejects a passphrase outside the WPA2 range before it can fault the task", async () => {
    await expect(setSsid("dev1", radio, { password: "short" })).rejects.toThrow(/8 to 63/);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test("refuses to write without a resolved radio", async () => {
    await expect(setSsid("dev1", null, { ssid: "x" })).rejects.toBeInstanceOf(OntError);
  });
});

describe("setLanPorts (ONT-10)", () => {
  // The console interpolated $_POST["lancheck"] straight into the parameter
  // path with no validation.
  test("drops ports the device does not have", async () => {
    apiFetch.mockResolvedValue(ok({}, 200));
    await setLanPorts("dev1", ["1", "99"], false, { dataModel: "tr181", validPorts: ["1", "2"] });
    const paths = lastBody().parameterValues.map((v) => v[0]);
    expect(paths).toEqual(["Device.Ethernet.Interface.1.Enable"]);
  });

  test("rejects non-numeric input outright", async () => {
    await expect(
      setLanPorts("dev1", ["1.Enable\",\"x"], false, { dataModel: "tr181", validPorts: ["1"] })
    ).rejects.toBeInstanceOf(OntError);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test("uses xsd:boolean", async () => {
    apiFetch.mockResolvedValue(ok({}, 200));
    await setLanPorts("dev1", ["1"], true, { dataModel: "tr098", validPorts: ["1"] });
    expect(lastBody().parameterValues[0][2]).toBe("xsd:boolean");
  });
});

describe("setPppoe", () => {
  test("is disabled unless explicitly enabled", async () => {
    // A wrong PPPoE credential takes the customer offline and needs a site visit
    // to recover — heavier than anything else on the screen.
    vi.stubEnv("VITE_ONT_ALLOW_PPPOE", "false");
    await expect(
      setPppoe("dev1", { username: "u", password: "p" }, { dataModel: "tr181" })
    ).rejects.toThrow(/disabled/i);
  });

  test("when enabled, writes only the reported model's paths", async () => {
    vi.stubEnv("VITE_ONT_ALLOW_PPPOE", "true");
    apiFetch.mockResolvedValue(ok({}, 200));
    await setPppoe("dev1", { username: "u@bbnl", password: "p" }, { dataModel: "tr181" });
    const paths = lastBody().parameterValues.map((v) => v[0]);
    expect(paths).toEqual(["Device.PPP.Interface.1.Username", "Device.PPP.Interface.1.Password"]);
  });
});

describe("operator scoping (WEB-03)", () => {
  // GenieACS has no op_id. Without tagging, counts cover every device on the ACS.
  test("returns null when tagging is off, so callers can warn instead of lying", () => {
    vi.stubEnv("VITE_ONT_TAG_SCOPING", "false");
    expect(operatorScope("123")).toBeNull();
  });

  test("filters on _tags when tagging is on", () => {
    vi.stubEnv("VITE_ONT_TAG_SCOPING", "true");
    vi.stubEnv("VITE_ONT_TAG_PREFIX", "op_");
    expect(operatorScope("123")).toEqual({ _tags: "op_123" });
  });
});

describe("fleet counts", () => {
  test("inventory is null — it cannot come from the ACS", async () => {
    // Inventory includes boxes that have never powered on; the ACS only knows
    // devices that have informed at least once. Substituting `registered` would
    // be a plausible-looking wrong number.
    apiFetch.mockResolvedValue(ok([{ _id: "a" }, { _id: "b" }]));
    const c = await getFleetCounts({ opId: "1", thresholdMin: 15 });
    expect(c.inventory).toBeNull();
    expect(c.registered).toBe(2);
  });

  test("offline is derived, never negative", async () => {
    apiFetch.mockResolvedValue(ok([{ _id: "a" }]));
    const c = await getFleetCounts({ opId: "1", thresholdMin: 15 });
    expect(c.offline).toBeGreaterThanOrEqual(0);
  });

  test("the online cutoff is sent as ISO UTC (WEB-09)", async () => {
    // The console formatted its cutoff as "+0530" and compared against UTC — a
    // 5.5-hour skew that flips the entire fleet with no error surfaced.
    apiFetch.mockResolvedValue(ok([]));
    await getFleetCounts({ opId: "1", thresholdMin: 15 });
    const urls = apiFetch.mock.calls.map((c) => decodeURIComponent(c[0]));
    expect(urls.some((u) => /\$gte.*\d{4}-\d{2}-\d{2}T.*Z/.test(u))).toBe(true);
  });
});

describe("isoUtcMinutesAgo", () => {
  test("produces a UTC ISO timestamp in the past", () => {
    const s = isoUtcMinutesAgo(15);
    expect(s).toMatch(/Z$/);
    expect(new Date(s).getTime()).toBeLessThan(Date.now());
  });
});
