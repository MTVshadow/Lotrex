import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { lutrisConfigDirectories, lutrisLaunchUrl, parseLutrisGameConfig } from "./lutris";

describe("Lutris integration", () => {
  it("checks native and Flatpak configuration directories", () => {
    expect(lutrisConfigDirectories("/home/user", "/config")).toEqual([
      "/config/lutris/games",
      "/home/user/.var/app/net.lutris.Lutris/config/lutris/games",
    ]);
  });

  it("parses a Wine game and resolves its prefix-relative executable", () => {
    expect(
      parseLutrisGameConfig(
        `
name: Fallout New Vegas
game_slug: fallout-new-vegas
runner: wine
game:
  exe: drive_c/GOG Games/Fallout New Vegas/FalloutNV.exe
  prefix: ~/Games/lutris/fallout-new-vegas
wine:
  runner: /opt/wine/bin/wine
`,
        "fallout-new-vegas-1.yml",
        "/home/user",
      ),
    ).toEqual({
      appid: "fallout-new-vegas",
      gamePath: path.join(
        "/home/user/Games/lutris/fallout-new-vegas",
        "drive_c/GOG Games/Fallout New Vegas",
      ),
      gameStoreId: "lutris",
      launchContext: {
        executablePath: path.join(
          "/home/user/Games/lutris/fallout-new-vegas",
          "drive_c/GOG Games/Fallout New Vegas/FalloutNV.exe",
        ),
        launcher: "lutris",
        prefixPath: "/home/user/Games/lutris/fallout-new-vegas",
        runner: "wine",
        runtimePath: "/opt/wine/bin/wine",
        runtimeType: "wine",
      },
      name: "Fallout New Vegas",
    });
  });

  it("uses the filename and working directory for minimal native configs", () => {
    expect(
      parseLutrisGameConfig(
        `
runner: linux
game:
  exe: game.sh
  working_dir: /games/example
`,
        "example-game.yml",
        "/home/user",
      ),
    ).toMatchObject({
      appid: "example-game",
      gamePath: "/games/example",
      launchContext: {
        executablePath: "/games/example/game.sh",
        runtimeType: "native",
      },
      name: "Example Game",
    });
  });

  it("builds an encoded Lutris launch URL", () => {
    expect(lutrisLaunchUrl("game name/edition")).toBe("lutris:rungame/game%20name%2Fedition");
  });
});
