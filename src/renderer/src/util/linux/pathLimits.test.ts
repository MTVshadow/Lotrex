import { describe, expect, it } from "vitest";

import {
  assertLinuxPathLimits,
  findLinuxPathLimitViolation,
  LINUX_NAME_MAX_BYTES,
  LINUX_PATH_MAX_BYTES,
} from "./pathLimits";

describe("Linux path limits and multibyte UTF-8 corpus", () => {
  describe("component byte limit (255 bytes)", () => {
    it("accepts exactly 255 bytes ASCII component", () => {
      const component = "a".repeat(255);
      expect(Buffer.byteLength(component, "utf8")).toBe(255);
      expect(findLinuxPathLimitViolation(`/mods/${component}`, "linux")).toBeUndefined();
      expect(() => assertLinuxPathLimits([`/mods/${component}`], "linux")).not.toThrow();
    });

    it("rejects 256 bytes ASCII component", () => {
      const component = "a".repeat(256);
      expect(findLinuxPathLimitViolation(`/mods/${component}`, "linux")).toMatchObject({
        actualBytes: 256,
        component,
        kind: "component",
        limitBytes: LINUX_NAME_MAX_BYTES,
      });
      expect(() => assertLinuxPathLimits([`/mods/${component}`], "linux")).toThrow(
        expect.objectContaining({
          actualBytes: 256,
          code: "ENAMETOOLONG",
          limitBytes: LINUX_NAME_MAX_BYTES,
        }),
      );
    });

    it("validates 2-byte Cyrillic / Ukrainian sequences", () => {
      // 127 Cyrillic chars * 2 bytes = 254 bytes (valid)
      const validCyrillic = "мод".repeat(42) + "м"; // 42*3 + 1 = 127 chars = 254 bytes
      expect(Buffer.byteLength(validCyrillic, "utf8")).toBe(254);
      expect(findLinuxPathLimitViolation(`/mods/${validCyrillic}`, "linux")).toBeUndefined();

      // 128 Cyrillic chars * 2 bytes = 256 bytes (exceeds 255)
      const invalidCyrillic = "мод".repeat(42) + "мо"; // 128 chars = 256 bytes
      expect(Buffer.byteLength(invalidCyrillic, "utf8")).toBe(256);
      expect(findLinuxPathLimitViolation(`/mods/${invalidCyrillic}`, "linux")).toMatchObject({
        actualBytes: 256,
        component: invalidCyrillic,
        kind: "component",
        limitBytes: LINUX_NAME_MAX_BYTES,
      });
    });

    it("validates 3-byte CJK sequences", () => {
      // 85 CJK characters * 3 bytes = 255 bytes (exact boundary - valid)
      const validCJK = "語".repeat(85);
      expect(Buffer.byteLength(validCJK, "utf8")).toBe(255);
      expect(findLinuxPathLimitViolation(`/mods/${validCJK}`, "linux")).toBeUndefined();

      // 86 CJK characters * 3 bytes = 258 bytes (exceeds 255)
      const invalidCJK = "語".repeat(86);
      expect(Buffer.byteLength(invalidCJK, "utf8")).toBe(258);
      expect(findLinuxPathLimitViolation(`/mods/${invalidCJK}`, "linux")).toMatchObject({
        actualBytes: 258,
        component: invalidCJK,
        kind: "component",
        limitBytes: LINUX_NAME_MAX_BYTES,
      });
    });

    it("validates 4-byte Emoji sequences", () => {
      // 63 emoji characters * 4 bytes = 252 bytes (valid)
      const validEmoji = "\u{1F3AE}".repeat(63);
      expect(Buffer.byteLength(validEmoji, "utf8")).toBe(252);
      expect(findLinuxPathLimitViolation(`/mods/${validEmoji}`, "linux")).toBeUndefined();

      // 64 emoji characters * 4 bytes = 256 bytes (exceeds 255)
      const invalidEmoji = "\u{1F3AE}".repeat(64);
      expect(Buffer.byteLength(invalidEmoji, "utf8")).toBe(256);
      expect(findLinuxPathLimitViolation(`/mods/${invalidEmoji}`, "linux")).toMatchObject({
        actualBytes: 256,
        component: invalidEmoji,
        kind: "component",
        limitBytes: LINUX_NAME_MAX_BYTES,
      });
    });
  });

  describe("path total byte limit (4096 bytes)", () => {
    it("accepts a total path of exactly 4096 bytes", () => {
      // Build a nested path of 16-byte segments: "/123456789012345"
      const segment = "/123456789012345"; // 16 bytes
      const path4096 = segment.repeat(256); // 16 * 256 = 4096 bytes
      expect(Buffer.byteLength(path4096, "utf8")).toBe(4096);
      expect(findLinuxPathLimitViolation(path4096, "linux")).toBeUndefined();
      expect(() => assertLinuxPathLimits([path4096], "linux")).not.toThrow();
    });

    it("rejects a total path of 4097 bytes", () => {
      const segment = "/123456789012345";
      const path4097 = segment.repeat(256) + "x"; // 4097 bytes
      expect(Buffer.byteLength(path4097, "utf8")).toBe(4097);
      expect(findLinuxPathLimitViolation(path4097, "linux")).toMatchObject({
        actualBytes: 4097,
        kind: "path",
        limitBytes: LINUX_PATH_MAX_BYTES,
      });
      expect(() => assertLinuxPathLimits([path4097], "linux")).toThrow(
        expect.objectContaining({
          actualBytes: 4097,
          code: "ENAMETOOLONG",
          limitBytes: LINUX_PATH_MAX_BYTES,
        }),
      );
    });

    it("does not apply Linux limits on Windows platform", () => {
      const oversized = `/${"x".repeat(300)}`;
      expect(findLinuxPathLimitViolation(oversized, "win32")).toBeUndefined();
      expect(() => assertLinuxPathLimits([oversized], "win32")).not.toThrow();
    });
  });
});
