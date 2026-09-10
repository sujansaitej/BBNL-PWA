/**
 * FO-Fi Cloud upload — contract guards.
 *
 * These pin the four things that make this endpoint different from every other
 * customer call, each of which silently breaks the upload if it drifts:
 *
 *   1. `files[]` WITH brackets, or PHP never builds $_FILES['files'] as arrays.
 *   2. A LONE `Authorization: Basic …` header — no username/password/appkeytype,
 *      and no hand-set Content-Type (that would strip the multipart boundary).
 *   3. `mac_address` is the box SERIAL NUMBER, not a MAC and not the box id.
 *   4. Per-file rows survive err_code 1 — partial failure is the case the list
 *      exists for, and the Android original throws it away.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  partitionFiles,
  isPrimaryBox,
  formatSize,
  uploadTimeout,
  uploadImagesToCloud,
  MAX_FILES,
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  cloudUploadEligibility,
} from "./cloudUpload.js";

const jpg = (name = "a.jpg", size = 1024) =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg" });

describe("partitionFiles", () => {
  it("accepts exactly the backend's whitelist", () => {
    expect(ALLOWED_TYPES).toEqual(["image/jpeg", "image/jpg", "image/png"]);
    const files = [
      new File(["x"], "a.jpg", { type: "image/jpeg" }),
      new File(["x"], "b.png", { type: "image/png" }),
      new File(["x"], "c.jpg", { type: "image/jpg" }),
    ];
    expect(partitionFiles(files).accepted).toHaveLength(3);
    expect(partitionFiles(files).rejected).toHaveLength(0);
  });

  it("rejects HEIC — what an iPhone hands over by default", () => {
    const { accepted, rejected } = partitionFiles([
      new File(["x"], "IMG_0001.HEIC", { type: "image/heic" }),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/HEIC/);
  });

  it("rejects a type-less pick rather than letting the server guess", () => {
    const { accepted, rejected } = partitionFiles([new File(["x"], "mystery", { type: "" })]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("caps at 20 ACCEPTED files — bad picks must not consume slots", () => {
    const files = [
      new File(["x"], "bad.heic", { type: "image/heic" }),
      ...Array.from({ length: 22 }, (_, i) => jpg(`p${i}.jpg`)),
    ];
    const { accepted, overflow, rejected } = partitionFiles(files);
    expect(accepted).toHaveLength(MAX_FILES);
    expect(overflow).toHaveLength(2);
    expect(rejected).toHaveLength(1);
  });

  it("survives null/undefined", () => {
    expect(partitionFiles(null).accepted).toEqual([]);
    expect(partitionFiles(undefined).rejected).toEqual([]);
  });
});

describe("isPrimaryBox", () => {
  it("only an explicit primarybox:'no' is secondary", () => {
    expect(isPrimaryBox({ primarybox: "yes" })).toBe(true);
    expect(isPrimaryBox({ primarybox: "no" })).toBe(false);
    expect(isPrimaryBox({ primarybox: "NO" })).toBe(false);
    // Absent flag must not be read as "secondary" — that would hide the icon
    // for every box on a backend that stops sending the field.
    expect(isPrimaryBox({})).toBe(true);
    expect(isPrimaryBox(null)).toBe(true);
  });
});

describe("formatSize", () => {
  it("matches the backend's base-1000 calculateFileSize()", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(195401)).toBe("195.4 KB");
    expect(formatSize(0)).toBe("0 B");
  });
  it("is NaN-safe", () => {
    expect(formatSize("nope")).toBe("");
    expect(formatSize(undefined)).toBe("");
  });
});

describe("uploadTimeout", () => {
  it("grows with the file count and stays bounded", () => {
    // The backend re-posts each file onward, one at a time, before answering —
    // a fixed 60s cap aborts healthy multi-file uploads.
    expect(uploadTimeout(1)).toBe(50000);
    expect(uploadTimeout(20)).toBe(300000);
    expect(uploadTimeout(999)).toBe(300000);
    expect(uploadTimeout(0)).toBe(50000);
  });
});

describe("uploadImagesToCloud — wire contract", () => {
  let fetchMock;
  const envelope = (body, err_code, err_msg = "") =>
    JSON.stringify({ body, status: { err_code, err_msg } });

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(envelope([], 0), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = () =>
    uploadImagesToCloud({ cid: "981demoniv", macAddress: "FOFI20191129000387", files: [jpg()] });

  it("posts to fofi/fofiapis/cloudUpload/", async () => {
    await call();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/fofi\/fofiapis\/cloudUpload\/$/);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("names the file part `files[]`, with brackets, once per file", async () => {
    await uploadImagesToCloud({
      cid: "c",
      macAddress: "m",
      files: [jpg("a.jpg"), jpg("b.jpg")],
    });
    const form = fetchMock.mock.calls[0][1].body;
    expect(form).toBeInstanceOf(FormData);
    expect(form.getAll("files[]")).toHaveLength(2);
    expect(form.getAll("files")).toHaveLength(0);
  });

  it("sends cid and mac_address as the serial number it was handed", async () => {
    await call();
    const form = fetchMock.mock.calls[0][1].body;
    expect(form.get("cid")).toBe("981demoniv");
    expect(form.get("mac_address")).toBe("FOFI20191129000387");
  });

  it("sends ONLY the Basic key — no quartet, no Content-Type", async () => {
    await call();
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers).toEqual({
      Authorization: "Basic Zm9maWxhYkBnbWFpbC5jb206MTIzNDUtNTQzMjE=",
    });
    // A hand-set Content-Type strips the browser's multipart boundary and the
    // backend then parses no files at all.
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("returns the per-file rows even when err_code is 1 (partial failure)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        envelope(
          [
            { filename: "ok.png", filesize: "195.4 KB", status: "success" },
            { filename: "bad.zip", filesize: "4.14 KB", status: "failed" },
          ],
          1,
          "1 file(s) uploaded successfully and 1 file(s) failed"
        ),
        { status: 200 }
      )
    );
    const res = await call();
    expect(res.ok).toBe(false);
    expect(res.rows).toHaveLength(2);   // Android drops these on the floor
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(1);
  });

  it("err_code 0 means every file landed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(envelope([{ filename: "a.jpg", filesize: "1 KB", status: "success" }], 0), {
        status: 200,
      })
    );
    const res = await call();
    expect(res.ok).toBe(true);
    expect(res.succeeded).toBe(1);
  });

  it("refuses to fire without a box serial", async () => {
    await expect(
      uploadImagesToCloud({ cid: "c", macAddress: "", files: [jpg()] })
    ).rejects.toThrow(/box details/i);
    await expect(uploadImagesToCloud({ cid: "c", macAddress: "m", files: [] })).rejects.toThrow(
      /at least one image/i
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a non-JSON body as an invalid response, not a silent success", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>500</html>", { status: 200 }));
    await expect(call()).rejects.toThrow(/invalid response/i);
  });
});

/**
 * 2 MB per image — a product rule (2 Sep 2026). Nothing upstream enforces a
 * size: Android posts the gallery original, and Fofiapis::cloudUpload has no
 * size branch at all (its ">100MB" is only wording in an error string). So
 * the cap has to be pinned HERE or it does not exist anywhere.
 */
describe("2 MB per-image cap", () => {
  it("is exactly 2 MiB", () => {
    expect(MAX_FILE_BYTES).toBe(2 * 1024 * 1024);
  });

  it("accepts a file at the limit and rejects one byte over, naming the cap", () => {
    const at = jpg("at.jpg", MAX_FILE_BYTES);
    const over = jpg("over.jpg", MAX_FILE_BYTES + 1);
    const { accepted, rejected } = partitionFiles([at, over]);
    expect(accepted.map((f) => f.name)).toEqual(["at.jpg"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].file.name).toBe("over.jpg");
    expect(rejected[0].reason).toMatch(/MB/);
  });

  it("an oversized file does not consume one of the 20 slots", () => {
    const files = Array.from({ length: 20 }, (_, i) => jpg(`ok${i}.jpg`));
    files.unshift(jpg("huge.jpg", MAX_FILE_BYTES * 3));
    const { accepted, overflow, rejected } = partitionFiles(files);
    expect(accepted).toHaveLength(20);
    expect(overflow).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });
});

/**
 * "Invalid User ID" on production, 2 Sep 2026, for a "TV-e118a9…" device.
 *
 * cloudUpload's checkuser() reads ONLY user_info, but the connection list
 * (Fofi_model::getAllFofiBoxesofCustomer) is a UNION of four tables. A
 * unicast / Android-TV row comes from unicast_users_new with its deviceid
 * copied into fserialno AND `primarybox: "yes"` — so it passes every check the
 * page used to make and then fails on the server. Android shows the same icon
 * and fails the same way; QA's Android test simply used a real box.
 */
describe("cloudUploadEligibility", () => {
  it("a real FO-Fi box on user_info is eligible", () => {
    expect(cloudUploadEligibility({
      product_name: "BBNL-ANDBOX-02200004", fserialno: "FS123", primarybox: "yes",
    })).toEqual({ ok: true, reason: "" });
    expect(cloudUploadEligibility({
      product_name: "AUG-ANDBOX-0001", fserialno: "FS1", primarybox: "yes",
    }).ok).toBe(true);
  });

  it("a unicast / TV-app device is NOT — even though it says primarybox yes", () => {
    const r = cloudUploadEligibility({
      product_name: "TV-e118a9a501c8ea3cbaa56edecc9aaa76210c2428",
      fserialno: "TV-e118a9a501c8ea3cbaa56edecc9aaa76210c2428",
      primarybox: "yes",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/TV app/i);
  });

  it("a linked (secondary) box is not", () => {
    const r = cloudUploadEligibility({
      product_name: "BBNL-ANDBOX-999", fserialno: "FS9", primarybox: "no",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/linked box/i);
  });

  it("a row with no serial cannot be addressed at all", () => {
    expect(cloudUploadEligibility({ product_name: "BBNL-ANDBOX-1", fserialno: "" }).ok).toBe(false);
    expect(cloudUploadEligibility(null).ok).toBe(false);
  });
});
