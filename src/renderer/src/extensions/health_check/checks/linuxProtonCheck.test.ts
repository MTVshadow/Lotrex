import { describe, expect, it } from "vitest";

import { assessLinuxProton } from "./linuxProtonAssessment";

const ready = {
  appId: "489830",
  executablePath: "/games/SkyrimSE.exe",
  gameName: "Skyrim Special Edition",
  platform: "linux" as const,
  prefixPath: "/games/steamapps/compatdata/489830/pfx",
  protonPath: "/steam/steamapps/common/Proton 10.0",
  steamPath: "/steam",
  store: "steam",
};

describe("assessLinuxProton", () => {
  it("passes a complete Linux Proton setup", () => {
    expect(assessLinuxProton(ready)).toBeUndefined();
  });

  it("ignores native Linux games and non-Linux platforms", () => {
    expect(assessLinuxProton({ ...ready, executablePath: "/games/game" })).toBeUndefined();
    expect(assessLinuxProton({ ...ready, platform: "win32" })).toBeUndefined();
  });

  it.each([
    ["steam-not-found", { steamPath: undefined }],
    ["app-id-not-found", { appId: undefined }],
    ["prefix-not-found", { prefixPath: undefined }],
    ["runtime-not-found", { protonPath: undefined }],
  ] as const)("reports %s with useful context", (reason, missing) => {
    expect(assessLinuxProton({ ...ready, ...missing })).toMatchObject({
      executablePath: ready.executablePath,
      reason,
    });
  });
});
