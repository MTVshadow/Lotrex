import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { IBoundedSourceDescriptor } from "./boundedSources";
import { validateDiscoveredResource, type IDiscoveredResource } from "./contracts";

export interface IConformanceFixturePaths {
  rootDir: string;
  steamDataDir: string;
  heroicConfigDir: string;
  lutrisDataDir: string;
  removableStorageDir: string;
}

export interface IProviderConformanceResult {
  provider: string;
  ruleName: string;
  passed: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Creates directory fixtures representing common Linux desktop layouts.
 *
 * Educational comment:
 * Sets up bounded directories for Steam, Heroic, Lutris, and external mount points
 * to test provider resilience against edge cases (corrupt files, symlinks, permissions).
 */
export async function setupConformanceFixtures(baseDir: string): Promise<IConformanceFixturePaths> {
  const steamDataDir = path.join(baseDir, ".local", "share", "Steam");
  const heroicConfigDir = path.join(baseDir, ".config", "heroic");
  const lutrisDataDir = path.join(baseDir, ".local", "share", "lutris");
  const removableStorageDir = path.join(baseDir, "run", "media", "user", "ExternalSSD");

  await fs.mkdir(path.join(steamDataDir, "steamapps"), { recursive: true });
  await fs.mkdir(path.join(heroicConfigDir, "legendaryConfig", "legendary"), { recursive: true });
  await fs.mkdir(path.join(heroicConfigDir, "gog_store"), { recursive: true });
  await fs.mkdir(lutrisDataDir, { recursive: true });
  await fs.mkdir(removableStorageDir, { recursive: true });

  return {
    rootDir: baseDir,
    steamDataDir,
    heroicConfigDir,
    lutrisDataDir,
    removableStorageDir,
  };
}

/**
 * Asserts that all returned resources comply strictly with the Phase 1 contract.
 */
export function assertConformanceResourcesContract(
  resources: IDiscoveredResource[],
  providerName: string,
): void {
  for (const resource of resources) {
    if (!validateDiscoveredResource(resource)) {
      throw new Error(
        `[Conformance] Provider '${providerName}' produced an invalid resource contract: ${JSON.stringify(
          resource,
        )}`,
      );
    }
    if (resource.provider !== providerName && providerName !== "unified") {
      throw new Error(
        `[Conformance] Provider '${providerName}' produced resource with mismatched provider id '${resource.provider}'`,
      );
    }
  }
}
