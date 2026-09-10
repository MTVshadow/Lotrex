import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deduplicateAndMergeResources,
  isPreferredUserVisiblePath,
  resolvePhysicalPath,
} from "./canonicalization";
import type { IDiscoveredResource } from "./contracts";

describe("Unified Linux Resource Discovery — Phase 5: Canonicalization and Deduplication", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-canon-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("resolves physical canonical path across symlink aliases", async () => {
    const physicalDir = path.join(tempDir, "real_storage", "SteamLibrary");
    await fs.mkdir(physicalDir, { recursive: true });

    const aliasSymlink = path.join(tempDir, "symlink_alias");
    await fs.symlink(physicalDir, aliasSymlink);

    expect(resolvePhysicalPath(aliasSymlink)).toBe(resolvePhysicalPath(physicalDir));
  });

  it("prefers standard user paths over internal .steam symlink aliases", () => {
    const standardPath = "/home/user/.local/share/Steam/compatibilitytools.d/GE-Proton8";
    const steamRootAlias = "/home/user/.steam/root/compatibilitytools.d/GE-Proton8";

    expect(isPreferredUserVisiblePath(standardPath, steamRootAlias)).toBe(true);
    expect(isPreferredUserVisiblePath(steamRootAlias, standardPath)).toBe(false);
  });

  it("deduplicates Steam/Proton runtimes pointing to the same physical directory and merges evidence", async () => {
    // Автентична структура Steam на Linux: .local/share/Steam — реальний каталог, .steam/root — симлінк
    const xdgSteamDir = path.join(tempDir, ".local", "share", "Steam");
    const physicalRuntimeDir = path.join(xdgSteamDir, "compatibilitytools.d", "GE-Proton8-25");
    await fs.mkdir(physicalRuntimeDir, { recursive: true });

    const dotSteamDir = path.join(tempDir, ".steam");
    await fs.mkdir(dotSteamDir, { recursive: true });
    await fs.symlink(xdgSteamDir, path.join(dotSteamDir, "root"));

    const pathFromDotSteam = path.join(
      tempDir,
      ".steam",
      "root",
      "compatibilitytools.d",
      "GE-Proton8-25",
    );
    const pathFromXdg = physicalRuntimeDir;

    const runtimeFromDotSteam: IDiscoveredResource = {
      id: "steam:runtime:GE-Proton8-25",
      kind: "compatibility-runtime",
      provider: "steam",
      canonicalPath: pathFromDotSteam,
      packagingContext: { format: "native" },
      evidence: [
        {
          sourceType: "manifest",
          sourcePath: path.join(pathFromDotSteam, "proton"),
          timestamp: 1000,
        },
      ],
      confidence: "probable",
      validationState: { status: "valid" },
      sourceTimestamp: 1000,
      metadata: { runtimeName: "GE-Proton8-25" },
    };

    const runtimeFromXdg: IDiscoveredResource = {
      id: "steam:runtime:GE-Proton8-25",
      kind: "compatibility-runtime",
      provider: "steam",
      canonicalPath: pathFromXdg,
      packagingContext: { format: "native" },
      evidence: [
        {
          sourceType: "manifest",
          sourcePath: path.join(pathFromXdg, "proton"),
          timestamp: 2000,
        },
      ],
      confidence: "confirmed",
      validationState: { status: "valid" },
      sourceTimestamp: 2000,
      metadata: { runtimeName: "GE-Proton8-25", xdgFound: true },
    };

    const deduplicated = deduplicateAndMergeResources([runtimeFromDotSteam, runtimeFromXdg]);

    // Результат повинен містити рівно один запис
    expect(deduplicated).toHaveLength(1);

    const item = deduplicated[0];
    expect(item.id).toBe("steam:runtime:GE-Proton8-25");
    expect(item.canonicalPath).toBe(pathFromXdg); // обрано кращий XDG шлях
    expect(item.confidence).toBe("confirmed");

    // Свідчення об'єднані
    expect(item.evidence).toHaveLength(2);
    expect(item.metadata?.xdgFound).toBe(true);
  });

  it("merges corroborating evidence from multiple providers for the same game directory", async () => {
    const gameDir = path.join(tempDir, "Games", "Cyberpunk2077");
    await fs.mkdir(gameDir, { recursive: true });

    const steamGame: IDiscoveredResource = {
      id: "steam:game:1091500",
      kind: "game",
      provider: "steam",
      canonicalPath: gameDir,
      packagingContext: { format: "native" },
      evidence: [
        {
          sourceType: "manifest",
          sourcePath: "/steam/steamapps/appmanifest_1091500.vdf",
          timestamp: 1000,
        },
      ],
      confidence: "confirmed",
      validationState: { status: "valid" },
      sourceTimestamp: 1000,
      metadata: { appId: "1091500" },
    };

    const lutrisGame: IDiscoveredResource = {
      id: "lutris:game:cyberpunk-2077",
      kind: "game",
      provider: "lutris",
      canonicalPath: gameDir,
      packagingContext: { format: "native" },
      evidence: [
        {
          sourceType: "database",
          sourcePath: "/lutris/pga.db",
          timestamp: 1500,
        },
      ],
      confidence: "probable",
      validationState: { status: "valid" },
      sourceTimestamp: 1500,
      metadata: { lutrisSlug: "cyberpunk-2077" },
    };

    const merged = deduplicateAndMergeResources([steamGame, lutrisGame]);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe("confirmed");
    expect(merged[0].evidence).toHaveLength(2);
    expect(merged[0].metadata?.appId).toBe("1091500");
    expect(merged[0].metadata?.lutrisSlug).toBe("cyberpunk-2077");
  });
});
