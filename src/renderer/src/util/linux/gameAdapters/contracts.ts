/**
 * Versioned capability kinds that game adapters declare (Phase 2).
 * Replaces core game-specific assumptions with modular capabilities.
 */
export type AdapterCapabilityKind =
  | "discovery"
  | "mod-types"
  | "install-rules"
  | "deployment-targets"
  | "load-order"
  | "tools"
  | "saves"
  | "launch"
  | "diagnostics"
  | "migration";

/**
 * All mandatory capability kinds that every game adapter must explicitly declare,
 * whether supported or unsupported.
 */
export const ALL_ADAPTER_CAPABILITY_KINDS: ReadonlyArray<AdapterCapabilityKind> = [
  "discovery",
  "mod-types",
  "install-rules",
  "deployment-targets",
  "load-order",
  "tools",
  "saves",
  "launch",
  "diagnostics",
  "migration",
] as const;

/**
 * Descriptor of an individual versioned capability.
 * Unsupported capabilities must be explicit and visible with an explanatory reason.
 */
export interface ICapabilityDescriptor<TDetails = unknown> {
  kind: AdapterCapabilityKind;
  /** Semantic version of this capability contract implementation */
  version: string;
  /** Whether this capability is supported by the adapter */
  supported: boolean;
  /** Explicit, user-visible explanation if capability is unsupported */
  unsupportedReason?: string;
  /** Strongly-typed capability metadata or configuration options */
  details?: TDetails;
}

/**
 * Metadata manifest identifying a game adapter.
 */
export interface IGameAdapterManifest {
  /** Unique adapter identifier, e.g. "skyrimse-linux-adapter" */
  id: string;
  /** Semantic version of the adapter, e.g. "1.0.0" */
  version: string;
  /** Target canonical game ID, e.g. "skyrimse" */
  targetGameId: string;
  /** Supported game editions, e.g. ["special-edition", "anniversary"] */
  targetEditions: string[];
  /** Human-readable adapter name */
  name: string;
  /** Adapter author or maintainer */
  author?: string;
  /** Map of declared capabilities */
  capabilities: Record<AdapterCapabilityKind, ICapabilityDescriptor>;
}

/**
 * Discovery capability details.
 */
export interface IDiscoveryCapabilityDetails {
  storeAppIds?: Record<string, string>;
  defaultExecutableName: string;
  relativeGamePaths?: string[];
}

/**
 * Mod type definition.
 */
export interface IAdapterModType {
  id: string;
  name: string;
  targetPath: string;
  priority: number;
}

/**
 * Install rule definition.
 */
export interface IAdapterInstallRule {
  pattern: string;
  destination: string;
  priority?: number;
}

/**
 * Deployment targets capability details.
 */
export interface IDeploymentTargetsDetails {
  supportedMethods: Array<"hardlink" | "symlink" | "move">;
  requiresElevated?: boolean;
}

/**
 * External tool definition managed by the adapter.
 */
export interface IAdapterTool {
  id: string;
  name: string;
  executable: string;
  requiredFiles?: string[];
  relativeToGamePath?: boolean;
}

/**
 * Operation result envelope for capability execution.
 */
export interface IAdapterOperationResult<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: string;
  diagnostics?: string[];
}

/**
 * Base interface that every versioned game adapter implements.
 */
export interface IGameAdapter {
  readonly manifest: IGameAdapterManifest;
  hasCapability(kind: AdapterCapabilityKind): boolean;
  getCapability<T = unknown>(kind: AdapterCapabilityKind): ICapabilityDescriptor<T>;
  executeCapability?<TArgs = unknown, TResult = unknown>(
    kind: AdapterCapabilityKind,
    args: TArgs,
  ): Promise<IAdapterOperationResult<TResult>>;
}
