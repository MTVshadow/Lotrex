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
import { computeFilesystemFingerprint, DiscoveryCache } from "./discoveryCache";
import { assessSandboxVisibility, detectPackagingFormat } from "./packagingAndSandbox";
import {
  checkCancellation,
  enforceResourceLimits,
  withDiscoveryLimits,
  yieldToUiLoop,
  type IDiscoveryLimits,
  type IDiscoveryProgress,
} from "./progressAndLimits";
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
  cache?: DiscoveryCache;
  forceRefresh?: boolean;
  onProgress?: (progress: IDiscoveryProgress) => void;
  limits?: IDiscoveryLimits;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface IDiscoveryExecutionReport {
  scannedSourcesCount: number;
  resources: IDiscoveredResource[];
  errors: Array<{ provider: string; message: string }>;
}

/**
 * Unified Linux Resource Discovery Engine.
 *
 * Educational comment:
 * Orchestrates bounded discovery across Steam, Heroic, Lutris, and custom roots.
 * Integrates:
 * - Phase 3 & 4: Sandbox assessment and candidate executable validation.
 * - Phase 5: Canonicalization and physical symlink deduplication.
 * - Phase 6: Fingerprint caching with negative probe caching and LRU eviction.
 * - Phase 7: Async progress reporting, cooperative UI yielding, timeouts, and resource limits.
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
    hostPackaging,
    strictExecutableValidation,
    cache,
    forceRefresh = false,
    onProgress,
    limits,
    timeoutMs,
    signal,
  } = options;

  return withDiscoveryLimits(
    async () => {
      checkCancellation(signal);
      onProgress?.({
        phase: "initializing",
        current: 0,
        total: providers.length,
        message: "Initializing bounded discovery",
      });

      const allDiscovered: IDiscoveredResource[] = [];
      const errors: Array<{ provider: string; message: string }> = [];
      let scannedSourcesCount = 0;

      const probeSourceWithCache = (
        source: IBoundedSourceDescriptor,
        discoverFn: (s: IBoundedSourceDescriptor[]) => IDiscoveredResource[],
      ): IDiscoveredResource[] => {
        scannedSourcesCount++;
        const fp = computeFilesystemFingerprint(source.resolvedPath);

        if (cache && !forceRefresh) {
          const cached = cache.get(source.id, fp);
          if (cached.hit) {
            if (!cached.isNegative && cached.value) {
              return cached.value;
            }
            return [];
          }
        }

        const discovered = discoverFn([source]);
        if (cache) {
          cache.set(source.id, fp, discovered.length > 0 ? discovered : null);
        }
        return discovered;
      };

      // 1. Steam Provider
      if (providers.includes("steam")) {
        try {
          checkCancellation(signal);
          onProgress?.({
            phase: "probing-steam",
            provider: "steam",
            current: 1,
            total: providers.length,
            message: "Scanning Steam libraries, manifests, and Proton runtimes",
          });
          await yieldToUiLoop();

          const steamSources = getSteamBoundedSources(homeDir, env, customRoots);
          for (const src of steamSources) {
            checkCancellation(signal);
            allDiscovered.push(...probeSourceWithCache(src, discoverSteamResources));
          }
        } catch (err) {
          checkCancellation(signal);
          errors.push({
            provider: "steam",
            message: err instanceof Error ? err.message : "Unknown steam discovery error",
          });
        }
      }

      // 2. Heroic Provider
      if (providers.includes("heroic")) {
        try {
          checkCancellation(signal);
          onProgress?.({
            phase: "probing-heroic",
            provider: "heroic",
            current: 2,
            total: providers.length,
            message: "Scanning Heroic Legendary and GOG store manifests",
          });
          await yieldToUiLoop();

          const heroicSources = getHeroicBoundedSources(homeDir, env);
          for (const src of heroicSources) {
            checkCancellation(signal);
            allDiscovered.push(...probeSourceWithCache(src, discoverHeroicResources));
          }
        } catch (err) {
          checkCancellation(signal);
          errors.push({
            provider: "heroic",
            message: err instanceof Error ? err.message : "Unknown heroic discovery error",
          });
        }
      }

      // 3. Lutris Provider
      if (providers.includes("lutris")) {
        try {
          checkCancellation(signal);
          onProgress?.({
            phase: "probing-lutris",
            provider: "lutris",
            current: 3,
            total: providers.length,
            message: "Querying Lutris pga.db database",
          });
          await yieldToUiLoop();

          const lutrisSources = getLutrisBoundedSources(homeDir, env);
          for (const src of lutrisSources) {
            checkCancellation(signal);
            allDiscovered.push(...probeSourceWithCache(src, discoverLutrisResources));
          }
        } catch (err) {
          checkCancellation(signal);
          errors.push({
            provider: "lutris",
            message: err instanceof Error ? err.message : "Unknown lutris discovery error",
          });
        }
      }

      checkCancellation(signal);
      onProgress?.({
        phase: "validating-candidates",
        current: providers.length,
        total: providers.length,
        message: "Validating executable candidates and sandbox permissions",
      });
      await yieldToUiLoop();

      const currentHostPackaging = hostPackaging || detectPackagingFormat(undefined, env).format;

      // Phases 3 & 4: Sandbox assessment & Candidate Validation
      const enrichedResources: IDiscoveredResource[] = allDiscovered.map((res) => {
        const sandboxAssessment = assessSandboxVisibility(res.canonicalPath, currentHostPackaging, {
          env,
          appId: res.packagingContext.appId,
        });

        let currentValidation = res.validationState;
        let currentConfidence = res.confidence;

        if (res.kind === "compatibility-runtime") {
          const candidateCheck = validateResourceCandidate(res.canonicalPath, {
            requiredSubpaths: ["proton"],
            manifestOwned: res.evidence.some((e) => e.sourceType === "manifest"),
          });
          currentValidation = candidateCheck.validationState;
          currentConfidence = candidateCheck.confidence;
        } else if (strictExecutableValidation) {
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

      checkCancellation(signal);
      onProgress?.({
        phase: "canonicalizing",
        current: providers.length,
        total: providers.length,
        message: "Resolving symlinks and deduplicating resources",
      });
      await yieldToUiLoop();

      // Phase 5: Canonicalization, Symlink Resolution & Deduplication
      const deduplicated = deduplicateAndMergeResources(enrichedResources);

      // Contract validation & kind filtering
      const validResources = deduplicated.filter((r) => {
        if (!validateDiscoveredResource(r)) return false;
        if (kinds && kinds.length > 0 && !kinds.includes(r.kind)) return false;
        return true;
      });

      // Phase 7: Enforce per-provider and total resource limits
      const limitedResources = enforceResourceLimits(validResources, limits);

      onProgress?.({
        phase: "completed",
        current: providers.length,
        total: providers.length,
        message: `Discovered ${limitedResources.length} resources`,
      });

      return {
        scannedSourcesCount,
        resources: limitedResources,
        errors,
      };
    },
    { timeoutMs, signal },
  );
}
