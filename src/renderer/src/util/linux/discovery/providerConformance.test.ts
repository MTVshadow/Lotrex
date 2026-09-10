import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getHeroicBoundedSources,
  getLutrisBoundedSources,
  getSteamBoundedSources,
  type IBoundedSourceDescriptor,
} from "./boundedSources";
import { DiscoveryCache } from "./discoveryCache";
import {
  assertConformanceResourcesContract,
  setupConformanceFixtures,
  type IConformanceFixturePaths,
} from "./providerConformance";
import { discoverHeroicResources } from "./providers/heroicProvider";
import { discoverLutrisResources } from "./providers/lutrisProvider";
import { discoverSteamResources } from "./providers/steamProvider";
import { runUnifiedResourceDiscovery } from "./resourceDiscoveryEngine";

describe("Unified Linux Resource Discovery — Phase 10: Provider Conformance Suite", () => {
  let tempDir: string;
  let fixtures: IConformanceFixturePaths;
  let customEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-conformance-test-"));
    fixtures = await setupConformanceFixtures(tempDir);
    customEnv = {
      HOME: tempDir,
      XDG_DATA_HOME: path.join(tempDir, ".local", "share"),
      XDG_CONFIG_HOME: path.join(tempDir, ".config"),
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("1. Steam Provider Conformance", () => {
    it("handles missing or empty Steam sources gracefully (Rule 1)", () => {
      const sources: IBoundedSourceDescriptor[] = [
        {
          id: "steam:test:missing",
          category: "steam-manifest",
          provider: "steam",
          resolvedPath: path.join(tempDir, "missing_steam"),
          packagingFormat: "native",
          exists: false,
        },
      ];

      const results = discoverSteamResources(sources);
      expect(results).toEqual([]);
    });

    it("survives corrupt libraryfolders.vdf and corrupt appmanifest files (Rule 2)", async () => {
      const steamRoot = fixtures.steamDataDir;
      // Write malformed VDF syntax
      await fs.writeFile(
        path.join(steamRoot, "steamapps", "libraryfolders.vdf"),
        `"libraryfolders" { "0" { "path" INVALID SYNTAX NO CLOSING BRACE`,
      );
      // Write corrupted/truncated appmanifest
      await fs.writeFile(
        path.join(steamRoot, "steamapps", "appmanifest_99999.vdf"),
        `"AppState" { "appid" "99999" "name" TRUNCATED`,
      );

      const sources = getSteamBoundedSources(tempDir, customEnv);
      const results = discoverSteamResources(sources);

      // Must not crash and must produce valid contracts
      assertConformanceResourcesContract(results, "steam");
      // Fallback library or launcher can be produced, but corrupt manifest is skipped
      expect(results.some((r) => r.id === "steam:game:99999")).toBe(false);
    });

    it("handles inaccessible permissions without crashing (Rule 3)", async () => {
      const steamRoot = fixtures.steamDataDir;
      const restrictedDir = path.join(steamRoot, "steamapps", "restricted_dir");
      await fs.mkdir(restrictedDir, { recursive: true, mode: 0o000 });

      try {
        const sources = getSteamBoundedSources(tempDir, customEnv);
        const results = discoverSteamResources(sources);
        assertConformanceResourcesContract(results, "steam");
      } finally {
        await fs.chmod(restrictedDir, 0o755);
      }
    });

    it("resolves game directories through symlink aliases (Rule 5)", async () => {
      const physicalGame = path.join(tempDir, "PhysicalStorage", "Skyrim");
      await fs.mkdir(physicalGame, { recursive: true });

      const steamAppsDir = path.join(fixtures.steamDataDir, "steamapps");
      const commonDir = path.join(steamAppsDir, "common");
      await fs.mkdir(commonDir, { recursive: true });

      // Symlink common/Skyrim -> PhysicalStorage/Skyrim
      await fs.symlink(physicalGame, path.join(commonDir, "Skyrim"));

      await fs.writeFile(
        path.join(steamAppsDir, "appmanifest_489830.vdf"),
        `"AppState"
{
  "appid" "489830"
  "name" "Skyrim"
  "installdir" "Skyrim"
}`,
      );

      const sources = getSteamBoundedSources(tempDir, customEnv);
      const results = discoverSteamResources(sources);
      const game = results.find((r) => r.id === "steam:game:489830");

      expect(game).toBeDefined();
      expect(game?.canonicalPath).toBe(path.resolve(path.join(commonDir, "Skyrim")));
      assertConformanceResourcesContract(results, "steam");
    });

    it("preserves forward-compatible unknown manifest fields (Rule 10)", async () => {
      const steamAppsDir = path.join(fixtures.steamDataDir, "steamapps");
      await fs.writeFile(
        path.join(steamAppsDir, "appmanifest_100.vdf"),
        `"AppState"
{
  "appid" "100"
  "name" "TestApp"
  "installdir" "TestApp"
  "CustomField_X" "future_token"
  "BetaKey" "v2"
}`,
      );

      const sources = getSteamBoundedSources(tempDir, customEnv);
      const results = discoverSteamResources(sources);
      const app = results.find((r) => r.id === "steam:game:100");

      expect(app).toBeDefined();
      expect(app?.metadata?.appId).toBe("100");
      assertConformanceResourcesContract(results, "steam");
    });
  });

  describe("2. Heroic Provider Conformance", () => {
    it("handles missing or empty sources gracefully (Rule 1)", () => {
      const sources: IBoundedSourceDescriptor[] = [
        {
          id: "heroic:test:missing",
          category: "heroic-manifest",
          provider: "heroic",
          resolvedPath: path.join(tempDir, "missing_heroic.json"),
          packagingFormat: "native",
          exists: false,
        },
      ];

      const results = discoverHeroicResources(sources);
      expect(results).toEqual([]);
    });

    it("survives corrupt JSON syntax in installed.json (Rule 2)", async () => {
      const gogFile = path.join(fixtures.heroicConfigDir, "gog_store", "installed.json");
      await fs.writeFile(gogFile, `{"installed": [ { "appName": "123", INVALID JSON`);

      const sources = getHeroicBoundedSources(tempDir, customEnv);
      const results = discoverHeroicResources(sources);

      expect(results).toEqual([]);
    });

    it("supports forward-compatible JSON schemas (array or object dictionary) (Rule 10)", async () => {
      const legendaryFile = path.join(
        fixtures.heroicConfigDir,
        "legendaryConfig",
        "legendary",
        "installed.json",
      );

      // Object dictionary format instead of array
      const dictData = {
        app_99: {
          app_name: "app_99",
          title: "Custom Dict Title",
          install_path: path.join(tempDir, "Games", "App99"),
          runner: "custom_proton",
          future_flag: true,
        },
      };
      await fs.writeFile(legendaryFile, JSON.stringify(dictData));

      const sources = getHeroicBoundedSources(tempDir, customEnv);
      const results = discoverHeroicResources(sources);
      const game = results.find((r) => r.id === "heroic:legendary:app_99");

      expect(game).toBeDefined();
      expect(game?.metadata?.displayName).toBe("Custom Dict Title");
      assertConformanceResourcesContract(results, "heroic");
    });
  });

  describe("3. Lutris Provider Conformance", () => {
    it("handles missing or uninitialized database (Rule 1)", () => {
      const sources: IBoundedSourceDescriptor[] = [
        {
          id: "lutris:test:missing",
          category: "lutris-db",
          provider: "lutris",
          resolvedPath: path.join(tempDir, "missing_pga.db"),
          packagingFormat: "native",
          exists: false,
        },
      ];

      const results = discoverLutrisResources(sources);
      expect(results).toEqual([]);
    });

    it("survives corrupt non-SQLite binary data in pga.db (Rule 2)", async () => {
      const dbPath = path.join(fixtures.lutrisDataDir, "pga.db");
      await fs.writeFile(dbPath, Buffer.from("GARBAGE DATA THAT IS NOT SQLITE"));

      const sources = getLutrisBoundedSources(tempDir, customEnv);
      const results = discoverLutrisResources(sources);

      expect(results).toEqual([]);
    });

    it("preserves forward-compatible runner types and metadata (Rule 10)", async () => {
      const dbPath = path.join(fixtures.lutrisDataDir, "pga.db");
      const gameDir = path.join(tempDir, "Games", "RetroRunner");
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
        VALUES (101, 'Retro Game', 'retro-game', 'scummvm_future', '${gameDir}', 1);
      `);
      db.close();

      const sources = getLutrisBoundedSources(tempDir, customEnv);
      const results = discoverLutrisResources(sources);
      const game = results.find((r) => r.id === "lutris:game:retro-game");

      expect(game).toBeDefined();
      expect(game?.metadata?.runner).toBe("scummvm_future");
      assertConformanceResourcesContract(results, "lutris");
    });
  });

  describe("4. Engine Conformance: Cancellation, Invalidation, Duplicates & Removable Sandbox", () => {
    it("conforms to mid-operation cancellation guarantees (Rule 6)", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        runUnifiedResourceDiscovery({
          env: customEnv,
          homeDir: tempDir,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });

    it("conforms to cache invalidation on manifest updates (Rule 7)", async () => {
      const gogFile = path.join(fixtures.heroicConfigDir, "gog_store", "installed.json");
      const gameDir1 = path.join(tempDir, "Games", "G1");
      const gameDir2 = path.join(tempDir, "Games", "G2");
      await fs.mkdir(gameDir1, { recursive: true });
      await fs.mkdir(gameDir2, { recursive: true });

      await fs.writeFile(
        gogFile,
        JSON.stringify({
          installed: [{ appName: "G1", title: "Game 1", install_path: gameDir1 }],
        }),
      );

      const cache = new DiscoveryCache();

      // Initial run
      const rep1 = await runUnifiedResourceDiscovery({
        env: customEnv,
        homeDir: tempDir,
        providers: ["heroic"],
        cache,
      });
      expect(rep1.resources.some((r) => r.id === "heroic:gog:G1")).toBe(true);
      expect(rep1.resources.some((r) => r.id === "heroic:gog:G2")).toBe(false);

      // Modify manifest file to add G2
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(
        gogFile,
        JSON.stringify({
          installed: [
            { appName: "G1", title: "Game 1", install_path: gameDir1 },
            { appName: "G2", title: "Game 2", install_path: gameDir2 },
          ],
        }),
      );

      // Subsequent run should detect fingerprint change and return both games
      const rep2 = await runUnifiedResourceDiscovery({
        env: customEnv,
        homeDir: tempDir,
        providers: ["heroic"],
        cache,
      });
      expect(rep2.resources.some((r) => r.id === "heroic:gog:G1")).toBe(true);
      expect(rep2.resources.some((r) => r.id === "heroic:gog:G2")).toBe(true);
    });

    it("conforms to duplicate resolution and multi-source evidence merging (Rule 8)", async () => {
      const sharedGameDir = path.join(tempDir, "Games", "SharedCyberpunk");
      await fs.mkdir(sharedGameDir, { recursive: true });

      // 1. Steam manifest pointing to sharedGameDir
      const steamAppsDir = path.join(fixtures.steamDataDir, "steamapps");
      await fs.writeFile(
        path.join(steamAppsDir, "appmanifest_1091500.vdf"),
        `"AppState"\n{\n  "appid" "1091500"\n  "name" "Cyberpunk 2077"\n  "installdir" "${sharedGameDir}"\n}`,
      );

      // 2. Heroic manifest pointing to exact same sharedGameDir
      const gogFile = path.join(fixtures.heroicConfigDir, "gog_store", "installed.json");
      await fs.writeFile(
        gogFile,
        JSON.stringify({
          installed: [{ appName: "cp2077", title: "Cyberpunk 2077", install_path: sharedGameDir }],
        }),
      );

      const report = await runUnifiedResourceDiscovery({
        env: customEnv,
        homeDir: tempDir,
        providers: ["steam", "heroic"],
      });

      // Filter games matching shared directory
      const matching = report.resources.filter(
        (r) => r.canonicalPath === path.resolve(sharedGameDir),
      );

      // Must be deduplicated to exactly 1 resource with combined evidence
      expect(matching).toHaveLength(1);
      const unifiedResource = matching[0];
      expect(unifiedResource.confidence).toBe("confirmed");
      expect(unifiedResource.evidence.length).toBeGreaterThanOrEqual(2);
      assertConformanceResourcesContract(report.resources, "unified");
    });

    it("conforms to removable storage and sandbox boundary evaluation (Rule 9)", async () => {
      const externalGameDir = path.join(fixtures.removableStorageDir, "SteamLibrary", "GameX");
      await fs.mkdir(externalGameDir, { recursive: true });

      const steamAppsDir = path.join(fixtures.steamDataDir, "steamapps");
      await fs.writeFile(
        path.join(steamAppsDir, "appmanifest_500.vdf"),
        `"AppState"\n{\n  "appid" "500"\n  "name" "GameX"\n  "installdir" "${externalGameDir}"\n}`,
      );

      const report = await runUnifiedResourceDiscovery({
        env: customEnv,
        homeDir: tempDir,
        providers: ["steam"],
        hostPackaging: "flatpak",
      });

      const game = report.resources.find((r) => r.id === "steam:game:500");
      expect(game).toBeDefined();
      expect(game?.packagingContext.sandboxVisibility).toBeDefined();
      assertConformanceResourcesContract(report.resources, "steam");
    });
  });
});
