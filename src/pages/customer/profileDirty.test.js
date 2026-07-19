import { describe, it, expect } from "vitest";
import { isDirty } from "./profileDirty";

const saved = { firstname: "abdul", lastname: "wahid", mobileno: "7019697942", emailid: "a@b.com" };

describe("profile dirty-check", () => {
  it("is clean when nothing changed", () => {
    expect(isDirty({ ...saved }, saved)).toBe(false);
  });

  it("is dirty when any single field changes", () => {
    for (const k of Object.keys(saved)) {
      expect(isDirty({ ...saved, [k]: "x" }, saved)).toBe(true);
    }
  });

  // Android compares raw strings, so trailing space IS a change and gets sent.
  it("treats whitespace-only edits as a change, like Android", () => {
    expect(isDirty({ ...saved, firstname: "abdul " }, saved)).toBe(true);
  });

  // Clearing a field must submit — otherwise "delete my email" silently no-ops.
  it("is dirty when a field is cleared", () => {
    expect(isDirty({ ...saved, emailid: "" }, saved)).toBe(true);
  });

  it("is clean before the first fetch resolves", () => {
    expect(isDirty({ ...saved }, null)).toBe(false);
  });

  // custViewProfile omits empty fields; undefined and "" must not read as a change.
  it("treats a missing saved field as empty", () => {
    expect(isDirty({ ...saved, emailid: "" }, { ...saved, emailid: undefined })).toBe(false);
  });
});
