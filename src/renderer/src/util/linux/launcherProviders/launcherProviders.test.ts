import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { type ILauncherLaunchRequest, type ILaunchPlan } from "./contracts";
import { buildNormalizedLaunchPlan, LauncherProviderRegistry } from "./launcherRegistry";

describe("Launcher/Provider Boundary (Phase 3)", () => {
  const nativeReferenceGame: ILauncherLaunchRequest = {
    launcher: "steam",
    gameId: "portal2",
    installPath: "/home/user/.steam/steam/steamapps/common/Portal 2",
    executablePath: "/home/user/.steam/steam/steamapps/common/Portal 2/portal2_linux",
    isWindows: false,
    commandLine: ["-novid", "-language", "english"],
    appId: "620",
  };

  const windowsReferenceGame: ILauncherLaunchRequest = {
    launcher: "steam",
    gameId: "skyrimse",
    installPath: "/home/user/.steam/steam/steamapps/common/Skyrim Special Edition",
    executablePath: "/home/user/.steam/steam/steamapps/common/Skyrim Special Edition/SkyrimSE.exe",
    isWindows: true,
    commandLine: ["-skipintro"],
    prefixPath: "/home/user/.steam/steam/steamapps/compatdata/489830/pfx",
    runtimePath: "/home/user/.steam/steam/steamapps/common/Proton 9.0",
    appId: "489830",
  };

  it("normalizes identical UI launch requests for native reference game", async () => {
    const plan: ILaunchPlan = await buildNormalizedLaunchPlan(nativeReferenceGame);

    expect(plan.launcher).toBe("steam");
    expect(plan.executable).toBe(nativeReferenceGame.executablePath);
    expect(plan.arguments).toEqual(["-novid", "-language", "english"]);
    expect(plan.workingDirectory).toBe(nativeReferenceGame.installPath);
    expect(plan.environment.SteamAppId).toBe("620");
    expect(plan.explanation).toContain("Launching native Linux binary");
    expect(plan.isDryRunSafe).toBe(true);
  });

  it("normalizes identical UI launch requests for Windows reference game through Proton", async () => {
    const plan: ILaunchPlan = await buildNormalizedLaunchPlan(windowsReferenceGame);

    expect(plan.launcher).toBe("steam");
    expect(plan.executable).toBe(path.join(windowsReferenceGame.runtimePath!, "proton"));
    expect(plan.arguments).toEqual(["run", windowsReferenceGame.executablePath, "-skipintro"]);
    expect(plan.environment.WINEPREFIX).toBe(windowsReferenceGame.prefixPath);
    expect(plan.explanation).toContain("Proton runtime");
    expect(plan.explanation).toContain("489830");
  });

  it("supports Heroic launcher provider for Windows and native games", async () => {
    const heroicReq: ILauncherLaunchRequest = {
      launcher: "heroic",
      gameId: "witcher3",
      installPath: "/home/user/Games/Heroic/TheWitcher3",
      executablePath: "/home/user/Games/Heroic/TheWitcher3/bin/x64/witcher3.exe",
      isWindows: true,
      commandLine: ["-force-d3d11"],
      prefixPath: "/home/user/Games/Heroic/Prefixes/TheWitcher3",
      runtimePath: "/usr/bin/wine",
    };

    const plan = await buildNormalizedLaunchPlan(heroicReq);
    expect(plan.launcher).toBe("heroic");
    expect(plan.executable).toBe("/usr/bin/wine");
    expect(plan.arguments).toEqual([heroicReq.executablePath, "-force-d3d11"]);
    expect(plan.environment.WINEPREFIX).toBe(heroicReq.prefixPath);
    expect(plan.explanation).toContain("Heroic game 'witcher3'");
  });

  it("supports Lutris launcher provider", async () => {
    const lutrisReq: ILauncherLaunchRequest = {
      launcher: "lutris",
      gameId: "cyberpunk2077",
      installPath: "/home/user/Games/lutris/cyberpunk-2077",
      executablePath: "/home/user/Games/lutris/cyberpunk-2077/bin/x64/Cyberpunk2077.exe",
      isWindows: true,
      prefixPath: "/home/user/Games/lutris/cyberpunk-2077/prefix",
      runtimePath: "/home/user/.local/share/lutris/runners/wine/wine-ge-8-26",
    };

    const plan = await buildNormalizedLaunchPlan(lutrisReq);
    expect(plan.launcher).toBe("lutris");
    expect(plan.environment.WINEPREFIX).toBe(lutrisReq.prefixPath);
    expect(plan.explanation).toContain("Lutris game 'cyberpunk2077'");
  });

  it("supports Bottles launcher provider via bottles-cli", async () => {
    const bottlesReq: ILauncherLaunchRequest = {
      launcher: "bottles",
      gameId: "skyrim_bottle",
      bottleName: "GamingBottle",
      installPath:
        "/home/user/.var/app/com.usebottles.bottles/data/bottles/bottles/GamingBottle/drive_c/Games/Skyrim",
      executablePath:
        "/home/user/.var/app/com.usebottles.bottles/data/bottles/bottles/GamingBottle/drive_c/Games/Skyrim/TESV.exe",
      isWindows: true,
      commandLine: ["-windowed"],
    };

    const plan = await buildNormalizedLaunchPlan(bottlesReq);
    expect(plan.launcher).toBe("bottles");
    expect(plan.executable).toBe("/usr/bin/bottles-cli");
    expect(plan.arguments).toEqual([
      "run",
      "-b",
      "GamingBottle",
      "-e",
      bottlesReq.executablePath,
      "--args",
      "-windowed",
    ]);
    expect(plan.explanation).toContain("GamingBottle");
  });

  it("supports Manual / Standalone launcher provider", async () => {
    const manualReq: ILauncherLaunchRequest = {
      launcher: "manual",
      gameId: "indie_native_game",
      installPath: "/opt/indie_game",
      executablePath: "/opt/indie_game/start.sh",
      isWindows: false,
    };

    const plan = await buildNormalizedLaunchPlan(manualReq);
    expect(plan.launcher).toBe("manual");
    expect(plan.executable).toBe("/opt/indie_game/start.sh");
    expect(plan.explanation).toContain("manual standalone native Linux game");
  });

  it("verifies launcher providers do not own mod semantics", async () => {
    const registry = new LauncherProviderRegistry();
    const providers = ["steam", "heroic", "lutris", "bottles", "manual"] as const;

    for (const launcher of providers) {
      const p = registry.getProvider(launcher);
      expect(p).toBeDefined();
      // Providers only implement generateLaunchPlan, without exposing mod directories, staging, or deployment
      expect((p as any).queryModPath).toBeUndefined();
      expect((p as any).deployMods).toBeUndefined();
      expect((p as any).stagingPath).toBeUndefined();
    }
  });

  it("rejects arguments containing null bytes or newline injections", async () => {
    const maliciousReq: ILauncherLaunchRequest = {
      launcher: "steam",
      gameId: "malicious_test",
      installPath: "/tmp",
      executablePath: "/tmp/game",
      isWindows: false,
      commandLine: ["arg1", "arg2\0injected"],
    };

    await expect(buildNormalizedLaunchPlan(maliciousReq)).rejects.toThrow(
      /forbidden control characters/,
    );
  });
});
