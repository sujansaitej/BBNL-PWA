import { describe, test, expect } from "vitest";
import { isFofiAndroidBoxId } from "./boxId.js";

// Mirrors the backend chk__fofiboxid gate (CustomerRegistrationValidations.php):
// substr($boxid,0,11) must equal 'AUG-ANDBOX-' or 'BBNL-ANDBOX'. Only those pass
// upgradeRegistration; everything else (notably a 'TV-' unicast/ATV device) is
// rejected with "Wrong Fofi box ID!" and must go through the Cable TV flow.
describe("isFofiAndroidBoxId — FoFi upgrade-registration box gate", () => {
    test("accepts BBNL-ANDBOX ids", () => {
        expect(isFofiAndroidBoxId("BBNL-ANDBOX-08190156")).toBe(true);
        expect(isFofiAndroidBoxId("BBNL-ANDBOX-02200019")).toBe(true);
    });

    test("accepts AUG-ANDBOX- ids", () => {
        expect(isFofiAndroidBoxId("AUG-ANDBOX-02180016")).toBe(true);
    });

    test("REJECTS the ATV/unicast 'TV-' device id (the bug)", () => {
        expect(isFofiAndroidBoxId("TV-e118a9a501c8ea3cbaa56edecc9aaa76210c2428")).toBe(false);
    });

    test("rejects a prefix-stripped hash (also fails backend — proven live)", () => {
        expect(isFofiAndroidBoxId("e118a9a501c8ea3cbaa56edecc9aaa76210c2428")).toBe(false);
    });

    test("rejects empty / nullish ids (brand-new customer, no box yet)", () => {
        expect(isFofiAndroidBoxId("")).toBe(false);
        expect(isFofiAndroidBoxId(null)).toBe(false);
        expect(isFofiAndroidBoxId(undefined)).toBe(false);
    });

    test("matches the backend's exact 11-char prefix rule, not a loose contains", () => {
        // 'BBNL-ANDBOX' is 11 chars; a lookalike that only contains it later fails.
        expect(isFofiAndroidBoxId("X-BBNL-ANDBOX-1")).toBe(false);
        // Case-sensitive, like the PHP substr comparison.
        expect(isFofiAndroidBoxId("bbnl-andbox-1")).toBe(false);
    });
});
