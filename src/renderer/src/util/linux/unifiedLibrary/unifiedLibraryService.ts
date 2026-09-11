import type { GameAdapterRegistry } from "../gameAdapters/adapterRegistry";
import type { IUnifiedGameInstallation } from "../gameIdentity/contracts";
import type { ILauncherLaunchRequest, LauncherType } from "../launcherProviders/contracts";
import type {
  ILibraryDiagnosticReport,
  ILibraryFilterCriteria,
  ILibraryOriginSummary,
  ILibraryRuntimeSummary,
  IUnifiedLibraryItem,
  LibrarySortKey,
} from "./contracts";
import {
  defaultFsInspector,
  DiagnosticEngine,
  type IFilesystemInspector,
} from "./diagnosticEngine";
import { DuplicateAnalyzer } from "./duplicateAnalyzer";
import { ManualCorrectionManager } from "./manualCorrectionManager";

/**
 * Unified Library Service (Phase 4).
 *
 * Orchestrates a single deduplicated library combining game identity, origins,
 * filesystem install state, runtime configurations, adapter capabilities,
 * launch availability, and non-destructive user corrections.
 */
export class UnifiedLibraryService {
  private readonly duplicateAnalyzer: DuplicateAnalyzer;
  private readonly diagnosticEngine: DiagnosticEngine;
  public readonly manualCorrections: ManualCorrectionManager;

  constructor(fsInspector: IFilesystemInspector = defaultFsInspector) {
    this.duplicateAnalyzer = new DuplicateAnalyzer();
    this.diagnosticEngine = new DiagnosticEngine(fsInspector);
    this.manualCorrections = new ManualCorrectionManager();
  }

  /**
   * Builds a single unified library item for an installation.
   */
  public buildLibraryItem(
    installation: IUnifiedGameInstallation,
    allInstallations: IUnifiedGameInstallation[],
    adapterRegistry: GameAdapterRegistry,
  ): IUnifiedLibraryItem {
    // 1. Analyze duplicate status across all installations
    const duplicateMap = this.duplicateAnalyzer.analyzeAll(allInstallations);
    const duplicateSummary = duplicateMap.get(installation.installationId) ?? {
      category: "none",
      isDuplicate: false,
      duplicateGroupKey: installation.installationId,
      duplicateIndex: 1,
      totalInGroup: 1,
      otherLocations: [],
      explanation: "Unique installation on host system.",
    };

    // 2. Fetch manual corrections without modifying launcher files
    const correctionRecord = this.manualCorrections.getCorrection(installation.installationId);
    const effectiveInst = this.manualCorrections.getEffectiveInstallation(installation);

    // 3. Map origin summaries
    const origins: ILibraryOriginSummary[] = installation.discoverySources.map((source) => ({
      launcher: source.launcher,
      storeId: source.storeId,
      storeAppId: source.storeAppId,
      installPath: source.installPath,
      prefixPath: source.prefixPath,
      confidence: source.confidence,
      discoveredAt: source.discoveredAt,
    }));

    // 4. Evaluate install state
    const installState = this.diagnosticEngine.evaluateInstallState(
      effectiveInst.installPath,
      effectiveInst.executablePath,
    );

    // 5. Build runtime summary
    const platform = effectiveInst.identity.platform;
    let runtimeName: string;
    if (platform === "linux-native") {
      runtimeName = "Native Linux";
    } else if (platform === "windows-proton") {
      runtimeName = effectiveInst.runtime ?? "Proton (Default)";
    } else {
      runtimeName = effectiveInst.runtime ?? "Wine (System)";
    }

    const runtimeSummary: ILibraryRuntimeSummary = {
      platform,
      runtimeName,
      runtimePath: effectiveInst.runtime,
      prefixPath: effectiveInst.prefixPath,
      isCustomOverride: correctionRecord?.overrides.runtime !== undefined,
    };

    // 6. Evaluate launch availability
    const launchAvailability = this.diagnosticEngine.evaluateLaunchAvailability(
      installation,
      effectiveInst.executablePath,
      effectiveInst.prefixPath,
      effectiveInst.runtime,
    );

    // 7. Evaluate adapter and mod support
    const adapterSupport = this.diagnosticEngine.evaluateModAcceptance(
      effectiveInst,
      adapterRegistry,
      effectiveInst.installPath,
    );

    // 8. Evaluate compatibility status
    const compatibilityStatus = this.diagnosticEngine.evaluateCompatibilityStatus(
      effectiveInst,
      launchAvailability,
    );

    // 9. Mod profile summary
    const activeModProfile = {
      profileId: installation.profileId,
      profileName: `Default Profile (${installation.identity.editionId})`,
      isActive: true,
      stagingPath: `${effectiveInst.installPath}/_vortex_staging`,
      activeModCount: 0,
      deploymentMethod: "hardlink" as const,
      isEnabled: adapterSupport.canAcceptMods,
    };

    // 10. Human-friendly display title
    const displayName = `${installation.identity.gameId.toUpperCase()} - ${installation.identity.editionId}`;

    return {
      id: installation.installationId,
      gameId: installation.identity.gameId,
      editionId: installation.identity.editionId,
      displayName,
      primaryInstallation: installation,
      installations: [installation],
      origins,
      installState,
      runtime: runtimeSummary,
      compatibilityStatus,
      activeModProfile,
      adapterSupport,
      launchAvailability,
      duplicateSummary,
      manualCorrection: correctionRecord,
      executablePath: effectiveInst.executablePath,
      installPath: effectiveInst.installPath,
      prefixPath: effectiveInst.prefixPath,
    };
  }

  /**
   * Constructs the full deduplicated unified library.
   */
  public buildLibrary(
    installations: IUnifiedGameInstallation[],
    adapterRegistry: GameAdapterRegistry,
  ): IUnifiedLibraryItem[] {
    return installations.map((inst) => this.buildLibraryItem(inst, installations, adapterRegistry));
  }

  /**
   * Filters library items based on multi-axis criteria.
   */
  public filterLibrary(
    items: IUnifiedLibraryItem[],
    criteria: ILibraryFilterCriteria,
  ): IUnifiedLibraryItem[] {
    return items.filter((item) => {
      // 1. Text search
      if (criteria.searchQuery && criteria.searchQuery.trim() !== "") {
        const query = criteria.searchQuery.trim().toLowerCase();
        const matchesName = item.displayName.toLowerCase().includes(query);
        const matchesGameId = item.gameId.toLowerCase().includes(query);
        const matchesEdition = item.editionId.toLowerCase().includes(query);
        const matchesPath = item.installPath.toLowerCase().includes(query);
        if (!matchesName && !matchesGameId && !matchesEdition && !matchesPath) {
          return false;
        }
      }

      // 2. Launcher filter
      if (criteria.launcherFilter && criteria.launcherFilter !== "all") {
        const hasLauncher = item.origins.some((o) => o.launcher === criteria.launcherFilter);
        if (!hasLauncher) return false;
      }

      // 3. Runtime platform filter
      if (criteria.runtimeFilter && criteria.runtimeFilter !== "all") {
        if (item.runtime.platform !== criteria.runtimeFilter) return false;
      }

      // 4. Support level filter
      if (criteria.supportLevelFilter && criteria.supportLevelFilter !== "all") {
        if (item.adapterSupport.supportLevel !== criteria.supportLevelFilter) {
          return false;
        }
      }

      // 5. Launch status filter
      if (criteria.launchStatusFilter && criteria.launchStatusFilter !== "all") {
        const wantsLaunchable = criteria.launchStatusFilter === "canLaunch";
        if (item.launchAvailability.canLaunch !== wantsLaunchable) return false;
      }

      // 6. Mod readiness filter
      if (criteria.modReadinessFilter && criteria.modReadinessFilter !== "all") {
        const wantsModReady = criteria.modReadinessFilter === "ready";
        if (item.adapterSupport.canAcceptMods !== wantsModReady) return false;
      }

      // 7. Duplicate filter
      if (criteria.duplicateFilter && criteria.duplicateFilter !== "all") {
        if (criteria.duplicateFilter === "duplicates-only") {
          if (!item.duplicateSummary.isDuplicate) return false;
        } else if (criteria.duplicateFilter === "unique-only") {
          if (item.duplicateSummary.isDuplicate) return false;
        }
      }

      // 8. Install state filter
      if (criteria.installStateFilter && criteria.installStateFilter !== "all") {
        if (criteria.installStateFilter === "installed") {
          if (item.installState !== "installed") return false;
        } else if (criteria.installStateFilter === "missing") {
          if (item.installState === "installed") return false;
        }
      }

      return true;
    });
  }

  /**
   * Sorts unified library items.
   */
  public sortLibrary(
    items: IUnifiedLibraryItem[],
    sortKey: LibrarySortKey = "name",
    ascending = true,
  ): IUnifiedLibraryItem[] {
    const sorted = [...items].sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case "name":
          comparison = a.displayName.localeCompare(b.displayName);
          break;
        case "origin": {
          const origA = a.origins[0]?.launcher ?? "";
          const origB = b.origins[0]?.launcher ?? "";
          comparison = origA.localeCompare(origB);
          break;
        }
        case "runtime":
          comparison = a.runtime.platform.localeCompare(b.runtime.platform);
          break;
        case "supportLevel":
          comparison = a.adapterSupport.supportLevel.localeCompare(b.adapterSupport.supportLevel);
          break;
        case "launchStatus":
          comparison =
            Number(b.launchAvailability.canLaunch) - Number(a.launchAvailability.canLaunch);
          break;
        case "installState":
          comparison = a.installState.localeCompare(b.installState);
          break;
      }
      return ascending ? comparison : -comparison;
    });

    return sorted;
  }

  /**
   * Produces a full explainable diagnostic report for an item.
   */
  public getDiagnosticReport(item: IUnifiedLibraryItem): ILibraryDiagnosticReport {
    return this.diagnosticEngine.generateDiagnosticReport(
      item.primaryInstallation,
      item.launchAvailability,
      item.adapterSupport,
    );
  }

  /**
   * Generates a normalized launch request from a library item, incorporating
   * any active manual correction overrides and custom launch arguments.
   */
  public getEffectiveLaunchRequest(item: IUnifiedLibraryItem): ILauncherLaunchRequest {
    const launcher: LauncherType =
      item.primaryInstallation.identity.owningLauncher === "standalone"
        ? "manual"
        : (item.primaryInstallation.identity.owningLauncher as LauncherType);

    const isWindows =
      item.runtime.platform === "windows-proton" || item.runtime.platform === "windows-wine";

    const customArgs = item.manualCorrection?.overrides.customLaunchArgs;
    const customEnv = item.manualCorrection?.overrides.customEnvironment;

    return {
      launcher,
      gameId: item.gameId,
      editionId: item.editionId,
      installPath: item.installPath,
      executablePath: item.executablePath,
      isWindows,
      commandLine: customArgs,
      workingDirectory: item.installPath,
      environment: customEnv,
      prefixPath: item.prefixPath,
      runtimePath: item.runtime.runtimePath,
      appId:
        item.primaryInstallation.identity.storeAppId ??
        item.origins.find((o) => o.storeAppId !== undefined)?.storeAppId,
    };
  }
}
