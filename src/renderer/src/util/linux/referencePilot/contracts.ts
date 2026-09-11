import type { GamePlatform, GameStoreId } from "../gameIdentity/contracts";
import type { CatalogDeploymentMethod, ILifecycleEvidence } from "../supportCatalog/contracts";

/**
 * Lifecycle stages evaluated during reference-game pilot verification.
 * Covers Phase 10 completion criteria.
 */
export type PilotStageName =
  | "discovery"
  | "profileCreation"
  | "modInstall"
  | "conflictResolution"
  | "deployment"
  | "loadOrder"
  | "toolsExecution"
  | "launch"
  | "inGameVerification"
  | "purgeRestoration"
  | "recoveryRollback"
  | "restartAndUpgrade";

/**
 * Detailed report of a single lifecycle stage.
 */
export interface IPilotStageReport {
  stage: PilotStageName;
  passed: boolean;
  durationMs: number;
  details: string;
  error?: string;
}

/**
 * Scenario definition for a reference game pilot.
 */
export interface IPilotScenario {
  name: string;
  gameType: "native" | "proton";
  gameId: string;
  editionId: string;
  storeId: GameStoreId;
  platform: GamePlatform;
  maintainer: string;
  adapterVersion: string;
  artifactBuildId: string;
  deploymentMethod: CatalogDeploymentMethod;
}

/**
 * Complete result of executing a reference-game pilot.
 */
export interface IPilotExecutionResult {
  scenario: IPilotScenario;
  success: boolean;
  stages: IPilotStageReport[];
  evidence: ILifecycleEvidence;
  summary: string;
}
