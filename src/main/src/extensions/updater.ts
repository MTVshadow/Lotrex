/**
 * Updater Main Process
 * Handles auto-update functionality in the main process
 */

import { getErrorMessageOrDefault } from "@vortex/shared";

import { log } from "../logging";
import { setupAutoUpdater } from "./autoupdater";

export function shouldEnableAutoUpdater(
  installType: string,
  platform: NodeJS.Platform,
  environment: string | undefined,
): boolean {
  return installType === "regular" || (environment === "development" && platform === "win32");
}

/**
 * Initialize the updater in the main process.
 * Should be called once during application startup.
 *
 * @param installType Application install type ("regular", "managed", etc.)
 */
export function initUpdater(installType: string): void {
  const enabled = shouldEnableAutoUpdater(installType, process.platform, process.env.NODE_ENV);
  try {
    if (enabled) {
      setupAutoUpdater(installType);
    }
  } catch (err) {
    log("error", "failed to initialize updater", getErrorMessageOrDefault(err));
  }

  log("info", "updater initialized", {
    isPreviewBuild: process.env.IS_PREVIEW_BUILD,
    installType,
    enabled,
  });
}
