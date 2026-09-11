import type { AdapterCapabilityKind, IGameAdapter } from "../gameAdapters/contracts";

/**
 * Supported file deployment mechanisms.
 */
export type DeploymentMethod = "hardlink" | "symlink" | "move";

/**
 * Inspected archive entry metadata.
 */
export interface IInspectedArchiveEntry {
  path: string;
  sizeBytes: number;
  isDirectory: boolean;
  destinationRelPath: string;
  modTypeId: string;
}

/**
 * Result of safe archive inspection.
 */
export interface IInspectedArchive {
  archivePath: string;
  archiveSha256: string;
  entries: IInspectedArchiveEntry[];
  totalSizeBytes: number;
  fileCount: number;
  suggestedModType: string;
}

/**
 * Staged file record within a mod's private staging directory.
 */
export interface IStagedFile {
  relativePath: string; // Relative to mod staging root
  destinationRelPath: string; // Target relative to game directory
  sizeBytes: number;
  sha256: string;
}

/**
 * Staged mod ready for conflict resolution and deployment.
 */
export interface IStagedMod {
  modId: string;
  name: string;
  version: string;
  stagingPath: string;
  priority: number;
  files: IStagedFile[];
  enabled: boolean;
}

/**
 * Conflict item between multiple mods targeting the same file destination.
 */
export interface IModFileConflict {
  destinationRelPath: string;
  conflictingModIds: string[];
  winningModId: string;
  reason: string;
}

/**
 * Resolved deployment file mapping.
 */
export interface IResolvedDeploymentFile {
  destinationRelPath: string;
  sourceAbsoluteStagingPath: string;
  owningModId: string;
  sha256: string;
}

/**
 * Single file mutation record within the deployment journal.
 */
export interface IDeployedFileRecord {
  destinationRelPath: string;
  destinationAbsolutePath: string;
  sourceStagingPath: string;
  owningModId: string;
  method: DeploymentMethod;
  previousState: "vanilla-absent" | "vanilla-backed-up";
  backupPath?: string;
  sha256: string;
}

/**
 * Deployment journal tracking all mutations for audit, purge, and rollback.
 */
export interface IDeploymentJournal {
  operationId: string;
  timestamp: number;
  gameId: string;
  profileId: string;
  gamePath: string;
  method: DeploymentMethod;
  deployedFiles: IDeployedFileRecord[];
  generatedFiles: string[];
  status: "committed" | "rolled-back" | "in-progress";
}

/**
 * Load order configuration entry.
 */
export interface ILoadOrderEntry {
  id: string;
  enabled: boolean;
  priority: number;
}

/**
 * Deployment options.
 */
export interface IDeploymentOptions {
  method?: DeploymentMethod;
  cleanGeneratedFiles?: boolean;
}

/**
 * Transaction execution envelope.
 */
export interface IPipelineResult<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: string;
  rollbackExecuted: boolean;
  journal?: IDeploymentJournal;
}
