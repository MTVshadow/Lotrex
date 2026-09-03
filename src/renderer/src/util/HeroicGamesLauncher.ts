import * as os from "node:os";

import PromiseBB from "bluebird";

import type { IExtensionApi } from "../types/IExtensionContext";
import type { IGameStore } from "../types/IGameStore";
import { GameEntryNotFound } from "../types/IGameStore";
import type { IGameStoreEntry } from "../types/IGameStoreEntry";
import * as fs from "./fs";
import {
  heroicGameConfigPath,
  heroicLaunchUrl,
  heroicManifestPaths,
  parseHeroicGameConfig,
  parseHeroicInstalledGames,
} from "./linux/heroic";
import type { HeroicRunner } from "./linux/heroic";
import { log } from "./log";
import opn from "./opn";

class HeroicGamesLauncher implements IGameStore {
  public readonly id: string;
  public readonly name: string;
  public readonly priority = 35;
  private mCache?: PromiseBB<IGameStoreEntry[]>;

  constructor(private readonly runner: HeroicRunner) {
    this.id = runner === "legendary" ? "epic" : "gog";
    this.name = runner === "legendary" ? "Heroic (Epic)" : "Heroic (GOG)";
  }

  public allGames(): PromiseBB<IGameStoreEntry[]> {
    if (!this.mCache) this.mCache = PromiseBB.resolve(this.loadGames());
    return this.mCache;
  }

  public reloadGames(): PromiseBB<void> {
    this.mCache = PromiseBB.resolve(this.loadGames());
    return this.mCache.then(() => undefined);
  }

  public findByAppId(appId: string | string[]): PromiseBB<IGameStoreEntry> {
    const ids = Array.isArray(appId) ? appId : [appId];
    return this.find((entry) => ids.includes(entry.appid), ids.join(", "));
  }

  public findByName(name: string): PromiseBB<IGameStoreEntry> {
    return this.find(
      (entry) => entry.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0,
      name,
    );
  }

  public launchGame(appInfo: unknown, _api?: IExtensionApi): PromiseBB<void> {
    const rawAppId =
      appInfo !== null && typeof appInfo === "object" && "appId" in appInfo
        ? (appInfo as { appId: unknown }).appId
        : appInfo;
    if (typeof rawAppId !== "string" && typeof rawAppId !== "number") {
      return PromiseBB.reject(new Error("Heroic launch requires a string or numeric app id"));
    }
    const appId = String(rawAppId);
    return PromiseBB.resolve(opn(heroicLaunchUrl(appId, this.runner))).then(() => undefined);
  }

  public getPosixPath(appId: string): PromiseBB<string> {
    return PromiseBB.resolve(heroicLaunchUrl(appId, this.runner));
  }

  public getGameStorePath(): PromiseBB<string | undefined> {
    return PromiseBB.resolve(undefined);
  }

  public isGameStoreInstalled(): PromiseBB<boolean> {
    return this.allGames().then((games) => games.length > 0);
  }

  private find(
    predicate: (entry: IGameStoreEntry) => boolean,
    query: string,
  ): PromiseBB<IGameStoreEntry> {
    return this.allGames().then((games) => {
      const entry = games.find(predicate);
      return entry !== undefined
        ? entry
        : PromiseBB.reject(
            new GameEntryNotFound(
              query,
              this.id,
              games.map((game) => game.name),
            ),
          );
    });
  }

  private async loadGames(): Promise<IGameStoreEntry[]> {
    const manifests = heroicManifestPaths(os.homedir(), process.env.XDG_CONFIG_HOME).filter(
      (manifest) => manifest.runner === this.runner,
    );
    const games: IGameStoreEntry[] = [];
    for (const manifest of manifests) {
      try {
        const content = await fs.readFileAsync(manifest.filePath, { encoding: "utf8" });
        const installedGames = parseHeroicInstalledGames(JSON.parse(content), this.runner);
        games.push(
          ...(await Promise.all(
            installedGames.map((game) => this.addLaunchContext(game, manifest.configRoot)),
          )),
        );
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") {
          log("warn", "Failed to read Heroic installed games", {
            error: err instanceof Error ? err.message : "unknown error",
            manifest: manifest.filePath,
          });
        }
      }
    }
    return dedupeGames(games);
  }

  private async addLaunchContext(
    game: IGameStoreEntry,
    configRoot: string,
  ): Promise<IGameStoreEntry> {
    const configPath = heroicGameConfigPath(configRoot, game.appid);
    try {
      const content = await fs.readFileAsync(configPath, { encoding: "utf8" });
      return {
        ...game,
        launchContext: {
          ...game.launchContext!,
          ...parseHeroicGameConfig(JSON.parse(content), game.appid),
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        log("warn", "Failed to read Heroic game launch configuration", {
          config: configPath,
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
      return game;
    }
  }
}

function dedupeGames(games: IGameStoreEntry[]): IGameStoreEntry[] {
  return Array.from(
    new Map(games.map((game) => [`${game.appid}\0${game.gamePath}`, game])).values(),
  );
}

export const heroicGameStores: IGameStore[] =
  process.platform === "linux"
    ? [new HeroicGamesLauncher("legendary"), new HeroicGamesLauncher("gog")]
    : [];
