import { describe, it, expect } from "vitest";
import { validatePassword, PASSWORD_MAX_LENGTH } from "./passwordPolicy";

describe("validatePassword", () => {
  it("rejects an empty password", () => {
    expect(validatePassword("")).toBe("Password is required");
    expect(validatePassword(undefined)).toBe("Password is required");
  });

  it("blocks only the two banned literals, case-insensitively", () => {
    for (const bad of ["password", "PASSWORD", "PassWord", "12345678", " password "]) {
      expect(validatePassword(bad)).toMatch(/too common/i);
    }
  });

  it("accepts a plain 10-digit phone number as the password", () => {
    expect(validatePassword("9876543210")).toBeNull();
  });

  it("accepts a random password with no uppercase / special character", () => {
    for (const ok of ["mahesh1234", "bbnl2026abc", "qwertyuiop", "87654321"]) {
      expect(validatePassword(ok)).toBeNull();
    }
  });

  it("no longer demands uppercase, digit or special characters", () => {
    // These all failed the old strong-password regex.
    expect(validatePassword("chennaicity")).toBeNull();
    expect(validatePassword("Bbnl@1234")).toBeNull(); // still fine, just not required
  });

  it("keeps the length bounds", () => {
    expect(validatePassword("1234567")).toMatch(/at least 8/);
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toMatch(/not exceed/);
  });
});
