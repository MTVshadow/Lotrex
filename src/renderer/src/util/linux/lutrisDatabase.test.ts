import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseLutrisGameConfig } from "./lutris";
import {
  lutrisDatabasePaths,
  lutrisDatabaseGameToEntry,
  matchLutrisDatabaseGame,
  readAllLutrisDatabases,
  readLutrisDatabase,
  type ILutrisDatabaseGame,
} from "./lutrisDatabase";

describe("Lutris SQLite database (pga.db) reader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vortex-lutris-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves native and Flatpak database paths", () => {
    const paths = lutrisDatabasePaths("/home/user", "/custom/data");
    expect(paths).toEqual([
      "/custom/data/lutris/pga.db",
      "/home/user/.var/app/net.lutris.Lutris/data/lutris/pga.db",
    ]);

    const defaultPaths = lutrisDatabasePaths("/home/user");
    expect(defaultPaths).toEqual([
      "/home/user/.local/share/lutris/pga.db",
      "/home/user/.var/app/net.lutris.Lutris/data/lutris/pga.db",
    ]);
  });

  it("safely handles non-existent and corrupt database paths", () => {
    expect(readLutrisDatabase("/path/that/does/not/exist/pga.db")).toEqual([]);

    const corruptPath = path.join(tempDir, "corrupt.db");
    fs.writeFileSync(corruptPath, "not an sqlite database file");
    expect(readLutrisDatabase(corruptPath)).toEqual([]);
  });

  it("safely handles database without a games table", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE other_table (id INTEGER PRIMARY KEY);");

    const result = readLutrisDatabase(db);
    expect(result).toEqual([]);
    db.close();
  });

  it("safely handles legacy schema lacking configpath and service columns", () => {
    const db = new DatabaseSync(":memory:");
    // Legacy Lutris schema without configpath, service, service_id, platform
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        name TEXT,
        slug TEXT,
        runner TEXT,
        directory TEXT,
        executable TEXT,
        installed INTEGER
      );
      INSERT INTO games (id, name, slug, runner, directory, executable, installed)
      VALUES (1, 'Legacy Game', 'legacy-game', 'wine', '/games/legacy', 'legacy.exe', 1);
    `);

    const games = readLutrisDatabase(db);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      id: 1,
      name: "Legacy Game",
      slug: "legacy-game",
      runner: "wine",
      directory: "/games/legacy",
      executable: "legacy.exe",
      installed: true,
      configpath: undefined,
      service: undefined,
      serviceId: undefined,
    });
    db.close();
  });

  it("reads modern Lutris schema with full metadata", () => {
    const dbPath = path.join(tempDir, "pga.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        name TEXT,
        sortname TEXT,
        slug TEXT,
        installer_slug TEXT,
        parent_slug TEXT,
        platform TEXT,
        runner TEXT,
        executable TEXT,
        directory TEXT,
        updated DATETIME,
        lastplayed INTEGER,
        installed INTEGER,
        installed_at INTEGER,
        year INTEGER,
        configpath TEXT,
        has_custom_banner INTEGER,
        has_custom_icon INTEGER,
        has_custom_coverart_big INTEGER,
        playtime REAL,
        service TEXT,
        service_id TEXT,
        discord_id TEXT
      );
      INSERT INTO games (id, name, slug, runner, platform, directory, executable, installed, configpath, service, service_id, installed_at, lastplayed)
      VALUES
        (1, 'Skyrim Special Edition', 'the-elder-scrolls-v-skyrim-special-edition', 'steam', 'Linux', NULL, NULL, 1, 'steam-489830-1781886452', 'steam', '489830', 1781886452, 1781900000),
        (2, 'Battle.net', 'battlenet', 'wine', 'Windows', '/home/user/Games/battlenet', NULL, 1, 'battlenet-1788009455', NULL, NULL, 1788009455, NULL),
        (3, 'Uninstalled Game', 'uninstalled-game', 'linux', 'Linux', '/games/old', 'run.sh', 0, 'old-game-123', NULL, NULL, NULL, NULL);
    `);
    db.close();

    const games = readLutrisDatabase(dbPath);
    expect(games).toHaveLength(3);

    expect(games.find((g) => g.id === 1)).toEqual({
      id: 1,
      name: "Skyrim Special Edition",
      slug: "the-elder-scrolls-v-skyrim-special-edition",
      runner: "steam",
      platform: "Linux",
      directory: undefined,
      executable: undefined,
      installed: true,
      configpath: "steam-489830-1781886452",
      service: "steam",
      serviceId: "489830",
      installedAt: 1781886452,
      lastPlayed: 1781900000,
    });

    expect(games.find((g) => g.id === 3)?.installed).toBe(false);
  });

  it("reads and deduplicates games across multiple database paths", () => {
    const nativeDir = path.join(tempDir, "native", "lutris");
    const flatpakDir = path.join(tempDir, "flatpak", "data", "lutris");
    fs.mkdirSync(nativeDir, { recursive: true });
    fs.mkdirSync(flatpakDir, { recursive: true });

    const nativeDb = new DatabaseSync(path.join(nativeDir, "pga.db"));
    nativeDb.exec(`
      CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, runner TEXT, installed INTEGER);
      INSERT INTO games VALUES (1, 'Game One', 'game-one', 'wine', 1);
    `);
    nativeDb.close();

    const flatpakDb = new DatabaseSync(path.join(flatpakDir, "pga.db"));
    flatpakDb.exec(`
      CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, runner TEXT, installed INTEGER);
      INSERT INTO games VALUES
        (10, 'Game One Flatpak', 'game-one', 'wine', 1),
        (11, 'Game Two Flatpak', 'game-two', 'linux', 1);
    `);
    flatpakDb.close();

    // Mock homePath and xdgDataHome
    const fakeHome = tempDir;
    // We override lutrisDatabasePaths via custom call
    const games = readAllLutrisDatabases(fakeHome, path.join(tempDir, "native"));
    // Native has game-one; Flatpak has duplicate game-one and new game-two
    // To test flatpak path, create the exact flatpak directory structure:
    const expectedFlatpakRoot = path.join(
      fakeHome,
      ".var",
      "app",
      "net.lutris.Lutris",
      "data",
      "lutris",
    );
    fs.mkdirSync(expectedFlatpakRoot, { recursive: true });
    fs.copyFileSync(path.join(flatpakDir, "pga.db"), path.join(expectedFlatpakRoot, "pga.db"));

    const combined = readAllLutrisDatabases(fakeHome, path.join(tempDir, "native"));
    expect(combined).toHaveLength(2);
    // Preserves first encountered instance of 'game-one'
    expect(combined.find((g) => g.slug === "game-one")?.name).toBe("Game One");
    expect(combined.find((g) => g.slug === "game-two")?.name).toBe("Game Two Flatpak");
  });
});

describe("Deterministic Lutris record matching without slug inferring", () => {
  const dbRecords: ILutrisDatabaseGame[] = [
    {
      id: 6,
      name: "The Elder Scrolls V: Skyrim Special Edition",
      slug: "the-elder-scrolls-v-skyrim-special-edition",
      runner: "steam",
      installed: true,
      configpath: "steam-489830-1781886452",
      service: "steam",
      serviceId: "489830",
    },
    {
      id: 8,
      name: "Battle.net",
      slug: "battlenet",
      runner: "wine",
      directory: "/home/user/Games/battlenet",
      installed: true,
      configpath: "battlenet-1788009455",
    },
    {
      id: 9,
      name: "Fallout 4",
      slug: "fallout-4",
      runner: "wine",
      directory: "/home/user/Games/fallout4",
      installed: true,
      configpath: "fallout-4-custom",
      serviceId: "377160",
    },
  ];

  it("matches deterministically by configpath without inferring slug from filename", () => {
    const yamlConfig = {
      game: { appid: "489830" },
    };
    // The filename is steam-489830-1781886452.yml. The true slug is NOT the filename!
    const matched = matchLutrisDatabaseGame(dbRecords, yamlConfig, "steam-489830-1781886452.yml");
    expect(matched).toBeDefined();
    expect(matched?.slug).toBe("the-elder-scrolls-v-skyrim-special-edition");
    expect(matched?.slug).not.toBe("steam-489830-1781886452");
    expect(matched?.name).toBe("The Elder Scrolls V: Skyrim Special Edition");
  });

  it("matches by explicit game_slug inside YAML", () => {
    const yamlConfig = {
      game_slug: "battlenet",
    };
    const matched = matchLutrisDatabaseGame(dbRecords, yamlConfig, "random-file-name.yml");
    expect(matched).toBeDefined();
    expect(matched?.slug).toBe("battlenet");
  });

  it("matches by serviceId / AppID when configpath differs", () => {
    const yamlConfig = {
      game: { appid: "377160" },
    };
    const matched = matchLutrisDatabaseGame(dbRecords, yamlConfig, "different-config-name.yml");
    expect(matched).toBeDefined();
    expect(matched?.slug).toBe("fallout-4");
  });

  it("returns undefined and never infers slug from filename when no match exists", () => {
    const yamlConfig = {
      game: { appid: "999999" },
    };
    const matched = matchLutrisDatabaseGame(dbRecords, yamlConfig, "unknown-game-12345.yml");
    expect(matched).toBeUndefined();
  });
});

describe("Lutris YAML and Database entry enrichment", () => {
  it("enriches a minimal Steam runner config with pga.db identity", () => {
    const dbGame: ILutrisDatabaseGame = {
      id: 6,
      name: "The Elder Scrolls V: Skyrim Special Edition",
      slug: "the-elder-scrolls-v-skyrim-special-edition",
      runner: "steam",
      directory: "/games/steam/steamapps/common/Skyrim Special Edition",
      installed: true,
      configpath: "steam-489830-1781886452",
      service: "steam",
      serviceId: "489830",
    };

    // Minimal YAML config containing only appid
    const yamlContent = `
game:
  appid: '489830'
`;
    const entry = parseLutrisGameConfig(
      yamlContent,
      "steam-489830-1781886452.yml",
      "/home/user",
      dbGame,
    );

    expect(entry).toEqual({
      appid: "the-elder-scrolls-v-skyrim-special-edition",
      gamePath: "/games/steam/steamapps/common/Skyrim Special Edition",
      gameStoreId: "lutris",
      launchContext: {
        launcher: "lutris",
        prefixPath: undefined,
        runner: "steam",
        runtimeType: undefined,
      },
      name: "The Elder Scrolls V: Skyrim Special Edition",
    });
  });

  it("merges self-contained YAML with database game metadata", () => {
    const dbGame: ILutrisDatabaseGame = {
      id: 8,
      name: "Battle.net",
      slug: "battlenet",
      runner: "wine",
      directory: "/home/user/Games/battlenet",
      installed: true,
      configpath: "battlenet-1788009455",
    };

    const yamlContent = `
game:
  exe: drive_c/Program Files/Battle.net/Battle.net.exe
  prefix: ~/Games/battlenet
wine:
  runner: /opt/wine/bin/wine
`;
    const entry = parseLutrisGameConfig(
      yamlContent,
      "battlenet-1788009455.yml",
      "/home/user",
      dbGame,
    );

    expect(entry).toEqual({
      appid: "battlenet",
      gamePath: "/home/user/Games/battlenet/drive_c/Program Files/Battle.net",
      gameStoreId: "lutris",
      launchContext: {
        executablePath:
          "/home/user/Games/battlenet/drive_c/Program Files/Battle.net/Battle.net.exe",
        launcher: "lutris",
        prefixPath: "/home/user/Games/battlenet",
        runner: "wine",
        runtimePath: "/opt/wine/bin/wine",
        runtimeType: "wine",
      },
      name: "Battle.net",
    });
  });

  it("converts installed database record directly to IGameStoreEntry", () => {
    const dbGame: ILutrisDatabaseGame = {
      id: 9,
      name: "ArcheAge Classic",
      slug: "archeage-classic",
      runner: "wine",
      directory: "/home/user/Games/AAClassic",
      executable: "/home/user/Games/AAClassic/Launcher.exe",
      installed: true,
    };

    const entry = lutrisDatabaseGameToEntry(dbGame, "/home/user");
    expect(entry).toEqual({
      appid: "archeage-classic",
      gamePath: "/home/user/Games/AAClassic",
      gameStoreId: "lutris",
      launchContext: {
        executablePath: "/home/user/Games/AAClassic/Launcher.exe",
        launcher: "lutris",
        prefixPath: "/home/user/Games/AAClassic",
        runner: "wine",
        runtimeType: "wine",
      },
      name: "ArcheAge Classic",
    });
  });

  it("rejects uninstalled database records in lutrisDatabaseGameToEntry", () => {
    const uninstalledGame: ILutrisDatabaseGame = {
      id: 1,
      name: "Garry's Mod",
      slug: "garrys-mod",
      runner: "steam",
      directory: "/games/garrysmod",
      installed: false,
    };

    expect(lutrisDatabaseGameToEntry(uninstalledGame, "/home/user")).toBeUndefined();
  });
});
