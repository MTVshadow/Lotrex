import { beforeEach, describe, expect, it, vi } from "vitest";

import ProtonPaths from "./ProtonPaths";
import { resolveUnifiedLaunch } from "./unifiedLaunchProvider";

describe("unifiedLaunchProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles native Linux binaries directly without Proton", () => {
    const result = resolveUnifiedLaunch({
      commandLine: ["--help"],
      executablePath: "/usr/bin/bash",
      gameId: "custom-game",
      isGame: true,
      workingDirectory: "/tmp",
    });

    expect(result.mode).toBe("native");
    expect(result.executable).toBe("/usr/bin/bash");
    expect(result.parameters).toEqual(["--help"]);
    expect(result.prefixPath).toBeUndefined();
  });

  it("handles Heroic URI launch protocol", () => {
    const result = resolveUnifiedLaunch({
      executablePath: "heroic://launch/12345",
      gameId: "witcher3",
      isGame: true,
      store: "heroic",
    });

    expect(result.mode).toBe("heroic-uri");
    expect(result.executable).toBe("heroic://launch/12345");
  });

  it("handles Lutris URI launch protocol", () => {
    const result = resolveUnifiedLaunch({
      executablePath: "lutris:rungame/skyrim-se",
      gameId: "skyrimse",
      isGame: true,
      store: "lutris",
    });

    expect(result.mode).toBe("lutris-uri");
    expect(result.executable).toBe("lutris:rungame/skyrim-se");
  });

  it("constructs Proton launch plan for Windows executables", () => {
    vi.spyOn(ProtonPaths, "resolve").mockReturnValue({
      prefixPath: "/steam/compatdata/489830/pfx",
      protonPath: "/steam/common/Proton 9.0",
      steamPath: "/steam",
      appId: "489830",
    } as any);

    const result = resolveUnifiedLaunch({
      commandLine: ["-skse"],
      enableProtonLogs: true,
      executablePath: "/games/Skyrim/skse64_loader.exe",
      gameId: "skyrimse",
      isGame: true,
    });

    expect(result.mode).toBe("steam-proton");
    expect(result.executable).toBe("/steam/common/Proton 9.0/proton");
    expect(result.parameters).toEqual(["run", "/games/Skyrim/skse64_loader.exe", "-skse"]);
    expect(result.environment.STEAM_COMPAT_DATA_PATH).toBe("/steam/compatdata/489830");
    expect(result.environment.PROTON_LOG).toBe("1");
    expect(result.logFilePath).toContain("proton-skyrimse.log");
  });

  it("throws ProtonUnavailable when prefix is missing", () => {
    vi.spyOn(ProtonPaths, "resolve").mockReturnValue({
      prefixPath: undefined,
      protonPath: "/steam/common/Proton 9.0",
    } as any);

    expect(() =>
      resolveUnifiedLaunch({
        executablePath: "/games/Skyrim/SkyrimSE.exe",
        gameId: "skyrimse",
        isGame: true,
      }),
    ).toThrowError();
  });
});
