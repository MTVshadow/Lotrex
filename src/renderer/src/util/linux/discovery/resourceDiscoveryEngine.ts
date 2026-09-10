import * as path from "node:path";

import {
  getAllRegisteredBoundedSources,
  getHeroicBoundedSources,
  getLutrisBoundedSources,
  getSteamBoundedSources,
  type IBoundedSourceDescriptor,
} from "./boundedSources";
import { validateResourceCandidate } from "./candidateValidation";
import { deduplicateAndMergeResources } from "./canonicalization";
import {
  validateDiscoveredResource,
  type DiscoveredResourceKind,
  type DiscoveryProviderId,
  type IDiscoveredResource,
  type PackagingFormat,
} from "./contracts";
import { assessSandboxVisibility, detectPackagingFormat } from "./packagingAndSandbox";
import { discoverHeroicResources } from "./providers/heroicProvider";
import { discoverLutrisResources } from "./providers/lutrisProvider";
import { discoverSteamResources } from "./providers/steamProvider";

export interface IResourceDiscoveryOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  customRoots?: string[];
  providers?: DiscoveryProviderId[];
  kinds?: DiscoveredResourceKind[];
  hostPackaging?: PackagingFormat;
  strictExecutableValidation?: boolean;
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

  const hostPackaging = options.hostPackaging || detectPackagingFormat(undefined, env).format;

  // Фаза 3 & 4: Оцінка пісочниці та поглиблена валідація кандидатів
  const enrichedResources: IDiscoveredResource[] = allDiscovered.map((res) => {
    // Оцінка видимості пісочниці окремо від фізичного існування шляху
    const sandboxAssessment = assessSandboxVisibility(res.canonicalPath, hostPackaging, {
      env,
      appId: res.packagingContext.appId,
    });

    let currentValidation = res.validationState;
    let currentConfidence = res.confidence;

    // Поглиблена перевірка кандидата для рантаймів або при запиті суворої перевірки
    if (res.kind === "compatibility-runtime") {
      const candidateCheck = validateResourceCandidate(res.canonicalPath, {
        requiredSubpaths: ["proton"],
        manifestOwned: res.evidence.some((e) => e.sourceType === "manifest"),
      });
      currentValidation = candidateCheck.validationState;
      currentConfidence = candidateCheck.confidence;
    } else if (options.strictExecutableValidation) {
      const candidateCheck = validateResourceCandidate(res.canonicalPath, {
        manifestOwned: res.evidence.some((e) => e.sourceType === "manifest"),
      });
      currentValidation = candidateCheck.validationState;
      currentConfidence = candidateCheck.confidence;
    }

    return {
      ...res,
      packagingContext: {
        ...res.packagingContext,
        sandboxVisibility: sandboxAssessment.visibility,
      },
      validationState: currentValidation,
      confidence: currentConfidence,
      remediation: sandboxAssessment.remediation || res.remediation,
    };
  });

  // Фаза 5: Канонізація, розв'язання симлінків, злиття свідчень та фізична дедуплікація
  const deduplicated = deduplicateAndMergeResources(enrichedResources);

  // Валідація контрактів та фільтрація за запитаними типами (kinds)
  const validResources = deduplicated.filter((r) => {
    if (!validateDiscoveredResource(r)) return false;
    if (kinds && kinds.length > 0 && !kinds.includes(r.kind)) return false;
    return true;
  });

  return {
    scannedSourcesCount,
    resources: validResources,
    errors,
  };
}
