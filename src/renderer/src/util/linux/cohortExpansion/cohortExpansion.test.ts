import { describe, expect, it } from "vitest";

import { SampleNativeGameAdapter, SampleProtonGameAdapter } from "../adapterSdk/sampleAdapters";
import type { ILifecycleEvidence } from "../supportCatalog/contracts";
import { GameSupportCatalog } from "../supportCatalog/supportCatalog";
import { CohortAdmissionGate } from "./admissionGate";
import { CohortManager } from "./cohortManager";
import type { ICohortCandidate } from "./contracts";

describe("Phase 11: Controlled Library Expansion", () => {
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

  const validEvidence: ILifecycleEvidence = {
    evidenceId: "ev-sample-01",
    timestamp: new Date().toISOString(),
    verifiedBy: "Lead Contributor",
    distro: { distro: "arch", kernel: "6.12" },
    runtimeVersion: "Proton 9.0",
    deploymentMethod: "hardlink",
    reproducibleScenario: "All 10 stages validated cleanly",
    artifactBuildId: "build-100",
    checklist: fullChecklist,
  };

  function createValidCandidate(id = "candidate-1"): ICohortCandidate {
    const adapter = new SampleProtonGameAdapter();
    return {
      candidateId: id,
      gameId: "sample-proton-game",
      editionId: "standard",
      storeId: "steam",
      platform: "windows-proton",
      maintainer: "Dedicated Maintainer",
      adapter,
      adapterManifest: adapter.manifest,
      fixtureProvenance: {
        isLegallyRedistributable: true,
        licenseOrPermission: "MIT-0 (Public Domain Test Fixture)",
        fixtureChecksum: "sha256:abcd1234ef567890",
        sourceUri: "https://github.com/vortex-fixtures/sample-mod.zip",
        modFormat: "esp_esm",
      },
      smokeScenario: {
        name: "Standard ESP Load Order Smoke",
        scenarioDescription: "Deploys ESP mod and verifies plugins.txt registration",
        expectedArtifactPath: "Data/Sample.esp",
        timeoutSeconds: 30,
      },
      lifecycleEvidence: validEvidence,
    };
  }

  it("enforces small cohort size constraints and rejects batch overflowing", () => {
    const manager = new CohortManager();
    const cohort = manager.createCohort("cohort-1", "Cohort 1 (Small Batch)", 2);

    expect(cohort.maxBatchSize).toBe(2);

    manager.addCandidate("cohort-1", createValidCandidate("game-1"));
    manager.addCandidate("cohort-1", createValidCandidate("game-2"));

    // Attempting to exceed maxBatchSize of 2
    expect(() => {
      manager.addCandidate("cohort-1", createValidCandidate("game-3"));
    }).toThrow("has reached its maximum batch size of 2");
  });

  it("evaluates and passes candidate meeting all 7 admission gate criteria", () => {
    const gate = new CohortAdmissionGate();
    const candidate = createValidCandidate();

    const result = gate.evaluateCandidate(candidate);

    expect(result.passed).toBe(true);
    expect(result.rejectionReasons).toHaveLength(0);
    expect(result.criteria.hasDedicatedMaintainer).toBe(true);
    expect(result.criteria.legalFixtureProvenanceVerified).toBe(true);
    expect(result.criteria.wellUnderstoodModFormat).toBe(true);
    expect(result.criteria.sdkConformancePassed).toBe(true);
    expect(result.criteria.repeatableSmokeDefined).toBe(true);
    expect(result.criteria.lifecycleEvidenceRetained).toBe(true);
    expect(result.recommendedTier).toBe("supported");
  });

  it("rejects candidate lacking dedicated maintainer", () => {
    const gate = new CohortAdmissionGate();
    const candidate = createValidCandidate();
    candidate.maintainer = ""; // Missing maintainer

    const result = gate.evaluateCandidate(candidate);

    expect(result.passed).toBe(false);
    expect(result.rejectionReasons.some((r) => r.includes("maintainer"))).toBe(true);
    expect(result.criteria.hasDedicatedMaintainer).toBe(false);
  });

  it("rejects candidate without legal redistributable fixture clearance", () => {
    const gate = new CohortAdmissionGate();
    const candidate = createValidCandidate();
    candidate.fixtureProvenance.isLegallyRedistributable = false; // DRM/Proprietary violation

    const result = gate.evaluateCandidate(candidate);

    expect(result.passed).toBe(false);
    expect(result.rejectionReasons.some((r) => r.includes("legally redistributable"))).toBe(true);
  });

  it("rejects candidate with unsupported mod format", () => {
    const gate = new CohortAdmissionGate();
    const candidate = createValidCandidate();
    candidate.fixtureProvenance.modFormat = "unknown_binary_blob" as any;

    const result = gate.evaluateCandidate(candidate);

    expect(result.passed).toBe(false);
    expect(result.rejectionReasons.some((r) => r.includes("not in the list of supported"))).toBe(
      true,
    );
  });

  it("reviews cohort and graduates accepted games into the support catalog while rejecting invalid entries", () => {
    const manager = new CohortManager();
    const catalog = new GameSupportCatalog();

    manager.createCohort("cohort-bethesda", "Bethesda Engines Cohort", 5);

    // Valid candidate
    const validCandidate = createValidCandidate("valid-skyrim");
    manager.addCandidate("cohort-bethesda", validCandidate);

    // Invalid candidate (missing smoke test and maintainer)
    const nativeAdapter = new SampleNativeGameAdapter();
    const invalidCandidate: ICohortCandidate = {
      candidateId: "invalid-native",
      gameId: "unverified-game",
      editionId: "std",
      storeId: "steam",
      platform: "linux-native",
      maintainer: "", // Invalid
      adapter: nativeAdapter,
      adapterManifest: nativeAdapter.manifest,
      fixtureProvenance: {
        isLegallyRedistributable: true,
        licenseOrPermission: "CC0",
        fixtureChecksum: "1234",
        sourceUri: "http://example.com",
        modFormat: "bepinex_plugin",
      },
      smokeScenario: {
        name: "",
        scenarioDescription: "",
        expectedArtifactPath: "",
        timeoutSeconds: 0, // Invalid
      },
    };
    manager.addCandidate("cohort-bethesda", invalidCandidate);

    // Review cohort
    const review = manager.reviewCohort("cohort-bethesda");
    expect(review.totalCandidates).toBe(2);
    expect(review.acceptedCandidates).toBe(1);
    expect(review.rejectedCandidates).toBe(1);

    // Graduate cohort into catalog
    const gradResult = manager.graduateCohort("cohort-bethesda", catalog);
    expect(gradResult.graduatedCandidates).toContain("valid-skyrim");
    expect(gradResult.rejectedCandidates.some((r) => r.candidateId === "invalid-native")).toBe(
      true,
    );

    // Catalog verification
    const record = catalog.getRecord({
      gameId: "sample-proton-game",
      editionId: "standard",
      storeId: "steam",
      platform: "windows-proton",
    });
    expect(record).toBeDefined();
    expect(record?.declaredTier).toBe("supported");

    // Invalid game was NOT registered in catalog
    const unverified = catalog.getRecord({
      gameId: "unverified-game",
      editionId: "std",
      storeId: "steam",
      platform: "linux-native",
    });
    expect(unverified).toBeUndefined();
  });
});
