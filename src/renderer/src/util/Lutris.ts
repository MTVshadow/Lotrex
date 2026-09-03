import * as os from "node:os";
import * as path from "node:path";

import PromiseBB from "bluebird";

import type { IExtensionApi } from "../types/IExtensionContext";
import type { IGameStore } from "../types/IGameStore";
import { GameEntryNotFound } from "../types/IGameStore";
import type { IGameStoreEntry } from "../types/IGameStoreEntry";
import * as fs from "./fs";
import { lutrisConfigDirectories, lutrisLaunchUrl, parseLutrisGameConfig } from "./linux/lutris";
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
    for (const configDirectory of lutrisConfigDirectories(
      os.homedir(),
      process.env.XDG_CONFIG_HOME,
    )) {
      let fileNames: string[];
      try {
        fileNames = await fs.readdirAsync(configDirectory);
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
          const content = await fs.readFileAsync(configPath, { encoding: "utf8" });
          const game = parseLutrisGameConfig(content, fileName, os.homedir());
          if (game) games.push(game);
        } catch (err) {
          log("warn", "Failed to read Lutris game configuration", {
            config: configPath,
            error: err instanceof Error ? err.message : "unknown error",
          });
        }
      }
    }
    return Array.from(new Map(games.map((game) => [game.appid, game])).values());
  }
}

export const lutrisGameStore: IGameStore | undefined =
  process.platform === "linux" ? new Lutris() : undefined;
