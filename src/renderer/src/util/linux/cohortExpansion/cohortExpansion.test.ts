import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { SampleNativeGameAdapter, SampleProtonGameAdapter } from "../adapterSdk/sampleAdapters";
import type { ITransactionalFs } from "../modPipeline/transactionalDeployer";
import type { ILifecycleEvidence } from "../supportCatalog/contracts";
import { GameSupportCatalog } from "../supportCatalog/supportCatalog";
import { CohortAdmissionGate } from "./admissionGate";
import { CohortManager } from "./cohortManager";
import type { ICohortCandidate } from "./contracts";
import { GameExtensionRecommender } from "./gameExtensionRecommender";
import { createReferenceCohorts } from "./referenceCohorts";
import { SmokeScenarioRunner } from "./smokeScenarioRunner";

/**
 * In-memory transactional filesystem for isolated, deterministic testing of smoke scenarios.
 */
class InMemoryTransactionalFs implements ITransactionalFs {
  public files = new Map<string, string>();
  public symlinks = new Map<string, string>();
  public directories = new Set<string>();

  public existsSync(p: string): boolean {
    const norm = path.normalize(p);
    return this.files.has(norm) || this.symlinks.has(norm) || this.directories.has(norm);
  }

  public mkdirSync(p: string): void {
    let current = path.normalize(p);
    while (current !== "/" && current !== "." && current !== "") {
      this.directories.add(current);
      current = path.dirname(current);
    }
  }

  public symlinkSync(target: string, p: string): void {
    const norm = path.normalize(p);
    this.symlinks.set(norm, target);
  }

  public linkSync(existingPath: string, newPath: string): void {
    const norm = path.normalize(newPath);
    const content = this.files.get(path.normalize(existingPath)) ?? "";
    this.files.set(norm, content);
  }

  public copyFileSync(src: string, dest: string): void {
    const normDest = path.normalize(dest);
    const content =
      this.files.get(path.normalize(src)) ?? this.symlinks.get(path.normalize(src)) ?? "content";
    this.files.set(normDest, content);
  }

  public unlinkSync(p: string): void {
    const norm = path.normalize(p);
    this.files.delete(norm);
    this.symlinks.delete(norm);
  }

  public writeFileSync(p: string, data: string): void {
    const norm = path.normalize(p);
    this.files.set(norm, data);
  }

  public readFileSync(p: string): string {
    const norm = path.normalize(p);
    if (this.symlinks.has(norm)) {
      const target = this.symlinks.get(norm)!;
      return this.readFileSync(target);
    }
    const content = this.files.get(norm);
    if (content === undefined) {
      throw new Error(`File not found: ${p}`);
    }
    return content;
  }

  public readdirSync(p: string): string[] {
    const norm = path.normalize(p);
    const results: string[] = [];
    for (const file of this.files.keys()) {
      if (path.dirname(file) === norm) {
        results.push(path.basename(file));
      }
    }
    return results;
  }
}

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

  describe("SmokeScenarioRunner", () => {
    it("executes automated smoke scenario and verifies expected artifact generation", () => {
      const memFs = new InMemoryTransactionalFs();
      const runner = new SmokeScenarioRunner(memFs, "/tmp/sandbox");
      const candidate = createValidCandidate();

      const result = runner.executeSmokeScenario(candidate);

      expect(result.passed).toBe(true);
      expect(result.artifactVerified).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.outputLog.length).toBeGreaterThan(0);
    });

    it("fails when expected artifact path is missing or timeout is invalid", () => {
      const memFs = new InMemoryTransactionalFs();
      const runner = new SmokeScenarioRunner(memFs, "/tmp/sandbox");
      const candidate = createValidCandidate();
      candidate.smokeScenario.expectedArtifactPath = "";

      const result = runner.executeSmokeScenario(candidate);

      expect(result.passed).toBe(false);
      expect(result.artifactVerified).toBe(false);
      expect(result.error).toContain("expectedArtifactPath");
    });
  });

  describe("CohortAdmissionGate", () => {
    it("evaluates and passes candidate meeting all 7 admission gate criteria with real smoke execution", () => {
      const memFs = new InMemoryTransactionalFs();
      const smokeRunner = new SmokeScenarioRunner(memFs, "/tmp/sandbox");
      const gate = new CohortAdmissionGate(smokeRunner);
      const candidate = createValidCandidate();

      const result = gate.evaluateCandidate(candidate);

      expect(result.passed).toBe(true);
      expect(result.rejectionReasons).toHaveLength(0);
      expect(result.criteria.hasDedicatedMaintainer).toBe(true);
      expect(result.criteria.legalFixtureProvenanceVerified).toBe(true);
      expect(result.criteria.wellUnderstoodModFormat).toBe(true);
      expect(result.criteria.sdkConformancePassed).toBe(true);
      expect(result.criteria.repeatableSmokePassed).toBe(true);
      expect(result.criteria.lifecycleEvidenceRetained).toBe(true);
      expect(result.recommendedTier).toBe("supported");
      expect(result.smokeExecution?.passed).toBe(true);
    });

    it("rejects candidate lacking dedicated maintainer", () => {
      const memFs = new InMemoryTransactionalFs();
      const gate = new CohortAdmissionGate(new SmokeScenarioRunner(memFs));
      const candidate = createValidCandidate();
      candidate.maintainer = "";

      const result = gate.evaluateCandidate(candidate);

      expect(result.passed).toBe(false);
      expect(result.rejectionReasons.some((r) => r.includes("maintainer"))).toBe(true);
      expect(result.criteria.hasDedicatedMaintainer).toBe(false);
    });

    it("rejects candidate without legal redistributable fixture clearance", () => {
      const memFs = new InMemoryTransactionalFs();
      const gate = new CohortAdmissionGate(new SmokeScenarioRunner(memFs));
      const candidate = createValidCandidate();
      candidate.fixtureProvenance.isLegallyRedistributable = false;

      const result = gate.evaluateCandidate(candidate);

      expect(result.passed).toBe(false);
      expect(result.rejectionReasons.some((r) => r.includes("legally redistributable"))).toBe(true);
    });

    it("rejects candidate with unsupported mod format", () => {
      const memFs = new InMemoryTransactionalFs();
      const gate = new CohortAdmissionGate(new SmokeScenarioRunner(memFs));
      const candidate = createValidCandidate();
      candidate.fixtureProvenance.modFormat = "unknown_binary_blob" as any;

      const result = gate.evaluateCandidate(candidate);

      expect(result.passed).toBe(false);
      expect(result.rejectionReasons.some((r) => r.includes("not in the list of supported"))).toBe(
        true,
      );
    });
  });

  describe("CohortManager & Graduation", () => {
    it("enforces small cohort size constraints and rejects batch overflowing", () => {
      const manager = new CohortManager();
      const cohort = manager.createCohort("cohort-1", "Cohort 1 (Small Batch)", 2);

      expect(cohort.maxBatchSize).toBe(2);

      manager.addCandidate("cohort-1", createValidCandidate("game-1"));
      manager.addCandidate("cohort-1", createValidCandidate("game-2"));

      expect(() => {
        manager.addCandidate("cohort-1", createValidCandidate("game-3"));
      }).toThrow("has reached its maximum batch size of 2");
    });

    it("reviews cohort and graduates accepted games into the support catalog while rejecting invalid entries", () => {
      const memFs = new InMemoryTransactionalFs();
      const gate = new CohortAdmissionGate(new SmokeScenarioRunner(memFs));
      const manager = new CohortManager(gate);
      const catalog = new GameSupportCatalog();

      manager.createCohort("cohort-bethesda", "Bethesda Engines Cohort", 5);

      const validCandidate = createValidCandidate("valid-skyrim");
      manager.addCandidate("cohort-bethesda", validCandidate);

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
          timeoutSeconds: 0,
        },
      };
      manager.addCandidate("cohort-bethesda", invalidCandidate);

      const review = manager.reviewCohort("cohort-bethesda");
      expect(review.totalCandidates).toBe(2);
      expect(review.acceptedCandidates).toBe(1);
      expect(review.rejectedCandidates).toBe(1);

      const gradResult = manager.graduateCohort("cohort-bethesda", catalog);
      expect(gradResult.graduatedCandidates).toContain("valid-skyrim");
      expect(gradResult.rejectedCandidates.some((r) => r.candidateId === "invalid-native")).toBe(
        true,
      );

      const record = catalog.getRecord({
        gameId: "sample-proton-game",
        editionId: "standard",
        storeId: "steam",
        platform: "windows-proton",
      });
      expect(record).toBeDefined();
      expect(record?.declaredTier).toBe("supported");

      const unverified = catalog.getRecord({
        gameId: "unverified-game",
        editionId: "std",
        storeId: "steam",
        platform: "linux-native",
      });
      expect(unverified).toBeUndefined();
    });
  });

  describe("GameExtensionRecommender (Roadmap line 729 & Scope Rule 637)", () => {
    it("strictly follows Rule 637: never advertises mod support for discovered games unless adapter is active", () => {
      const catalog = GameSupportCatalog.createDefaultCatalog();
      const recommender = new GameExtensionRecommender(catalog);

      // Discovered game without active adapter
      const suggestion = recommender.evaluateDiscoveredGame({
        gameId: "skyrimse",
        editionId: "special-edition",
        platform: "windows-proton",
        storeId: "steam",
        owningLauncher: "steam",
        executable: "SkyrimSE.exe",
        adapterVersion: "1.0.0",
      });

      expect(suggestion.hasActiveAdapter).toBe(false);
      expect(suggestion.modSupportAdvertised).toBe(false); // Rule 637 MUST be respected
      expect(suggestion.suggestedAction).toBe("install-reviewed-extension");
      expect(suggestion.suggestedExtension?.tier).toBe("supported");
      expect(suggestion.diagnosticMessage).toContain("Modding is inactive");
    });

    it("advertises mod support when compatible game adapter is actively registered", () => {
      const catalog = GameSupportCatalog.createDefaultCatalog();
      const activeAdapter = new SampleProtonGameAdapter();
      const activeMap = new Map([[activeAdapter.manifest.id, activeAdapter]]);

      const recommender = new GameExtensionRecommender(catalog, activeMap);

      const suggestion = recommender.evaluateDiscoveredGame({
        gameId: "sample-proton-game",
        editionId: "standard",
        platform: "windows-proton",
        storeId: "steam",
        owningLauncher: "steam",
        executable: "Game.exe",
        adapterVersion: "1.0.0",
      });

      expect(suggestion.hasActiveAdapter).toBe(true);
      expect(suggestion.modSupportAdvertised).toBe(true);
      expect(suggestion.suggestedAction).toBe("activate-existing");
      expect(suggestion.diagnosticMessage).toContain("Mod support enabled");
    });

    it("recommends scaffolding a new adapter via SDK when no catalog or cohort entry exists", () => {
      const catalog = new GameSupportCatalog();
      const recommender = new GameExtensionRecommender(catalog);

      const suggestion = recommender.evaluateDiscoveredGame({
        gameId: "completely-unknown-game",
        editionId: "standard",
        platform: "linux-native",
        storeId: "steam",
        owningLauncher: "steam",
        executable: "unknown.bin",
        adapterVersion: "1.0.0",
      });

      expect(suggestion.hasActiveAdapter).toBe(false);
      expect(suggestion.modSupportAdvertised).toBe(false);
      expect(suggestion.suggestedAction).toBe("scaffold-sdk-template");
      expect(suggestion.scaffoldCommandHint).toContain("pnpm lotrex sdk new-game");
      expect(suggestion.diagnosticMessage).toContain(
        "Use the Lotrex Adapter SDK to scaffold a new game adapter",
      );
    });

    it("recommends candidate extension when game matches an active cohort under review", () => {
      const catalog = new GameSupportCatalog();
      const cohorts = createReferenceCohorts(); // Cohort 2 has fallout4 under canary review
      const recommender = new GameExtensionRecommender(catalog, new Map(), cohorts);

      const suggestion = recommender.evaluateDiscoveredGame({
        gameId: "fallout4",
        editionId: "standard",
        platform: "windows-proton",
        storeId: "steam",
        owningLauncher: "steam",
        executable: "Fallout4.exe",
        adapterVersion: "1.0.0",
      });

      expect(suggestion.hasActiveAdapter).toBe(false);
      expect(suggestion.modSupportAdvertised).toBe(false);
      expect(suggestion.suggestedAction).toBe("install-reviewed-extension");
      expect(suggestion.suggestedExtension?.adapterId).toBe("fallout4-proton-adapter");
      expect(suggestion.suggestedExtension?.isReviewedCatalogEntry).toBe(false);
      expect(suggestion.diagnosticMessage).toContain(
        "under review in cohort 'Cohort 2: Bethesda Engine Expansion'",
      );
    });
  });

  describe("ReferenceCohorts", () => {
    it("generates production reference cohorts complying with small batch limits", () => {
      const cohorts = createReferenceCohorts();

      expect(cohorts.length).toBeGreaterThanOrEqual(2);

      for (const cohort of cohorts) {
        expect(cohort.candidates.length).toBeLessThanOrEqual(cohort.maxBatchSize);
        expect(cohort.candidates.length).toBeGreaterThan(0);
        for (const cand of cohort.candidates) {
          expect(cand.maintainer.length).toBeGreaterThan(0);
          expect(cand.fixtureProvenance.isLegallyRedistributable).toBe(true);
          expect(cand.smokeScenario.timeoutSeconds).toBeGreaterThan(0);
          expect(cand.lifecycleEvidence).toBeDefined();
        }
      }
    });
  });
});
