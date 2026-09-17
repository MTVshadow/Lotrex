import type { AdapterCapabilityKind, IGameAdapter } from "../gameAdapters/contracts";
import type {
  GamePlatform,
  GameStoreId,
  IUnifiedGameIdentity,
  IUnifiedGameInstallation,
  OwningLauncher,
} from "../gameIdentity/contracts";

/**
 * Installation state on disk.
 */
export type LibraryInstallState =
  | "installed"
  | "missing-files"
  | "relocated"
  | "uninstalled"
  | "corrupted";

/**
 * Summary of a single discovery origin (e.g. Steam, Heroic, Lutris).
 */
export interface ILibraryOriginSummary {
  launcher: OwningLauncher;
  storeId: GameStoreId;
  storeAppId?: string;
  installPath: string;
  prefixPath?: string;
  confidence: "confirmed" | "probable";
  discoveredAt: number;
}

/**
 * Summary of the runtime environment configuration.
 */
export interface ILibraryRuntimeSummary {
  platform: GamePlatform;
  runtimeName: string;
  runtimePath?: string;
  prefixPath?: string;
  isCustomOverride: boolean;
}

/**
 * Granular compatibility status.
 */
export interface ILibraryCompatibilityStatus {
  status:
    | "ready"
    | "needs-runtime"
    | "needs-prefix"
    | "incompatible-runtime"
    | "degraded"
    | "missing-executable";
  message: string;
  messageDescriptor?: ILibraryMessage;
  remedies: string[];
  remedyDescriptors?: ILibraryMessage[];
}

/** Locale-independent UI message emitted by library services. */
export interface ILibraryMessage {
  key: string;
  values?: Record<string, number | string>;
}

/**
 * Summary of the active mod profile bound to the installation.
 */
export interface ILibraryModProfileSummary {
  profileId: string;
  profileName: string;
  isActive: boolean;
  stagingPath: string;
  activeModCount: number;
  deploymentMethod: "hardlink" | "symlink" | "move" | "none";
  isEnabled: boolean;
}

/**
 * Adapter support level for modding and lifecycle management.
 */
export type AdapterSupportTier = "supported" | "community-tested" | "experimental" | "unsupported";

/**
 * Summary of game adapter support.
 */
export interface ILibraryAdapterSupportSummary {
  supportLevel: AdapterSupportTier;
  adapterId?: string;
  adapterName?: string;
  adapterVersion?: string;
  supportedCapabilities: AdapterCapabilityKind[];
  unsupportedCapabilities: Array<{
    kind: AdapterCapabilityKind;
    reason: string;
  }>;
  /**
   * Whether the game can accept mods.
   * Strict rule: Must be false unless a compatible, active adapter is registered.
   */
  canAcceptMods: boolean;
  /** Technical explanation if mod acceptance is blocked */
  modRejectionReason?: string;
  modRejectionMessage?: ILibraryMessage;
}

/**
 * Launch availability assessment.
 */
export interface ILibraryLaunchAvailability {
  canLaunch: boolean;
  blockingReasons: string[];
  blockingReasonMessages?: ILibraryMessage[];
  launchExplanation: string;
  launchExplanationMessage?: ILibraryMessage;
}

/**
 * Type of duplication detected across the library.
 */
export type DuplicateCategory =
  | "none"
  | "multi-launcher" // Single physical directory detected by multiple launchers
  | "multi-install" // Multiple physical installations of the exact same game and edition
  | "distinct-edition"; // Same base gameId, but different distinct editions

/**
 * Summary of duplicate status for user differentiation.
 */
export interface ILibraryDuplicateSummary {
  category: DuplicateCategory;
  isDuplicate: boolean;
  duplicateGroupKey: string;
  duplicateIndex: number;
  totalInGroup: number;
  otherLocations: string[];
  explanation: string;
  explanationMessage?: ILibraryMessage;
}

/**
 * Manual user correction record.
 * Crucial constraint: User overrides are kept separate and NEVER overwrite launcher-owned files.
 */
export interface IManualCorrectionRecord {
  installationId: string;
  correctedAt: number;
  reason?: string;
  originalData: {
    executablePath: string;
    installPath: string;
    prefixPath?: string;
    runtime?: string;
  };
  overrides: {
    executablePath?: string;
    installPath?: string;
    prefixPath?: string;
    runtime?: string;
    customLaunchArgs?: string[];
    customEnvironment?: Record<string, string>;
  };
}

/**
 * Side-by-side audit of auto-discovered data versus user corrections.
 */
export interface IManualCorrectionAudit {
  installationId: string;
  hasOverrides: boolean;
  fields: Array<{
    fieldName: string;
    discoveredValue: string | undefined;
    correctedValue: string | undefined;
    isOverridden: boolean;
  }>;
  customLaunchArgs?: string[];
  customEnvironment?: Record<string, string>;
  divergenceDetected: boolean;
  divergenceMessage?: string;
}

/**
 * Complete unified library item presented in the UI (Phase 4).
 */
export interface IUnifiedLibraryItem {
  id: string;
  gameId: string;
  editionId: string;
  displayName: string;
  primaryInstallation: IUnifiedGameInstallation;
  installations: IUnifiedGameInstallation[];
  origins: ILibraryOriginSummary[];
  installState: LibraryInstallState;
  runtime: ILibraryRuntimeSummary;
  compatibilityStatus: ILibraryCompatibilityStatus;
  activeModProfile: ILibraryModProfileSummary;
  adapterSupport: ILibraryAdapterSupportSummary;
  launchAvailability: ILibraryLaunchAvailability;
  duplicateSummary: ILibraryDuplicateSummary;
  manualCorrection: IManualCorrectionRecord | null;
  executablePath: string;
  installPath: string;
  prefixPath?: string;
}

/**
 * Filtering criteria for the unified library view.
 */
export interface ILibraryFilterCriteria {
  searchQuery?: string;
  launcherFilter?: OwningLauncher | "all";
  runtimeFilter?: GamePlatform | "all";
  supportLevelFilter?: AdapterSupportTier | "all";
  launchStatusFilter?: "all" | "canLaunch" | "blocked";
  modReadinessFilter?: "all" | "ready" | "blocked";
  duplicateFilter?: "all" | "duplicates-only" | "unique-only";
  installStateFilter?: "all" | "installed" | "missing";
}

/**
 * Sorting keys for library presentation.
 */
export type LibrarySortKey =
  | "name"
  | "origin"
  | "runtime"
  | "supportLevel"
  | "launchStatus"
  | "installState";

/**
 * Diagnostic check result item.
 */
export interface IDiagnosticCheckItem {
  domain: "launch" | "modding" | "filesystem" | "runtime";
  check: string;
  checkDescriptor?: ILibraryMessage;
  passed: boolean;
  severity: "error" | "warning" | "info";
  message: string;
  messageDescriptor?: ILibraryMessage;
  resolutionHint?: string;
  resolutionDescriptor?: ILibraryMessage;
}

/**
 * Full explainable diagnostic report for a library item.
 */
export interface ILibraryDiagnosticReport {
  itemId: string;
  gameId: string;
  editionId: string;
  timestamp: number;
  canLaunch: boolean;
  canAcceptMods: boolean;
  checks: IDiagnosticCheckItem[];
  summary: string;
  summaryDescriptor?: ILibraryMessage;
}
