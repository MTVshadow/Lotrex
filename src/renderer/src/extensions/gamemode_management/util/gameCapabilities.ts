import type { IGame, IGamePlatformCapabilities } from "../../../types/IGame";

type GameSteamMetadata = Partial<
  Pick<IGame, "capabilities" | "details" | "environment" | "queryArgs">
>;

export function resolveGameSteamAppId(
  game: GameSteamMetadata | undefined,
  platform: NodeJS.Platform,
  discoveredAppId?: string | number,
): string | undefined {
  const platformCapabilities =
    platform === "linux" || platform === "win32" || platform === "darwin"
      ? game?.capabilities?.platforms?.[platform]
      : undefined;
  const candidates = [
    platformCapabilities?.steamAppId,
    discoveredAppId,
    game?.environment?.SteamAPPId,
    game?.details?.steamAppId,
    firstQueryId(game?.queryArgs?.steam),
  ];

  const result = candidates.find(
    (candidate) => candidate !== undefined && String(candidate) !== "",
  );
  return result !== undefined ? String(result) : undefined;
}

export function gamePlatformCapabilities(
  game: GameSteamMetadata | undefined,
  platform: NodeJS.Platform,
): IGamePlatformCapabilities | undefined {
  return platform === "linux" || platform === "win32" || platform === "darwin"
    ? game?.capabilities?.platforms?.[platform]
    : undefined;
}

function firstQueryId(
  query: NonNullable<IGame["queryArgs"]>[string] | undefined,
): string | undefined {
  if (typeof query === "string") return query;
  const first = Array.isArray(query) ? query[0] : query;
  return first?.id;
}
