import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  heroicGameConfigPath,
  heroicLaunchUrl,
  heroicManifestPaths,
  parseHeroicGameConfig,
  parseHeroicInstalledGames,
} from "./heroic";

describe("Heroic integration", () => {
  it("checks native and Flatpak manifests", () => {
    const paths = heroicManifestPaths("/home/user", "/config");
    expect(paths).toContainEqual({
      configRoot: "/config/heroic",
      filePath: path.join("/config/heroic", "legendaryConfig", "legendary", "installed.json"),
      runner: "legendary",
    });
    expect(paths).toContainEqual({
      configRoot: "/home/user/.var/app/com.heroicgameslauncher.hgl/config/heroic",
      filePath: path.join(
        "/home/user/.var/app/com.heroicgameslauncher.hgl/config/heroic",
        "gog_store",
        "installed.json",
      ),
      runner: "gog",
    });
  });

  it("parses Epic's keyed Legendary manifest", () => {
    expect(
      parseHeroicInstalledGames(
        {
          Heather: {
            executable: "Game.exe",
            install_path: "/games/Example",
            title: "Example Game",
          },
        },
        "legendary",
      ),
    ).toEqual([
      {
        appid: "Heather",
        gamePath: "/games/Example",
        gameStoreId: "epic",
        launchContext: {
          executablePath: "/games/Example/Game.exe",
          launcher: "heroic",
          runner: "legendary",
        },
        name: "Example Game",
      },
    ]);
  });

  it("parses GOG arrays and skips incomplete rows", () => {
    expect(
      parseHeroicInstalledGames(
        [
          { appName: "1459073823", installPath: "/games/Project Warlock", name: "Project Warlock" },
          { appName: "missing-path" },
        ],
        "gog",
      ),
    ).toEqual([
      {
        appid: "1459073823",
        gamePath: "/games/Project Warlock",
        gameStoreId: "gog",
        launchContext: { launcher: "heroic", runner: "gog" },
        name: "Project Warlock",
      },
    ]);
  });

  it("parses Heroic's GOG installed envelope", () => {
    expect(
      parseHeroicInstalledGames(
        {
          installed: [
            {
              app_name: "1459073823",
              install_path: "/games/Project Warlock",
              title: "Project Warlock",
            },
          ],
        },
        "gog",
      ),
    ).toEqual([
      {
        appid: "1459073823",
        gamePath: "/games/Project Warlock",
        gameStoreId: "gog",
        launchContext: { launcher: "heroic", runner: "gog" },
        name: "Project Warlock",
      },
    ]);
  });

  it("parses Heroic's wrapped Wine launch configuration", () => {
    expect(
      parseHeroicGameConfig(
        {
          game123: {
            winePrefix: "/games/prefixes/game123",
            wineVersion: { bin: "/usr/bin/wine", type: "wine" },
          },
          appId: "game123",
        },
        "game123",
      ),
    ).toEqual({
      prefixPath: "/games/prefixes/game123",
      runtimePath: "/usr/bin/wine",
      runtimeType: "wine",
    });
    expect(heroicGameConfigPath("/config/heroic", "game123")).toBe(
      "/config/heroic/GamesConfig/game123.json",
    );
  });

  it("builds an encoded official Heroic launch URL", () => {
    expect(heroicLaunchUrl("Game Name&Edition", "legendary")).toBe(
      "heroic://launch?appName=Game%20Name%26Edition&runner=legendary",
    );
  });
});
