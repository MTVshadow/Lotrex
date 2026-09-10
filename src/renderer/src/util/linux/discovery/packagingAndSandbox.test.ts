import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assessSandboxVisibility, detectPackagingFormat } from "./packagingAndSandbox";

describe("Unified Linux Resource Discovery — Phase 3: Packaging and Sandbox Detection", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-pkg-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("detectPackagingFormat", () => {
    it("detects Native package format for standard system and home paths", () => {
      expect(detectPackagingFormat("/usr/bin/steam").format).toBe("native");
      expect(detectPackagingFormat("/home/user/.local/share/Steam").format).toBe("native");
      expect(detectPackagingFormat("/opt/heroic/heroic").format).toBe("native");
    });

    it("detects Flatpak format based on .var/app directory or FLATPAK_ID env", () => {
      const flatpakPath = "/home/user/.var/app/com.valvesoftware.Steam/data/Steam";
      const res = detectPackagingFormat(flatpakPath);
      expect(res.format).toBe("flatpak");
      expect(res.appId).toBe("com.valvesoftware.Steam");

      const envRes = detectPackagingFormat("", { FLATPAK_ID: "com.nexusmods.vortex" });
      expect(envRes.format).toBe("flatpak");
      expect(envRes.appId).toBe("com.nexusmods.vortex");
    });

    it("detects Snap format based on snap directory or SNAP env", () => {
      const snapPath = "/home/user/snap/steam/common/.local/share/Steam";
      const res = detectPackagingFormat(snapPath);
      expect(res.format).toBe("snap");
      expect(res.appId).toBe("steam");

      const envRes = detectPackagingFormat("", { SNAP: "/snap/vortex/x1", SNAP_NAME: "vortex" });
      expect(envRes.format).toBe("snap");
      expect(envRes.appId).toBe("vortex");
    });

    it("detects AppImage format via mount path or APPIMAGE env", () => {
      expect(detectPackagingFormat("/tmp/.mount_vortexp123/usr/bin/vortex").format).toBe(
        "appimage",
      );
      expect(detectPackagingFormat("/home/user/Downloads/Vortex.AppImage").format).toBe("appimage");
      expect(detectPackagingFormat("", { APPIMAGE: "/home/user/Vortex.AppImage" }).format).toBe(
        "appimage",
      );
    });

    it("detects Nix/NixOS environment and store paths", () => {
      const nixStorePath = "/nix/store/abcdef123456-steam-run/bin/steam";
      const res = detectPackagingFormat(nixStorePath);
      expect(res.format).toBe("nix");
      expect(res.isNix).toBe(true);

      const envRes = detectPackagingFormat("", { NIX_PROFILES: "/nix/var/nix/profiles/default" });
      expect(envRes.format).toBe("nix");
      expect(envRes.isNix).toBe(true);
    });

    it("detects portable directories outside system hierarchies", () => {
      const portablePath = path.join(tempDir, "CustomGames", "VortexApp");
      expect(detectPackagingFormat(portablePath).format).toBe("portable");
    });
  });

  describe("assessSandboxVisibility", () => {
    it("reports sandbox visibility separately from path existence", () => {
      const nonExistentDrive = "/run/media/user/DriveX/SteamLibrary";
      const assessment = assessSandboxVisibility(nonExistentDrive, "flatpak", {
        appId: "com.nexusmods.vortex",
        fsCheck: () => false, // шлях фізично не існує
        accessCheck: () => false,
      });

      // Фізичне існування: false, стан видимості пісочниці: isolated
      expect(assessment.pathExists).toBe(false);
      expect(assessment.visibility).toBe("isolated");
      expect(assessment.isAccessible).toBe(false);
    });

    it("reports restricted visibility and generates flatpak override command when external drive exists but lacks permission", () => {
      const existingDrive = "/run/media/user/GamesDrive/SteamLibrary";
      const assessment = assessSandboxVisibility(existingDrive, "flatpak", {
        appId: "com.nexusmods.vortex",
        fsCheck: () => true, // диск підмонтовано і він існує
        accessCheck: () => false, // але пісочниця не має доступу
      });

      expect(assessment.pathExists).toBe(true);
      expect(assessment.visibility).toBe("restricted");
      expect(assessment.isAccessible).toBe(false);
      expect(assessment.remediation).toBeDefined();
      expect(assessment.remediation?.code).toBe("flatpak-sandbox-override-required");
      expect(assessment.remediation?.command).toContain(
        "flatpak override --user --filesystem='/run/media/user/GamesDrive/SteamLibrary' 'com.nexusmods.vortex'",
      );
    });

    it("reports direct visibility when path is inside flatpak app data", () => {
      const internalFlatpakPath = path.join(
        os.homedir(),
        ".var",
        "app",
        "com.nexusmods.vortex",
        "data",
        "mods",
      );
      const assessment = assessSandboxVisibility(internalFlatpakPath, "flatpak", {
        appId: "com.nexusmods.vortex",
        fsCheck: () => true,
        accessCheck: () => true,
      });

      expect(assessment.visibility).toBe("direct");
      expect(assessment.isAccessible).toBe(true);
      expect(assessment.remediation).toBeUndefined();
    });

    it("detects portal visibility for XDG Document Portal paths", () => {
      const portalPath = "/run/user/1000/doc/by-app/com.nexusmods.vortex/file.zip";
      const assessment = assessSandboxVisibility(portalPath, "flatpak", {
        fsCheck: () => true,
        accessCheck: () => true,
      });

      expect(assessment.visibility).toBe("portal");
      expect(assessment.pathExists).toBe(true);
      expect(assessment.isAccessible).toBe(true);
    });

    it("reports restricted visibility and snap connect remediation for inaccessible removable media", () => {
      const snapRemovablePath = "/media/user/ExternalSSD/Steam";
      const assessment = assessSandboxVisibility(snapRemovablePath, "snap", {
        appId: "vortex",
        fsCheck: () => true,
        accessCheck: () => false,
      });

      expect(assessment.visibility).toBe("restricted");
      expect(assessment.remediation?.code).toBe("snap-removable-media-required");
      expect(assessment.remediation?.command).toBe("snap connect vortex:removable-media");
    });
  });
});
