import { describe, expect, it, vi } from "vitest";

import { detectAppContainerSupport } from "./platform";

describe("FOMOD sandbox platform support", () => {
  it("does not call the Windows probe on Linux or macOS", () => {
    const probe = vi.fn(() => true);

    expect(detectAppContainerSupport("linux", probe)).toBe(false);
    expect(detectAppContainerSupport("darwin", probe)).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns the Windows capability result", () => {
    expect(detectAppContainerSupport("win32", () => true)).toBe(true);
    expect(detectAppContainerSupport("win32", () => false)).toBe(false);
  });

  it("treats a failed native capability probe as unsupported", () => {
    expect(
      detectAppContainerSupport("win32", () => {
        throw new Error("native API unavailable");
      }),
    ).toBe(false);
  });
});
