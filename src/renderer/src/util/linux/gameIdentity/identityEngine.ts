import * as fs from "node:fs";
import * as path from "node:path";

import {
  type IDiscoveredGameCandidate,
  type IDiscoverySourceRecord,
  type IGameProfileBinding,
  type IUnifiedGameIdentity,
  type IUnifiedGameInstallation,
  sha256,
} from "./contracts";

/**
 * Resolves a filesystem path to its physical canonical realpath.
 */
export function getCanonicalPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Checks whether two filesystem paths point to the exact same physical directory or symlink target.
 */
export function areSamePhysicalPath(pathA: string, pathB: string): boolean {
  return getCanonicalPath(pathA) === getCanonicalPath(pathB);
}

/**
 * Generates a stable deterministic installation ID based on game identity and optional hardware/install fingerprint.
 * The ID remains invariant across directory moves or launcher changes for the same installation.
 */
export function generateInstallationId(
  identity: IUnifiedGameIdentity,
  fingerprint?: string,
): string {
  const seed = `${identity.gameId}:${identity.editionId}:${fingerprint ?? "default"}`;
  return sha256(seed);
}

/**
 * Merges a newly discovered game candidate into an existing collection of managed game installations.
 *
 * Enforces Phase 1 acceptance criteria:
 * 1. Merges duplicate Steam, Heroic, Lutris, and manual discoveries targeting the same physical game install.
 * 2. Strictly refuses to merge distinct game editions (e.g. Standard vs Special Edition vs Anniversary).
 * 3. Preserves the Lotrex profileId and installationId when an installation moves or changes launcher path.
 *
 * @param existingInstallations List of currently tracked game installations.
 * @param candidate Freshly discovered game candidate from a provider.
 */
export function mergeGameDiscoveries(
  existingInstallations: IUnifiedGameInstallation[],
  candidate: IDiscoveredGameCandidate,
): {
  installations: IUnifiedGameInstallation[];
  action: "created" | "merged" | "relocated";
  installation: IUnifiedGameInstallation;
} {
  const updatedList = [...existingInstallations];

  // 1. Look for existing installation matching gameId and editionId
  const matchIndex = updatedList.findIndex((inst) => {
    // Game ID must match
    if (inst.identity.gameId !== candidate.identity.gameId) return false;
    // CRITICAL: Editions must match identically; distinct editions must NEVER be merged
    if (inst.identity.editionId !== candidate.identity.editionId) return false;

    // Check if it matches physical path
    if (areSamePhysicalPath(inst.installPath, candidate.installPath)) {
      return true;
    }

    // Check if it matches candidate installation fingerprint
    if (
      candidate.fingerprint &&
      generateInstallationId(candidate.identity, candidate.fingerprint) === inst.installationId
    ) {
      return true;
    }

    return false;
  });

  const now = Date.now();
  const sourceRecord: IDiscoverySourceRecord = {
    launcher: candidate.identity.owningLauncher,
    storeId: candidate.identity.storeId,
    storeAppId: candidate.identity.storeAppId,
    installPath: candidate.installPath,
    prefixPath: candidate.prefixPath,
    confidence: candidate.confidence,
    discoveredAt: now,
  };

  // Case A: Found matching installation
  if (matchIndex >= 0) {
    const existing = updatedList[matchIndex];
    const isRelocation = !areSamePhysicalPath(existing.installPath, candidate.installPath);

    // Merge discovery source records, avoiding exact duplicates
    const mergedSources = [...existing.discoverySources];
    const sourceExists = mergedSources.some(
      (s) =>
        s.launcher === sourceRecord.launcher &&
        s.storeId === sourceRecord.storeId &&
        areSamePhysicalPath(s.installPath, sourceRecord.installPath),
    );
    if (!sourceExists) {
      mergedSources.push(sourceRecord);
    }

    const updatedInstallation: IUnifiedGameInstallation = {
      ...existing,
      // If relocated, update the physical install and executable paths
      installPath: isRelocation ? candidate.installPath : existing.installPath,
      executablePath: isRelocation ? candidate.executablePath : existing.executablePath,
      prefixPath: candidate.prefixPath ?? existing.prefixPath,
      runtime: candidate.runtime ?? existing.runtime,
      discoverySources: mergedSources,
      lastSeenTimestamp: now,
      // INVARIANT: installationId and profileId are strictly preserved across relocations
      installationId: existing.installationId,
      profileId: existing.profileId,
    };

    updatedList[matchIndex] = updatedInstallation;

    return {
      installations: updatedList,
      action: isRelocation ? "relocated" : "merged",
      installation: updatedInstallation,
    };
  }

  // Case B: Brand new game or new distinct edition
  const installationId = generateInstallationId(candidate.identity, candidate.fingerprint);
  const defaultProfileId = `profile_${candidate.identity.gameId}_${candidate.identity.editionId}_${installationId.slice(0, 8)}`;

  const newInstallation: IUnifiedGameInstallation = {
    installationId,
    identity: { ...candidate.identity },
    installPath: candidate.installPath,
    executablePath: candidate.executablePath,
    runtime: candidate.runtime,
    prefixPath: candidate.prefixPath,
    discoverySources: [sourceRecord],
    lastSeenTimestamp: now,
    profileId: defaultProfileId,
  };

  updatedList.push(newInstallation);

  return {
    installations: updatedList,
    action: "created",
    installation: newInstallation,
  };
}

/**
 * Reconciles an explicit move or launcher relocation of an existing installation.
 * Preserves the installation ID, profile binding, and previous discovery history.
 */
export function reconcileInstallationRelocation(
  installation: IUnifiedGameInstallation,
  newInstallPath: string,
  newExecutablePath: string,
  newPrefixPath?: string,
  newLauncher?: IDiscoverySourceRecord["launcher"],
): IUnifiedGameInstallation {
  const updatedSources = [...installation.discoverySources];
  if (newLauncher) {
    updatedSources.push({
      launcher: newLauncher,
      storeId: installation.identity.storeId,
      storeAppId: installation.identity.storeAppId,
      installPath: newInstallPath,
      prefixPath: newPrefixPath,
      confidence: "confirmed",
      discoveredAt: Date.now(),
    });
  }

  return {
    ...installation,
    installPath: newInstallPath,
    executablePath: newExecutablePath,
    prefixPath: newPrefixPath ?? installation.prefixPath,
    discoverySources: updatedSources,
    lastSeenTimestamp: Date.now(),
  };
}

/**
 * Creates or updates an active profile binding for a unified game installation.
 */
export function createProfileBinding(
  installation: IUnifiedGameInstallation,
  profileName: string,
  stagingPath: string,
): IGameProfileBinding {
  return {
    installationId: installation.installationId,
    gameId: installation.identity.gameId,
    editionId: installation.identity.editionId,
    profileId: installation.profileId,
    profileName,
    stagingPath,
    lastKnownInstallPath: installation.installPath,
    isActive: true,
  };
}
