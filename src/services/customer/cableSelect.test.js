import { describe, it, expect } from "vitest";
import {
  isPackageSubscribed,
  isChannelSubscribed,
  isMandatoryBasePack,
  isPackageSelected,
  isChannelSelected,
  togglePackage,
  toggleChannel,
  applyMandatoryBasePacks,
  assembleSelectionIds,
  canProceed,
} from "./cableSelect.js";

describe("subscribed guards", () => {
  it("isPackageSubscribed: disable=Yes blocks", () => {
    expect(isPackageSubscribed({ disable: "Yes" })).toBe(true);
    expect(isPackageSubscribed({ disable: "no" })).toBe(false);
  });
  it("isPackageSubscribed: issubscribed truthy (not no/0) blocks", () => {
    expect(isPackageSubscribed({ issubscribed: "yes" })).toBe(true);
    expect(isPackageSubscribed({ issubscribed: "1" })).toBe(true);
    expect(isPackageSubscribed({ issubscribed: "no" })).toBe(false);
    expect(isPackageSubscribed({ issubscribed: "0" })).toBe(false);
    expect(isPackageSubscribed({ issubscribed: "" })).toBe(false);
    expect(isPackageSubscribed({})).toBe(false);
  });
  it("isChannelSubscribed: disable=YES or issubscribed set (not no)", () => {
    expect(isChannelSubscribed({ disable: "YES" })).toBe(true);
    expect(isChannelSubscribed({ issubscribed: "yes" })).toBe(true);
    expect(isChannelSubscribed({ issubscribed: "0" })).toBe(true); // != null and != "no"
    expect(isChannelSubscribed({ issubscribed: "no" })).toBe(false);
    expect(isChannelSubscribed({ issubscribed: null })).toBe(false);
    expect(isChannelSubscribed({})).toBe(false);
  });
});

describe("isMandatoryBasePack", () => {
  const categories = [
    { id: 1, mandatory: "yes", basepack: "BP100" },
    { id: 2, mandatory: "no", basepack: "BP200" },
  ];
  it("true only for a mandatory category's base pack code", () => {
    expect(isMandatoryBasePack({ pkgcode: "BP100" }, categories)).toBe(true);
    expect(isMandatoryBasePack({ pkgcode: 100 }, [{ mandatory: "yes", basepack: 100 }])).toBe(true);
    expect(isMandatoryBasePack({ pkgcode: "BP200" }, categories)).toBe(false); // not mandatory
    expect(isMandatoryBasePack({ pkgcode: "BP999" }, categories)).toBe(false);
  });
});

describe("selected lookups", () => {
  const pkgs = [{ pkgid: "10", pkgcode: "BP1", pkgctg: "1" }];
  const chans = [{ chid: "5", lcochid: "9" }];
  it("isPackageSelected by pkgid (string-compare)", () => {
    expect(isPackageSelected(pkgs, "10")).toBe(true);
    expect(isPackageSelected(pkgs, 10)).toBe(true);
    expect(isPackageSelected(pkgs, "11")).toBe(false);
  });
  it("isChannelSelected by chid", () => {
    expect(isChannelSelected(chans, "5")).toBe(true);
    expect(isChannelSelected(chans, 5)).toBe(true);
    expect(isChannelSelected(chans, "6")).toBe(false);
  });
});

describe("togglePackage", () => {
  const categories = [
    { id: 1, mandatory: "yes", basepack: "BP1", selectiontype: "single" },
    { id: 2, mandatory: "no", basepack: "BP2", selectiontype: "single" },
    { id: 3, mandatory: "no", basepack: "BP3", selectiontype: "multi" },
  ];
  const catSingle = categories[1];
  const catMulti = categories[2];

  it("subscribed package is blocked (unchanged)", () => {
    const sel = [];
    const out = togglePackage(sel, { pkgid: "1", pkgcode: "X", disable: "Yes" }, catSingle, categories);
    expect(out).toBe(sel);
  });

  it("adds an unselected package (stores strings)", () => {
    const out = togglePackage([], { pkgid: 20, pkgcode: 200 }, catSingle, categories);
    expect(out).toEqual([{ pkgid: "20", pkgcode: "200", pkgctg: "2" }]);
  });

  it("single-select replaces the currently-selected package within the same category", () => {
    const sel = [{ pkgid: "20", pkgcode: "200", pkgctg: "2" }];
    const out = togglePackage(sel, { pkgid: "21", pkgcode: "201" }, catSingle, categories);
    expect(out).toEqual([{ pkgid: "21", pkgcode: "201", pkgctg: "2" }]);
    expect(out).not.toBe(sel); // new array
  });

  it("single-select leaves other categories' selections intact", () => {
    const sel = [{ pkgid: "30", pkgcode: "300", pkgctg: "3" }];
    const out = togglePackage(sel, { pkgid: "21", pkgcode: "201" }, catSingle, categories);
    expect(out).toEqual([
      { pkgid: "30", pkgcode: "300", pkgctg: "3" },
      { pkgid: "21", pkgcode: "201", pkgctg: "2" },
    ]);
  });

  it("multi-select appends", () => {
    const sel = [{ pkgid: "30", pkgcode: "300", pkgctg: "3" }];
    const out = togglePackage(sel, { pkgid: "31", pkgcode: "301" }, catMulti, categories);
    expect(out).toEqual([
      { pkgid: "30", pkgcode: "300", pkgctg: "3" },
      { pkgid: "31", pkgcode: "301", pkgctg: "3" },
    ]);
  });

  it("selected non-mandatory package is removed on toggle", () => {
    const sel = [{ pkgid: "20", pkgcode: "200", pkgctg: "2" }];
    const out = togglePackage(sel, { pkgid: "20", pkgcode: "200" }, catSingle, categories);
    expect(out).toEqual([]);
  });

  it("mandatory base pack cannot be deselected (unchanged)", () => {
    const catMand = categories[0];
    const sel = [{ pkgid: "10", pkgcode: "BP1", pkgctg: "1" }];
    const out = togglePackage(sel, { pkgid: "10", pkgcode: "BP1" }, catMand, categories);
    expect(out).toBe(sel);
  });
});

describe("toggleChannel", () => {
  it("subscribed channel is blocked (unchanged)", () => {
    const sel = [];
    const out = toggleChannel(sel, { chid: "5", lcochid: "9", disable: "yes" });
    expect(out).toBe(sel);
  });
  it("adds then removes by chid (new arrays, strings preserved)", () => {
    const added = toggleChannel([], { chid: 5, lcochid: 9 });
    expect(added).toEqual([{ chid: 5, lcochid: 9 }]);
    const removed = toggleChannel([{ chid: "5", lcochid: "9" }], { chid: "5", lcochid: "9" });
    expect(removed).toEqual([]);
  });
});

describe("applyMandatoryBasePacks", () => {
  const categories = [
    { id: 1, mandatory: "yes", basepack: "BP1" },
    { id: 2, mandatory: "no", basepack: "BP2" },
  ];
  const packagesByCategory = {
    1: [{ pkgid: 10, pkgcode: "BP1" }, { pkgid: 11, pkgcode: "OTHER" }],
    2: [{ pkgid: 20, pkgcode: "BP2" }],
  };

  it("auto-adds the mandatory base pack when absent", () => {
    const out = applyMandatoryBasePacks([], categories, packagesByCategory);
    expect(out).toEqual([{ pkgid: "10", pkgcode: "BP1", pkgctg: "1" }]);
  });

  it("no-op when the category already has a selection", () => {
    const sel = [{ pkgid: "11", pkgcode: "OTHER", pkgctg: "1" }];
    const out = applyMandatoryBasePacks(sel, categories, packagesByCategory);
    expect(out).toEqual(sel);
  });

  it("skips (no throw) when the base pack is absent from the list", () => {
    const out = applyMandatoryBasePacks([], categories, { 1: [{ pkgid: 11, pkgcode: "OTHER" }] });
    expect(out).toEqual([]);
  });
});

describe("assembleSelectionIds", () => {
  it("produces parallel string arrays with pkgcode distinct from pkgid", () => {
    const pkgs = [
      { pkgid: "10", pkgcode: "BP1", pkgctg: "1" },
      { pkgid: "20", pkgcode: "BP2", pkgctg: "2" },
    ];
    const chans = [{ chid: "5", lcochid: "9" }];
    const out = assembleSelectionIds(pkgs, chans);
    expect(out).toEqual({
      packageid: ["10", "20"],
      pkgcode: ["BP1", "BP2"],
      channelid: ["5"],
      lcochid: ["9"],
    });
    // pkgcode must NOT be equated with pkgid on this path.
    expect(out.pkgcode).not.toEqual(out.packageid);
  });
});

describe("canProceed", () => {
  it("true when there is any package or channel, false when empty", () => {
    expect(canProceed([], [])).toBe(false);
    expect(canProceed([{ pkgid: "1" }], [])).toBe(true);
    expect(canProceed([], [{ chid: "1" }])).toBe(true);
  });
});
