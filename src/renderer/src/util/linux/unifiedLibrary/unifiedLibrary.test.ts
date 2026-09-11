import { describe, expect, it } from "vitest";

import { GameAdapterRegistry } from "../gameAdapters/adapterRegistry";
import type { IGameAdapter } from "../gameAdapters/contracts";
import { ReferenceGameAdapter } from "../gameAdapters/referenceAdapter";
import type { IDiscoverySourceRecord, IUnifiedGameInstallation } from "../gameIdentity/contracts";
import type { IFilesystemInspector } from "./diagnosticEngine";
import { DuplicateAnalyzer } from "./duplicateAnalyzer";
import { ManualCorrectionManager } from "./manualCorrectionManager";
import { UnifiedLibraryService } from "./unifiedLibraryService";

/**
 * Mock filesystem inspector for deterministic testing.
 */
class MockFsInspector implements IFilesystemInspector {
  private existingPaths = new Set<string>();
  private writablePaths = new Set<string>();
  private executablePaths = new Set<string>();

  constructor(paths: { existing?: string[]; writable?: string[]; executable?: string[] }) {
    paths.existing?.forEach((p) => this.existingPaths.add(p));
    paths.writable?.forEach((p) => this.writablePaths.add(p));
    paths.executable?.forEach((p) => this.executablePaths.add(p));
  }

  public existsSync(targetPath: string): boolean {
    return this.existingPaths.has(targetPath);
  }

  public isWritableSync(targetPath: string): boolean {
    return this.writablePaths.has(targetPath);
  }

  public isExecutableSync(targetPath: string): boolean {
    return this.executablePaths.has(targetPath);
  }

  public addPath(targetPath: string, options: { writable?: boolean; executable?: boolean } = {}) {
    this.existingPaths.add(targetPath);
    if (options.writable !== false) this.writablePaths.add(targetPath);
    if (options.executable !== false) this.executablePaths.add(targetPath);
  }

  public removePath(targetPath: string) {
    this.existingPaths.delete(targetPath);
    this.writablePaths.delete(targetPath);
    this.executablePaths.delete(targetPath);
  }
}

describe("Unified Library Domain & Service (Phase 4)", () => {
  const createMockInstallation = (
    id: string,
    gameId: string,
    editionId: string,
    installPath: string,
    executablePath: string,
    platform: "linux-native" | "windows-proton" | "windows-wine" = "windows-proton",
    sources: IDiscoverySourceRecord[] = [],
    prefixPath?: string,
    runtime?: string,
  ): IUnifiedGameInstallation => ({
    installationId: id,
    identity: {
      gameId,
      editionId,
      platform,
      storeId: "steam",
      owningLauncher: sources[0]?.launcher ?? "steam",
      executable: "game.exe",
      adapterVersion: "1.0.0",
    },
    installPath,
    executablePath,
    prefixPath,
    runtime,
    discoverySources:
      sources.length > 0
        ? sources
        : [
            {
              launcher: "steam",
              storeId: "steam",
              installPath,
              prefixPath,
              confidence: "confirmed",
              discoveredAt: 1700000000,
            },
          ],
    lastSeenTimestamp: 1700000000,
    profileId: `profile_${id}`,
  });

  describe("DuplicateAnalyzer", () => {
    it("identifies multi-launcher alias for the exact same filesystem path", () => {
      const analyzer = new DuplicateAnalyzer();
      const sources: IDiscoverySourceRecord[] = [
        {
          launcher: "steam",
          storeId: "steam",
          installPath: "/games/cyberpunk",
          confidence: "confirmed",
          discoveredAt: 1,
        },
        {
          launcher: "heroic",
          storeId: "gog",
          installPath: "/games/cyberpunk",
          confidence: "confirmed",
          discoveredAt: 2,
        },
      ];

      const inst = createMockInstallation(
        "inst1",
        "cyberpunk2077",
        "standard",
        "/games/cyberpunk",
        "/games/cyberpunk/bin/Cyberpunk2077.exe",
        "windows-proton",
        sources,
      );

      const map = analyzer.analyzeAll([inst]);
      const result = map.get("inst1");

      expect(result).toBeDefined();
      expect(result?.category).toBe("multi-launcher");
      expect(result?.isDuplicate).toBe(true);
      expect(result?.explanation).toContain(
        "Same physical installation tracked by multiple launchers (steam, heroic)",
      );
    });

    it("distinguishes multiple physical installations of the same game and edition across different disks", () => {
      const analyzer = new DuplicateAnalyzer();
      const instA = createMockInstallation(
        "inst-ssd",
        "skyrimse",
        "special-edition",
        "/mnt/nvme/games/SkyrimSE",
        "/mnt/nvme/games/SkyrimSE/SkyrimSE.exe",
      );
      const instB = createMockInstallation(
        "inst-hdd",
        "skyrimse",
        "special-edition",
        "/mnt/storage/games/SkyrimSE",
        "/mnt/storage/games/SkyrimSE/SkyrimSE.exe",
      );

      const map = analyzer.analyzeAll([instA, instB]);
      const summaryA = map.get("inst-ssd");
      const summaryB = map.get("inst-hdd");

      expect(summaryA?.category).toBe("multi-install");
      expect(summaryA?.isDuplicate).toBe(true);
      expect(summaryA?.duplicateIndex).toBe(1);
      expect(summaryA?.totalInGroup).toBe(2);
      expect(summaryA?.otherLocations).toContain("/mnt/storage/games/SkyrimSE (steam)");

      expect(summaryB?.category).toBe("multi-install");
      expect(summaryB?.duplicateIndex).toBe(2);
      expect(summaryB?.otherLocations).toContain("/mnt/nvme/games/SkyrimSE (steam)");
    });

    it("separates and isolates distinct game editions of the same franchise", () => {
      const analyzer = new DuplicateAnalyzer();
      const instStandard = createMockInstallation(
        "inst-std",
        "skyrim",
        "standard",
        "/games/Skyrim_Old",
        "/games/Skyrim_Old/TESV.exe",
      );
      const instSE = createMockInstallation(
        "inst-se",
        "skyrim",
        "special-edition",
        "/games/Skyrim_SE",
        "/games/Skyrim_SE/SkyrimSE.exe",
      );

      const map = analyzer.analyzeAll([instStandard, instSE]);
      const summaryStd = map.get("inst-std");
      const summarySE = map.get("inst-se");

      expect(summaryStd?.category).toBe("distinct-edition");
      expect(summaryStd?.isDuplicate).toBe(false);
      expect(summaryStd?.explanation).toContain(
        "Distinct edition 'standard' of skyrim. Kept strictly isolated",
      );

      expect(summarySE?.category).toBe("distinct-edition");
      expect(summarySE?.isDuplicate).toBe(false);
      expect(summarySE?.explanation).toContain(
        "Distinct edition 'special-edition' of skyrim. Kept strictly isolated",
      );
    });
  });

  describe("ManualCorrectionManager", () => {
    it("applies user overrides without mutating raw launcher discovery sources", () => {
      const manager = new ManualCorrectionManager();
      const inst = createMockInstallation(
        "inst-skyrim",
        "skyrimse",
        "special-edition",
        "/games/SkyrimSE",
        "/games/SkyrimSE/SkyrimSE.exe",
        "windows-proton",
        undefined,
        "/games/SkyrimSE/pfx",
        "Proton 8.0",
      );

      // Verify original sources snapshot
      const originalSourcesCount = inst.discoverySources.length;

      manager.applyCorrection(
        inst,
        {
          executablePath: "/games/SkyrimSE/skse64_loader.exe",
          runtime: "GE-Proton9-11",
          customLaunchArgs: ["-novid", "+fps_max 120"],
        },
        "Using SKSE loader instead of launcher",
      );

      expect(manager.hasOverrides("inst-skyrim")).toBe(true);
      const effective = manager.getEffectiveInstallation(inst);

      expect(effective.executablePath).toBe("/games/SkyrimSE/skse64_loader.exe");
      expect(effective.runtime).toBe("GE-Proton9-11");
      // INVARIANT: Discovered source records remain intact
      expect(effective.discoverySources.length).toBe(originalSourcesCount);
      expect(inst.executablePath).toBe("/games/SkyrimSE/SkyrimSE.exe"); // Original unmutated
    });

    it("generates side-by-side audit and detects divergence if underlying launcher moves", () => {
      const manager = new ManualCorrectionManager();
      const inst = createMockInstallation(
        "inst-1",
        "witcher3",
        "goty",
        "/games/Witcher3",
        "/games/Witcher3/bin/witcher3.exe",
      );

      manager.applyCorrection(inst, {
        executablePath: "/games/Witcher3/bin/custom_witcher3.exe",
      });

      // No divergence initially
      let audit = manager.getAudit(inst);
      expect(audit.hasOverrides).toBe(true);
      expect(audit.divergenceDetected).toBe(false);

      const execField = audit.fields.find((f) => f.fieldName === "executablePath");
      expect(execField?.discoveredValue).toBe("/games/Witcher3/bin/witcher3.exe");
      expect(execField?.correctedValue).toBe("/games/Witcher3/bin/custom_witcher3.exe");
      expect(execField?.isOverridden).toBe(true);

      // Simulate launcher relocating game files on disk
      const relocatedInst: IUnifiedGameInstallation = {
        ...inst,
        installPath: "/mnt/storage/Witcher3",
        executablePath: "/mnt/storage/Witcher3/bin/witcher3.exe",
      };

      audit = manager.getAudit(relocatedInst);
      expect(audit.divergenceDetected).toBe(true);
      expect(audit.divergenceMessage).toContain("Launcher source data changed on disk");
    });

    it("reverts corrections completely back to discovered launcher data", () => {
      const manager = new ManualCorrectionManager();
      const inst = createMockInstallation(
        "inst-1",
        "witcher3",
        "goty",
        "/games/Witcher3",
        "/games/Witcher3/bin/witcher3.exe",
      );

      manager.applyCorrection(inst, { executablePath: "/custom.exe" });
      expect(manager.hasOverrides("inst-1")).toBe(true);

      const reverted = manager.revertCorrection("inst-1");
      expect(reverted).toBe(true);
      expect(manager.hasOverrides("inst-1")).toBe(false);

      const effective = manager.getEffectiveInstallation(inst);
      expect(effective.executablePath).toBe("/games/Witcher3/bin/witcher3.exe");
    });
  });

  describe("DiagnosticEngine and Mod Readiness Rules", () => {
    it("reports launch blocked when primary executable is missing", () => {
      const mockFs = new MockFsInspector({
        existing: ["/games/SkyrimSE", "/games/SkyrimSE/pfx"],
        writable: ["/games/SkyrimSE"],
      });

      const service = new UnifiedLibraryService(mockFs);
      const registry = new GameAdapterRegistry();
      const inst = createMockInstallation(
        "inst-1",
        "skyrimse",
        "special-edition",
        "/games/SkyrimSE",
        "/games/SkyrimSE/SkyrimSE.exe",
        "windows-proton",
        undefined,
        "/games/SkyrimSE/pfx",
        "Proton 9.0",
      );

      const item = service.buildLibraryItem(inst, [inst], registry);
      expect(item.launchAvailability.canLaunch).toBe(false);
      expect(item.launchAvailability.blockingReasons[0]).toContain(
        "Primary executable does not exist",
      );
      expect(item.compatibilityStatus.status).toBe("missing-executable");
    });

    it("reports launch blocked when Proton prefix is missing for Windows game", () => {
      const mockFs = new MockFsInspector({
        existing: ["/games/SkyrimSE", "/games/SkyrimSE/SkyrimSE.exe"],
        writable: ["/games/SkyrimSE"],
      });

      const service = new UnifiedLibraryService(mockFs);
      const registry = new GameAdapterRegistry();
      const inst = createMockInstallation(
        "inst-1",
        "skyrimse",
        "special-edition",
        "/games/SkyrimSE",
        "/games/SkyrimSE/SkyrimSE.exe",
        "windows-proton",
        undefined,
        undefined, // Missing prefix
        "Proton 9.0",
      );

      const item = service.buildLibraryItem(inst, [inst], registry);
      expect(item.launchAvailability.canLaunch).toBe(false);
      expect(item.launchAvailability.blockingReasons[0]).toContain("Wine/Proton prefix is missing");
      expect(item.compatibilityStatus.status).toBe("needs-prefix");
    });

    it("reports mod support as unsupported when NO adapter is registered (Scope Rule)", () => {
      const mockFs = new MockFsInspector({
        existing: ["/games/SkyrimSE", "/games/SkyrimSE/SkyrimSE.exe", "/games/SkyrimSE/pfx"],
        writable: ["/games/SkyrimSE"],
      });

      const service = new UnifiedLibraryService(mockFs);
      const emptyRegistry = new GameAdapterRegistry();
      const inst = createMockInstallation(
        "inst-1",
        "unsupported_game",
        "standard",
        "/games/SkyrimSE",
        "/games/SkyrimSE/SkyrimSE.exe",
        "windows-proton",
        undefined,
        "/games/SkyrimSE/pfx",
        "Proton 9.0",
      );

      const item = service.buildLibraryItem(inst, [inst], emptyRegistry);

      // CRITICAL SCOPE & SAFETY RULE:
      // Never advertise a discovered game as mod-supported unless a compatible game adapter is active.
      expect(item.adapterSupport.canAcceptMods).toBe(false);
      expect(item.adapterSupport.supportLevel).toBe("unsupported");
      expect(item.adapterSupport.modRejectionReason).toContain(
        "No compatible game adapter is registered for game 'unsupported_game'",
      );
    });

    it("reports mod support blocked when adapter declares mod-types as unsupported", () => {
      const mockFs = new MockFsInspector({
        existing: ["/games/RefGame", "/games/RefGame/refgame.exe", "/games/RefGame/pfx"],
        writable: ["/games/RefGame"],
      });

      const service = new UnifiedLibraryService(mockFs);
      const registry = new GameAdapterRegistry();

      // Create adapter declaring mod-types unsupported
      const adapter = new ReferenceGameAdapter({ targetGameId: "reference-linux-game" });
      const customAdapter: IGameAdapter = {
        manifest: {
          ...adapter.manifest,
          capabilities: {
            ...adapter.manifest.capabilities,
            "mod-types": {
              kind: "mod-types",
              version: "1.0.0",
              supported: false,
              unsupportedReason: "Encrypted PAK archives cannot be unpacked or redirected.",
            },
          },
        },
        hasCapability(kind) {
          return this.manifest.capabilities[kind]?.supported ?? false;
        },
        getCapability(kind) {
          return this.manifest.capabilities[kind];
        },
      };

      registry.registerAdapter(customAdapter);

      const inst = createMockInstallation(
        "inst-ref",
        "reference-linux-game",
        "special-edition",
        "/games/RefGame",
        "/games/RefGame/refgame.exe",
        "windows-proton",
        undefined,
        "/games/RefGame/pfx",
        "Proton 9.0",
      );

      const item = service.buildLibraryItem(inst, [inst], registry);
      expect(item.adapterSupport.canAcceptMods).toBe(false);
      expect(item.adapterSupport.modRejectionReason).toContain(
        "Adapter declared 'mod-types' capability as unsupported",
      );
      expect(item.adapterSupport.modRejectionReason).toContain(
        "Encrypted PAK archives cannot be unpacked",
      );
    });

    it("verifies ready status when all launch and adapter criteria pass", () => {
      const mockFs = new MockFsInspector({
        existing: ["/games/RefGame", "/games/RefGame/refgame.exe", "/games/RefGame/pfx"],
        writable: ["/games/RefGame"],
      });

      const service = new UnifiedLibraryService(mockFs);
      const registry = new GameAdapterRegistry();
      registry.registerAdapter(new ReferenceGameAdapter({ targetGameId: "reference-linux-game" }));

      const inst = createMockInstallation(
        "inst-ref",
        "reference-linux-game",
        "special-edition",
        "/games/RefGame",
        "/games/RefGame/refgame.exe",
        "windows-proton",
        undefined,
        "/games/RefGame/pfx",
        "Proton 9.0",
      );

      const item = service.buildLibraryItem(inst, [inst], registry);

      expect(item.launchAvailability.canLaunch).toBe(true);
      expect(item.adapterSupport.canAcceptMods).toBe(true);
      expect(item.adapterSupport.supportLevel).toBe("community-tested");
      expect(item.compatibilityStatus.status).toBe("ready");

      // Verify diagnostic report
      const report = service.getDiagnosticReport(item);
      expect(report.canLaunch).toBe(true);
      expect(report.canAcceptMods).toBe(true);
      expect(report.checks.every((c) => c.passed)).toBe(true);
    });
  });

  describe("Library Filtering and Effective Launch Requests", () => {
    it("filters library items across multiple orthogonal criteria", () => {
      const mockFs = new MockFsInspector({
        existing: ["/g1", "/g1/e.exe", "/g1/pfx", "/g2", "/g2/e.exe", "/g2/pfx"],
        writable: ["/g1", "/g2"],
      });

      const service = new UnifiedLibraryService(mockFs);
      const registry = new GameAdapterRegistry();
      registry.registerAdapter(new ReferenceGameAdapter({ targetGameId: "reference-linux-game" }));

      const inst1 = createMockInstallation(
        "1",
        "reference-linux-game",
        "special-edition",
        "/g1",
        "/g1/e.exe",
        "windows-proton",
        [
          {
            launcher: "steam",
            storeId: "steam",
            installPath: "/g1",
            confidence: "confirmed",
            discoveredAt: 1,
          },
        ],
        "/g1/pfx",
        "Proton 9.0",
      );

      const inst2 = createMockInstallation(
        "2",
        "native-sim",
        "standard",
        "/g2",
        "/g2/e.exe",
        "linux-native",
        [
          {
            launcher: "heroic",
            storeId: "gog",
            installPath: "/g2",
            confidence: "confirmed",
            discoveredAt: 1,
          },
        ],
      );

      const items = service.buildLibrary([inst1, inst2], registry);

      // Filter by launcher: steam
      const steamItems = service.filterLibrary(items, { launcherFilter: "steam" });
      expect(steamItems.length).toBe(1);
      expect(steamItems[0].id).toBe("1");

      // Filter by launcher: heroic
      const heroicItems = service.filterLibrary(items, { launcherFilter: "heroic" });
      expect(heroicItems.length).toBe(1);
      expect(heroicItems[0].id).toBe("2");

      // Filter by runtime: linux-native
      const nativeItems = service.filterLibrary(items, { runtimeFilter: "linux-native" });
      expect(nativeItems.length).toBe(1);
      expect(nativeItems[0].id).toBe("2");

      // Filter by mod support: community-tested
      const communityItems = service.filterLibrary(items, {
        supportLevelFilter: "community-tested",
      });
      expect(communityItems.length).toBe(1);
      expect(communityItems[0].id).toBe("1");
    });

    it("generates effective launch requests incorporating manual overrides without touching launcher data", () => {
      const mockFs = new MockFsInspector({
        existing: ["/g1", "/g1/e.exe", "/g1/pfx"],
        writable: ["/g1"],
      });

      const service = new UnifiedLibraryService(mockFs);
      const registry = new GameAdapterRegistry();

      const inst = createMockInstallation(
        "1",
        "reference-linux-game",
        "special-edition",
        "/g1",
        "/g1/e.exe",
        "windows-proton",
        [
          {
            launcher: "steam",
            storeId: "steam",
            installPath: "/g1",
            confidence: "confirmed",
            discoveredAt: 1,
            storeAppId: "489830",
          },
        ],
        "/g1/pfx",
        "Proton 9.0",
      );

      service.manualCorrections.applyCorrection(inst, {
        customLaunchArgs: ["-novid", "-nojoy"],
        customEnvironment: { WINEDLLOVERRIDES: "dinput8=n,b" },
      });

      const item = service.buildLibraryItem(inst, [inst], registry);
      const req = service.getEffectiveLaunchRequest(item);

      expect(req.launcher).toBe("steam");
      expect(req.appId).toBe("489830");
      expect(req.commandLine).toEqual(["-novid", "-nojoy"]);
      expect(req.environment).toEqual({ WINEDLLOVERRIDES: "dinput8=n,b" });
      expect(req.isWindows).toBe(true);
    });
  });
});
