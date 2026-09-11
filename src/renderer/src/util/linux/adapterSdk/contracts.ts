import type {
  AdapterCapabilityKind,
  IGameAdapter,
  IGameAdapterManifest,
} from "../gameAdapters/contracts";

/**
 * Current supported SDK version for Linux game adapters.
 */
export const LOTREX_ADAPTER_SDK_VERSION = "1.0.0";

/**
 * Declared permissions and containment rules for an adapter (Least Privilege Boundary).
 */
export interface IAdapterPermissions {
  /** Directories inside the game directory that the adapter is allowed to stage/deploy into */
  allowedRoots: string[];
  /** Allowed tool executable names */
  allowedTools: string[];
  /** Whether the adapter requires network access (default: false) */
  networkAccess: boolean;
}

/**
 * Localization namespace descriptor isolating user-visible strings from core codebase.
 */
export interface ILocalizationNamespace {
  namespace: string;
  defaultLocale: string;
  strings: Record<string, string>;
}

/**
 * Diagnostics declarations describing dependencies and recommendations.
 */
export interface IDiagnosticsDeclaration {
  requiredDependencies: string[];
  recommendedRuntimes: string[];
}

/**
 * Typed, documented SDK manifest for modular game adapters (Phase 8).
 */
export interface ISdkAdapterManifest extends IGameAdapterManifest {
  sdkVersion: string;
  permissions: IAdapterPermissions;
  localization: ILocalizationNamespace;
  diagnosticsMeta?: IDiagnosticsDeclaration;
}

/**
 * Check result item in the conformance report.
 */
export interface IConformanceCheckResult {
  capability: AdapterCapabilityKind | "manifest" | "permissions" | "localization";
  check: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning";
}

/**
 * Comprehensive conformance test report.
 */
export interface IAdapterConformanceReport {
  adapterId: string;
  sdkVersion: string;
  passed: boolean;
  conformanceScore: number; // 0 to 100
  checks: IConformanceCheckResult[];
  timestamp: number;
}

/**
 * Inputs for scaffolding a new game adapter from the SDK template.
 */
export interface IScaffoldAdapterInput {
  gameId: string;
  gameName: string;
  editionId: string;
  platform: "linux-native" | "windows-proton";
  defaultExecutable: string;
  author: string;
  storeAppIds?: Record<string, string>;
}
