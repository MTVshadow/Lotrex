import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  GameStoreRuntimeType,
  IGameStoreEntry,
  IGameStoreLaunchContext,
} from "../../types/IGameStoreEntry";

/**
 * Represents a game row retrieved from the Lutris SQLite database (pga.db).
 */
export interface ILutrisDatabaseGame {
  id: number;
  name: string;
  slug: string;
  runner?: string;
  platform?: string;
  directory?: string;
  executable?: string;
  installed: boolean;
  configpath?: string;
  service?: string;
  serviceId?: string;
  installedAt?: number;
  lastPlayed?: number;
}

/**
 * Resolves potential file locations for the Lutris database (pga.db),
 * checking native XDG data directories as well as the Lutris Flatpak sandbox data root.
 */
export function lutrisDatabasePaths(homePath: string, xdgDataHome?: string): string[] {
  const nativeData = xdgDataHome || path.join(homePath, ".local", "share");
  const flatpakData = path.join(homePath, ".var", "app", "net.lutris.Lutris", "data");
  return Array.from(
    new Set([
      path.join(nativeData, "lutris", "pga.db"),
      path.join(flatpakData, "lutris", "pga.db"),
    ]),
  );
}

/**
 * Safely reads all game rows from a Lutris pga.db SQLite database in read-only mode.
 * Supports schema evolution across Lutris versions via PRAGMA table_info inspection.
 */
export function readLutrisDatabase(databaseSource: string | DatabaseSync): ILutrisDatabaseGame[] {
  let db: DatabaseSync;
  let shouldClose = false;

  if (typeof databaseSource === "string") {
    if (!fs.existsSync(databaseSource)) {
      return [];
    }
    try {
      // Open in read-only mode to prevent any database locks or unintended writes
      db = new DatabaseSync(databaseSource, { readOnly: true });
      shouldClose = true;
    } catch {
      // Gracefully handle unreadable, locked, or corrupt databases
      return [];
    }
  } else {
    db = databaseSource;
  }

  try {
    // Check if the 'games' table exists before issuing queries
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='games'")
      .all() as Array<{ name: unknown }>;
    if (!tables || tables.length === 0) {
      return [];
    }

    // Inspect available columns dynamically to support older/newer Lutris database migrations
    const tableInfo = db.prepare("PRAGMA table_info(games)").all() as Array<{
      name: unknown;
    }>;
    const columns = new Set(
      tableInfo
        .map((col) => (typeof col.name === "string" ? col.name.toLowerCase() : ""))
        .filter((colName) => colName.length > 0),
    );

    // Essential columns required for identifying a game
    if (!columns.has("slug") || !columns.has("name")) {
      return [];
    }

    const rows = db.prepare("SELECT * FROM games").all() as Array<Record<string, unknown>>;
    const games: ILutrisDatabaseGame[] = [];

    for (const row of rows) {
      const slug = firstString(row.slug);
      const name = firstString(row.name);
      if (!slug || !name) continue;

      // In Lutris, 'installed' is stored as an integer (1 or 0). If column is missing in legacy schema, default to true.
      const installed = columns.has("installed")
        ? Boolean(row.installed === 1 || row.installed === true || row.installed === "1")
        : true;

      games.push({
        id: typeof row.id === "number" ? row.id : Number(row.id) || 0,
        name,
        slug,
        runner: firstString(row.runner),
        platform: firstString(row.platform),
        directory: firstString(row.directory),
        executable: firstString(row.executable),
        installed,
        configpath: firstString(row.configpath),
        service: firstString(row.service),
        serviceId: firstString(row.service_id),
        installedAt: typeof row.installed_at === "number" ? row.installed_at : undefined,
        lastPlayed: typeof row.lastplayed === "number" ? row.lastplayed : undefined,
      });
    }

    return games;
  } catch {
    return [];
  } finally {
    if (shouldClose) {
      try {
        db.close();
      } catch {
        // Ignore errors on closing read-only handles
      }
    }
  }
}

/**
 * Reads and aggregates games across all discovered Lutris database paths (native and Flatpak).
 * Deduplicates records preferring the first encountered instance of each game slug.
 */
export function readAllLutrisDatabases(
  homePath: string,
  xdgDataHome?: string,
): ILutrisDatabaseGame[] {
  const paths = lutrisDatabasePaths(homePath, xdgDataHome);
  const gamesMap = new Map<string, ILutrisDatabaseGame>();

  for (const dbPath of paths) {
    const records = readLutrisDatabase(dbPath);
    for (const record of records) {
      if (!gamesMap.has(record.slug)) {
        gamesMap.set(record.slug, record);
      }
    }
  }

  return Array.from(gamesMap.values());
}

/**
 * Correlates a Lutris YAML configuration file with a database game record without
 * inferring the slug from the configuration filename.
 *
 * Matching strategy in order of authority:
 * 1. configpath match: Lutris writes YAML configs to games/<configpath>.yml where configpath
 *    is an exact reference stored in pga.db (e.g. 'battlenet-1788009455' or 'steam-489830-1781886452').
 * 2. Explicit slug match: When YAML explicitly specifies 'game_slug' or 'slug' in its contents.
 * 3. External service AppID match: When YAML specifies 'game.appid' corresponding to 'service_id'.
 */
export function matchLutrisDatabaseGame(
  dbGames: ILutrisDatabaseGame[],
  config: Record<string, unknown>,
  fileName: string,
): ILutrisDatabaseGame | undefined {
  const baseConfigName = path.basename(fileName, path.extname(fileName));

  // 1. Match by configpath stored in pga.db (exact Lutris config file identifier)
  const byConfigPath = dbGames.find((game) => {
    if (!game.configpath) return false;
    const cleanDbConfig = path.basename(game.configpath, path.extname(game.configpath));
    return cleanDbConfig === baseConfigName || game.configpath === baseConfigName;
  });
  if (byConfigPath) return byConfigPath;

  // 2. Match by explicit game_slug or slug declared INSIDE the YAML (never from filename)
  const explicitSlug = firstString(config.game_slug, config.slug);
  if (explicitSlug) {
    const bySlug = dbGames.find((game) => game.slug === explicitSlug);
    if (bySlug) return bySlug;
  }

  // 3. Match by service_id / external store AppID (e.g. game: { appid: '489830' })
  const gameSection = asRecord(config.game);
  const yamlAppId = firstString(gameSection.appid);
  if (yamlAppId) {
    const byServiceId = dbGames.find((game) => game.serviceId === yamlAppId);
    if (byServiceId) return byServiceId;
  }

  return undefined;
}

/**
 * Converts an installed database entry into an IGameStoreEntry if its directory
 * or executable path can be resolved on disk.
 */
export function lutrisDatabaseGameToEntry(
  dbGame: ILutrisDatabaseGame,
  homePath: string,
): IGameStoreEntry | undefined {
  if (!dbGame.installed || !dbGame.slug) {
    return undefined;
  }

  const runner = dbGame.runner ?? "unknown";
  const directory = expandHome(dbGame.directory, homePath);
  const executable = expandHome(dbGame.executable, homePath);
  const prefixPath = runner === "wine" || runner === "proton" ? directory : undefined;
  const executablePath = resolveExecutable(executable, prefixPath, directory);
  const gamePath = resolveGamePath(executablePath, prefixPath, directory);

  if (!gamePath) {
    return undefined;
  }

  return {
    appid: dbGame.slug,
    gamePath,
    gameStoreId: "lutris",
    launchContext: compactContext({
      executablePath,
      launcher: "lutris",
      prefixPath,
      runner,
      runtimeType: parseRuntimeType(runner),
    }) as IGameStoreLaunchContext,
    name: dbGame.name,
  };
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

function parseRuntimeType(runner: string): GameStoreRuntimeType | undefined {
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

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function compactContext(
  context: Partial<IGameStoreLaunchContext>,
): Partial<IGameStoreLaunchContext> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Partial<IGameStoreLaunchContext>;
}
