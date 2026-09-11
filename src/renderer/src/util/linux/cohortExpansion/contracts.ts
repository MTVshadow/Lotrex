import type { ISdkAdapterManifest } from "../adapterSdk/contracts";
import type { IGameAdapter } from "../gameAdapters/contracts";
import type { GamePlatform, GameStoreId, IUnifiedGameIdentity } from "../gameIdentity/contracts";
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
 * Result of executing an automated smoke scenario.
 */
export interface ISmokeExecutionResult {
  passed: boolean;
  durationMs: number;
  artifactVerified: boolean;
  outputLog: string[];
  error?: string;
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
    repeatableSmokePassed: boolean;
    lifecycleEvidenceRetained: boolean;
  };
  rejectionReasons: string[];
  recommendedTier: GameSupportTier;
  smokeExecution?: ISmokeExecutionResult;
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

/**
 * Automatic game-extension recommendation (Phase 11 & Roadmap line 729).
 *
 * Adheres strictly to Scope Rule 637:
 * "Never advertise a discovered game as mod-supported unless a compatible game adapter is active."
 */
export interface IGameExtensionSuggestion {
  identity: IUnifiedGameIdentity;
  /** True only if a compatible game adapter is currently active and installed in Lotrex */
  hasActiveAdapter: boolean;
  /** True only if hasActiveAdapter is true; NEVER advertise mod support for bare discovered games */
  modSupportAdvertised: boolean;
  suggestedExtension?: {
    adapterId: string;
    name: string;
    version: string;
    maintainer: string;
    tier: GameSupportTier;
    declaredRoots: string[];
    knownLimitations: string[];
    isReviewedCatalogEntry: boolean;
  };
  suggestedAction:
    | "activate-existing"
    | "install-reviewed-extension"
    | "scaffold-sdk-template"
    | "none";
  scaffoldCommandHint?: string;
  diagnosticMessage: string;
}
