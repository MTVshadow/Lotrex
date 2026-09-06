import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parse } from "simple-vdf";

import getVortexPath from "../getVortexPath";

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
  try {
    const content = fs.readFileSync(path.join(steamPath, "config", "libraryfolders.vdf"), "utf8");
    const parsed = parse(content) as Record<string, unknown>;
    const libraryFolders =
      parsed.libraryfolders ??
      Object.entries(parsed).find(([key]) => key.toLowerCase() === "libraryfolders")?.[1];
    return extractSteamLibraryPaths(libraryFolders, steamPath);
  } catch {
    return [steamPath];
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
