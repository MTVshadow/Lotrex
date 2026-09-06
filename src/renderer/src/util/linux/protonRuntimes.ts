import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getLinuxSteamPaths } from "./steamPaths";

export type ProtonRuntimeType = "auto" | "steam-selected" | "experimental" | "ge-proton" | "custom";

export interface IProtonRuntimeOption {
  id: string;
  name: string;
  type: ProtonRuntimeType;
  path: string;
  isUsable: boolean;
  source: "steamapps" | "compatibilitytools.d" | "custom";
  version?: string;
}

export interface ICustomProtonValidationOptions {
  approvedPath?: string;
  currentUid?: number;
  requireApproval?: boolean;
  untrustedRoots?: string[];
}

function isWithinPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/** Validate a user-provided Proton runtime directory. */
export function validateCustomProtonPath(
  customPath: string,
  options: ICustomProtonValidationOptions = {},
): { valid: boolean; error?: string } {
  if (!customPath || customPath.trim().length === 0) {
    return { valid: false, error: "The Proton runtime path cannot be empty." };
  }

  const normalized = path.resolve(customPath);
  if (
    options.requireApproval === true &&
    (options.approvedPath === undefined || path.resolve(options.approvedPath) !== normalized)
  ) {
    return {
      valid: false,
      error: "This custom Proton runtime must be selected again to confirm that you trust it.",
    };
  }
  if (!fs.existsSync(normalized)) {
    return { valid: false, error: `The selected directory does not exist: ${normalized}` };
  }

  const protonBin = path.join(normalized, "proton");
  if (!fs.existsSync(protonBin)) {
    return {
      valid: false,
      error: `The selected directory does not contain the required 'proton' script: ${protonBin}`,
    };
  }

  let resolvedRuntime: string;
  try {
    resolvedRuntime = fs.realpathSync(normalized);
  } catch {
    return { valid: false, error: `The selected Proton runtime path cannot be resolved safely.` };
  }
  const untrustedRoot = options.untrustedRoots?.find(
    (root) => root.trim().length > 0 && isWithinPath(root, resolvedRuntime),
  );
  if (untrustedRoot !== undefined) {
    return {
      valid: false,
      error: `The custom Proton runtime cannot be loaded from managed game or staging content: ${resolvedRuntime}`,
    };
  }

  try {
    fs.accessSync(protonBin, fs.constants.X_OK);
  } catch {
    return {
      valid: false,
      error: `The Proton script is not executable (+x): ${protonBin}`,
    };
  }

  const currentUid = options.currentUid ?? process.getuid?.();
  if (currentUid !== undefined) {
    let runtimeStats: fs.Stats;
    let protonStats: fs.Stats;
    try {
      runtimeStats = fs.statSync(resolvedRuntime);
      protonStats = fs.statSync(fs.realpathSync(protonBin));
    } catch {
      return {
        valid: false,
        error: "The custom Proton runtime ownership or permissions could not be verified.",
      };
    }
    if (runtimeStats.uid !== currentUid || protonStats.uid !== currentUid) {
      return {
        valid: false,
        error: "The custom Proton runtime and its script must be owned by the current user.",
      };
    }
    if ((runtimeStats.mode & 0o022) !== 0 || (protonStats.mode & 0o022) !== 0) {
      return {
        valid: false,
        error: "The custom Proton runtime cannot be writable by group or other users.",
      };
    }
  }

  return { valid: true };
}

/** Discover installed Steam, Experimental, GE-Proton, and custom compatibility tools. */
export function discoverAvailableProtonRuntimes(steamPath?: string): IProtonRuntimeOption[] {
  const home = os.homedir();
  const searchRoots = new Set<string>();

  if (steamPath) {
    searchRoots.add(steamPath);
  }

  for (const sPath of getLinuxSteamPaths()) {
    searchRoots.add(sPath);
  }

  const candidateDirs: Array<{ dir: string; source: "steamapps" | "compatibilitytools.d" }> = [];

  for (const sRoot of searchRoots) {
    candidateDirs.push(
      { dir: path.join(sRoot, "steamapps", "common"), source: "steamapps" },
      { dir: path.join(sRoot, "compatibilitytools.d"), source: "compatibilitytools.d" },
    );
  }

  candidateDirs.push(
    {
      dir: path.join(home, ".local", "share", "Steam", "compatibilitytools.d"),
      source: "compatibilitytools.d",
    },
    {
      dir: path.join(
        home,
        ".var",
        "app",
        "com.valvesoftware.Steam",
        "data",
        "Steam",
        "compatibilitytools.d",
      ),
      source: "compatibilitytools.d",
    },
  );

  const seenPaths = new Set<string>();
  const runtimes: IProtonRuntimeOption[] = [];

  for (const { dir, source } of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (seenPaths.has(fullPath)) continue;

        const protonBin = path.join(fullPath, "proton");
        if (fs.existsSync(protonBin)) {
          seenPaths.add(fullPath);

          let isUsable = true;
          try {
            fs.accessSync(protonBin, fs.constants.X_OK);
          } catch {
            isUsable = false;
          }

          let type: ProtonRuntimeType = "custom";
          if (/GE-Proton/i.test(entry)) {
            type = "ge-proton";
          } else if (/experimental/i.test(entry)) {
            type = "experimental";
          } else if (/proton/i.test(entry)) {
            type = "steam-selected";
          }

          runtimes.push({
            id: entry,
            name: entry,
            type,
            path: fullPath,
            isUsable,
            source,
          });
        }
      }
    } catch {
      // An inaccessible optional runtime directory should not abort discovery.
    }
  }

  return runtimes;
}
