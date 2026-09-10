import * as path from "node:path";

import {
  getAllRegisteredBoundedSources,
  getHeroicBoundedSources,
  getLutrisBoundedSources,
  getSteamBoundedSources,
  type IBoundedSourceDescriptor,
} from "./boundedSources";
import {
  validateDiscoveredResource,
  type DiscoveredResourceKind,
  type DiscoveryProviderId,
  type IDiscoveredResource,
} from "./contracts";
import { discoverHeroicResources } from "./providers/heroicProvider";
import { discoverLutrisResources } from "./providers/lutrisProvider";
import { discoverSteamResources } from "./providers/steamProvider";

export interface IResourceDiscoveryOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  customRoots?: string[];
  providers?: DiscoveryProviderId[];
  kinds?: DiscoveredResourceKind[];
  signal?: AbortSignal;
}

export interface IDiscoveryExecutionReport {
  scannedSourcesCount: number;
  resources: IDiscoveredResource[];
  errors: Array<{ provider: string; message: string }>;
}

/**
 * Головний рушій уніфікованого пошуку ресурсів Linux (Unified Linux Resource Discovery).
 *
 * Освітній коментар:
 * Рушій реалізує строго обмежений пошук (Bounded Discovery):
 * замість неконтрольованого рекурсивного обходу диску (find /) він
 * опитує виключно зареєстровані точки XDG, маніфести Steam/Heroic,
 * базу pga.db Lutris та схвалені користувачем додаткові шляхи.
 */
export async function runUnifiedResourceDiscovery(
  options: IResourceDiscoveryOptions = {},
): Promise<IDiscoveryExecutionReport> {
  const {
    homeDir,
    env = process.env,
    customRoots = [],
    providers = ["steam", "heroic", "lutris"],
    kinds,
    signal,
  } = options;

  if (signal?.aborted) {
    const error = new Error("Resource discovery was cancelled");
    Object.assign(error, { code: "ECANCELED" });
    throw error;
  }

  const allDiscovered: IDiscoveredResource[] = [];
  const errors: Array<{ provider: string; message: string }> = [];
  let scannedSourcesCount = 0;

  // 1. Steam Provider
  if (providers.includes("steam")) {
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      const steamSources = getSteamBoundedSources(homeDir, env, customRoots);
      scannedSourcesCount += steamSources.length;
      const steamResources = discoverSteamResources(steamSources);
      allDiscovered.push(...steamResources);
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push({
        provider: "steam",
        message: err instanceof Error ? err.message : "Unknown steam discovery error",
      });
    }
  }

  // 2. Heroic Provider
  if (providers.includes("heroic")) {
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      const heroicSources = getHeroicBoundedSources(homeDir, env);
      scannedSourcesCount += heroicSources.length;
      const heroicResources = discoverHeroicResources(heroicSources);
      allDiscovered.push(...heroicResources);
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push({
        provider: "heroic",
        message: err instanceof Error ? err.message : "Unknown heroic discovery error",
      });
    }
  }

  // 3. Lutris Provider
  if (providers.includes("lutris")) {
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      const lutrisSources = getLutrisBoundedSources(homeDir, env);
      scannedSourcesCount += lutrisSources.length;
      const lutrisResources = discoverLutrisResources(lutrisSources);
      allDiscovered.push(...lutrisResources);
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push({
        provider: "lutris",
        message: err instanceof Error ? err.message : "Unknown lutris discovery error",
      });
    }
  }

  // Валідація контрактів та фільтрація за запитаними типами (kinds)
  const validResources = allDiscovered.filter((r) => {
    if (!validateDiscoveredResource(r)) return false;
    if (kinds && kinds.length > 0 && !kinds.includes(r.kind)) return false;
    return true;
  });

  // Дедуплікація за унікальним id
  const deduplicated = Array.from(new Map(validResources.map((res) => [res.id, res])).values());

  return {
    scannedSourcesCount,
    resources: deduplicated,
    errors,
  };
}
