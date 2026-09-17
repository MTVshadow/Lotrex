import * as path from "node:path";

import type { IUnifiedGameInstallation } from "../gameIdentity/contracts";
import { areSamePhysicalPath, getCanonicalPath } from "../gameIdentity/identityEngine";
import type { DuplicateCategory, ILibraryDuplicateSummary } from "./contracts";

/**
 * Analyzes a collection of unified game installations to identify, categorize,
 * and provide explainable summaries of duplicates across launchers, physical disks, and editions.
 *
 * Implements Phase 4 acceptance criteria:
 * Users can immediately distinguish duplicate installs, multi-launcher origins, and distinct editions.
 */
export class DuplicateAnalyzer {
  /**
   * Evaluates the duplicate status for each installation in the provided collection.
   */
  public analyzeAll(
    installations: IUnifiedGameInstallation[],
  ): Map<string, ILibraryDuplicateSummary> {
    const results = new Map<string, ILibraryDuplicateSummary>();

    // Step 1: Map physical paths to identify multi-launcher aliases
    const physicalPathMap = new Map<string, IUnifiedGameInstallation[]>();
    for (const inst of installations) {
      const canonical = getCanonicalPath(inst.installPath);
      const group = physicalPathMap.get(canonical) ?? [];
      group.push(inst);
      physicalPathMap.set(canonical, group);
    }

    // Step 2: Group by gameId + editionId to identify multiple physical installations
    const editionGroupMap = new Map<string, IUnifiedGameInstallation[]>();
    for (const inst of installations) {
      const editionKey = `${inst.identity.gameId}:::${inst.identity.editionId}`;
      const group = editionGroupMap.get(editionKey) ?? [];
      group.push(inst);
      editionGroupMap.set(editionKey, group);
    }

    // Step 3: Group by gameId to identify distinct editions of the same franchise/game
    const franchiseMap = new Map<string, IUnifiedGameInstallation[]>();
    for (const inst of installations) {
      const group = franchiseMap.get(inst.identity.gameId) ?? [];
      group.push(inst);
      franchiseMap.set(inst.identity.gameId, group);
    }

    // Step 4: Evaluate each installation against these structural groupings
    for (const inst of installations) {
      const canonical = getCanonicalPath(inst.installPath);
      const pathGroup = physicalPathMap.get(canonical) ?? [inst];
      const editionKey = `${inst.identity.gameId}:::${inst.identity.editionId}`;
      const editionGroup = editionGroupMap.get(editionKey) ?? [inst];
      const franchiseGroup = franchiseMap.get(inst.identity.gameId) ?? [inst];

      // Case A: Multi-launcher: single physical directory with multiple launcher sources
      if (inst.discoverySources.length > 1 || pathGroup.length > 1) {
        const launchers = Array.from(new Set(inst.discoverySources.map((s) => s.launcher)));
        const explanation =
          launchers.length > 1
            ? `Same physical installation tracked by multiple launchers (${launchers.join(
                ", ",
              )}) at ${inst.installPath}. Updates and DRM remain owned by the respective launcher.`
            : `Multiple discovery passes registered at the same filesystem path: ${inst.installPath}.`;

        results.set(inst.installationId, {
          category: "multi-launcher",
          isDuplicate: true,
          duplicateGroupKey: `path:${canonical}`,
          duplicateIndex: 1,
          totalInGroup: Math.max(inst.discoverySources.length, pathGroup.length),
          otherLocations: [],
          explanation,
          explanationMessage:
            launchers.length > 1
              ? {
                  key: "unified_library::service::duplicates::multiple_launchers",
                  values: { launchers: launchers.join(", "), path: inst.installPath },
                }
              : {
                  key: "unified_library::service::duplicates::same_path",
                  values: { path: inst.installPath },
                },
        });
        continue;
      }

      // Case B: Multi-install: same gameId and same editionId installed in multiple physical locations
      if (editionGroup.length > 1) {
        const index = editionGroup.findIndex((item) => item.installationId === inst.installationId);
        const otherLocations = editionGroup
          .filter((item) => item.installationId !== inst.installationId)
          .map((item) => `${item.installPath} (${item.identity.owningLauncher})`);

        results.set(inst.installationId, {
          category: "multi-install",
          isDuplicate: true,
          duplicateGroupKey: `edition:${editionKey}`,
          duplicateIndex: index + 1,
          totalInGroup: editionGroup.length,
          otherLocations,
          explanation: `Duplicate installation of ${inst.identity.gameId} [${inst.identity.editionId}] (Copy ${
            index + 1
          } of ${editionGroup.length}). Installed at ${
            inst.installPath
          }. Other copy at: ${otherLocations.join(", ")}. Each copy maintains independent profile bindings.`,
          explanationMessage: {
            key: "unified_library::service::duplicates::multiple_installations",
            values: {
              copy: index + 1,
              edition: inst.identity.editionId,
              gameId: inst.identity.gameId,
              locations: otherLocations.join(", "),
              path: inst.installPath,
              total: editionGroup.length,
            },
          },
        });
        continue;
      }

      // Case C: Distinct edition: multiple installations sharing gameId but different editionId
      if (franchiseGroup.length > 1) {
        const otherEditions = franchiseGroup
          .filter((item) => item.installationId !== inst.installationId)
          .map(
            (item) =>
              `${item.identity.editionId} at ${item.installPath} (${item.identity.owningLauncher})`,
          );

        results.set(inst.installationId, {
          category: "distinct-edition",
          isDuplicate: false, // Not a duplicate install of the same game edition, but a distinct edition
          duplicateGroupKey: `franchise:${inst.identity.gameId}`,
          duplicateIndex: 1,
          totalInGroup: franchiseGroup.length,
          otherLocations: otherEditions,
          explanation: `Distinct edition '${inst.identity.editionId}' of ${inst.identity.gameId}. Kept strictly isolated from other editions (${otherEditions.join(
            ", ",
          )}) to prevent save/mod corruption.`,
          explanationMessage: {
            key: "unified_library::service::duplicates::distinct_edition",
            values: {
              edition: inst.identity.editionId,
              gameId: inst.identity.gameId,
              otherEditions: otherEditions.join(", "),
            },
          },
        });
        continue;
      }

      // Case D: Unique installation
      results.set(inst.installationId, {
        category: "none",
        isDuplicate: false,
        duplicateGroupKey: inst.installationId,
        duplicateIndex: 1,
        totalInGroup: 1,
        otherLocations: [],
        explanation: "Unique installation on host system.",
        explanationMessage: { key: "unified_library::service::duplicates::unique" },
      });
    }

    return results;
  }
}
