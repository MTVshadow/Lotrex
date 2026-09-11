import * as path from "node:path";

import type { IModFileConflict, IResolvedDeploymentFile, IStagedMod } from "./contracts";

/**
 * Resolves file conflicts between enabled staged mods based on priority ordering.
 */
export class ConflictResolver {
  /**
   * Resolves conflicts across all enabled mods, returning the winning deployment file mapping
   * and a log of detected collisions.
   */
  public resolveConflicts(mods: IStagedMod[]): {
    resolvedFiles: Map<string, IResolvedDeploymentFile>;
    conflicts: IModFileConflict[];
  } {
    const resolvedFiles = new Map<string, IResolvedDeploymentFile>();
    const conflicts: IModFileConflict[] = [];

    // Filter enabled mods and sort by priority ascending (higher priority processed later, overwriting)
    const enabledMods = mods.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);

    // Track all mods contributing to each path
    const pathContributions = new Map<
      string,
      Array<{ modId: string; stagingPath: string; priority: number; sha256: string }>
    >();

    for (const mod of enabledMods) {
      for (const file of mod.files) {
        const destKey = path.normalize(file.destinationRelPath).toLowerCase();
        const sourceAbsolute = path.join(mod.stagingPath, file.relativePath);

        const contribs = pathContributions.get(destKey) ?? [];
        contribs.push({
          modId: mod.modId,
          stagingPath: sourceAbsolute,
          priority: mod.priority,
          sha256: file.sha256,
        });
        pathContributions.set(destKey, contribs);

        // Current mod wins so far due to ascending priority
        resolvedFiles.set(destKey, {
          destinationRelPath: file.destinationRelPath,
          sourceAbsoluteStagingPath: sourceAbsolute,
          owningModId: mod.modId,
          sha256: file.sha256,
        });
      }
    }

    // Identify conflicts where multiple mods targeted the same destination
    for (const [destKey, contribs] of pathContributions.entries()) {
      if (contribs.length > 1) {
        const winningContrib = contribs[contribs.length - 1];
        const conflictingModIds = contribs.map((c) => c.modId);
        const loserModIds = conflictingModIds.filter((id) => id !== winningContrib.modId);

        conflicts.push({
          destinationRelPath: destKey,
          conflictingModIds,
          winningModId: winningContrib.modId,
          reason: `Mod '${winningContrib.modId}' (priority ${winningContrib.priority}) overwrites [${loserModIds.join(", ")}]`,
        });
      }
    }

    return {
      resolvedFiles,
      conflicts,
    };
  }
}
