import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runUnifiedResourceDiscovery } from "./resourceDiscoveryEngine";

describe("Unified Linux Resource Discovery — Phase 1 & 2 Engine Verification", () => {
  let tempDir: string;
  let homeDir: string;
  let mockEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-discovery-test-"));
    homeDir = path.join(tempDir, "user");
    mockEnv = {
      HOME: homeDir,
      XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
      XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    };

    await fs.mkdir(path.join(mockEnv.XDG_DATA_HOME!, "Steam", "steamapps"), { recursive: true });
    await fs.mkdir(path.join(mockEnv.XDG_CONFIG_HOME!, "heroic", "gog_store"), { recursive: true });
    await fs.mkdir(path.join(mockEnv.XDG_DATA_HOME!, "lutris"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("discovers Steam library and games through bounded manifests without disk crawl", async () => {
    const steamRoot = path.join(mockEnv.XDG_DATA_HOME!, "Steam");
    const libraryfoldersContent = `"libraryfolders"
{
  "0"
  {
    "path"    "${steamRoot}"
    "apps"
    {
      "489830"    "12345678"
    }
  }
}`;
    await fs.writeFile(
      path.join(steamRoot, "steamapps", "libraryfolders.vdf"),
      libraryfoldersContent,
    );

    const appmanifestContent = `"AppState"
{
  "appid"       "489830"
  "name"        "Skyrim Special Edition"
  "installdir"  "Skyrim Special Edition"
  "buildid"     "9999"
}`;
    await fs.writeFile(
      path.join(steamRoot, "steamapps", "appmanifest_489830.vdf"),
      appmanifestContent,
    );

    const gameCommonDir = path.join(steamRoot, "steamapps", "common", "Skyrim Special Edition");
    await fs.mkdir(gameCommonDir, { recursive: true });

    const report = await runUnifiedResourceDiscovery({
      env: mockEnv,
      homeDir,
      providers: ["steam"],
    });

    expect(report.scannedSourcesCount).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);

    const game = report.resources.find((r) => r.id === "steam:game:489830");
    expect(game).toBeDefined();
    expect(game?.kind).toBe("game");
    expect(game?.provider).toBe("steam");
    expect(game?.canonicalPath).toBe(path.resolve(gameCommonDir));
    expect(game?.confidence).toBe("confirmed");
    expect(game?.evidence[0].sourceType).toBe("manifest");
  });

  it("discovers Heroic games through bounded installed.json manifest", async () => {
    const gogInstalledPath = path.join(
      mockEnv.XDG_CONFIG_HOME!,
      "heroic",
      "gog_store",
      "installed.json",
    );
    const gameDir = path.join(tempDir, "Games", "Witcher3");
    await fs.mkdir(gameDir, { recursive: true });

    const installedData = {
      installed: [
        {
          appName: "123456",
          title: "The Witcher 3: Wild Hunt",
          install_path: gameDir,
          platform: "windows",
        },
      ],
    };
    await fs.writeFile(gogInstalledPath, JSON.stringify(installedData));

    const report = await runUnifiedResourceDiscovery({
      env: mockEnv,
      homeDir,
      providers: ["heroic"],
    });

    expect(report.errors).toEqual([]);
    const game = report.resources.find((r) => r.id === "heroic:gog:123456");
    expect(game).toBeDefined();
    expect(game?.kind).toBe("game");
    expect(game?.provider).toBe("heroic");
    expect(game?.canonicalPath).toBe(path.resolve(gameDir));
    expect(game?.confidence).toBe("confirmed");
  });

  it("supports cancellation without completing unneeded probes", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runUnifiedResourceDiscovery({
        env: mockEnv,
        homeDir,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("filters results by requested resource kinds", async () => {
    const steamRoot = path.join(mockEnv.XDG_DATA_HOME!, "Steam");
    await fs.writeFile(
      path.join(steamRoot, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders" { "0" { "path" "${steamRoot}" } }`,
    );

    const report = await runUnifiedResourceDiscovery({
      env: mockEnv,
      homeDir,
      kinds: ["launcher"],
      providers: ["steam"],
    });

    for (const res of report.resources) {
      expect(res.kind).toBe("launcher");
    }
  });

  it("discovers Lutris games through bounded pga.db database without crawling", async () => {
    const dbPath = path.join(mockEnv.XDG_DATA_HOME!, "lutris", "pga.db");
    const gameDir = path.join(tempDir, "Games", "SkyrimLutris");
    await fs.mkdir(gameDir, { recursive: true });

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        name TEXT,
        slug TEXT,
        runner TEXT,
        directory TEXT,
        installed INTEGER
      );
      INSERT INTO games (id, name, slug, runner, directory, installed)
      VALUES (42, 'Skyrim SE', 'skyrim-se', 'wine', '${gameDir}', 1);
    `);
    db.close();

    const report = await runUnifiedResourceDiscovery({
      env: mockEnv,
      homeDir,
      providers: ["lutris"],
    });

    expect(report.errors).toEqual([]);
    const game = report.resources.find((r) => r.id === "lutris:game:skyrim-se");
    expect(game).toBeDefined();
    expect(game?.kind).toBe("game");
    expect(game?.provider).toBe("lutris");
    expect(game?.canonicalPath).toBe(path.resolve(gameDir));
    expect(game?.confidence).toBe("confirmed");
    expect(game?.evidence[0].sourceType).toBe("database");
  });

  it("integrates sandbox assessment, candidate validation, and symlink deduplication (Phases 3-5)", async () => {
    const steamRoot = path.join(mockEnv.XDG_DATA_HOME!, "Steam");
    const runtimeDir = path.join(steamRoot, "compatibilitytools.d", "GE-Proton8-25");
    await fs.mkdir(runtimeDir, { recursive: true });

    // Створюємо валідний виконуваний скрипт proton з shebang
    await fs.writeFile(path.join(runtimeDir, "proton"), "#!/usr/bin/env python3\nexit(0)\n", {
      mode: 0o755,
    });

    // Створюємо симлінк .steam/root -> XDG Steam
    const dotSteamDir = path.join(homeDir, ".steam");
    await fs.mkdir(dotSteamDir, { recursive: true });
    await fs.symlink(steamRoot, path.join(dotSteamDir, "root"));

    const report = await runUnifiedResourceDiscovery({
      env: mockEnv,
      homeDir,
      providers: ["steam"],
      kinds: ["compatibility-runtime"],
      hostPackaging: "flatpak",
      strictExecutableValidation: true,
    });

    expect(report.errors).toEqual([]);
    // Завдяки дедуплікації (Phase 5) рантайм знайдено лише 1 раз
    const runtimes = report.resources.filter((r) => r.kind === "compatibility-runtime");
    expect(runtimes).toHaveLength(1);

    const runtime = runtimes[0];
    expect(runtime.id).toBe("steam:runtime:GE-Proton8-25");
    // Валідація Phase 4 підтвердила наявність виконуваного файлу
    expect(runtime.validationState.status).toBe("valid");
    expect(runtime.confidence).toBe("confirmed");
    // Оцінка Phase 3 визначила статус видимості пісочниці
    expect(runtime.packagingContext.sandboxVisibility).toBeDefined();
  });
});
