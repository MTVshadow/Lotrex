import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import PromiseBB from "bluebird";
import { load as loadYaml } from "js-yaml";

import type { IExtensionApi } from "../types/IExtensionContext";
import type { IGameStore } from "../types/IGameStore";
import { GameEntryNotFound } from "../types/IGameStore";
import type { IGameStoreEntry } from "../types/IGameStoreEntry";
import {
  lutrisConfigDirectories,
  lutrisDatabaseGameToEntry,
  lutrisLaunchUrl,
  matchLutrisDatabaseGame,
  parseLutrisGameConfig,
  readAllLutrisDatabases,
  type ILutrisDatabaseGame,
} from "./linux/lutris";
import { log } from "./log";
import opn from "./opn";

class Lutris implements IGameStore {
  public readonly id = "lutris";
  public readonly name = "Lutris";
  public readonly priority = 40;
  private mCache?: PromiseBB<IGameStoreEntry[]>;

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
    return this.find((game) => ids.includes(game.appid), ids.join(", "));
  }

  public findByName(name: string): PromiseBB<IGameStoreEntry> {
    return this.find(
      (game) => game.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0,
      name,
    );
  }

  public launchGame(appInfo: unknown, _api?: IExtensionApi): PromiseBB<void> {
    const rawAppId =
      appInfo !== null && typeof appInfo === "object" && "appId" in appInfo
        ? (appInfo as { appId: unknown }).appId
        : appInfo;
    if (typeof rawAppId !== "string" && typeof rawAppId !== "number") {
      return PromiseBB.reject(new Error("Lutris launch requires a string or numeric app id"));
    }
    return PromiseBB.resolve(opn(lutrisLaunchUrl(String(rawAppId)))).then(() => undefined);
  }

  public getPosixPath(appId: string): PromiseBB<string> {
    return PromiseBB.resolve(lutrisLaunchUrl(appId));
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
    const games: IGameStoreEntry[] = [];
    const home = os.homedir();
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    const xdgData = process.env.XDG_DATA_HOME;

    // 1. Read all pga.db databases (native and Flatpak)
    let dbGames: ILutrisDatabaseGame[] = [];
    try {
      dbGames = readAllLutrisDatabases(home, xdgData);
    } catch (err) {
      log("warn", "Failed to read Lutris database", {
        error: err instanceof Error ? err.message : "unknown error",
      });
    }

    const matchedDbGameIds = new Set<number>();

    // 2. Discover YAML game configs
    for (const configDirectory of lutrisConfigDirectories(home, xdgConfig, xdgData)) {
      let fileNames: string[];
      try {
        fileNames = await fs.readdir(configDirectory);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
          log("warn", "Failed to list Lutris game configurations", {
            directory: configDirectory,
            error: err instanceof Error ? err.message : "unknown error",
          });
        }
        continue;
      }

      for (const fileName of fileNames.filter((name) => /\.ya?ml$/i.test(name))) {
        const configPath = path.join(configDirectory, fileName);
        try {
          const content = await fs.readFile(configPath, { encoding: "utf8" });
          let rawConfig: Record<string, unknown> = {};
          try {
            const parsed = loadYaml(content);
            if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
              rawConfig = parsed as Record<string, unknown>;
            }
          } catch {
            // Ignore YAML parse error here; parseLutrisGameConfig will handle it
          }

          const dbGame = matchLutrisDatabaseGame(dbGames, rawConfig, fileName);
          if (dbGame) {
            matchedDbGameIds.add(dbGame.id);
          }

          const game = parseLutrisGameConfig(content, fileName, home, dbGame);
          if (game) games.push(game);
        } catch (err) {
          log("warn", "Failed to read Lutris game configuration", {
            config: configPath,
            error: err instanceof Error ? err.message : "unknown error",
          });
        }
      }
    }

    // 3. Include any installed pga.db games that did not have a matching YAML config
    for (const dbGame of dbGames) {
      if (dbGame.installed && !matchedDbGameIds.has(dbGame.id)) {
        const entry = lutrisDatabaseGameToEntry(dbGame, home);
        if (entry) games.push(entry);
      }
    }

    return Array.from(new Map(games.map((game) => [game.appid, game])).values());
  }
}

export const lutrisGameStore: IGameStore | undefined =
  process.platform === "linux" ? new Lutris() : undefined;
