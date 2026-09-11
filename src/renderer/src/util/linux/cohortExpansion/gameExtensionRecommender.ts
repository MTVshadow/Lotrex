import type { IGameAdapter } from "../gameAdapters/contracts";
import type { IUnifiedGameIdentity } from "../gameIdentity/contracts";
import type { GameSupportCatalog } from "../supportCatalog/supportCatalog";
import type { ICohort, IGameExtensionSuggestion } from "./contracts";

/**
 * Game extension recommendation and suggestion engine (Phase 11 & Roadmap line 729).
 *
 * Implements Scope & Safety Rule 637:
 * "Never advertise a discovered game as mod-supported unless a compatible game adapter is active."
 *
 * Implements Roadmap feature line 729:
 * "Automatic game-extension suggestions: Recommend an extension or template when an unsupported
 * game is discovered. Reliable executable/store identity and a reviewed extension catalog."
 */
export class GameExtensionRecommender {
  constructor(
    private readonly catalog: GameSupportCatalog,
    private readonly activeAdapters: Map<string, IGameAdapter> = new Map(),
    private readonly activeCohorts: ICohort[] = [],
  ) {}

  /**
   * Evaluates a discovered game installation and generates safe recommendations.
   * Never advertises mod support unless an active compatible adapter is bound.
   */
  public evaluateDiscoveredGame(identity: IUnifiedGameIdentity): IGameExtensionSuggestion {
    // 1. Check if a compatible adapter is already active in Lotrex
    const activeAdapter = this.findActiveAdapter(identity.gameId);

    if (activeAdapter) {
      return {
        identity,
        hasActiveAdapter: true,
        modSupportAdvertised: true, // Mod support is ONLY advertised when adapter is active
        suggestedAction: "activate-existing",
        suggestedExtension: {
          adapterId: activeAdapter.manifest.id,
          name: activeAdapter.manifest.name,
          version: activeAdapter.manifest.version,
          maintainer: activeAdapter.manifest.author,
          tier: "supported",
          declaredRoots:
            (activeAdapter.manifest as { permissions?: { allowedRoots?: string[] } }).permissions
              ?.allowedRoots ?? [],
          knownLimitations: [],
          isReviewedCatalogEntry: true,
        },
        diagnosticMessage: `Compatible game adapter '${activeAdapter.manifest.name}' is active. Mod support enabled.`,
      };
    }

    // 2. No active adapter: Rule 637 strictly requires modSupportAdvertised = false
    const catalogRecord = this.catalog.getRecord({
      gameId: identity.gameId,
      editionId: identity.editionId,
      storeId: identity.storeId,
      platform: identity.platform,
    });

    if (catalogRecord) {
      const evaluation = this.catalog.evaluateRecord(catalogRecord.id);
      const effectiveTier = evaluation?.effectiveTier ?? catalogRecord.declaredTier;

      return {
        identity,
        hasActiveAdapter: false,
        modSupportAdvertised: false, // Rule 637
        suggestedAction: "install-reviewed-extension",
        suggestedExtension: {
          adapterId: catalogRecord.adapterId,
          name: `${identity.gameId} Adapter`,
          version: catalogRecord.adapterVersion,
          maintainer: catalogRecord.maintainer ?? "Community Contributor",
          tier: effectiveTier,
          declaredRoots: [],
          knownLimitations: catalogRecord.knownLimitations.map((l) => l.summary),
          isReviewedCatalogEntry: true,
        },
        diagnosticMessage: `Discovered '${identity.gameId}'. Modding is inactive. A reviewed adapter is available in the catalog (Tier: ${effectiveTier}, Maintainer: ${catalogRecord.maintainer ?? "Community"}). Enable adapter to activate mod support.`,
      };
    }

    // 3. Search active cohorts under review
    for (const cohort of this.activeCohorts) {
      const match = cohort.candidates.find(
        (c) =>
          c.gameId === identity.gameId &&
          c.editionId === identity.editionId &&
          c.storeId === identity.storeId &&
          c.platform === identity.platform,
      );

      if (match) {
        return {
          identity,
          hasActiveAdapter: false,
          modSupportAdvertised: false, // Rule 637
          suggestedAction: "install-reviewed-extension",
          suggestedExtension: {
            adapterId: match.adapterManifest.id,
            name: match.adapterManifest.name,
            version: match.adapterManifest.version,
            maintainer: match.maintainer,
            tier: "experimental",
            declaredRoots: match.adapterManifest.permissions?.allowedRoots ?? [],
            knownLimitations: [],
            isReviewedCatalogEntry: false,
          },
          diagnosticMessage: `Candidate adapter for '${identity.gameId}' is currently under review in cohort '${cohort.name}' (Status: ${cohort.status}). Enable for experimental testing.`,
        };
      }
    }

    // 4. No reviewed adapter exists: suggest scaffolding a new adapter via SDK
    const scaffoldHint = `pnpm lotrex sdk new-game --id "${identity.gameId}" --platform "${identity.platform}" --name "${identity.gameId.toUpperCase()}"`;

    return {
      identity,
      hasActiveAdapter: false,
      modSupportAdvertised: false, // Rule 637
      suggestedAction: "scaffold-sdk-template",
      scaffoldCommandHint: scaffoldHint,
      diagnosticMessage: `Discovered '${identity.gameId}', but no compatible adapter exists in catalog. Use the Lotrex Adapter SDK to scaffold a new game adapter.`,
    };
  }

  private findActiveAdapter(gameId: string): IGameAdapter | undefined {
    for (const adapter of this.activeAdapters.values()) {
      if (adapter.manifest.targetGameId === gameId || adapter.manifest.id.includes(gameId)) {
        return adapter;
      }
    }
    return undefined;
  }
}
