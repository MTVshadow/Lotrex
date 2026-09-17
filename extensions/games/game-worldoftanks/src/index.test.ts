import path from "node:path";

import { describe, expect, it } from "vitest";

const {
  EXECUTABLE,
  GAME_ID,
  MODS_DIRECTORY,
  PACKAGED_MODS_TYPE,
  STEAM_APP_ID,
  VERSION_FILE,
  extractVersion,
  findClientDirectory,
  findGame,
  inspectModCompatibility,
  linuxSteamCandidates,
  requiresLauncher,
  testSupportedContent,
  default: registerExtension,
} = require("./index.js");

type GameRegistration = {
  id: string;
  requiredFiles: string[];
  queryPath: () => Promise<string>;
  queryArgs?: { steam: string[] };
  details: { steamAppId: number };
  capabilities: { platforms: { linux: { steamAppId: string } } };
  requiresLauncher: (gamePath: string, store?: string) => Promise<{ launcher: string } | undefined>;
};

const file = () => ({ isFile: () => true });
const missing = () => {
  throw new Error("not found");
};

describe("World of Tanks Linux Steam support", () => {
  it("uses the official Steam application ID", () => {
    expect(GAME_ID).toBe("worldoftanks");
    expect(STEAM_APP_ID).toBe("1407200");
  });

  it("registers Steam discovery and Linux capability metadata", async () => {
    const registrations: GameRegistration[] = [];
    registerExtension({
      api: { showErrorNotification: () => undefined },
      registerGame: (game: GameRegistration) => registrations.push(game),
      registerModType: () => undefined,
      registerInstaller: () => undefined,
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      id: GAME_ID,
      requiredFiles: [EXECUTABLE, VERSION_FILE],
      details: { steamAppId: 1407200 },
      capabilities: { platforms: { linux: { steamAppId: STEAM_APP_ID } } },
    });
    expect(registrations[0].queryPath).toBe(findGame);
    expect(registrations[0].queryArgs).toBeUndefined();
    await expect(registrations[0].requiresLauncher("/games/wot", "steam")).resolves.toEqual({
      launcher: "steam",
    });
  });

  it("only delegates Steam installations to the Steam launcher", async () => {
    await expect(requiresLauncher("/games/wot", "steam")).resolves.toEqual({ launcher: "steam" });
    await expect(requiresLauncher("/games/wot", "manual")).resolves.toBeUndefined();
  });

  it("resolves the locale client from the Steam discovery result", async () => {
    const resolvedPath = await findGame({
      util: {
        steam: { findByAppId: () => Promise.resolve({ gamePath: "/steam/World of Tanks" }) },
        GameStoreHelper: { findByAppId: () => Promise.reject(new Error("should not be called")) },
      },
      findClientDirectory: (gamePath: string) => `${gamePath}/ru`,
    });

    expect(resolvedPath).toBe("/steam/World of Tanks/ru");
  });

  it("finds a client in a Steam locale directory", () => {
    const gamePath = path.join("/steam", "steamapps", "common", "World of Tanks");
    const clientPath = path.join(gamePath, "ru");
    const statSync = (candidate: string) => {
      if (
        candidate === path.join(clientPath, EXECUTABLE) ||
        candidate === path.join(clientPath, VERSION_FILE)
      ) {
        return file();
      }
      return missing();
    };

    expect(
      findClientDirectory(gamePath, {
        statSync,
        readdirSync: () => [{ name: "ru", isDirectory: () => true }],
      }),
    ).toBe(clientPath);
  });

  it("also accepts a root client directory from Wargaming Game Center", () => {
    const gamePath = path.join("/games", "World_of_Tanks");
    const statSync = (candidate: string) => {
      if (
        candidate === path.join(gamePath, EXECUTABLE) ||
        candidate === path.join(gamePath, VERSION_FILE)
      ) {
        return file();
      }
      return missing();
    };

    expect(findClientDirectory(gamePath, { statSync, readdirSync: () => [] })).toBe(gamePath);
  });

  it("covers native, legacy and Flatpak Steam directories", () => {
    const env = { HOME: "/home/tester", XDG_DATA_HOME: "/data/user" };
    expect(linuxSteamCandidates(env)).toEqual([
      path.join("/data/user", "Steam", "steamapps", "common", "World of Tanks"),
      path.join("/home/tester", ".steam", "steam", "steamapps", "common", "World of Tanks"),
      path.join(
        "/home/tester",
        ".var",
        "app",
        "com.valvesoftware.Steam",
        ".local",
        "share",
        "Steam",
        "steamapps",
        "common",
        "World of Tanks",
      ),
    ]);
  });

  it("extracts the current mod-directory version from version.xml", () => {
    expect(extractVersion("<version> v.2.4.0.0 #944 </version>")).toBe("2.4.0.0");
    expect(extractVersion("<version> 1.26.1.1 </version>")).toBe("1.26.1.1");
    expect(extractVersion("<version.xml></version.xml>")).toBeUndefined();
    expect(MODS_DIRECTORY).toBe("res_mods");
  });

  it("recognizes a versioned mod payload below an archive wrapper", async () => {
    const files = ["author-pack/res_mods/2.4.0.0/scripts/client/mod.pyc", "author-pack/readme.txt"];

    expect(inspectModCompatibility(files, "2.4.0.0")).toMatchObject({
      status: "compatible",
      modVersions: ["2.4.0.0"],
      directories: ["res_mods"],
    });
    await expect(testSupportedContent(files, GAME_ID)).resolves.toEqual({
      supported: true,
      requiredFiles: [],
    });
  });

  it("marks old World of Tanks payloads as incompatible", () => {
    expect(
      inspectModCompatibility(
        ["n0rdisTimex810/res_mods/0.8.10/gui/scaleform/crosshair.swf"],
        "2.4.0.0",
      ),
    ).toMatchObject({
      status: "incompatible",
      modVersions: ["0.8.10"],
    });
  });

  it("recognizes the separate packaged-mod directory", () => {
    expect(
      inspectModCompatibility(["mods/2.4.0.0/scripts/client/mod.pyc"], "2.4.0.0"),
    ).toMatchObject({
      status: "compatible",
      directories: ["mods"],
    });
    expect(PACKAGED_MODS_TYPE).toBe("worldoftanks-mods");
  });
});
