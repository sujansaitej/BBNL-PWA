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

import { findAndboxBoxId } from "./boxId.js";

// Regression for the scan bug: validateAsset's "device not belongs op(BBNL_OP981)"
// error embeds an OPERATOR id that a broad /BBNL[-_].../ matched and loaded into
// the Box ID field. findAndboxBoxId must match ONLY real ANDBOX box ids.
describe("findAndboxBoxId — never mistakes an operator id for a box id", () => {
  test("does NOT match an operator id in an error message", () => {
    const resp = { status: { err_code: 1, err_msg: "device not belongs op(BBNL_OP981)" }, body: [] };
    expect(findAndboxBoxId(resp)).toBe("");
  });

  test("does NOT match bare operator ids", () => {
    expect(findAndboxBoxId("BBNL_OP981")).toBe("");
    expect(findAndboxBoxId("BBNL-OP49")).toBe("");
  });

  test("matches a real BBNL-ANDBOX box id in a named field", () => {
    const resp = { status: { err_code: 0 }, body: [{ boxid: "BBNL-ANDBOX-08190156", mac_addr: "68:1D:EF:23:9D:7F" }] };
    expect(findAndboxBoxId(resp)).toBe("BBNL-ANDBOX-08190156");
  });

  test("matches an ANDBOX id embedded in an 'already assigned' message", () => {
    const resp = { status: { err_code: 1, err_msg: "Device already assigned to BBNL-ANDBOX-02200004" } };
    expect(findAndboxBoxId(resp)).toBe("BBNL-ANDBOX-02200004");
  });

  test("matches AUG-ANDBOX ids too", () => {
    expect(findAndboxBoxId("AUG-ANDBOX-02180016")).toBe("AUG-ANDBOX-02180016");
  });

  test("does NOT match a FOFI serial", () => {
    expect(findAndboxBoxId("FOFI20190729000335")).toBe("");
  });
});
