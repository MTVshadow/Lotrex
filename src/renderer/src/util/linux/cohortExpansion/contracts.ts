import type { ISdkAdapterManifest } from "../adapterSdk/contracts";
import type { IGameAdapter } from "../gameAdapters/contracts";
import type { GamePlatform, GameStoreId } from "../gameIdentity/contracts";
import type { GameSupportTier, ILifecycleEvidence } from "../supportCatalog/contracts";

/**
 * Recognized and contained mod packaging formats.
 */
export type WellUnderstoodModFormat =
  | "esp_esm"
  | "bepinex_plugin"
  | "unreal_pak"
  | "raw_asset"
  | "json_config";

/**
 * Legal provenance record for redistributable test fixtures.
 * Adheres to rule: "Prioritize games with maintainers, legal redistributable fixtures, well-understood mod formats."
 */
export interface IFixtureProvenance {
  isLegallyRedistributable: boolean;
  licenseOrPermission: string;
  fixtureChecksum: string;
  sourceUri: string;
  modFormat: WellUnderstoodModFormat;
}

/**
 * Automated, repeatable smoke test specification for a proposed game.
 */
export interface IRepeatableSmokeScenario {
  name: string;
  scenarioDescription: string;
  expectedArtifactPath: string;
  timeoutSeconds: number;
}

/**
 * Proposed candidate game adapter for intake into a controlled expansion cohort.
 */
export interface ICohortCandidate {
  candidateId: string;
  gameId: string;
  editionId: string;
  storeId: GameStoreId;
  platform: GamePlatform;
  maintainer: string;
  adapter: IGameAdapter;
  adapterManifest: ISdkAdapterManifest;
  fixtureProvenance: IFixtureProvenance;
  smokeScenario: IRepeatableSmokeScenario;
  lifecycleEvidence?: ILifecycleEvidence;
}

/**
 * Result of evaluating a candidate against the 7 mandatory intake gating criteria.
 */
export interface ICandidateGateResult {
  candidateId: string;
  passed: boolean;
  criteria: {
    sdkConformancePassed: boolean;
    conformanceScore: number;
    hasDedicatedMaintainer: boolean;
    legalFixtureProvenanceVerified: boolean;
    wellUnderstoodModFormat: boolean;
    repeatableSmokeDefined: boolean;
    lifecycleEvidenceRetained: boolean;
  };
  rejectionReasons: string[];
  recommendedTier: GameSupportTier;
}

/**
 * Cohort status lifecycle.
 */
export type CohortLifecycleStatus = "draft" | "under-review" | "canary" | "graduated" | "rejected";

/**
 * Controlled expansion cohort grouping small batches of game candidates.
 */
export interface ICohort {
  cohortId: string;
  name: string;
  maxBatchSize: number; // Small cohort rule: default maximum 5 games
  status: CohortLifecycleStatus;
  candidates: ICohortCandidate[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Review summary of a cohort after evaluating all candidates.
 */
export interface ICohortReviewSummary {
  cohortId: string;
  status: CohortLifecycleStatus;
  totalCandidates: number;
  acceptedCandidates: number;
  rejectedCandidates: number;
  candidateResults: ICandidateGateResult[];
}
