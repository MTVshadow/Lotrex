import { runAdapterConformanceSuite } from "../adapterSdk/conformanceTester";
import type { GameSupportTier } from "../supportCatalog/contracts";
import type { ICandidateGateResult, ICohortCandidate } from "./contracts";
import { SmokeScenarioRunner } from "./smokeScenarioRunner";

/**
 * Permitted well-understood mod formats.
 */
export const ALLOWED_MOD_FORMATS = new Set([
  "esp_esm",
  "bepinex_plugin",
  "unreal_pak",
  "raw_asset",
  "json_config",
]);

/**
 * Gatekeeper enforcing Phase 11 admission criteria for adding new games.
 *
 * Implements Phase 11 acceptance criteria:
 * - Prioritizes games with maintainers, legal redistributable fixtures, well-understood mod formats,
 *   and repeatable smoke scenarios.
 * - Rejects catalog bloat: a large catalog is not a success metric if entries cannot pass their declared support tier.
 */
export class CohortAdmissionGate {
  constructor(private readonly smokeRunner: SmokeScenarioRunner = new SmokeScenarioRunner()) {}

  /**
   * Evaluates a candidate game adapter against all 7 mandatory intake criteria.
   */
  public evaluateCandidate(candidate: ICohortCandidate): ICandidateGateResult {
    const rejectionReasons: string[] = [];

    // 1. Adapter SDK Conformance Suite check
    const conformance = runAdapterConformanceSuite(candidate.adapter, candidate.adapterManifest);
    const sdkConformancePassed = conformance.passed && conformance.conformanceScore >= 90;
    if (!sdkConformancePassed) {
      rejectionReasons.push(
        `Adapter SDK conformance suite failed (score: ${conformance.conformanceScore}%, required >= 90%).`,
      );
    }

    // 2. Dedicated Maintainer check
    const hasDedicatedMaintainer = Boolean(
      candidate.maintainer && candidate.maintainer.trim().length > 0,
    );
    if (!hasDedicatedMaintainer) {
      rejectionReasons.push(
        "Candidate lacks a dedicated, named maintainer responsible for upstream updates.",
      );
    }

    // 3. Legal Redistributable Fixture Provenance check
    const legalFixtureProvenanceVerified = Boolean(
      candidate.fixtureProvenance &&
      candidate.fixtureProvenance.isLegallyRedistributable &&
      candidate.fixtureProvenance.licenseOrPermission &&
      candidate.fixtureProvenance.fixtureChecksum &&
      candidate.fixtureProvenance.fixtureChecksum.length >= 8,
    );
    if (!legalFixtureProvenanceVerified) {
      rejectionReasons.push(
        "Candidate does not provide legally redistributable, license-cleared test fixtures with valid checksum.",
      );
    }

    // 4. Well-Understood Mod Format check
    const wellUnderstoodModFormat = Boolean(
      candidate.fixtureProvenance && ALLOWED_MOD_FORMATS.has(candidate.fixtureProvenance.modFormat),
    );
    if (!wellUnderstoodModFormat) {
      rejectionReasons.push(
        `Mod format '${candidate.fixtureProvenance?.modFormat}' is not in the list of supported, well-understood mod formats.`,
      );
    }

    // 5. Repeatable Smoke Scenario execution check
    const smokeResult = this.smokeRunner.executeSmokeScenario(candidate);
    const repeatableSmokePassed = smokeResult.passed;
    if (!repeatableSmokePassed) {
      rejectionReasons.push(
        `Repeatable smoke scenario failed: ${smokeResult.error ?? "Unknown error"}`,
      );
    }

    // 6. Retained Lifecycle Evidence check
    const evidence = candidate.lifecycleEvidence;
    const lifecycleEvidenceRetained = Boolean(
      evidence &&
      evidence.checklist &&
      evidence.checklist.discovery &&
      evidence.checklist.modInstall &&
      evidence.checklist.deployment &&
      evidence.checklist.purgeRestoration,
    );
    if (!lifecycleEvidenceRetained) {
      rejectionReasons.push(
        "Candidate lacks retained, reproducible lifecycle verification evidence (discovery, install, deploy, purge).",
      );
    }

    // 7. Calculate Recommended Tier
    let recommendedTier: GameSupportTier = "experimental";
    if (
      sdkConformancePassed &&
      hasDedicatedMaintainer &&
      legalFixtureProvenanceVerified &&
      repeatableSmokePassed &&
      lifecycleEvidenceRetained
    ) {
      const allTenPassed =
        evidence?.checklist.profileCreation &&
        evidence?.checklist.conflictResolution &&
        evidence?.checklist.loadOrder &&
        evidence?.checklist.toolsExecution &&
        evidence?.checklist.launchPreparation &&
        evidence?.checklist.atomicRollback;

      recommendedTier = allTenPassed ? "supported" : "community-tested";
    }

    const passed = rejectionReasons.length === 0;

    return {
      candidateId: candidate.candidateId,
      passed,
      criteria: {
        sdkConformancePassed,
        conformanceScore: conformance.conformanceScore,
        hasDedicatedMaintainer,
        legalFixtureProvenanceVerified,
        wellUnderstoodModFormat,
        repeatableSmokePassed,
        lifecycleEvidenceRetained,
      },
      rejectionReasons,
      recommendedTier,
      smokeExecution: smokeResult,
    };
  }
}
