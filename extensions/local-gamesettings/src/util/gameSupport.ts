import * as fs from "fs";
import * as path from "path";

import { log, selectors, types, util } from "@nexusmods/vortex-api";
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
 * Resolve the "Documents" directory a game actually writes to.
 *
 * Under Proton the game is a Windows process against a wine prefix, so its Documents folder is
 * inside `steamapps/compatdata/<appId>/pfx/drive_c/users/steamuser`, not the Linux `~/Documents`
 * that getVortexPath("documents") reports. Without this, Vortex looks for Skyrim.ini and
 * SkyrimPrefs.ini in a directory the game never writes and reports them as missing.
 *
 * Returns undefined when the game is not a Proton install, so callers fall back to the normal
 * documents path -- that covers Windows, and native Linux titles.
 */
const protonDocumentsCache = new Map<string, string>();

function protonDocumentsPath(gameMode: string): string | undefined {
  if (process.platform === "win32") return undefined;
  if (protonDocumentsCache.has(gameMode)) return protonDocumentsCache.get(gameMode);

  let result: string | undefined;
  try {
    const discovery = discoveryForGame(gameMode);
    // steam only: the compatdata layout is Steam's, and discovery.path points at
    // <library>/steamapps/common/<installdir>.
    if (discovery?.path !== undefined && discovery.store === "steam") {
      const steamApps = path.dirname(path.dirname(discovery.path));
      const installDir = path.basename(discovery.path);
      const escapedInstallDir = installDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Map the install directory back to its appId via Steam's own manifests rather than
      // hardcoding ids, so this keeps working for every supported game.
      const manifest = fs
        .readdirSync(steamApps)
        .filter((entry) => entry.startsWith("appmanifest_") && entry.endsWith(".acf"))
        .find((entry) => {
          const content = fs.readFileSync(path.join(steamApps, entry), "utf8");
          return new RegExp(`"installdir"\\s+"${escapedInstallDir}"`, "i").test(content);
        });

      if (manifest !== undefined) {
        const appId = manifest.slice("appmanifest_".length, -".acf".length);
        const documents = path.join(
          steamApps,
          "compatdata",
          appId,
          "pfx",
          "drive_c",
          "users",
          "steamuser",
          "Documents",
        );
        if (fs.existsSync(documents)) {
          result = documents;
        }
      }
    }
  } catch (error) {
    // Any failure here just means we fall back to the normal documents path, which is no worse
    // than the behaviour before this existed.
    log("debug", "failed to resolve proton documents path", {
      gameMode,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }

  // Discovery may not be populated yet when this is first called. Only cache a successful
  // resolution so a later call can retry once Steam discovery has completed.
  if (result !== undefined) {
    protonDocumentsCache.set(gameMode, result);
  }
  return result;
}

export function mygamesPath(gameMode: string): string {
  const documents = protonDocumentsPath(gameMode) ?? util.getVortexPath("documents");
  return path.join(documents, "My Games", gameSupport.get(gameMode, "mygamesPath"));
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
