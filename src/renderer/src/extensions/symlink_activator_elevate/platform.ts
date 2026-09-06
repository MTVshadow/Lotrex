export function supportsElevatedSymlinkPlatform(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}
