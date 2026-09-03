import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
  return [
    path.join(home, ".local", "share", "Steam"), // XDG standard (native)
    path.join(home, ".steam", "debian-installation"), // Debian/Ubuntu symlink
    path.join(home, ".steam", "root"), // Arch Linux symlink
    path.join(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"), // Flatpak
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    path.join(home, "snap", "steam", "common", ".local", "share", "Steam"), // Snap
    path.join(home, ".steam", "steam"), // Legacy
  ];
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
