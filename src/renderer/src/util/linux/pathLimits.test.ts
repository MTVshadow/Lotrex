import { describe, expect, it } from "vitest";

import {
  assertLinuxPathLimits,
  findLinuxPathLimitViolation,
  LINUX_NAME_MAX_BYTES,
  LINUX_PATH_MAX_BYTES,
} from "./pathLimits";

describe("Linux path limits", () => {
  it("measures UTF-8 bytes rather than JavaScript characters", () => {
    const component = "я".repeat(128);
    expect(component.length).toBe(128);
    expect(findLinuxPathLimitViolation(`/game/${component}`, "linux")).toMatchObject({
      actualBytes: 256,
      component,
      kind: "component",
      limitBytes: LINUX_NAME_MAX_BYTES,
    });
  });

  it("rejects an oversized complete path with an actionable ENAMETOOLONG error", () => {
    const inputPath = `/${"safe/".repeat(820)}`;
    expect(Buffer.byteLength(inputPath)).toBeGreaterThan(LINUX_PATH_MAX_BYTES);
    expect(() => assertLinuxPathLimits([inputPath], "linux")).toThrow(
      expect.objectContaining({
        actualBytes: Buffer.byteLength(inputPath),
        code: "ENAMETOOLONG",
        limitBytes: LINUX_PATH_MAX_BYTES,
        path: inputPath,
      }),
    );
  });

  it("does not apply Linux limits to another platform", () => {
    expect(findLinuxPathLimitViolation(`/${"x".repeat(300)}`, "win32")).toBeUndefined();
  });
});
