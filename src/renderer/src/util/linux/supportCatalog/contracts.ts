import type { GamePlatform, GameStoreId } from "../gameIdentity/contracts";

/**
 * Declared and evaluated support tier for a game/edition/store/runtime combination.
 *
 * Tiers:
 * - `unsupported`: No active compatible adapter or failed critical baseline criteria.
 * - `experimental`: Adapter exists and discovers game, but verification is incomplete or severe limitations exist.
 * - `community-tested`: Valid reproducible test evidence verified on specific matrix within staleness window, but lacks full packaged lifecycle record or maintainer.
 * - `supported`: Full 10-step packaged lifecycle record, designated maintainer, no unmitigated blocking limitations, and non-stale verification.
 */
export type GameSupportTier = "unsupported" | "experimental" | "community-tested" | "supported";

/**
 * Severity of known issues / limitations.
 */
export type LimitationSeverity = "cosmetic" | "functional" | "blocking";

/**
 * Deployment mechanisms tested and supported for this matrix entry.
 */
export type CatalogDeploymentMethod = "hardlink" | "symlink" | "copy";

/**
 * Documented known limitation or issue.
 */
export interface IKnownLimitation {
  id: string;
  severity: LimitationSeverity;
  summary: string;
  details?: string;
  workaround?: string;
  trackingIssueUrl?: string;
}

/**
 * Target Linux distribution and environment.
 */
export interface IDistroTarget {
  distro: string; // e.g. "arch", "ubuntu", "fedora", "steamos", "debian"
  version?: string; // e.g. "24.04", "3.6"
  kernel?: string; // e.g. "6.12"
  desktop?: "wayland" | "x11" | "gamescope" | "any";
}

/**
 * 10 mandatory lifecycle stages required for reproducible verification.
 * Adheres to rule: "Never treat launching successfully as proof that deployment, plugins, tools, saves, or rollback work."
 */
export interface ILifecycleVerificationChecklist {
  /** Game executable and install discovery verified */
  discovery: boolean;
  /** Isolated profile creation and binding verified */
  profileCreation: boolean;
  /** Mod archive staging and extraction verified */
  modInstall: boolean;
  /** Conflict resolution and priority ordering verified */
  conflictResolution: boolean;
  /** File deployment (hardlink/symlink/copy) verified */
  deployment: boolean;
  /** Load order / plugin list synchronization verified */
  loadOrder: boolean;
  /** Extensible tool/script execution verified (where applicable) */
  toolsExecution: boolean;
  /** Launch argument / environment / runtime plan preparation verified */
  launchPreparation: boolean;
  /** Complete removal and vanilla state restoration verified */
  purgeRestoration: boolean;
  /** Transactional error rollback and recovery verified */
  atomicRollback: boolean;
}

/**
 * Retained reproducible test run evidence for game support tier qualification.
 */
export interface ILifecycleEvidence {
  evidenceId: string;
  timestamp: string; // ISO 8601
  verifiedBy: string; // Maintainer or tester identity
  distro: IDistroTarget;
  runtimeVersion: string; // e.g. "Proton-GE-9-15", "Native 1.2"
  deploymentMethod: CatalogDeploymentMethod;
  checklist: ILifecycleVerificationChecklist;
  reproducibleScenario: string;
  artifactBuildId: string;
  notes?: string;
}

/**
 * Distinct matrix key: not merely per title, but per edition, store, and platform runtime.
 */
export interface ISupportCatalogKey {
  gameId: string;
  editionId: string;
  storeId: GameStoreId;
  platform: GamePlatform;
}

/**
 * Stored catalog record for a specific game/edition/store/runtime combination.
 */
export interface ISupportCatalogRecord {
  /** Unique composite ID formatted as `${gameId}:${editionId}:${storeId}:${platform}` */
  id: string;
  gameId: string;
  editionId: string;
  storeId: GameStoreId;
  platform: GamePlatform;
  declaredTier: GameSupportTier;
  maintainer?: string;
  adapterId: string;
  adapterVersion: string;
  testedArtifact: string;
  distroMatrix: IDistroTarget[];
  deploymentMatrix: CatalogDeploymentMethod[];
  knownLimitations: IKnownLimitation[];
  lastVerificationDate: string; // ISO 8601
  evidenceHistory: ILifecycleEvidence[];
  staleAfterDays: number;
}

/**
 * Result of evaluating a catalog record against real-time staleness, blocking limitations, and criteria.
 */
export interface IEvaluatedSupportTier {
  recordId: string;
  key: ISupportCatalogKey;
  declaredTier: GameSupportTier;
  effectiveTier: GameSupportTier;
  isStale: boolean;
  staleDays: number;
  downgraded: boolean;
  downgradeReason?: string;
  blockingLimitations: IKnownLimitation[];
  missingCriteria: string[];
  recommendedActions: string[];
}

/**
 * Check result for promotion eligibility.
 */
export interface IPromotionEligibility {
  targetTier: GameSupportTier;
  eligible: boolean;
  reasons: string[];
  missingLifecycleSteps: (keyof ILifecycleVerificationChecklist)[];
}

/**
 * Filtering options for catalog queries.
 */
export interface ICatalogFilter {
  gameId?: string;
  editionId?: string;
  storeId?: GameStoreId;
  platform?: GamePlatform;
  tier?: GameSupportTier;
  includeStale?: boolean;
  distro?: string;
  deploymentMethod?: CatalogDeploymentMethod;
}
