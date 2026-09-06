export function detectAppContainerSupport(
  platform: NodeJS.Platform,
  probe: (() => boolean) | undefined,
): boolean {
  if (platform !== "win32" || probe === undefined) {
    return false;
  }

  try {
    return probe();
  } catch {
    return false;
  }
}
