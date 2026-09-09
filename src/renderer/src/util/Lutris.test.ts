import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lutrisGameStore } from "./Lutris";

describe("Lutris game store integration", () => {
  let tempDir: string;
  let originalDataHome: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vortex-lutris-store-test-"));
    originalDataHome = process.env.XDG_DATA_HOME;
    originalConfigHome = process.env.XDG_CONFIG_HOME;

    process.env.XDG_DATA_HOME = path.join(tempDir, "data");
    process.env.XDG_CONFIG_HOME = path.join(tempDir, "config");

    fs.mkdirSync(path.join(process.env.XDG_DATA_HOME, "lutris", "games"), { recursive: true });
    fs.mkdirSync(path.join(process.env.XDG_CONFIG_HOME, "lutris", "games"), { recursive: true });
  });

  afterEach(async () => {
    process.env.XDG_DATA_HOME = originalDataHome;
    process.env.XDG_CONFIG_HOME = originalConfigHome;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("exposes expected store identity and protocol url", async () => {
    expect(lutrisGameStore).toBeDefined();
    expect(lutrisGameStore?.id).toBe("lutris");
    expect(lutrisGameStore?.name).toBe("Lutris");
    expect(lutrisGameStore?.priority).toBe(40);

    const launchUrl = await lutrisGameStore?.getPosixPath("fallout-new-vegas");
    expect(launchUrl).toBe("lutris:rungame/fallout-new-vegas");
  });

  it("loads and reconciles games from pga.db and yaml configs", async () => {
    // 1. Create pga.db SQLite database
    const dbPath = path.join(process.env.XDG_DATA_HOME!, "lutris", "pga.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        name TEXT,
        slug TEXT,
        runner TEXT,
        directory TEXT,
        executable TEXT,
        installed INTEGER,
        configpath TEXT,
        service TEXT,
        service_id TEXT
      );
      INSERT INTO games (id, name, slug, runner, directory, executable, installed, configpath, service, service_id)
      VALUES
        (1, 'Battle.net', 'battlenet', 'wine', '/games/battlenet', NULL, 1, 'battlenet-1788009455', NULL, NULL),
        (2, 'The Elder Scrolls V: Skyrim Special Edition', 'the-elder-scrolls-v-skyrim-special-edition', 'steam', '/games/skyrim', NULL, 1, 'steam-489830-1781886452', 'steam', '489830'),
        (3, 'Direct DB Game', 'direct-db-game', 'linux', '/games/direct', '/games/direct/start.sh', 1, NULL, NULL, NULL),
        (4, 'Uninstalled Game', 'uninstalled-game', 'wine', '/games/uninstalled', NULL, 0, 'uninstalled-game-123', NULL, NULL);
    `);
    db.close();

    // 2. Write YAML configs matching configpath
    fs.writeFileSync(
      path.join(process.env.XDG_DATA_HOME!, "lutris", "games", "battlenet-1788009455.yml"),
      `
game:
  exe: drive_c/Program Files/Battle.net/Battle.net.exe
  prefix: /games/battlenet
wine:
  runner: /opt/wine/bin/wine
`,
    );

    // Minimal config with only appid
    fs.writeFileSync(
      path.join(process.env.XDG_DATA_HOME!, "lutris", "games", "steam-489830-1781886452.yml"),
      `
game:
  appid: '489830'
`,
    );

    await lutrisGameStore?.reloadGames();
    const games = (await lutrisGameStore?.allGames()) ?? [];

    expect(games).toHaveLength(3);

    // Battle.net resolved via configpath + YAML exe/prefix
    const battlenet = games.find((g) => g.appid === "battlenet");
    expect(battlenet).toMatchObject({
      appid: "battlenet",
      name: "Battle.net",
      gamePath: "/games/battlenet/drive_c/Program Files/Battle.net",
      launchContext: {
        launcher: "lutris",
        runner: "wine",
        prefixPath: "/games/battlenet",
        runtimePath: "/opt/wine/bin/wine",
      },
    });

    // Skyrim Special Edition resolved via pga.db identity without guessing slug from filename
    const skyrim = games.find((g) => g.appid === "the-elder-scrolls-v-skyrim-special-edition");
    expect(skyrim).toMatchObject({
      appid: "the-elder-scrolls-v-skyrim-special-edition",
      name: "The Elder Scrolls V: Skyrim Special Edition",
      gamePath: "/games/skyrim",
      launchContext: {
        launcher: "lutris",
        runner: "steam",
      },
    });

    // Direct DB game without YAML config
    const directGame = games.find((g) => g.appid === "direct-db-game");
    expect(directGame).toMatchObject({
      appid: "direct-db-game",
      name: "Direct DB Game",
      gamePath: "/games/direct",
      launchContext: {
        executablePath: "/games/direct/start.sh",
        launcher: "lutris",
        runner: "linux",
      },
    });

    // Uninstalled game should not be present
    expect(games.find((g) => g.appid === "uninstalled-game")).toBeUndefined();
  });

  it("finds games by appid and name", async () => {
    const dbPath = path.join(process.env.XDG_DATA_HOME!, "lutris", "pga.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, runner TEXT, directory TEXT, installed INTEGER);
      INSERT INTO games VALUES (1, 'Fallout: New Vegas', 'fallout-new-vegas', 'wine', '/games/fnv', 1);
    `);
    db.close();

    await lutrisGameStore?.reloadGames();

    const byAppId = await lutrisGameStore?.findByAppId("fallout-new-vegas");
    expect(byAppId?.name).toBe("Fallout: New Vegas");

    const byName = await lutrisGameStore?.findByName("fallout: new vegas");
    expect(byName?.appid).toBe("fallout-new-vegas");
  });
});
