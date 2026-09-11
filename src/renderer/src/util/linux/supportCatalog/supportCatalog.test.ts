import { describe, expect, it } from "vitest";

import {
  COMMUNITY_TESTED_MANDATORY_STEPS,
  FULL_LIFECYCLE_STEPS,
  buildCatalogKeyId,
  checkPromotionEligibility,
  evaluateSupportTier,
} from "./catalogEvaluator";
import type { ILifecycleEvidence, ISupportCatalogRecord } from "./contracts";
import { GameSupportCatalog } from "./supportCatalog";

describe("Phase 9: Game Support Tiers and Catalog", () => {
  const now = new Date("2026-09-11T12:00:00Z");

  const fullChecklist = {
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
  };

  it("ensures composite keys separate game editions, stores, and runtimes independently", () => {
    const key1 = buildCatalogKeyId("skyrimse", "special-edition", "steam", "windows-proton");
    const key2 = buildCatalogKeyId("skyrimse", "anniversary-edition", "steam", "windows-proton");
    const key3 = buildCatalogKeyId("skyrimse", "special-edition", "gog", "windows-wine");

    expect(key1).toBe("skyrimse:special-edition:steam:windows-proton");
    expect(key2).toBe("skyrimse:anniversary-edition:steam:windows-proton");
    expect(key3).toBe("skyrimse:special-edition:gog:windows-wine");
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);

    const catalog = new GameSupportCatalog();
    catalog.registerRecord({
      id: key1,
      gameId: "skyrimse",
      editionId: "special-edition",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "supported",
      maintainer: "Maintainer A",
      adapterId: "adapter-se",
      adapterVersion: "1.0.0",
      testedArtifact: "build-1",
      distroMatrix: [{ distro: "arch" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [],
      lastVerificationDate: now.toISOString(),
      staleAfterDays: 90,
      evidenceHistory: [],
    });

    catalog.registerRecord({
      id: key2,
      gameId: "skyrimse",
      editionId: "anniversary-edition",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "experimental",
      maintainer: "Maintainer B",
      adapterId: "adapter-ae",
      adapterVersion: "1.0.0",
      testedArtifact: "build-2",
      distroMatrix: [{ distro: "arch" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [],
      lastVerificationDate: now.toISOString(),
      staleAfterDays: 90,
      evidenceHistory: [],
    });

    expect(catalog.getAllRecords()).toHaveLength(2);
    expect(
      catalog.getRecord({
        gameId: "skyrimse",
        editionId: "special-edition",
        storeId: "steam",
        platform: "windows-proton",
      })?.declaredTier,
    ).toBe("supported");
    expect(
      catalog.getRecord({
        gameId: "skyrimse",
        editionId: "anniversary-edition",
        storeId: "steam",
        platform: "windows-proton",
      })?.declaredTier,
    ).toBe("experimental");
  });

  it("automatically downgrades supported tier when verification evidence is stale", () => {
    // 100 days old (threshold: 90 days)
    const staleDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const record: ISupportCatalogRecord = {
      id: "skyrimse:special-edition:steam:windows-proton",
      gameId: "skyrimse",
      editionId: "special-edition",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "supported",
      maintainer: "Active Maintainer",
      adapterId: "skyrim-adapter",
      adapterVersion: "1.0.0",
      testedArtifact: "build-1.6",
      distroMatrix: [{ distro: "arch" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [],
      lastVerificationDate: staleDate,
      staleAfterDays: 90,
      evidenceHistory: [
        {
          evidenceId: "ev-1",
          timestamp: staleDate,
          verifiedBy: "Active Maintainer",
          distro: { distro: "arch" },
          runtimeVersion: "Proton 9.0",
          deploymentMethod: "hardlink",
          reproducibleScenario: "All verified",
          artifactBuildId: "build-1.6",
          checklist: fullChecklist,
        },
      ],
    };

    const evalResult = evaluateSupportTier(record, now);
    expect(evalResult.declaredTier).toBe("supported");
    expect(evalResult.isStale).toBe(true);
    expect(evalResult.staleDays).toBe(10);
    expect(evalResult.downgraded).toBe(true);
    expect(evalResult.effectiveTier).toBe("community-tested");
    expect(evalResult.downgradeReason).toContain("Stale verification");
  });

  it("automatically downgrades to experimental when verification is severely stale (> 2x threshold)", () => {
    // 200 days old (threshold: 90 days, 2x is 180 days)
    const severeDate = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const record: ISupportCatalogRecord = {
      id: "skyrimse:special-edition:steam:windows-proton",
      gameId: "skyrimse",
      editionId: "special-edition",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "supported",
      maintainer: "Active Maintainer",
      adapterId: "skyrim-adapter",
      adapterVersion: "1.0.0",
      testedArtifact: "build-1.6",
      distroMatrix: [{ distro: "arch" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [],
      lastVerificationDate: severeDate,
      staleAfterDays: 90,
      evidenceHistory: [
        {
          evidenceId: "ev-severe",
          timestamp: severeDate,
          verifiedBy: "Active Maintainer",
          distro: { distro: "arch" },
          runtimeVersion: "Proton 9.0",
          deploymentMethod: "hardlink",
          reproducibleScenario: "Legacy run",
          artifactBuildId: "build-1.6",
          checklist: fullChecklist,
        },
      ],
    };

    const evalResult = evaluateSupportTier(record, now);
    expect(evalResult.downgraded).toBe(true);
    expect(evalResult.effectiveTier).toBe("experimental");
    expect(evalResult.downgradeReason).toContain("Severely stale");
  });

  it("downgrades tier when unmitigated blocking limitations are present", () => {
    const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const record: ISupportCatalogRecord = {
      id: "native-ref:standard:steam:linux-native",
      gameId: "native-ref",
      editionId: "standard",
      storeId: "steam",
      platform: "linux-native",
      declaredTier: "supported",
      maintainer: "Maintainer",
      adapterId: "adapter-1",
      adapterVersion: "1.0.0",
      testedArtifact: "build-native-1",
      distroMatrix: [{ distro: "arch" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [
        {
          id: "bug-001",
          severity: "blocking",
          summary: "Crash on saving game when modded",
        },
      ],
      lastVerificationDate: recentDate,
      staleAfterDays: 90,
      evidenceHistory: [
        {
          evidenceId: "ev-blocking",
          timestamp: recentDate,
          verifiedBy: "Maintainer",
          distro: { distro: "arch" },
          runtimeVersion: "Native",
          deploymentMethod: "hardlink",
          reproducibleScenario: "All stages",
          artifactBuildId: "build-native-1",
          checklist: fullChecklist,
        },
      ],
    };

    const evalResult = evaluateSupportTier(record, now);
    expect(evalResult.downgraded).toBe(true);
    expect(evalResult.effectiveTier).toBe("experimental");
    expect(evalResult.blockingLimitations).toHaveLength(1);
    expect(evalResult.downgradeReason).toContain("Blocking limitations present");
  });

  it("enforces that launch success alone does not qualify for supported tier", () => {
    const record: ISupportCatalogRecord = {
      id: "fake-game:std:steam:windows-proton",
      gameId: "fake-game",
      editionId: "std",
      storeId: "steam",
      platform: "windows-proton",
      declaredTier: "experimental",
      adapterId: "fake-adapter",
      adapterVersion: "1.0.0",
      testedArtifact: "build-test",
      distroMatrix: [{ distro: "ubuntu" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [],
      lastVerificationDate: now.toISOString(),
      staleAfterDays: 90,
      evidenceHistory: [],
    };

    // Partial evidence: launchPreparation passes, but purgeRestoration and atomicRollback fail
    const partialEvidence: ILifecycleEvidence = {
      evidenceId: "ev-partial",
      timestamp: now.toISOString(),
      verifiedBy: "Tester",
      distro: { distro: "ubuntu" },
      runtimeVersion: "Proton 9.0",
      deploymentMethod: "hardlink",
      reproducibleScenario: "Only launched",
      artifactBuildId: "build-test",
      checklist: {
        ...fullChecklist,
        purgeRestoration: false,
        atomicRollback: false,
      },
    };

    const promotion = checkPromotionEligibility(record, "supported", partialEvidence);
    expect(promotion.eligible).toBe(false);
    expect(promotion.missingLifecycleSteps).toContain("purgeRestoration");
    expect(promotion.missingLifecycleSteps).toContain("atomicRollback");
    expect(promotion.reasons.some((r) => r.includes("Missing: 'purgeRestoration'"))).toBe(true);
  });

  it("successfully promotes record to supported when complete reproducible evidence is submitted", () => {
    const catalog = new GameSupportCatalog();
    const key = {
      gameId: "test-game",
      editionId: "standard",
      storeId: "steam" as const,
      platform: "linux-native" as const,
    };

    catalog.registerRecord({
      id: buildCatalogKeyId(key.gameId, key.editionId, key.storeId, key.platform),
      ...key,
      declaredTier: "experimental",
      maintainer: "Dedicated Maintainer",
      adapterId: "test-adapter",
      adapterVersion: "1.0.0",
      testedArtifact: "artifact-v1",
      distroMatrix: [{ distro: "arch", kernel: "6.12" }],
      deploymentMatrix: ["hardlink"],
      knownLimitations: [],
      lastVerificationDate: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      staleAfterDays: 90,
      evidenceHistory: [],
    });

    const completeEvidence: ILifecycleEvidence = {
      evidenceId: "ev-complete-001",
      timestamp: now.toISOString(),
      verifiedBy: "Dedicated Maintainer",
      distro: { distro: "arch", kernel: "6.12" },
      runtimeVersion: "Native 1.0",
      deploymentMethod: "hardlink",
      reproducibleScenario: "All 10 stages verified with clean purge and recovery",
      artifactBuildId: "artifact-v1",
      checklist: fullChecklist,
    };

    const result = catalog.submitEvidence(key, completeEvidence, "supported", now);
    expect(result.accepted).toBe(true);
    expect(result.promotion?.eligible).toBe(true);
    expect(result.newEffectiveTier).toBe("supported");

    const record = catalog.getRecord(key);
    expect(record?.declaredTier).toBe("supported");
    expect(record?.evidenceHistory).toHaveLength(1);
    expect(record?.lastVerificationDate).toBe(now.toISOString());
  });

  it("submitting fresh evidence resets staleness and restores tier", () => {
    const catalog = GameSupportCatalog.createDefaultCatalog(now);
    const fo4Key = {
      gameId: "fallout4",
      editionId: "standard",
      storeId: "steam" as const,
      platform: "windows-proton" as const,
    };

    // Initially Fallout 4 in default catalog is stale and evaluated as community-tested
    const initialEval = catalog.evaluateRecord(fo4Key, now);
    expect(initialEval?.declaredTier).toBe("supported");
    expect(initialEval?.isStale).toBe(true);
    expect(initialEval?.effectiveTier).toBe("community-tested");

    // Submit fresh evidence
    const freshEvidence: ILifecycleEvidence = {
      evidenceId: "ev-fo4-renewed",
      timestamp: now.toISOString(),
      verifiedBy: "Lotrex Community Contributor",
      distro: { distro: "ubuntu", version: "24.04" },
      runtimeVersion: "Proton 9.0-2",
      deploymentMethod: "symlink",
      reproducibleScenario: "Fresh full verification run",
      artifactBuildId: "fo4-1.10.163",
      checklist: fullChecklist,
    };

    const submitResult = catalog.submitEvidence(fo4Key, freshEvidence, undefined, now);
    expect(submitResult.accepted).toBe(true);
    expect(submitResult.newEffectiveTier).toBe("supported");

    const renewedEval = catalog.evaluateRecord(fo4Key, now);
    expect(renewedEval?.isStale).toBe(false);
    expect(renewedEval?.effectiveTier).toBe("supported");
    expect(renewedEval?.downgraded).toBe(false);
  });

  it("filters catalog records by tier, platform, store, distro, and deployment method", () => {
    const catalog = GameSupportCatalog.createDefaultCatalog(now);

    // Query native-only
    const nativeResults = catalog.queryRecords({ platform: "linux-native" }, now);
    expect(nativeResults.every((r) => r.record.platform === "linux-native")).toBe(true);
    expect(nativeResults.length).toBeGreaterThan(0);

    // Query by distro "arch"
    const archResults = catalog.queryRecords({ distro: "arch" }, now);
    expect(archResults.length).toBeGreaterThan(0);
    expect(archResults.every((r) => r.record.distroMatrix.some((d) => d.distro === "arch"))).toBe(
      true,
    );

    // Query non-stale only
    const nonStaleResults = catalog.queryRecords({ includeStale: false }, now);
    expect(nonStaleResults.every((r) => !r.evaluation.isStale)).toBe(true);

    // Query by tier "supported"
    const supportedResults = catalog.queryRecords({ tier: "supported" }, now);
    expect(supportedResults.every((r) => r.evaluation.effectiveTier === "supported")).toBe(true);
  });

  it("exports and imports catalog as JSON while preserving evaluations", () => {
    const catalog1 = GameSupportCatalog.createDefaultCatalog(now);
    const json = catalog1.exportCatalogJson();

    const catalog2 = new GameSupportCatalog();
    catalog2.importCatalogJson(json);

    expect(catalog2.getAllRecords()).toHaveLength(catalog1.getAllRecords().length);

    const native1 = catalog1.evaluateRecord("native-ref:standard:steam:linux-native", now);
    const native2 = catalog2.evaluateRecord("native-ref:standard:steam:linux-native", now);
    expect(native1?.effectiveTier).toBe(native2?.effectiveTier);
    expect(native1?.effectiveTier).toBe("supported");
  });

  it("lists all mandatory checklist steps correctly", () => {
    expect(FULL_LIFECYCLE_STEPS).toHaveLength(10);
    expect(COMMUNITY_TESTED_MANDATORY_STEPS).toHaveLength(4);
    for (const step of COMMUNITY_TESTED_MANDATORY_STEPS) {
      expect(FULL_LIFECYCLE_STEPS).toContain(step);
    }
  });
});
