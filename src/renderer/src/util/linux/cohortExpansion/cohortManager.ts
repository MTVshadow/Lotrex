import { buildCatalogKeyId } from "../supportCatalog/catalogEvaluator";
import type { GameSupportCatalog } from "../supportCatalog/supportCatalog";
import { CohortAdmissionGate } from "./admissionGate";
import type {
  ICandidateGateResult,
  ICohort,
  ICohortCandidate,
  ICohortReviewSummary,
} from "./contracts";

/**
 * Manager for small, controlled cohorts of game library expansion (Phase 11).
 *
 * Implements Phase 11 acceptance criteria:
 * - Adds games in small cohorts (enforcing maximum cohort size).
 * - Only graduates games into the catalog after full qualification.
 * - Prevents catalog bloat by rejecting games that fail admission criteria.
 */
export class CohortManager {
  private readonly cohorts = new Map<string, ICohort>();
  private readonly admissionGate: CohortAdmissionGate;

  constructor(admissionGate = new CohortAdmissionGate()) {
    this.admissionGate = admissionGate;
  }

  /**
   * Creates a new expansion cohort with a strict batch size limit.
   */
  public createCohort(cohortId: string, name: string, maxBatchSize = 5): ICohort {
    if (this.cohorts.has(cohortId)) {
      throw new Error(`Cohort with ID '${cohortId}' already exists.`);
    }

    const now = new Date().toISOString();
    const cohort: ICohort = {
      cohortId,
      name,
      maxBatchSize,
      status: "draft",
      candidates: [],
      createdAt: now,
      updatedAt: now,
    };

    this.cohorts.set(cohortId, cohort);
    return cohort;
  }

  /**
   * Returns an existing cohort.
   */
  public getCohort(cohortId: string): ICohort | undefined {
    return this.cohorts.get(cohortId);
  }

  /**
   * Adds a candidate to an active cohort, enforcing maximum batch size constraints.
   */
  public addCandidate(cohortId: string, candidate: ICohortCandidate): void {
    const cohort = this.getCohort(cohortId);
    if (!cohort) {
      throw new Error(`Cohort '${cohortId}' not found.`);
    }

    if (cohort.status !== "draft" && cohort.status !== "under-review") {
      throw new Error(
        `Cannot add candidates to cohort '${cohortId}' with status '${cohort.status}'.`,
      );
    }

    if (cohort.candidates.length >= cohort.maxBatchSize) {
      throw new Error(
        `Cohort '${cohortId}' has reached its maximum batch size of ${cohort.maxBatchSize}. Create a new cohort for additional games.`,
      );
    }

    cohort.candidates.push(candidate);
    cohort.updatedAt = new Date().toISOString();
  }

  /**
   * Reviews all candidates in a cohort against the admission gate.
   */
  public reviewCohort(cohortId: string): ICohortReviewSummary {
    const cohort = this.getCohort(cohortId);
    if (!cohort) {
      throw new Error(`Cohort '${cohortId}' not found.`);
    }

    cohort.status = "under-review";
    const candidateResults: ICandidateGateResult[] = [];
    let accepted = 0;
    let rejected = 0;

    for (const candidate of cohort.candidates) {
      const gateResult = this.admissionGate.evaluateCandidate(candidate);
      candidateResults.push(gateResult);
      if (gateResult.passed) {
        accepted++;
      } else {
        rejected++;
      }
    }

    cohort.updatedAt = new Date().toISOString();
    return {
      cohortId,
      status: cohort.status,
      totalCandidates: cohort.candidates.length,
      acceptedCandidates: accepted,
      rejectedCandidates: rejected,
      candidateResults,
    };
  }

  /**
   * Graduates qualified candidates from the cohort into the GameSupportCatalog.
   * Discards candidates that fail admission gate criteria.
   */
  public graduateCohort(
    cohortId: string,
    catalog: GameSupportCatalog,
  ): {
    graduatedCandidates: string[];
    rejectedCandidates: Array<{ candidateId: string; reasons: string[] }>;
  } {
    const cohort = this.getCohort(cohortId);
    if (!cohort) {
      throw new Error(`Cohort '${cohortId}' not found.`);
    }

    const review = this.reviewCohort(cohortId);
    const graduatedCandidates: string[] = [];
    const rejectedCandidates: Array<{ candidateId: string; reasons: string[] }> = [];

    for (let i = 0; i < cohort.candidates.length; i++) {
      const candidate = cohort.candidates[i];
      const gateResult = review.candidateResults[i];

      if (gateResult.passed && candidate.lifecycleEvidence) {
        // Register in catalog with assigned tier
        const catalogId = buildCatalogKeyId(
          candidate.gameId,
          candidate.editionId,
          candidate.storeId,
          candidate.platform,
        );

        catalog.registerRecord({
          id: catalogId,
          gameId: candidate.gameId,
          editionId: candidate.editionId,
          storeId: candidate.storeId,
          platform: candidate.platform,
          declaredTier: gateResult.recommendedTier,
          maintainer: candidate.maintainer,
          adapterId: candidate.adapterManifest.id,
          adapterVersion: candidate.adapterManifest.version,
          testedArtifact: candidate.fixtureProvenance.fixtureChecksum,
          distroMatrix: [{ distro: "arch", desktop: "wayland" }],
          deploymentMatrix: ["symlink", "hardlink"],
          knownLimitations: [],
          lastVerificationDate: candidate.lifecycleEvidence.timestamp,
          staleAfterDays: 90,
          evidenceHistory: [candidate.lifecycleEvidence],
        });

        graduatedCandidates.push(candidate.candidateId);
      } else {
        rejectedCandidates.push({
          candidateId: candidate.candidateId,
          reasons: gateResult.rejectionReasons,
        });
      }
    }

    cohort.status = graduatedCandidates.length > 0 ? "graduated" : "rejected";
    cohort.updatedAt = new Date().toISOString();

    return {
      graduatedCandidates,
      rejectedCandidates,
    };
  }
}
