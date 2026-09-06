import { describe, expect, it } from "vitest";

import {
  generateLinuxDiagnosticReport,
  inferSteamInstallType,
  redactTokensAndSecrets,
  redactUserPaths,
} from "./diagnosticReport";

describe("diagnosticReport", () => {
  it("redacts user home directory and username from paths", () => {
    const home = "/home/developer";
    const user = "developer";

    expect(redactUserPaths("/home/developer/.config/Vortex", home, user)).toBe("~/.config/Vortex");
    expect(redactUserPaths("/games/path/for/developer/data", home, user)).toBe(
      "/games/path/for/developer/data",
    );
  });

  it("redacts API keys and secrets in URLs and strings", () => {
    const secretUrl = "https://api.nexusmods.com/v1/games?apiKey=secret_key_1234567890abcdef";
    expect(redactTokensAndSecrets(secretUrl)).toContain("apiKey=[REDACTED]");

    const bearer = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
    expect(redactTokensAndSecrets(bearer)).toBe("Authorization: Bearer [REDACTED]");
  });

  it("infers Steam install types correctly", () => {
    expect(inferSteamInstallType("/home/user/.var/app/com.valvesoftware.Steam/data/Steam")).toBe(
      "flatpak",
    );
    expect(inferSteamInstallType("/home/user/snap/steam/common/.local/share/Steam")).toBe("snap");
    expect(inferSteamInstallType("/home/user/.local/share/Steam")).toBe("native");
  });

  it("generates markdown report with redacted sensitive fields", () => {
    const report = generateLinuxDiagnosticReport({
      game: {
        deploymentMethod: "hardlink",
        gameId: "skyrimse",
        gameName: "Skyrim Special Edition",
        gamePath: "/home/johndoe/Games/SkyrimSE",
        stagingPath: "/home/johndoe/Vortex Mods/skyrimse",
      },
      homeDir: "/home/johndoe",
      mounts: [
        {
          device: "/dev/sda1",
          fsType: "ext4",
          mountPoint: "/home",
          options: ["rw", "password=mount-secret"],
        },
      ],
      issues: [
        {
          code: "EACCES",
          message: "Cannot access /home/johndoe/private?token=issue-secret",
          severity: "error",
        },
      ],
      steam: {
        installType: "native",
        prefixPath: "/home/johndoe/.local/share/Steam/steamapps/compatdata/489830/pfx",
        protonRuntime: "/home/johndoe/.local/share/Steam/steamapps/common/Proton - Experimental",
        steamPath: "/home/johndoe/.local/share/Steam",
      },
      system: {
        arch: "x64",
        desktop: "KDE",
        kernel: "6.12.1-arch1-1",
        sessionType: "wayland",
      },
      userName: "johndoe",
    });

    expect(report).toContain("# Vortex Linux Diagnostic Report");
    expect(report).toContain("Skyrim Special Edition");
    expect(report).toContain("~/Games/SkyrimSE");
    expect(report).toContain("~/Vortex Mods/skyrimse");
    expect(report).not.toContain("/home/johndoe");
    expect(report).not.toContain("mount-secret");
    expect(report).not.toContain("issue-secret");
  });
});
