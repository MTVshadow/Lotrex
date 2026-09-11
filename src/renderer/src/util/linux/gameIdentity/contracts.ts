import * as crypto from "node:crypto";

/**
 * Supported execution platforms for unified Linux game management.
 */
export type GamePlatform = "linux-native" | "windows-proton" | "windows-wine";

/**
 * Owning launchers managing game installations.
 */
export type OwningLauncher = "steam" | "heroic" | "lutris" | "bottles" | "standalone" | "manual";

/**
 * Distribution stores where games originate.
 */
export type GameStoreId = "steam" | "gog" | "epic" | "ea" | "ubisoft" | "gasp" | "manual" | "other";

/**
 * Core unified game identity independent of localized names and filesystem install paths (Phase 1).
 */
export interface IUnifiedGameIdentity {
  /** Canonical invariant game identifier, e.g. "skyrimse", "witcher3" */
  gameId: string;
  /** Explicit edition identifier to prevent merging distinct releases (e.g. "standard", "special-edition", "goty") */
  editionId: string;
  /** Target execution platform */
  platform: GamePlatform;
  /** Primary digital store identifier */
  storeId: GameStoreId;
  /** Digital store catalog ID (e.g. Steam AppID "489830") */
  storeAppId?: string;
  /** Owning launcher managing this game */
  owningLauncher: OwningLauncher;
  /** Normalized executable relative path or binary name (e.g. "SkyrimSE.exe") */
  executable: string;
  /** Required version of the game adapter capability contract */
  adapterVersion: string;
}

/**
 * Provenance record from a launcher or filesystem discovery pass.
 */
export interface IDiscoverySourceRecord {
  launcher: OwningLauncher;
  storeId: GameStoreId;
  storeAppId?: string;
  installPath: string;
  prefixPath?: string;
  confidence: "confirmed" | "probable";
  discoveredAt: number;
}

/**
 * Registered game installation with stable persistent identity and profile binding.
 */
export interface IUnifiedGameInstallation {
  /** Stable internal installation identifier independent of installation paths */
  installationId: string;
  /** Normalized identity properties */
  identity: IUnifiedGameIdentity;
  /** Current absolute installation path on the host filesystem */
  installPath: string;
  /** Current resolved path to the primary game executable */
  executablePath: string;
  /** Configured runtime identifier (e.g. "proton-9.0", "native") */
  runtime?: string;
  /** Configured Proton/Wine prefix directory */
  prefixPath?: string;
  /** Discovered launcher provenance records */
  discoverySources: IDiscoverySourceRecord[];
  /** Timestamp when this installation was last verified on disk */
  lastSeenTimestamp: number;
  /** Bound Lotrex profile identifier preserved across moves and launcher changes */
  profileId: string;
}

/**
 * Candidate discovery record emitted by a provider during resource scanning.
 */
export interface IDiscoveredGameCandidate {
  identity: IUnifiedGameIdentity;
  installPath: string;
  executablePath: string;
  prefixPath?: string;
  runtime?: string;
  confidence: "confirmed" | "probable";
  fingerprint?: string;
}

/**
 * Profile binding associating mod deployments and user configurations with a game installation.
 */
export interface IGameProfileBinding {
  installationId: string;
  gameId: string;
  editionId: string;
  profileId: string;
  profileName: string;
  stagingPath: string;
  lastKnownInstallPath: string;
  isActive: boolean;
}

/**
 * Deterministic hash calculation helper.
 */
export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
