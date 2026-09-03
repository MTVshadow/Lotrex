import { describe, expect, it } from "vitest";

import { shouldEnableAutoUpdater } from "./updater";

describe("shouldEnableAutoUpdater", () => {
  it("enables packaged regular installations", () => {
    expect(shouldEnableAutoUpdater("regular", "linux", "production")).toBe(true);
  });

  it("allows development update testing on Windows", () => {
    expect(shouldEnableAutoUpdater("managed", "win32", "development")).toBe(true);
  });

  it("does not request unavailable Linux update metadata in development", () => {
    expect(shouldEnableAutoUpdater("managed", "linux", "development")).toBe(false);
  });

  it("leaves managed production installations to their package manager", () => {
    expect(shouldEnableAutoUpdater("managed", "linux", "production")).toBe(false);
  });
});
