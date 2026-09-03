import * as path from "path";

export function suggestStagingPathPattern(
  platform: NodeJS.Platform,
  sameFileSystem: boolean,
  gamePath: string,
  directoryName: string,
  windowsVolume?: string,
): string {
  if (sameFileSystem) {
    return path.join("{USERDATA}", "{game}", "mods");
  }

  if (platform === "win32") {
    return path.join(windowsVolume, directoryName, "{game}");
  }

  // Hardlinks cannot cross filesystems. Keep staging outside the game directory,
  // but beside it so it remains on the same mounted filesystem on Linux/macOS.
  return path.join(path.dirname(gamePath), directoryName, "{game}");
}
