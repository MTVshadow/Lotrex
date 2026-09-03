import * as fs from "fs";
import * as path from "path";

import { log, selectors, types, util, ProtonPaths } from "@nexusmods/vortex-api";
import * as Redux from "redux";

export interface ISettingsFile {
  name: string;
  optional: boolean;
}

export interface IGameSupportEntry {
  mygamesPath: string;
  gameSettingsFiles: Array<string | ISettingsFile>;
}

const gameSupport = util.makeOverlayableDictionary<string, IGameSupportEntry>(
  {
    skyrim: {
      mygamesPath: "skyrim",
      gameSettingsFiles: ["Skyrim.ini", "SkyrimPrefs.ini"],
    },
    enderal: {
      mygamesPath: "Enderal",
      gameSettingsFiles: ["Enderal.ini", "EnderalPrefs.ini"],
    },
    skyrimse: {
      mygamesPath: "Skyrim Special Edition",
      gameSettingsFiles: [
        "Skyrim.ini",
        "SkyrimPrefs.ini",
        { name: "SkyrimCustom.ini", optional: true },
      ],
    },
    enderalspecialedition: {
      mygamesPath: "Enderal Special Edition",
      gameSettingsFiles: ["Enderal.ini", "EnderalPrefs.ini"],
    },
    skyrimvr: {
      mygamesPath: "Skyrim VR",
      gameSettingsFiles: ["Skyrim.ini", "SkyrimVR.ini", "SkyrimPrefs.ini"],
    },
    fallout3: {
      mygamesPath: "Fallout3",
      gameSettingsFiles: [
        "Fallout.ini",
        "FalloutPrefs.ini",
        { name: "FalloutCustom.ini", optional: true },
      ],
    },
    fallout4: {
      mygamesPath: "Fallout4",
      gameSettingsFiles: [
        "Fallout4.ini",
        "Fallout4Prefs.ini",
        { name: "Fallout4Custom.ini", optional: true },
      ],
    },
    fallout4vr: {
      mygamesPath: "Fallout4VR",
      gameSettingsFiles: ["Fallout4Custom.ini", "Fallout4Prefs.ini"],
    },
    starfield: {
      mygamesPath: "Starfield",
      gameSettingsFiles: ["StarfieldCustom.ini", "StarfieldPrefs.ini"],
    },
    falloutnv: {
      mygamesPath: "FalloutNV",
      gameSettingsFiles: [
        "Fallout.ini",
        "FalloutPrefs.ini",
        { name: "FalloutCustom.ini", optional: true },
      ],
    },
    oblivion: {
      mygamesPath: "Oblivion",
      gameSettingsFiles: ["Oblivion.ini"],
    },
    oblivionremastered: {
      mygamesPath: path.join("Oblivion Remastered", "Saved", "Config", "Windows"),
      gameSettingsFiles: ["Altar.ini"],
    },
  },
  {
    xbox: {
      skyrimse: {
        mygamesPath: "Skyrim Special Edition MS",
      },
      fallout4: {
        mygamesPath: "Fallout4 MS",
      },
    },
    gog: {
      skyrimse: {
        mygamesPath: "Skyrim Special Edition GOG",
      },
      enderalspecialedition: {
        mygamesPath: "Enderal Special Edition GOG",
      },
    },
    epic: {
      skyrimse: {
        mygamesPath: "Skyrim Special Edition EPIC",
      },
      fallout4: {
        mygamesPath: "Fallout4 EPIC",
      },
    },
    enderalseOverlay: {
      enderalspecialedition: {
        mygamesPath: "Skyrim Special Edition",
        gameSettingsFiles: [
          "Skyrim.ini",
          "SkyrimPrefs.ini",
          { name: "SkyrimCustom.ini", optional: true },
        ],
      },
    },
  },
  (gameId: string) => {
    const discovery = discoveryForGame(gameId);
    if (
      discovery?.path !== undefined &&
      gameId === "enderalspecialedition" &&
      discovery.path.includes("skyrim")
    ) {
      return "enderalseOverlay";
    } else {
      return discovery?.store;
    }
  },
);

let discoveryForGame: (gameId: string) => types.IDiscoveryResult = () => undefined;

export function initGameSupport(api: types.IExtensionApi) {
  discoveryForGame = (gameId: string) => selectors.discoveryByGame(api.store.getState(), gameId);
}

export function gameSupported(gameMode: string): boolean {
  return gameSupport.has(gameMode);
}

/**
 * Resolve the "My Games" directory for the specified game mode.
 *
 * Під Proton гра виконується як Windows процес у префіксі Wine, тому її каталог
 * Documents / My Games знаходиться всередині префіксу (compatdata/<appId>/pfx/drive_c/users/<user>/Documents/My Games),
 * а не в нативному домашньому каталозі Linux (~/Documents).
 * Завдяки ProtonPaths шляхи вирішуються автоматично з кешуванням та безпечним фолбеком.
 */
export function mygamesPath(gameMode: string): string {
  const discovery = discoveryForGame(gameMode);
  const proton = (ProtonPaths ?? util.ProtonPaths)?.resolve({ gameMode, discovery });
  const myGamesBase = proton?.myGamesPath ?? path.join(util.getVortexPath("documents"), "My Games");
  return path.join(myGamesBase, gameSupport.get(gameMode, "mygamesPath"));
}

export function gameSettingsFiles(gameMode: string, customPath: string): ISettingsFile[] {
  const fileNames = gameSupport.get(gameMode, "gameSettingsFiles");

  const mapFile = (input: string | ISettingsFile): ISettingsFile =>
    typeof input === "string" ? { name: input, optional: false } : input;

  if (customPath === null) {
    return fileNames.map(mapFile);
  } else {
    return fileNames.map(mapFile).map((input) => ({
      name: path.join(customPath, input.name),
      optional: input.optional,
    }));
  }
}

export function profilePath(profile: types.IProfile): string {
  return path.join(util.getVortexPath("userData"), profile.gameId, "profiles", profile.id);
}

export function backupPath(profile: types.IProfile): string {
  return path.join(util.getVortexPath("userData"), profile.gameId);
}
