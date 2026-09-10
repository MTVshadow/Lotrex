import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  rankAutomaticDeploymentMethods,
  type IDeploymentMethodAssessment,
} from "../../extensions/mod_management/util/deploymentRecommendation";
import { detectSteamInstallationType } from "../../extensions/mod_management/util/linuxSetupModel";
import {
  assessDesktopPortalEnvironment,
  buildPortalOpenUriCommand,
  detectDesktopEnvironment,
  detectSessionType,
  validatePortalUri,
} from "./desktopPortals";
import { generateLinuxDiagnosticReport, inferSteamInstallType } from "./diagnosticReport";
import { assessLinuxEnvironment } from "./environmentAssessment";
import { translateFilesystemError } from "./filesystemErrors";
import {
  assessFlatpakDirectoryAccess,
  getFlatpakOverrideCommand,
  isFlatpakSteam,
} from "./flatpakSupport";
import {
  assessDirectoryFileSystem,
  checkHardlinkCompatibility,
  type IMountEntry,
} from "./linuxMounts";
import {
  assessSnapDirectoryAccess,
  getSnapRemovableMediaCommand,
  isRemovableOrSecondaryPath,
  isSnapSteam,
} from "./snapSupport";
import { resolveUnifiedLaunch } from "./unifiedLaunchProvider";

const createMockDeploymentMethod = (id: string) =>
  ({
    id,
    name: id,
    priority: 1,
    isSupported: () => undefined,
    detailedDescription: () => "",
    prepare: async () => undefined,
    activate: async () => undefined,
    finalize: async () => [],
  }) as any;

describe("Gate D — Flatpak, Snap, desktop, and filesystem matrix verification suite", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-gate-d-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("1. Native, Flatpak, and Snap Steam on Wayland/X11 and KDE/GNOME matrix", () => {
    const desktopCombinations = [
      { desktop: "KDE", session: "wayland" },
      { desktop: "KDE", session: "x11" },
      { desktop: "GNOME", session: "wayland" },
      { desktop: "GNOME", session: "x11" },
    ];

    it.each(desktopCombinations)(
      "correctly evaluates desktop environment and session for %s on %s",
      ({ desktop, session }) => {
        const env = {
          XDG_CURRENT_DESKTOP: desktop,
          XDG_SESSION_TYPE: session,
        };
        expect(detectDesktopEnvironment(env)).toBe(desktop);
        expect(detectSessionType(env)).toBe(session);

        const portalInfo = assessDesktopPortalEnvironment(env);
        expect(portalInfo.desktop).toBe(desktop);
        expect(portalInfo.sessionType).toBe(session);
        if (session === "wayland") {
          expect(portalInfo.isWayland).toBe(true);
          expect(portalInfo.portalRequired).toBe(true);
          expect(portalInfo.availablePortals).toContain("org.freedesktop.portal.OpenURI");
        } else {
          expect(portalInfo.isWayland).toBe(false);
          expect(portalInfo.portalRequired).toBe(false);
        }
      },
    );

    it("identifies Native, Flatpak, and Snap Steam install types across paths", () => {
      expect(detectSteamInstallationType("/home/user/.local/share/Steam")).toBe("Native");
      expect(inferSteamInstallType("/home/user/.local/share/Steam")).toBe("native");

      expect(
        detectSteamInstallationType("/home/user/.var/app/com.valvesoftware.Steam/data/Steam"),
      ).toBe("Flatpak");
      expect(inferSteamInstallType("/home/user/.var/app/com.valvesoftware.Steam/data/Steam")).toBe(
        "flatpak",
      );

      expect(detectSteamInstallationType("/home/user/snap/steam/common/.steam")).toBe("Snap");
      expect(inferSteamInstallType("/home/user/snap/steam/common/.local/share/Steam")).toBe("snap");
    });

    it("resolves unified launch safely for Steam URI protocol across all environments", () => {
      const plan = resolveUnifiedLaunch({
        executablePath: "steam://run/489830",
        gameId: "skyrimse",
        isGame: true,
      });

      expect(plan.mode).toBe("steam-uri");
      expect(plan.executable).toBe("steam://run/489830");
      expect(plan.parameters).toEqual([]);
      expect(plan.diagnostics).toContain("Using the Steam URI protocol.");
    });

    it("generates privacy-redacted diagnostic reports with desktop and Steam details", () => {
      const report = generateLinuxDiagnosticReport({
        homeDir: "/home/testuser",
        steam: {
          installType: "flatpak",
          steamPath: "/home/testuser/.var/app/com.valvesoftware.Steam/data/Steam",
        },
        system: {
          arch: "x64",
          desktop: "KDE",
          kernel: "6.12.0-arch",
          sessionType: "wayland",
        },
        userName: "testuser",
      });

      expect(report).toContain("Desktop Environment:** KDE");
      expect(report).toContain("Session Type:** wayland");
      expect(report).toContain("Steam Type:** flatpak");
      expect(report).not.toContain("/home/testuser");
      expect(report).toContain("~/");
    });
  });

  describe("2. Secret Service & Keyring integration and privacy safeguards", () => {
    it("ensures diagnostic reports do not leak credential keys or tokens", () => {
      const report = generateLinuxDiagnosticReport({
        homeDir: "/home/testuser",
        userName: "testuser",
        system: {
          desktop: "GNOME",
          sessionType: "wayland",
          kernel: "6.12.0-arch",
          arch: "x64",
        },
      });

      expect(report).not.toContain("token");
      expect(report).not.toContain("secret");
      expect(report).not.toContain("password");
    });

    it("confirms portal environment reflects Wayland/X11 desktop session for keyring interaction", () => {
      const gnomeWayland = assessDesktopPortalEnvironment({
        XDG_CURRENT_DESKTOP: "GNOME",
        XDG_SESSION_TYPE: "wayland",
      });
      expect(gnomeWayland.desktop).toBe("GNOME");
      expect(gnomeWayland.sessionType).toBe("wayland");

      const kdeX11 = assessDesktopPortalEnvironment({
        XDG_CURRENT_DESKTOP: "KDE",
        XDG_SESSION_TYPE: "x11",
      });
      expect(kdeX11.desktop).toBe("KDE");
      expect(kdeX11.sessionType).toBe("x11");
    });
  });

  describe("3. Scoped portals, permissions, and internal/secondary/removable libraries", () => {
    it("validates safe desktop portal URI dispatching and blocks shell metacharacters", () => {
      expect(() => validatePortalUri("https://nexusmods.com")).not.toThrow();
      expect(() => validatePortalUri("steam://run/489830")).not.toThrow();

      expect(() => validatePortalUri("https://nexusmods.com; echo pwned")).toThrowError(
        /shell metacharacters/,
      );
      expect(buildPortalOpenUriCommand("https://nexusmods.com")).toBe(
        "xdg-open 'https://nexusmods.com'",
      );
    });

    describe("Flatpak library boundaries and remediation", () => {
      it("allows internal sandbox paths without reporting permission issues", () => {
        expect(isFlatpakSteam("/home/user/.var/app/com.valvesoftware.Steam/data/Steam")).toBe(true);
      });

      it("detects ungranted secondary/removable libraries and generates precise override command", () => {
        const secondaryLibrary = "/mnt/fast_ssd/SteamLibrary";
        const issue = assessFlatpakDirectoryAccess(
          secondaryLibrary,
          "/home/user/.var/app/com.valvesoftware.Steam/data/Steam",
        );

        expect(issue).toBeDefined();
        expect(issue?.code).toBe("flatpak-permission-missing");
        expect(issue?.command).toBe(
          getFlatpakOverrideCommand(secondaryLibrary, "com.valvesoftware.Steam"),
        );
        expect(issue?.command).toContain(`--filesystem='${path.resolve(secondaryLibrary)}'`);
        expect(issue?.command).not.toContain("--filesystem=host");
        expect(issue?.command).not.toContain("--filesystem=home");
      });
    });

    describe("Snap library boundaries and remediation", () => {
      it("identifies removable/secondary storage and generates snap connect command", () => {
        expect(isRemovableOrSecondaryPath("/run/media/user/External/SteamLibrary")).toBe(true);
        expect(isRemovableOrSecondaryPath("/media/user/Disk/SteamLibrary")).toBe(true);
        expect(isRemovableOrSecondaryPath("/mnt/storage/SteamLibrary")).toBe(true);
        expect(isRemovableOrSecondaryPath("/home/user/SteamLibrary")).toBe(false);

        expect(getSnapRemovableMediaCommand("steam")).toBe("snap connect 'steam':removable-media");
      });

      it("assesses Snap Steam secondary library access with actionable remediation", () => {
        const snapIssue = assessSnapDirectoryAccess(
          "/mnt/games/SteamLibrary",
          "/home/user/snap/steam/common/.steam",
        );

        expect(snapIssue).toBeDefined();
        expect(snapIssue?.code).toBe("snap-permission-missing");
        expect(snapIssue?.command).toBe("snap connect 'steam':removable-media");
        expect(snapIssue?.snapAdvice).toContain("removable-media");
      });
    });
  });

  describe("4. Filesystem matrix: ext4, btrfs subvolumes, and NTFS/exFAT safe rejection", () => {
    const MATRIX_MOUNTS: IMountEntry[] = [
      { device: "/dev/nvme0n1p2", fsType: "ext4", mountPoint: "/", options: ["rw", "relatime"] },
      {
        device: "/dev/nvme0n1p3",
        fsType: "ext4",
        mountPoint: "/home",
        options: ["rw", "relatime"],
      },
      {
        device: "/dev/sda1",
        fsType: "ext4",
        mountPoint: "/mnt/secondary",
        options: ["rw", "relatime"],
      },
      {
        device: "/dev/sdb1",
        fsType: "btrfs",
        mountPoint: "/mnt/btrfs_home",
        options: ["rw", "subvol=@home"],
      },
      {
        device: "/dev/sdb1",
        fsType: "btrfs",
        mountPoint: "/mnt/btrfs_games",
        options: ["rw", "subvol=@games"],
      },
      {
        device: "/dev/sdc1",
        fsType: "ntfs3",
        mountPoint: "/mnt/windows_drive",
        options: ["rw", "noexec", "uid=1000"],
      },
      {
        device: "/dev/sdd1",
        fsType: "exfat",
        mountPoint: "/mnt/flash_drive",
        options: ["rw", "uid=1000"],
      },
    ];

    it("ext4: recommends hardlinks when staging and game share the filesystem", () => {
      const assessed: IDeploymentMethodAssessment[] = [
        { activator: createMockDeploymentMethod("hardlink_activator"), errors: [], warnings: [] },
        { activator: createMockDeploymentMethod("symlink_activator"), errors: [], warnings: [] },
      ];

      const recommendation = rankAutomaticDeploymentMethods(assessed, "linux", {
        hardlink: true,
        symlink: true,
      });

      expect(recommendation.activator?.id).toBe("hardlink_activator");
      expect(recommendation.reason).toContain("Hardlinks are supported");
    });

    it("ext4: automatically falls back to symlinks across partition boundaries (EXDEV)", () => {
      const assessed: IDeploymentMethodAssessment[] = [
        {
          activator: createMockDeploymentMethod("hardlink_activator"),
          errors: [
            {
              description: () =>
                "The staging and game directories are on different filesystem devices (EXDEV)",
            },
          ],
          warnings: [],
        },
        { activator: createMockDeploymentMethod("symlink_activator"), errors: [], warnings: [] },
      ];

      const recommendation = rankAutomaticDeploymentMethods(assessed, "linux", {
        hardlink: false,
        symlink: true,
      });

      expect(recommendation.activator?.id).toBe("symlink_activator");
      expect(recommendation.reason).toContain(
        "Symlinks are supported; hardlink requirements were not met",
      );
    });

    it("btrfs: handles cross-subvolume boundaries where hardlinks are prohibited by the kernel (EXDEV)", () => {
      // In Linux, btrfs subvolumes have distinct anonymous st_dev values
      // Automatic ranking smoothly falls back to symlinks
      const assessed: IDeploymentMethodAssessment[] = [
        {
          activator: createMockDeploymentMethod("hardlink_activator"),
          errors: [{ description: () => "cross-device-hardlink on btrfs subvolume boundary" }],
          warnings: [],
        },
        { activator: createMockDeploymentMethod("symlink_activator"), errors: [], warnings: [] },
      ];

      const recommendation = rankAutomaticDeploymentMethods(assessed, "linux", {
        hardlink: false,
        symlink: true,
      });

      expect(recommendation.activator?.id).toBe("symlink_activator");
    });

    it("NTFS: detects non-POSIX filesystem for Proton prefix and provides clear remediation", () => {
      const issues = assessDirectoryFileSystem(
        "/mnt/windows_drive/compatdata/489830/pfx",
        "prefix",
        MATRIX_MOUNTS,
      );

      const ntfsWarning = issues.find((i) => i.code === "ntfs-prefix");
      expect(ntfsWarning).toBeDefined();
      expect(ntfsWarning?.severity).toBe("warning");
      expect(ntfsWarning?.remediation).toContain("ext4 or btrfs");
    });

    it("exFAT: safely rejects mod staging/game paths and flags hardlink incompatibility", () => {
      const stagingIssues = assessDirectoryFileSystem(
        "/mnt/flash_drive/VortexMods",
        "staging",
        MATRIX_MOUNTS,
      );

      const exfatIssue = stagingIssues.find((i) => i.code === "cross-device-hardlink");
      expect(exfatIssue).toBeDefined();
      expect(exfatIssue?.severity).toBe("error");
      expect(exfatIssue?.message).toContain("exFAT/FAT");
      expect(exfatIssue?.remediation).toContain("ext4 or btrfs");
    });

    it("translates runtime ENOTSUP / EOPNOTSUPP errors with actionable remediation", () => {
      const err = Object.assign(new Error("Operation not supported on non-POSIX filesystem"), {
        code: "ENOTSUP",
      });
      const translated = translateFilesystemError(err, {
        activeMethod: "hardlink",
        destPath: "/mnt/flash_drive/Skyrim/Data",
      });

      expect(translated.code).toBe("ENOTSUP");
      expect(translated.fallbackMethod).toBe("symlink");
      expect(translated.openSettingsAction).toBe(true);
      expect(translated.remediation).toContain("POSIX");
    });
  });
});
