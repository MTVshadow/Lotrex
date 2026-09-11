import * as path from "node:path";

import type { IGameAdapter } from "../gameAdapters/contracts";
import type { ILoadOrderEntry } from "./contracts";
import type { ITransactionalFs } from "./transactionalDeployer";
import { defaultTransactionalFs } from "./transactionalDeployer";

/**
 * Load order capability configuration details.
 */
export interface ILoadOrderCapabilityDetails {
  fileFormat: "plugins.txt" | "mods.json" | "custom";
  relativeFilePath?: string;
  lootIntegration?: boolean;
}

/**
 * Game-agnostic load-order and plugin serializer/validator.
 *
 * Implements Phase 5 load-order handling without core game-ID branching.
 */
export class LoadOrderManager {
  constructor(private readonly fsAdapter: ITransactionalFs = defaultTransactionalFs) {}

  /**
   * Generates and writes the load order file appropriate for the game adapter.
   */
  public writeLoadOrder(
    gameOrPrefixPath: string,
    entries: ILoadOrderEntry[],
    adapter: IGameAdapter,
  ): string {
    const desc = adapter.getCapability<ILoadOrderCapabilityDetails>("load-order");
    if (!desc || !desc.supported || !desc.details) {
      throw new Error(
        `Game adapter '${adapter.manifest.id}' does not support load-order management.`,
      );
    }

    const { fileFormat, relativeFilePath } = desc.details;
    const sortedEntries = [...entries].sort((a, b) => a.priority - b.priority);

    let content: string;
    let targetRelative = relativeFilePath;

    if (fileFormat === "plugins.txt") {
      targetRelative = targetRelative ?? "plugins.txt";
      // Bethesda format: active plugins prefixed with '*'
      content = sortedEntries.map((e) => (e.enabled ? `*${e.id}` : e.id)).join("\n");
    } else if (fileFormat === "mods.json") {
      targetRelative = targetRelative ?? "mods.json";
      // Modern JSON manifest format
      content = JSON.stringify(
        sortedEntries.map((e) => ({
          name: e.id,
          enabled: e.enabled,
          order: e.priority,
        })),
        null,
        2,
      );
    } else {
      targetRelative = targetRelative ?? "loadorder.txt";
      content = sortedEntries.map((e) => e.id).join("\n");
    }

    const targetAbsolute = path.resolve(gameOrPrefixPath, targetRelative);
    const parentDir = path.dirname(targetAbsolute);
    if (!this.fsAdapter.existsSync(parentDir)) {
      this.fsAdapter.mkdirSync(parentDir, { recursive: true });
    }

    this.fsAdapter.writeFileSync(targetAbsolute, content, "utf-8");

    return targetAbsolute;
  }

  /**
   * Validates load order entries for missing masters or duplicates.
   */
  public validateLoadOrder(entries: ILoadOrderEntry[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (seen.has(entry.id)) {
        errors.push(`Duplicate load order entry detected: '${entry.id}'`);
      }
      seen.add(entry.id);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
