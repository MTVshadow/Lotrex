import * as crypto from "node:crypto";
import * as path from "node:path";

import { assertArchiveDecompressionSafety } from "../archiveSafety";
import type { IAdapterInstallRule, IAdapterModType, IGameAdapter } from "../gameAdapters/contracts";
import { isWithinRoot } from "../pathSafety";
import type { IInspectedArchive, IInspectedArchiveEntry } from "./contracts";

/**
 * Simple glob-to-regex converter supporting standard patterns (* and **).
 */
function globToRegex(globPattern: string): RegExp {
  const alternates: string[] = [];
  const pattern = globPattern.replace(/\{([^}]+)\}/g, (_, group) => {
    const idx = alternates.length;
    alternates.push(`(?:${group.split(",").join("|")})`);
    return `___ALT_${idx}___`;
  });

  let regexStr = pattern
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "___GLOB_DOUBLE_STAR_SLASH___")
    .replace(/\*\*/g, "___GLOB_DOUBLE_STAR___")
    .replace(/\*/g, "___GLOB_STAR___")
    .replace(/\?/g, "___GLOB_QUESTION___")
    .replace(/___GLOB_DOUBLE_STAR_SLASH___/g, "(?:.*/)?")
    .replace(/___GLOB_DOUBLE_STAR___/g, ".*")
    .replace(/___GLOB_STAR___/g, "[^/]*")
    .replace(/___GLOB_QUESTION___/g, "[^/]");

  alternates.forEach((alt, idx) => {
    regexStr = regexStr.replace(`___ALT_${idx}___`, alt);
  });

  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * Inspects mod archives safely and determines installer mappings
 * using declarative adapter rules without branching core by game ID.
 */
export class ArchiveInspector {
  /**
   * Matches a relative file path against a list of declarative adapter install rules.
   */
  public matchInstallRule(filePath: string, rules: IAdapterInstallRule[]): string | null {
    const normalized = filePath.replace(/\\/g, "/");

    for (const rule of rules) {
      const regex = globToRegex(rule.pattern);
      if (regex.test(normalized) || regex.test(path.basename(normalized))) {
        return rule.destination;
      }
    }

    return null;
  }

  /**
   * Inspects a list of archive entries against adapter capabilities.
   */
  public inspectEntries(
    archivePath: string,
    rawEntries: Array<{ path: string; sizeBytes: number; isDirectory?: boolean }>,
    adapter: IGameAdapter,
  ): IInspectedArchive {
    // 1. Enforce archive containment and limit safety
    const totalSizeBytes = rawEntries.reduce((sum, e) => sum + e.sizeBytes, 0);
    assertArchiveDecompressionSafety({
      compressedSizeBytes: totalSizeBytes,
      uncompressedSizeBytes: totalSizeBytes,
      fileCount: rawEntries.length,
    });

    // 2. Fetch adapter declarative rules and mod types
    const installRulesDesc = adapter.getCapability<IAdapterInstallRule[]>("install-rules");
    const rules: IAdapterInstallRule[] = Array.isArray(installRulesDesc?.details)
      ? installRulesDesc.details
      : [];

    const modTypesDesc = adapter.getCapability<IAdapterModType[]>("mod-types");
    const modTypes: IAdapterModType[] = Array.isArray(modTypesDesc?.details)
      ? modTypesDesc.details
      : [];

    const defaultModType = modTypes[0]?.id ?? "default";
    const defaultDestination = modTypes[0]?.targetPath ?? "";

    const entries: IInspectedArchiveEntry[] = [];

    for (const raw of rawEntries) {
      // Security check: prevent directory traversal or absolute paths in archive entries
      const normalizedPath = path.normalize(raw.path).replace(/^(\/|\\)+/, "");
      if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
        throw new Error(`Malicious archive entry detected with directory traversal: '${raw.path}'`);
      }

      const isDir = raw.isDirectory ?? raw.path.endsWith("/");
      if (isDir) continue; // Only file leaves need destination mapping

      // Evaluate against adapter install rules
      const matchedDest = this.matchInstallRule(normalizedPath, rules);
      const destinationFolder = matchedDest ?? defaultDestination;

      const destinationRelPath =
        destinationFolder === "" ? normalizedPath : path.join(destinationFolder, normalizedPath);

      entries.push({
        path: normalizedPath,
        sizeBytes: raw.sizeBytes,
        isDirectory: false,
        destinationRelPath,
        modTypeId: defaultModType,
      });
    }

    const archiveSha256 = crypto.createHash("sha256").update(archivePath).digest("hex");

    return {
      archivePath,
      archiveSha256,
      entries,
      totalSizeBytes,
      fileCount: entries.length,
      suggestedModType: defaultModType,
    };
  }
}
