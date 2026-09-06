import { describe, expect, it } from "vitest";

import { supportsElevatedSymlinkPlatform } from "./platform";

describe("elevated symlink deployment platform gate", () => {
  it("loads only on Windows", () => {
    expect(supportsElevatedSymlinkPlatform("win32")).toBe(true);
    expect(supportsElevatedSymlinkPlatform("linux")).toBe(false);
    expect(supportsElevatedSymlinkPlatform("darwin")).toBe(false);
  });
});
