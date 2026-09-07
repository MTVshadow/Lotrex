import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parse } from "simple-vdf";

import getVortexPath from "../getVortexPath";

interface ISteamLibraryCacheEntry {
  fingerprint: string;
  paths: string[];
}

const libraryCache = new Map<string, ISteamLibraryCacheEntry>();

export interface ISteamLibraryDiscoveryOptions {
  signal?: AbortSignal;
}

function abortDiscovery(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;
  const error = new Error("Steam library discovery was cancelled.");
  Object.assign(error, { code: "ECANCELED" });
  throw error;
}

function steamLibraryFingerprint(stats: fs.Stats): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(":");
}

/**
 * Default Steam installation paths for Linux systems
 * Ordered by likelihood (most common first)
 */
export function getLinuxSteamPaths(): string[] {
  let home: string | undefined;
  try {
    home = getVortexPath("home");
  } catch {
    // ApplicationData may not be initialized in isolated environments or tests
  }
  if (!home) {
    home = process.env.HOME || os.homedir();
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  return Array.from(
    new Set([
      ...(xdgDataHome ? [path.join(xdgDataHome, "Steam")] : []),
      path.join(home, ".local", "share", "Steam"), // XDG standard (native)
      path.join(home, ".steam", "debian-installation"), // Debian/Ubuntu symlink
      path.join(home, ".steam", "root"), // Arch Linux symlink
      path.join(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"), // Flatpak
      path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
      path.join(home, "snap", "steam", "common", ".local", "share", "Steam"), // Snap
      path.join(home, ".steam", "steam"), // Legacy
    ]),
  );
}

/**
 * Extract Steam library roots from either the current object-based VDF shape or
 * the legacy string-based shape. Numeric keys are not guaranteed to be contiguous.
 */
export function extractSteamLibraryPaths(libraryFolders: unknown, basePath: string): string[] {
  if (libraryFolders === null || typeof libraryFolders !== "object") {
    return [basePath];
  }

  const discovered = Object.entries(libraryFolders)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, value]) => {
      if (typeof value === "string") {
        return value;
      }
      if (value !== null && typeof value === "object" && "path" in value) {
        const libraryPath = value.path;
        return typeof libraryPath === "string" ? libraryPath : undefined;
      }
      return undefined;
    })
    .filter((libraryPath): libraryPath is string => Boolean(libraryPath));

  return Array.from(new Set([basePath, ...discovered]));
}

/**
 * Check if a path is a valid Steam installation
 */
export function isValidSteamPath(steamPath: string): boolean {
  const libraryFoldersPath = path.join(steamPath, "config", "libraryfolders.vdf");
  try {
    fs.statSync(libraryFoldersPath);
    return true;
  } catch {
    return false;
  }
}

/** Read all library roots from a Steam installation without scanning game manifests. */
export function discoverLinuxSteamLibraries(steamPath: string): string[] {
  const libraryFoldersPath = path.join(steamPath, "config", "libraryfolders.vdf");
  try {
    const stats = fs.statSync(libraryFoldersPath);
    const fingerprint = steamLibraryFingerprint(stats);
    const cached = libraryCache.get(steamPath);
    if (cached?.fingerprint === fingerprint) {
      return [...cached.paths];
    }

    const content = fs.readFileSync(libraryFoldersPath, "utf8");
    const parsed = parse(content) as Record<string, unknown>;
    const libraryFolders =
      parsed.libraryfolders ??
      Object.entries(parsed).find(([key]) => key.toLowerCase() === "libraryfolders")?.[1];
    const paths = extractSteamLibraryPaths(libraryFolders, steamPath);
    libraryCache.set(steamPath, { fingerprint, paths });
    return [...paths];
  } catch {
    libraryCache.delete(steamPath);
    return [steamPath];
  }
}

/** Read Steam library metadata asynchronously and allow cancellation around filesystem I/O. */
export async function discoverLinuxSteamLibrariesAsync(
  steamPath: string,
  options: ISteamLibraryDiscoveryOptions = {},
): Promise<string[]> {
  const libraryFoldersPath = path.join(steamPath, "config", "libraryfolders.vdf");
  abortDiscovery(options.signal);
  try {
    const stats = await fs.promises.stat(libraryFoldersPath);
    abortDiscovery(options.signal);
    const fingerprint = steamLibraryFingerprint(stats);
    const cached = libraryCache.get(steamPath);
    if (cached?.fingerprint === fingerprint) return [...cached.paths];

    const content = await fs.promises.readFile(libraryFoldersPath, "utf8");
    abortDiscovery(options.signal);
    const parsed = parse(content) as Record<string, unknown>;
    const libraryFolders =
      parsed.libraryfolders ??
      Object.entries(parsed).find(([key]) => key.toLowerCase() === "libraryfolders")?.[1];
    const paths = extractSteamLibraryPaths(libraryFolders, steamPath);
    libraryCache.set(steamPath, { fingerprint, paths });
    return [...paths];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ECANCELED") throw error;
    libraryCache.delete(steamPath);
    return [steamPath];
  }
}

/** Clear cached Steam library metadata after an explicit installation change. */
export function invalidateLinuxSteamLibraryCache(steamPath?: string): void {
  if (steamPath === undefined) {
    libraryCache.clear();
  } else {
    libraryCache.delete(steamPath);
  }
}

/**
 * Find the first valid Steam installation path on Linux
 */
export function findLinuxSteamPath(): string | undefined {
  for (const steamPath of getLinuxSteamPaths()) {
    if (isValidSteamPath(steamPath)) {
      return steamPath;
    }
  }
  return undefined;
}
