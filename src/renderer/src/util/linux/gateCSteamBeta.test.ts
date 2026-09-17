import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  rankAutomaticDeploymentMethods,
  type IDeploymentMethodAssessment,
} from "../../extensions/mod_management/util/deploymentRecommendation";
import {
  configurationProblems,
  detectSteamInstallationType,
  runtimePreferenceValue,
} from "../../extensions/mod_management/util/linuxSetupModel";
import { assertLinuxDestinationSafety } from "./pathSafety";
import { validateCustomProtonPath } from "./protonRuntimes";
import { resolveUnifiedLaunch } from "./unifiedLaunchProvider";

describe("Gate C — Packaged Native Steam beta verification suite", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-gate-c-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("1. Native Steam environment detection and setup assistant model", () => {
    it("identifies Native Steam installation paths", () => {
      expect(detectSteamInstallationType("/home/vhs/.steam/root")).toBe("Native");
      expect(detectSteamInstallationType("/home/vhs/.local/share/Steam")).toBe("Native");
      expect(
        detectSteamInstallationType("/home/vhs/.var/app/com.valvesoftware.Steam/data/Steam"),
      ).toBe("Flatpak");
      expect(detectSteamInstallationType("/home/vhs/snap/steam/common/.steam")).toBe("Snap");
      expect(detectSteamInstallationType(undefined)).toBe("Not detected");
    });

    it("evaluates setup assistant configuration and reports actionable issues", () => {
      // Healthy Native Steam configuration
      const healthyProblems = configurationProblems(
        [],
        "/home/vhs/.local/share/Steam/steamapps/compatdata/489830/pfx",
      );
      expect(healthyProblems).toEqual([]);

      // Missing prefix and permission issues
      const badProblems = configurationProblems(
        [
          {
            code: "permission-denied",
            message: "Data directory is read-only",
            path: "/games/Skyrim/Data",
            purpose: "game",
            severity: "error",
          },
        ],
        undefined,
        "Proton 9.0 executable not found",
      );
      expect(badProblems).toEqual([
        "ERROR: Data directory is read-only",
        "ERROR: Proton prefix was not detected.",
        "ERROR: Proton 9.0 executable not found",
      ]);
    });
  });

  describe("2. Automatic deployment method selection for Native Steam", () => {
    const createMockMethod = (id: string) =>
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

    it("selects symlinks as the safer primary choice when both methods are available", () => {
      const assessed: IDeploymentMethodAssessment[] = [
        { activator: createMockMethod("hardlink_activator"), errors: [], warnings: [] },
        { activator: createMockMethod("symlink_activator"), errors: [], warnings: [] },
      ];

      const recommendation = rankAutomaticDeploymentMethods(assessed, "linux", {
        hardlink: true,
        symlink: true,
      });

      expect(recommendation.activator?.id).toBe("symlink_activator");
      expect(recommendation.reason).toContain("safer automatic Linux choice");
    });

    it("falls back to symlinks when hardlinks are unavailable (e.g. cross-partition)", () => {
      const assessed: IDeploymentMethodAssessment[] = [
        {
          activator: createMockMethod("hardlink_activator"),
          errors: [{ description: () => "Cross-device link not permitted" }],
          warnings: [],
        },
        { activator: createMockMethod("symlink_activator"), errors: [], warnings: [] },
      ];

      const recommendation = rankAutomaticDeploymentMethods(assessed, "linux", {
        hardlink: false,
        symlink: true,
      });

      expect(recommendation.activator?.id).toBe("symlink_activator");
      expect(recommendation.reason).toContain("safer automatic Linux choice");
    });
  });

  describe("3. Runtime choices and trust boundary enforcement", () => {
    it("maps runtime preferences correctly across selection types", () => {
      expect(runtimePreferenceValue({ type: "auto" })).toBe("auto");
      expect(runtimePreferenceValue({ type: "steam-selected" })).toBe("steam-selected");
      expect(runtimePreferenceValue({ type: "experimental" })).toBe("experimental");
      expect(runtimePreferenceValue({ type: "ge-proton" })).toBe("ge-proton");
      expect(runtimePreferenceValue({ path: "/opt/custom-proton", type: "custom" })).toBe(
        "runtime:/opt/custom-proton",
      );
    });

    it("rejects custom Proton runtime located in untrusted download/staging paths", async () => {
      const stagingDir = path.join(tempDir, "staging");
      await fs.mkdir(stagingDir, { recursive: true });
      const customProton = path.join(stagingDir, "Proton-Custom");
      await fs.mkdir(customProton);
      await fs.writeFile(path.join(customProton, "proton"), "#!/bin/sh\n", { mode: 0o755 });

      const validation = validateCustomProtonPath(customProton, {
        untrustedRoots: [stagingDir],
      });

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain(
        "cannot be loaded from unsafe temporary, download, or staging content",
      );
    });
  });

  describe("4. Launch plan resolution & protocol handling for Native Steam", () => {
    it("builds valid Proton launch plan for SKSE / game executables", () => {
      const plan = resolveUnifiedLaunch({
        commandLine: ["-skse"],
        executablePath: "/games/Skyrim/skse64_loader.exe",
        gameId: "skyrimse",
        isGame: true,
        protonContext: {
          appId: "489830",
          gamePath: "/games/Skyrim",
          prefixPath: "/steam/compatdata/489830/pfx",
          protonPath: "/steam/common/Proton 9.0",
          steamPath: "/home/vhs/.local/share/Steam",
        },
      });

      expect(plan.mode).toBe("steam-proton");
      expect(plan.executable).toBe("/steam/common/Proton 9.0/proton");
      expect(plan.parameters).toEqual(["run", "/games/Skyrim/skse64_loader.exe", "-skse"]);
      expect(plan.environment.STEAM_COMPAT_DATA_PATH).toBe("/steam/compatdata/489830");
      expect(plan.environment.WINEPREFIX).toBe("/steam/compatdata/489830/pfx");
      expect(plan.environment.STEAM_COMPAT_CLIENT_INSTALL_PATH).toBe(
        "/home/vhs/.local/share/Steam",
      );
    });

    it("handles Steam protocol URIs safely and rejects injection attempts", () => {
      const validSteam = resolveUnifiedLaunch({
        executablePath: "steam://run/489830",
        gameId: "skyrimse",
        isGame: true,
      });
      expect(validSteam.mode).toBe("steam-uri");
      expect(validSteam.executable).toBe("steam://run/489830");

      expect(() =>
        resolveUnifiedLaunch({
          executablePath: "steam://run/489830; rm -rf /",
          gameId: "skyrimse",
          isGame: true,
        }),
      ).toThrowError(/Refusing to launch unsafe Steam URI/);
    });

    it("verifies deployment destination parent identity race protection during mutation", async () => {
      const managedData = path.join(tempDir, "Data");
      await fs.mkdir(managedData, { recursive: true });
      const targetPath = path.join(managedData, "Synthetic.esp");

      const initialIdentity = await assertLinuxDestinationSafety(
        managedData,
        targetPath,
        undefined,
        "linux",
      );
      expect(initialIdentity).toBeDefined();

      // Ensure verify with matching identity succeeds
      await expect(
        assertLinuxDestinationSafety(managedData, targetPath, initialIdentity, "linux"),
      ).resolves.toEqual(initialIdentity);

      // Verify TOCTOU parent substitution race is caught
      await expect(
        assertLinuxDestinationSafety(
          managedData,
          targetPath,
          { dev: initialIdentity!.dev, ino: initialIdentity!.ino + 12345 },
          "linux",
        ),
      ).rejects.toMatchObject({ code: "EDEPLOYMENTPARENTCHANGED" });
    });
  });
});
