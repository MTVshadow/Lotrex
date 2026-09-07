import * as path from "node:path";

import { load as loadYaml } from "js-yaml";

import type {
  GameStoreRuntimeType,
  IGameStoreEntry,
  IGameStoreLaunchContext,
} from "../../types/IGameStoreEntry";

export function lutrisConfigDirectories(
  homePath: string,
  xdgConfigHome?: string,
  xdgDataHome?: string,
): string[] {
  const nativeConfig = xdgConfigHome || path.join(homePath, ".config");
  const nativeData = xdgDataHome || path.join(homePath, ".local", "share");
  const flatpakRoot = path.join(homePath, ".var", "app", "net.lutris.Lutris");
  return Array.from(
    new Set([
      path.join(nativeData, "lutris", "games"),
      path.join(nativeConfig, "lutris", "games"),
      path.join(flatpakRoot, "data", "lutris", "games"),
      path.join(flatpakRoot, "config", "lutris", "games"),
    ]),
  );
}

export function parseLutrisGameConfig(
  content: string,
  fileName: string,
  homePath: string,
): IGameStoreEntry | undefined {
  const config = asRecord(loadYaml(content));
  const game = asRecord(config.game);
  const runnerOptions = asRecord(config.wine);
  const slug =
    firstString(config.game_slug, config.slug) ?? path.basename(fileName, path.extname(fileName));
  const runner = firstString(config.runner) ?? "unknown";
  const prefixPath = expandHome(firstString(game.prefix), homePath);
  const workingDirectory = expandHome(firstString(game.working_dir), homePath);
  const executable = expandHome(firstString(game.exe), homePath);
  const executablePath = resolveExecutable(executable, prefixPath, workingDirectory);
  const gamePath = resolveGamePath(executablePath, prefixPath, workingDirectory);
  if (!slug || !gamePath) return undefined;

  return {
    appid: slug,
    gamePath,
    gameStoreId: "lutris",
    launchContext: compactContext({
      executablePath,
      launcher: "lutris",
      prefixPath,
      runner,
      runtimePath: expandHome(firstString(runnerOptions.runner), homePath),
      runtimeType: runtimeType(runner),
    }) as IGameStoreLaunchContext,
    name: firstString(config.name) ?? humanizeSlug(slug),
  };
}

export function lutrisLaunchUrl(slug: string): string {
  return `lutris:rungame/${encodeURIComponent(slug)}`;
}

function resolveExecutable(
  executable: string | undefined,
  prefixPath: string | undefined,
  workingDirectory: string | undefined,
): string | undefined {
  if (!executable) return undefined;
  if (path.isAbsolute(executable)) return executable;
  if (workingDirectory) return path.join(workingDirectory, executable);
  return prefixPath ? path.join(prefixPath, executable) : undefined;
}

function resolveGamePath(
  executablePath: string | undefined,
  prefixPath: string | undefined,
  workingDirectory: string | undefined,
): string | undefined {
  if (workingDirectory) return workingDirectory;
  if (executablePath) return path.dirname(executablePath);
  return prefixPath;
}

function runtimeType(runner: string): GameStoreRuntimeType | undefined {
  if (runner === "linux") return "native";
  if (runner === "wine") return "wine";
  if (runner === "proton") return "proton";
  return undefined;
}

function expandHome(value: string | undefined, homePath: string): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/^~(?=\/|$)/, homePath)
    .replace(/^\$HOME(?=\/|$)/, homePath)
    .replace(/^\$\{HOME\}(?=\/|$)/, homePath);
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function compactContext(
  context: Partial<IGameStoreLaunchContext>,
): Partial<IGameStoreLaunchContext> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Partial<IGameStoreLaunchContext>;
}
