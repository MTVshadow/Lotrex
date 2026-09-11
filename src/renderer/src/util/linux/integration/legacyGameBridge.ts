import * as path from "node:path";

import type { IDiscoveryResult } from "../../../extensions/gamemode_management/types/IDiscoveryResult";
import type { IGameStored } from "../../../extensions/gamemode_management/types/IGameStored";
import { resolveGameSteamAppId } from "../../../extensions/gamemode_management/util/gameCapabilities";
import type { IProfile } from "../../../extensions/profile_management/types/IProfile";
import { GameAdapterRegistry } from "../gameAdapters/adapterRegistry";
import {
  ALL_ADAPTER_CAPABILITY_KINDS,
  type AdapterCapabilityKind,
  type ICapabilityDescriptor,
  type IGameAdapter,
  type IGameAdapterManifest,
} from "../gameAdapters/contracts";
import type {
  GamePlatform,
  GameStoreId,
  IDiscoveredGameCandidate,
  IUnifiedGameInstallation,
  OwningLauncher,
} from "../gameIdentity/contracts";
import { mergeGameDiscoveries } from "../gameIdentity/identityEngine";
import { ProtonPaths } from "../ProtonPaths";

export interface ILegacyLibraryBridgeResult {
  adapterRegistry: GameAdapterRegistry;
  installations: IUnifiedGameInstallation[];
}

function normalizeStore(store: string | undefined): GameStoreId {
  switch (store?.toLowerCase()) {
    case "steam":
      return "steam";
    case "gog":
      return "gog";
    case "epic":
    case "epicgames":
      return "epic";
    case "ea":
    case "origin":
      return "ea";
    case "uplay":
    case "ubisoft":
      return "ubisoft";
    default:
      return store === undefined ? "manual" : "other";
  }
}

function normalizeLauncher(discovery: IDiscoveryResult): OwningLauncher {
  const explicit = discovery.environment?.VORTEX_LAUNCHER?.toLowerCase();
  const source = explicit ?? discovery.store?.toLowerCase();
  switch (source) {
    case "steam":
      return "steam";
    case "heroic":
      return "heroic";
    case "lutris":
      return "lutris";
    case "bottles":
      return "bottles";
    default:
      return discovery.pathSetManually ? "manual" : "standalone";
  }
}

function resolvePlatform(game: IGameStored, executable: string): GamePlatform {
  const declaredLaunch = game.capabilities?.platforms?.linux?.launch;
  if (declaredLaunch === "native") return "linux-native";
  if (declaredLaunch === "wine") return "windows-wine";
  if (declaredLaunch === "steam-proton") return "windows-proton";
  return executable.toLowerCase().endsWith(".exe") ? "windows-proton" : "linux-native";
}

function capability(
  kind: AdapterCapabilityKind,
  supported: boolean,
  unsupportedReason?: string,
): ICapabilityDescriptor {
  return {
    kind,
    version: "legacy-bridge-1",
    supported,
    unsupportedReason: supported ? undefined : unsupportedReason,
  };
}

class LegacyGameAdapter implements IGameAdapter {
  public readonly manifest: IGameAdapterManifest;

  constructor(game: IGameStored, editionId: string) {
    const hasDeployment = game.capabilities?.deployment !== undefined;
    const capabilities = Object.fromEntries(
      ALL_ADAPTER_CAPABILITY_KINDS.map((kind) => {
        const supported =
          kind === "discovery" ||
          kind === "mod-types" ||
          kind === "install-rules" ||
          kind === "tools" ||
          kind === "launch" ||
          (kind === "deployment-targets" && hasDeployment);
        return [
          kind,
          capability(
            kind,
            supported,
            "The existing Vortex game extension does not expose this capability through the Lotrex bridge yet.",
          ),
        ];
      }),
    ) as Record<AdapterCapabilityKind, ICapabilityDescriptor>;

    this.manifest = {
      id: `legacy:${game.id}`,
      version: "legacy-bridge-1",
      targetGameId: game.id,
      targetEditions: [editionId],
      name: `${game.name} (existing Vortex extension)`,
      author: game.contributed,
      capabilities,
    };
  }

  public getCapability<T = unknown>(kind: AdapterCapabilityKind): ICapabilityDescriptor<T> {
    return this.manifest.capabilities[kind] as ICapabilityDescriptor<T>;
  }

  public hasCapability(kind: AdapterCapabilityKind): boolean {
    return this.manifest.capabilities[kind].supported;
  }
}

function executablePath(game: IGameStored, discovery: IDiscoveryResult): string | undefined {
  if (!discovery.path) return undefined;
  const executable = discovery.executable ?? game.executable;
  if (!executable) return undefined;
  return path.isAbsolute(executable) ? executable : path.join(discovery.path, executable);
}

/**
 * Adapts the current Vortex game state into the new Lotrex contracts without replacing the proven
 * discovery, launch, profile, or deployment paths. The bridge is intentionally read-only.
 */
export function buildLegacyUnifiedLibrary(
  knownGames: IGameStored[],
  discoveries: Record<string, IDiscoveryResult>,
  profiles: Record<string, IProfile>,
): ILegacyLibraryBridgeResult {
  const adapterRegistry = new GameAdapterRegistry();
  let installations: IUnifiedGameInstallation[] = [];

  for (const game of knownGames) {
    const discovery = discoveries[game.id];
    const resolvedExecutable = discovery ? executablePath(game, discovery) : undefined;
    if (!discovery?.path || !resolvedExecutable || discovery.hidden) continue;

    const editionId = String(game.details?.editionId ?? "default");
    const platform = resolvePlatform(game, resolvedExecutable);
    const storeId = normalizeStore(discovery.store);
    const proton =
      platform === "linux-native"
        ? undefined
        : ProtonPaths.resolve({ discovery, gameMode: game.id, game });
    const profile = Object.values(profiles)
      .filter((candidate) => candidate.gameId === game.id && !candidate.pendingRemove)
      .sort((left, right) => right.lastActivated - left.lastActivated)[0];

    const candidate: IDiscoveredGameCandidate = {
      identity: {
        gameId: game.id,
        editionId,
        platform,
        storeId,
        storeAppId: resolveGameSteamAppId(game, "linux", discovery.environment?.SteamAPPId),
        owningLauncher: normalizeLauncher(discovery),
        executable: path.basename(resolvedExecutable),
        adapterVersion: "legacy-bridge-1",
      },
      installPath: discovery.path,
      executablePath: resolvedExecutable,
      prefixPath: proton?.prefixPath ?? discovery.environment?.WINEPREFIX,
      runtime: proton?.protonPath ?? discovery.environment?.VORTEX_PROTON_PATH,
      confidence: discovery.pathSetManually ? "confirmed" : "probable",
    };

    const merged = mergeGameDiscoveries(installations, candidate);
    installations = merged.installations;
    if (profile) {
      const index = installations.findIndex(
        (installation) => installation.installationId === merged.installation.installationId,
      );
      installations[index] = { ...installations[index], profileId: profile.id };
    }

    adapterRegistry.registerAdapter(new LegacyGameAdapter(game, editionId));
  }

  return { adapterRegistry, installations };
}
