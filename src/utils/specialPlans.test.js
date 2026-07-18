import { describe, test, expect } from "vitest";
import { findSpecialPlanSrvid, findLinkFofiboxSrvid } from "./specialPlans.js";

// Real shape from live specialInternetPlans (bare array of {srvid, serv_name}).
const ROWS = [
    { srvid: 806, serv_name: "100MB_IPTV_OTT_COMBO" },
    { srvid: 812, serv_name: "100MB_KIRANA_FOFI" },
    { srvid: 815, serv_name: "LINK_FOFIBOX" }, // the unicast/linked-TV link plan
    { srvid: 807, serv_name: "50MB_IPTV_OTT_COMBO" },
];

describe("findLinkFofiboxSrvid — freeOTAService plan_id for linked TV devices", () => {
    test("returns the LINK_FOFIBOX srvid (case-insensitive) as a string", () => {
        // Backend serv_name is UPPERCASE 'LINK_FOFIBOX'; native lowercases to match.
        expect(findLinkFofiboxSrvid(ROWS)).toBe("815");
    });

    test("returns '' when LINK_FOFIBOX is absent (so the caller can error, not send a bad id)", () => {
        expect(findLinkFofiboxSrvid([{ srvid: 806, serv_name: "100MB_IPTV_OTT_COMBO" }])).toBe("");
    });

    test("is NOT confused by a fofi planid — only matches the special-plan serv_name", () => {
        // A fofi plan like {planid:51,...} has no serv_name 'link_fofibox' → no match.
        expect(findSpecialPlanSrvid([{ planid: 51, planname: "FOFI-Box + FTA ONLY" }], "link_fofibox")).toBe("");
    });

    test("findSpecialPlanSrvid matches any serv_name and coerces srvid to string", () => {
        expect(findSpecialPlanSrvid(ROWS, "100MB_KIRANA_FOFI")).toBe("812");
        expect(findSpecialPlanSrvid(ROWS, "nope")).toBe("");
    });

    test("handles non-array / empty input safely", () => {
        expect(findLinkFofiboxSrvid(null)).toBe("");
        expect(findLinkFofiboxSrvid(undefined)).toBe("");
        expect(findLinkFofiboxSrvid([])).toBe("");
    });
});
