import type { GamePlatform, GameStoreId } from "../gameIdentity/contracts";
import {
  buildCatalogKeyId,
  checkPromotionEligibility,
  evaluateSupportTier,
} from "./catalogEvaluator";
import type {
  GameSupportTier,
  ICatalogFilter,
  IEvaluatedSupportTier,
  ILifecycleEvidence,
  IPromotionEligibility,
  ISupportCatalogKey,
  ISupportCatalogRecord,
} from "./contracts";

/**
 * In-memory and serializable game support catalog.
 *
 * Implements Phase 9 acceptance criteria:
 * Tracks 'experimental', 'community-tested', and 'supported' per game/edition/store/runtime.
 * Automatic staleness downgrade and reproducible evidence-driven promotion.
 */
export class GameSupportCatalog {
  private readonly records = new Map<string, ISupportCatalogRecord>();

  constructor(initialRecords: ISupportCatalogRecord[] = []) {
    for (const record of initialRecords) {
      this.registerRecord(record);
    }
  }

  /**
   * Registers or updates a catalog entry keyed by composite game/edition/store/runtime tuple.
   */
  public registerRecord(record: ISupportCatalogRecord): void {
    const keyId = buildCatalogKeyId(
      record.gameId,
      record.editionId,
      record.storeId,
      record.platform,
    );
    const normalizedRecord: ISupportCatalogRecord = {
      ...record,
      id: keyId,
      staleAfterDays: record.staleAfterDays || 90,
      evidenceHistory: [...(record.evidenceHistory || [])],
      knownLimitations: [...(record.knownLimitations || [])],
      distroMatrix: [...(record.distroMatrix || [])],
      deploymentMatrix: [...(record.deploymentMatrix || [])],
    };
    this.records.set(keyId, normalizedRecord);
  }

  /**
   * Looks up a record by its composite key.
   */
  public getRecord(key: ISupportCatalogKey): ISupportCatalogRecord | undefined {
    const keyId = buildCatalogKeyId(key.gameId, key.editionId, key.storeId, key.platform);
    return this.records.get(keyId);
  }

  /**
   * Looks up a record by its raw composite ID.
   */
  public getRecordById(id: string): ISupportCatalogRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Evaluates the support tier for a record, checking staleness and reproducible criteria.
   */
  public evaluateRecord(
    keyOrId: ISupportCatalogKey | string,
    currentDate: Date = new Date(),
  ): IEvaluatedSupportTier | undefined {
    const record =
      typeof keyOrId === "string" ? this.getRecordById(keyOrId) : this.getRecord(keyOrId);
    if (!record) {
      return undefined;
    }
    return evaluateSupportTier(record, currentDate);
  }

  /**
   * Submits fresh reproducible lifecycle evidence.
   * Updates lastVerificationDate, appends to evidence history, and optionally promotes declared tier.
   */
  public submitEvidence(
    key: ISupportCatalogKey,
    evidence: ILifecycleEvidence,
    promoteToTier?: GameSupportTier,
    currentDate: Date = new Date(),
  ): {
    accepted: boolean;
    promotion?: IPromotionEligibility;
    newEffectiveTier: GameSupportTier;
    reason?: string;
  } {
    const record = this.getRecord(key);
    if (!record) {
      return {
        accepted: false,
        newEffectiveTier: "unsupported",
        reason: `Catalog record not found for key '${buildCatalogKeyId(key.gameId, key.editionId, key.storeId, key.platform)}'`,
      };
    }

    // Append evidence and update verification timestamp
    record.evidenceHistory.push(evidence);
    record.lastVerificationDate = evidence.timestamp;

    let promotionResult: IPromotionEligibility | undefined;

    // Check optional promotion
    if (promoteToTier && promoteToTier !== record.declaredTier) {
      promotionResult = checkPromotionEligibility(record, promoteToTier, evidence);
      if (promotionResult.eligible) {
        record.declaredTier = promoteToTier;
      }
    }

    // Re-evaluate effective tier
    const evaluation = evaluateSupportTier(record, currentDate);

    return {
      accepted: true,
      promotion: promotionResult,
      newEffectiveTier: evaluation.effectiveTier,
      reason:
        promotionResult && !promotionResult.eligible
          ? `Evidence recorded, but promotion to '${promoteToTier}' denied: ${promotionResult.reasons.join("; ")}`
          : undefined,
    };
  }

  /**
   * Queries catalog entries with multi-axis filtering.
   */
  public queryRecords(
    filter?: ICatalogFilter,
    currentDate: Date = new Date(),
  ): { record: ISupportCatalogRecord; evaluation: IEvaluatedSupportTier }[] {
    const results: { record: ISupportCatalogRecord; evaluation: IEvaluatedSupportTier }[] = [];

    for (const record of this.records.values()) {
      if (filter?.gameId && record.gameId !== filter.gameId) {
        continue;
      }
      if (filter?.editionId && record.editionId !== filter.editionId) {
        continue;
      }
      if (filter?.storeId && record.storeId !== filter.storeId) {
        continue;
      }
      if (filter?.platform && record.platform !== filter.platform) {
        continue;
      }

      const evaluation = evaluateSupportTier(record, currentDate);

      if (filter?.tier && evaluation.effectiveTier !== filter.tier) {
        continue;
      }

      if (filter?.includeStale === false && evaluation.isStale) {
        continue;
      }

      if (
        filter?.distro &&
        !record.distroMatrix.some((d) =>
          d.distro.toLowerCase().includes(filter.distro!.toLowerCase()),
        )
      ) {
        continue;
      }

      if (filter?.deploymentMethod && !record.deploymentMatrix.includes(filter.deploymentMethod)) {
        continue;
      }

      results.push({ record, evaluation });
    }

    return results;
  }

  /**
   * Returns all stored records as an array.
   */
  public getAllRecords(): ISupportCatalogRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Exports catalog records as JSON string.
   */
  public exportCatalogJson(): string {
    return JSON.stringify(this.getAllRecords(), null, 2);
  }

  /**
   * Imports catalog records from JSON string.
   */
  public importCatalogJson(json: string): void {
    const parsed = JSON.parse(json) as ISupportCatalogRecord[];
    if (Array.isArray(parsed)) {
      for (const rec of parsed) {
        this.registerRecord(rec);
      }
    }
  }

  /**
   * Creates a pre-populated reference catalog satisfying Phase 9 & Phase 10 reference requirements.
   */
  public static createDefaultCatalog(now: Date = new Date()): GameSupportCatalog {
    const catalog = new GameSupportCatalog();
    const recentIso = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 5).toISOString(); // 5 days ago
    const staleIso = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 120).toISOString(); // 120 days ago (stale > 90d)
    const severeStaleIso = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 220).toISOString(); // 220 days ago (> 180d)

    // 1. Reference Native Linux Game (Pilot Reference: Fully Supported)
    catalog.registerRecord({
      id: "native-ref:standard:steam:linux-native",
      gameId: "native-ref",
      editionId: "standard",
      storeId: "steam",
      platform: "linux-native",
      declaredTier: "supported",
      maintainer: "Lotrex Native Linux SIG",
      adapterId: "native-reference-adapter",
      adapterVersion: "1.0.0",
      testedArtifact: "build-2026.08.native",
      distroMatrix: [
        { distro: "arch", kernel: "6.12", desktop: "wayland" },
        { distro: "ubuntu", version: "24.04", desktop: "wayland" },
        { distro: "steamos", version: "3.6", desktop: "gamescope" },
      ],
      deploymentMatrix: ["hardlink", "symlink", "copy"],
      knownLimitations: [],
      lastVerificationDate: recentIso,
      staleAfterDays: 90,
      evidenceHistory: [
        {
          evidenceId: "ev-native-ref-001",
          timestamp: recentIso,
          verifiedBy: "Lotrex Native Linux SIG",
          distro: { distro: "arch", kernel: "6.12", desktop: "wayland" },
          runtimeVersion: "Native glibc 2.40",
          deploymentMethod: "hardlink",
          reproducibleScenario:
            "Clean discovery -> mod staging -> hardlink deploy -> plugins -> launch -> purge",
          artifactBuildId: "build-2026.08.native",
          checklist: {
            discovery: true,
            profileCreation: true,
            modInstall: true,
            conflictResolution: true,
            deployment: true,
            loadOrder: true,
            toolsExecution: true,
            launchPreparation: true,
            purgeRestoration: true,
            atomicRollback: true,
          },
        },
      ],
    });

    // 2. Reference Windows/Proton Game: Skyrim Special Edition (Pilot Reference: Fully Supported)
    catalog.registerRecord({
      id: "skyrimse:special-edition:steam:windows-proton",
      gameId: "skyrimse",
      editionId: "special-edition",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "supported",
      maintainer: "Lotrex Bethesda/Proton Team",
      adapterId: "skyrimse-proton-adapter",
      adapterVersion: "1.0.0",
      testedArtifact: "skyrimse-1.6.1170.steam",
      distroMatrix: [
        { distro: "arch", kernel: "6.12", desktop: "wayland" },
        { distro: "ubuntu", version: "24.04", desktop: "x11" },
        { distro: "fedora", version: "41", desktop: "wayland" },
        { distro: "steamos", version: "3.6", desktop: "gamescope" },
      ],
      deploymentMatrix: ["hardlink", "symlink"],
      knownLimitations: [
        {
          id: "lim-skyrim-case-sens",
          severity: "cosmetic",
          summary: "Case sensitivity warning for texture subdirectories",
          workaround: "Lotrex staging normalizes Data/textures casing automatically",
        },
      ],
      lastVerificationDate: recentIso,
      staleAfterDays: 90,
      evidenceHistory: [
        {
          evidenceId: "ev-skyrim-001",
          timestamp: recentIso,
          verifiedBy: "Lotrex Bethesda/Proton Team",
          distro: { distro: "arch", kernel: "6.12", desktop: "wayland" },
          runtimeVersion: "Proton Experimental / 9.0-2",
          deploymentMethod: "hardlink",
          reproducibleScenario:
            "Discovery -> SKSE launch plan -> LOOT plugins.txt -> rollback verification",
          artifactBuildId: "skyrimse-1.6.1170.steam",
          checklist: {
            discovery: true,
            profileCreation: true,
            modInstall: true,
            conflictResolution: true,
            deployment: true,
            loadOrder: true,
            toolsExecution: true,
            launchPreparation: true,
            purgeRestoration: true,
            atomicRollback: true,
          },
        },
      ],
    });

    // 3. Stale Record: Fallout 4 (Demonstrating automatic staleness downgrade)
    catalog.registerRecord({
      id: "fallout4:standard:steam:windows-proton",
      gameId: "fallout4",
      editionId: "standard",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "supported",
      maintainer: "Lotrex Community Contributor",
      adapterId: "fallout4-adapter",
      adapterVersion: "0.9.0",
      testedArtifact: "fo4-1.10.163",
      distroMatrix: [{ distro: "ubuntu", version: "22.04" }],
      deploymentMatrix: ["symlink"],
      knownLimitations: [],
      lastVerificationDate: staleIso, // 120 days old -> exceeds 90 days!
      staleAfterDays: 90,
      evidenceHistory: [
        {
          evidenceId: "ev-fo4-stale",
          timestamp: staleIso,
          verifiedBy: "Lotrex Community Contributor",
          distro: { distro: "ubuntu", version: "22.04" },
          runtimeVersion: "Proton 8.0-4",
          deploymentMethod: "symlink",
          reproducibleScenario: "Legacy verification run",
          artifactBuildId: "fo4-1.10.163",
          checklist: {
            discovery: true,
            profileCreation: true,
            modInstall: true,
            conflictResolution: true,
            deployment: true,
            loadOrder: true,
            toolsExecution: true,
            launchPreparation: true,
            purgeRestoration: true,
            atomicRollback: true,
          },
        },
      ],
    });

    // 4. Severely Stale Record: Witcher 3 GOG (Demonstrating severe staleness downgrade to experimental)
    catalog.registerRecord({
      id: "witcher3:goty:gog:windows-proton",
      gameId: "witcher3",
      editionId: "goty",
      storeId: "gog",
      platform: "windows-proton",
      declaredTier: "supported",
      maintainer: "Old Maintainer",
      adapterId: "witcher3-adapter",
      adapterVersion: "0.5.0",
      testedArtifact: "w3-goty-1.32",
      distroMatrix: [{ distro: "arch" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [],
      lastVerificationDate: severeStaleIso, // 220 days old -> > 2 * 90 days!
      staleAfterDays: 90,
      evidenceHistory: [],
    });

    // 5. Experimental Record with Blocking Bug: New Game Test
    catalog.registerRecord({
      id: "starfield:standard:steam:windows-proton",
      gameId: "starfield",
      editionId: "standard",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "experimental",
      adapterId: "starfield-adapter",
      adapterVersion: "0.1.0",
      testedArtifact: "starfield-1.12.30",
      distroMatrix: [{ distro: "arch", desktop: "wayland" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [
        {
          id: "lim-sf-plugin-txt",
          severity: "blocking",
          summary: "Plugins.txt parser crashes on Unicode plugin names",
        },
      ],
      lastVerificationDate: recentIso,
      staleAfterDays: 60,
      evidenceHistory: [
        {
          evidenceId: "ev-sf-001",
          timestamp: recentIso,
          verifiedBy: "Tester",
          distro: { distro: "arch", desktop: "wayland" },
          runtimeVersion: "Proton Experimental",
          deploymentMethod: "hardlink",
          reproducibleScenario: "Discovery test",
          artifactBuildId: "starfield-1.12.30",
          checklist: {
            discovery: true,
            profileCreation: true,
            modInstall: false,
            conflictResolution: false,
            deployment: false,
            loadOrder: false,
            toolsExecution: false,
            launchPreparation: false,
            purgeRestoration: false,
            atomicRollback: false,
          },
        },
      ],
    });

    return catalog;
  }
}
