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

export interface IProtonRuntimeDiscoveryProgress {
  completed: number;
  directory: string;
  total: number;
}

export interface IProtonRuntimeDiscoveryOptions {
  onProgress?: (progress: IProtonRuntimeDiscoveryProgress) => void;
  signal?: AbortSignal;
}

interface IRuntimeCacheEntry {
  fingerprint: string;
  runtimes: IProtonRuntimeOption[];
}

let runtimeCache: IRuntimeCacheEntry | undefined;

function cloneRuntimes(runtimes: IProtonRuntimeOption[]): IProtonRuntimeOption[] {
  return runtimes.map((runtime) => ({ ...runtime }));
}

function directoryFingerprint(directories: string[]): string {
  return directories
    .map((directory) => {
      try {
        const stats = fs.statSync(directory);
        return [directory, stats.dev, stats.ino, stats.mtimeMs, stats.ctimeMs].join(":");
      } catch {
        return `${directory}:missing`;
      }
    })
    .join("|");
}

async function directoryFingerprintAsync(directories: string[]): Promise<string> {
  const entries = await Promise.all(
    directories.map(async (directory) => {
      try {
        const stats = await fs.promises.stat(directory);
        return [directory, stats.dev, stats.ino, stats.mtimeMs, stats.ctimeMs].join(":");
      } catch {
        return `${directory}:missing`;
      }
    }),
  );
  return entries.join("|");
}

function abortRuntimeDiscovery(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;
  const error = new Error("Proton runtime discovery was cancelled.");
  Object.assign(error, { code: "ECANCELED" });
  throw error;
}

function classifyRuntime(entry: string): ProtonRuntimeType {
  if (/GE-Proton/i.test(entry)) return "ge-proton";
  if (/experimental/i.test(entry)) return "experimental";
  if (/proton/i.test(entry)) return "steam-selected";
  return "custom";
}

function protonCandidateDirectories(
  steamPath?: string,
): Array<{ dir: string; source: "steamapps" | "compatibilitytools.d" }> {
  const home = os.homedir();
  const searchRoots = new Set(getLinuxSteamPaths());
  if (steamPath) searchRoots.add(steamPath);
  const candidates = Array.from(searchRoots).flatMap((steamRoot) => [
    { dir: path.join(steamRoot, "steamapps", "common"), source: "steamapps" as const },
    {
      dir: path.join(steamRoot, "compatibilitytools.d"),
      source: "compatibilitytools.d" as const,
    },
  ]);
  candidates.push(
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
  return Array.from(
    new Map(
      candidates.map((candidate) => {
        try {
          const resolvedDirectory = fs.realpathSync(candidate.dir);
          return [resolvedDirectory, { ...candidate, dir: resolvedDirectory }] as const;
        } catch {
          return [candidate.dir, candidate] as const;
        }
      }),
    ).values(),
  );
}

function isWithinPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/** Validate a user-provided Proton runtime directory. */
export interface ICustomProtonValidationOptions {
  approvedPath?: string;
  currentUid?: number;
  requireApproval?: boolean;
  untrustedRoots?: string[];
  stagingPaths?: string[];
  downloadPaths?: string[];
  checkDefaultUntrustedRoots?: boolean;
}

export interface ICustomProtonValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Returns default untrusted filesystem roots where executables must never be loaded from:
 * - Temporary directories (/tmp, /var/tmp, /dev/shm, os.tmpdir())
 * - User Downloads directory
 * - User Cache directory (~/.cache)
 */
export function getDefaultUntrustedRuntimeRoots(): string[] {
  const home = os.homedir();
  const roots = [
    os.tmpdir(),
    "/tmp",
    "/var/tmp",
    "/dev/shm",
    path.join(home, "Downloads"),
    path.join(home, ".cache"),
  ];
  return Array.from(new Set(roots.map((r) => path.resolve(r))));
}

/** Validate a user-provided Proton runtime directory. */
export function validateCustomProtonPath(
  customPath: string,
  options: ICustomProtonValidationOptions = {},
): ICustomProtonValidationResult {
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

  // Enforce trust boundaries: reject runtimes placed in Downloads, temp directories, or mod staging
  const defaultRoots =
    options.checkDefaultUntrustedRoots !== false ? getDefaultUntrustedRuntimeRoots() : [];
  const allUntrustedRoots = [
    ...defaultRoots,
    ...(options.untrustedRoots ?? []),
    ...(options.stagingPaths ?? []),
    ...(options.downloadPaths ?? []),
  ];

  const untrustedRoot = allUntrustedRoots.find(
    (root) => root.trim().length > 0 && isWithinPath(root, resolvedRuntime),
  );
  if (untrustedRoot !== undefined) {
    return {
      valid: false,
      error: `The custom Proton runtime cannot be loaded from unsafe temporary, download, or staging content: ${resolvedRuntime}`,
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

    // World-writable check (0o002) - strict rejection
    if ((runtimeStats.mode & 0o002) !== 0 || (protonStats.mode & 0o002) !== 0) {
      return {
        valid: false,
        error: "The custom Proton runtime cannot be writable by other users.",
      };
    }

    // Group-writable check (0o020)
    if ((runtimeStats.mode & 0o020) !== 0 || (protonStats.mode & 0o020) !== 0) {
      return {
        valid: false,
        error: "The custom Proton runtime cannot be writable by group or other users.",
      };
    }

    // Check parent directories up to root: reject if any ancestor is world-writable without sticky bit (TOCTOU protection)
    let currentParent = path.dirname(resolvedRuntime);
    while (currentParent !== path.dirname(currentParent)) {
      try {
        const pStats = fs.statSync(currentParent);
        if ((pStats.mode & 0o002) !== 0 && (pStats.mode & 0o1000) === 0) {
          return {
            valid: false,
            error: `A parent directory of the custom Proton runtime is writable by other users without a sticky bit: ${currentParent}`,
          };
        }
      } catch {
        break;
      }
      currentParent = path.dirname(currentParent);
    }
  }

  return { valid: true };
}

/** Discover installed Steam, Experimental, GE-Proton, and custom compatibility tools. */
export function discoverAvailableProtonRuntimes(steamPath?: string): IProtonRuntimeOption[] {
  const deduplicatedCandidateDirs = protonCandidateDirectories(steamPath);
  const fingerprint = directoryFingerprint(
    deduplicatedCandidateDirs.map((candidate) => candidate.dir),
  );
  if (runtimeCache?.fingerprint === fingerprint) {
    return cloneRuntimes(runtimeCache.runtimes);
  }

  const seenPaths = new Set<string>();
  const runtimes: IProtonRuntimeOption[] = [];

  for (const { dir, source } of deduplicatedCandidateDirs) {
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

          runtimes.push({
            id: entry,
            name: entry,
            type: classifyRuntime(entry),
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

  runtimes.sort((left, right) => left.name.localeCompare(right.name));
  runtimeCache = { fingerprint, runtimes };
  return cloneRuntimes(runtimes);
}

/** Discover runtimes incrementally without blocking the renderer between search roots. */
export async function discoverAvailableProtonRuntimesAsync(
  steamPath?: string,
  options: IProtonRuntimeDiscoveryOptions = {},
): Promise<IProtonRuntimeOption[]> {
  const candidates = protonCandidateDirectories(steamPath);
  abortRuntimeDiscovery(options.signal);
  const fingerprint = await directoryFingerprintAsync(candidates.map((candidate) => candidate.dir));
  abortRuntimeDiscovery(options.signal);
  if (runtimeCache?.fingerprint === fingerprint) return cloneRuntimes(runtimeCache.runtimes);

  const seenPaths = new Set<string>();
  const runtimes: IProtonRuntimeOption[] = [];
  for (const [index, { dir, source }] of candidates.entries()) {
    abortRuntimeDiscovery(options.signal);
    try {
      const entries = await fs.promises.readdir(dir);
      for (const entry of entries) {
        abortRuntimeDiscovery(options.signal);
        const fullPath = path.join(dir, entry);
        if (seenPaths.has(fullPath)) continue;
        const protonBin = path.join(fullPath, "proton");
        try {
          await fs.promises.access(protonBin, fs.constants.F_OK);
        } catch {
          continue;
        }
        seenPaths.add(fullPath);
        let isUsable = true;
        try {
          await fs.promises.access(protonBin, fs.constants.X_OK);
        } catch {
          isUsable = false;
        }
        runtimes.push({
          id: entry,
          isUsable,
          name: entry,
          path: fullPath,
          source,
          type: classifyRuntime(entry),
        });
      }
    } catch {
      // Optional runtime roots may be missing or inaccessible.
    }
    options.onProgress?.({ completed: index + 1, directory: dir, total: candidates.length });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  runtimes.sort((left, right) => left.name.localeCompare(right.name));
  abortRuntimeDiscovery(options.signal);
  runtimeCache = { fingerprint, runtimes };
  return cloneRuntimes(runtimes);
}

/** Clear cached runtime discovery after an explicit compatibility-tool change. */
export function invalidateProtonRuntimeCache(): void {
  runtimeCache = undefined;
}
