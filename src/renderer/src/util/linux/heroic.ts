import * as path from "node:path";

import type {
  GameStoreRuntimeType,
  IGameStoreEntry,
  IGameStoreLaunchContext,
} from "../../types/IGameStoreEntry";

export type HeroicRunner = "gog" | "legendary";

export interface IHeroicManifest {
  configRoot: string;
  filePath: string;
  runner: HeroicRunner;
}

interface IHeroicInstalledGame {
  app_name?: unknown;
  appName?: unknown;
  appid?: unknown;
  executable?: unknown;
  install_path?: unknown;
  installPath?: unknown;
  name?: unknown;
  path?: unknown;
  title?: unknown;
}

export function heroicManifestPaths(homePath: string, xdgConfigHome?: string): IHeroicManifest[] {
  const nativeConfig = xdgConfigHome || path.join(homePath, ".config");
  const flatpakConfig = path.join(homePath, ".var", "app", "com.heroicgameslauncher.hgl", "config");
  const roots = [path.join(nativeConfig, "heroic"), path.join(flatpakConfig, "heroic")];

  return roots.flatMap((root) => [
    {
      configRoot: root,
      filePath: path.join(root, "legendaryConfig", "legendary", "installed.json"),
      runner: "legendary" as const,
    },
    {
      configRoot: root,
      filePath: path.join(root, "gog_store", "installed.json"),
      runner: "gog" as const,
    },
  ]);
}

export function parseHeroicInstalledGames(input: unknown, runner: HeroicRunner): IGameStoreEntry[] {
  const record = asRecord(input);
  const installed = Array.isArray(record.installed) ? record.installed : input;
  const rows: Array<[string, IHeroicInstalledGame]> = Array.isArray(installed)
    ? installed.map((value, index) => [String(index), asInstalledGame(value)])
    : Object.entries(asRecord(installed)).map(([key, value]) => [key, asInstalledGame(value)]);
  const storeId = runner === "legendary" ? "epic" : "gog";

  return rows.flatMap(([key, game]) => {
    const appid = firstString(game.app_name, game.appName, game.appid, key);
    const gamePath = firstString(game.install_path, game.installPath, game.path);
    if (!appid || !gamePath) return [];

    return [
      {
        appid,
        gamePath,
        gameStoreId: storeId,
        launchContext: {
          executablePath: resolveExecutable(gamePath, firstString(game.executable)),
          launcher: "heroic",
          runner,
        },
        name: firstString(game.title, game.name, game.app_name, game.appName, appid)!,
      },
    ];
  });
}

export function heroicGameConfigPath(configRoot: string, appId: string): string {
  return path.join(configRoot, "GamesConfig", `${appId}.json`);
}

export function parseHeroicGameConfig(
  input: unknown,
  appId: string,
): Partial<IGameStoreLaunchContext> {
  const outer = asRecord(input);
  const settings = asRecord(outer[appId] ?? input);
  const wineVersion = asRecord(settings.wineVersion);
  const runtimeType = parseRuntimeType(wineVersion.type);

  return compactContext({
    prefixPath: firstString(settings.winePrefix),
    runtimePath: firstString(wineVersion.bin),
    runtimeType,
  });
}

export function heroicLaunchUrl(appId: string, runner: HeroicRunner): string {
  return `heroic://launch?appName=${encodeURIComponent(appId)}&runner=${runner}`;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function asInstalledGame(input: unknown): IHeroicInstalledGame {
  return asRecord(input);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function resolveExecutable(gamePath: string, executable: string | undefined): string | undefined {
  if (!executable) return undefined;
  return path.isAbsolute(executable) ? executable : path.join(gamePath, executable);
}

function parseRuntimeType(value: unknown): GameStoreRuntimeType | undefined {
  return value === "native" || value === "proton" || value === "umu" || value === "wine"
    ? value
    : undefined;
}

function compactContext(
  context: Partial<IGameStoreLaunchContext>,
): Partial<IGameStoreLaunchContext> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Partial<IGameStoreLaunchContext>;
}
