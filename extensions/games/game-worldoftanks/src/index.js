const fs = require("fs");
const path = require("path");
let vortexApi;
try {
  vortexApi = require("@nexusmods/vortex-api");
} catch {
  vortexApi = {};
}
const { util } = vortexApi;

let applicationApi;

const GAME_ID = "worldoftanks";
const STEAM_APP_ID = "1407200";
const EXECUTABLE = "WorldOfTanks.exe";
const VERSION_FILE = "version.xml";
const MODS_DIRECTORY = "res_mods";
const PACKAGED_MODS_DIRECTORY = "mods";
const PACKAGED_MODS_TYPE = "worldoftanks-mods";

function isWoTClientDirectory(directory, statSync = fs.statSync) {
  try {
    return (
      statSync(path.join(directory, EXECUTABLE)).isFile() &&
      statSync(path.join(directory, VERSION_FILE)).isFile()
    );
  } catch {
    return false;
  }
}

/**
 * Steam stores the World of Tanks client in a locale directory (for example
 * `ru/`), while the Wargaming Game Center installs the client at the root.
 */
function findClientDirectory(gamePath, options = {}) {
  const statSync = options.statSync || fs.statSync;
  const readdirSync = options.readdirSync || fs.readdirSync;

  if (isWoTClientDirectory(gamePath, statSync)) {
    return gamePath;
  }

  try {
    for (const entry of readdirSync(gamePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(gamePath, entry.name);
      if (isWoTClientDirectory(candidate, statSync)) {
        return candidate;
      }
    }
  } catch {
    // The candidate is unavailable or cannot be read.
  }

  return undefined;
}

function linuxSteamCandidates(env = process.env) {
  const home = env.HOME || "";
  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const steamRoots = [
    path.join(dataHome, "Steam"),
    path.join(home, ".steam", "steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ];

  return steamRoots.map((root) => path.join(root, "steamapps", "common", "World of Tanks"));
}

function findWindowsGame() {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("World of Tanks was not found in Steam"));
  }

  const winapi = require("winapi-bindings");
  return new Promise((resolve, reject) => {
    try {
      winapi.WithRegOpen(
        "HKEY_CURRENT_USER",
        "Software\\Wargaming.net\\Launcher\\Apps\\wot",
        (hkey) => {
          const keys = winapi.RegEnumValues(hkey);
          if (keys.length > 0) {
            const value = winapi.RegGetValue(hkey, "", keys[0].key);
            return resolve(value.value);
          }
          return resolve(null);
        },
      );
    } catch (err) {
      return reject(err);
    }
  });
}

function findGame(options = {}) {
  const apiUtil = options.util || util;
  const platform = options.platform || process.platform;
  const resolveClientDirectory = options.findClientDirectory || findClientDirectory;
  const steamCandidates = options.linuxSteamCandidates || linuxSteamCandidates;
  const ensureClientDirectory = (game) => {
    const clientPath = resolveClientDirectory(game.gamePath);
    if (clientPath === undefined) {
      throw new Error("World of Tanks client files were not found in the Steam directory");
    }
    return clientPath;
  };

  const findSteamClient = () => apiUtil.steam.findByAppId(STEAM_APP_ID).then(ensureClientDirectory);
  const findStoreClient = () =>
    apiUtil.GameStoreHelper.findByAppId([STEAM_APP_ID], "steam").then(ensureClientDirectory);

  return findSteamClient()
    .catch(findStoreClient)
    .catch(() => {
      if (platform === "linux") {
        for (const candidate of steamCandidates()) {
          const clientPath = resolveClientDirectory(candidate);
          if (clientPath !== undefined) {
            return clientPath;
          }
        }
      }
      return findWindowsGame().then((gamePath) => resolveClientDirectory(gamePath) || gamePath);
    });
}

/**
 * The Steam client supplies the session, anti-cheat and Proton context that
 * World of Tanks needs. Running its executable directly through Proton can
 * start a short-lived process without ever opening the game.
 */
function requiresLauncher(gamePath, store) {
  return store === "steam" ? Promise.resolve({ launcher: "steam" }) : Promise.resolve(undefined);
}

function extractVersion(versionXml) {
  const match = versionXml.match(/<version>\s*v?\.?([^\s<]+).*?<\/version>/is);
  return match?.[1];
}

function readClientVersion(gamePath) {
  try {
    return extractVersion(fs.readFileSync(path.join(gamePath, VERSION_FILE), { encoding: "utf8" }));
  } catch {
    return undefined;
  }
}

function getDiscoveredGamePath(application = applicationApi) {
  const state = application?.getState?.() || application?.store?.getState?.();
  return state?.settings?.gameMode?.discovered?.[GAME_ID]?.path;
}

function getCurrentClientVersion(application = applicationApi) {
  const gamePath = getDiscoveredGamePath(application);
  return gamePath === undefined ? undefined : readClientVersion(gamePath);
}

function normalizeArchivePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

/**
 * Finds an explicit WoT versioned payload in an archive, even if an author
 * wrapped it in a top-level folder. Both `res_mods/<version>` and
 * `mods/<version>` are supported by the current client.
 */
function parseVersionedModPath(filePath) {
  const parts = normalizeArchivePath(filePath).split("/");
  for (let index = 0; index < parts.length - 2; index += 1) {
    const directory = parts[index].toLowerCase();
    if (![MODS_DIRECTORY, PACKAGED_MODS_DIRECTORY].includes(directory)) {
      continue;
    }

    const version = parts[index + 1];
    if (!/^\d+(?:\.\d+)+$/.test(version)) {
      continue;
    }

    return {
      directory,
      version,
      relativePath: parts.slice(index + 2).join("/"),
    };
  }

  return undefined;
}

function inspectModCompatibility(files, gameVersion) {
  const payloads = files
    .map((source) => {
      const parsed = parseVersionedModPath(source);
      return parsed === undefined ? undefined : { ...parsed, source };
    })
    .filter(Boolean);
  const modVersions = [...new Set(payloads.map((payload) => payload.version))];
  const directories = [...new Set(payloads.map((payload) => payload.directory))];

  if (modVersions.length === 0) {
    return { status: "unknown", payloads, modVersions, directories };
  }
  if (gameVersion === undefined) {
    return { status: "unverified", payloads, modVersions, directories };
  }
  if (modVersions.every((version) => version === gameVersion)) {
    return { status: "compatible", payloads, modVersions, directories };
  }
  return { status: "incompatible", payloads, modVersions, directories };
}

function modCompatibilityError(gameVersion, modVersions) {
  return new Error(
    `This World of Tanks mod targets version ${modVersions.join(", ")}, ` +
      `but the installed game is ${gameVersion}. Install a mod made for ${gameVersion}.`,
  );
}

function testSupportedContent(files, gameId) {
  const inspection = inspectModCompatibility(files);
  return Promise.resolve({
    supported: gameId === GAME_ID && inspection.payloads.length > 0,
    requiredFiles: [],
  });
}

function installContent(files) {
  const gameVersion = getCurrentClientVersion();
  const inspection = inspectModCompatibility(files, gameVersion);

  if (inspection.status === "incompatible") {
    return Promise.reject(modCompatibilityError(gameVersion, inspection.modVersions));
  }
  if (inspection.status === "unverified") {
    return Promise.reject(
      new Error(
        "World of Tanks must be discovered before installing a versioned mod so Lotrex can verify compatibility.",
      ),
    );
  }
  if (inspection.payloads.length === 0) {
    return Promise.reject(
      new Error(
        "The archive has no versioned World of Tanks mod payload (res_mods/<version> or mods/<version>).",
      ),
    );
  }
  if (inspection.directories.length > 1) {
    return Promise.reject(
      new Error(
        "The archive contains both res_mods and mods payloads. Install its components separately so each can be deployed safely.",
      ),
    );
  }

  const modType =
    inspection.directories[0] === PACKAGED_MODS_DIRECTORY ? PACKAGED_MODS_TYPE : undefined;
  const instructions = inspection.payloads
    .filter((payload) => payload.relativePath.length > 0)
    .map((payload) => ({
      type: "copy",
      source: payload.source,
      destination: payload.relativePath,
    }));

  if (modType !== undefined) {
    instructions.unshift({ type: "setmodtype", value: modType });
  }

  return Promise.resolve({ instructions });
}

function getPackagedModsPath() {
  const gamePath = getDiscoveredGamePath();
  const version = getCurrentClientVersion();
  return gamePath === undefined || version === undefined
    ? undefined
    : path.join(gamePath, PACKAGED_MODS_DIRECTORY, version);
}

function isPackagedMod(instructions) {
  return Promise.resolve(
    instructions.some(
      (instruction) =>
        instruction.type === "setmodtype" && instruction.value === PACKAGED_MODS_TYPE,
    ),
  );
}

function queryModPath(applicationApi, gamePath) {
  try {
    const version = readClientVersion(gamePath);
    if (version === undefined) {
      throw new Error("version.xml has no usable version entry");
    }

    const modPath = path.join(gamePath, MODS_DIRECTORY, version);
    fs.statSync(modPath);
    return modPath;
  } catch {
    applicationApi.showErrorNotification(
      "Game not installed",
      "World of Tanks doesn't seem to be installed correctly. " +
        "Please check the version.xml file in your game directory.",
      { allowReport: false, id: "wot-not-installed" },
    );
    return ".";
  }
}

function main(context) {
  applicationApi = context.api;
  context.registerGame({
    id: GAME_ID,
    name: "World Of Tanks",
    mergeMods: true,
    queryPath: findGame,
    queryModPath: (gamePath) => queryModPath(context.api, gamePath),
    logo: "gameart.jpg",
    executable: () => EXECUTABLE,
    requiredFiles: [EXECUTABLE, VERSION_FILE],
    environment: {
      SteamAPPId: STEAM_APP_ID,
    },
    details: {
      steamAppId: Number(STEAM_APP_ID),
    },
    capabilities: {
      platforms: {
        linux: { steamAppId: STEAM_APP_ID },
        win32: { steamAppId: STEAM_APP_ID },
      },
    },
    requiresLauncher,
  });

  context.registerModType(
    PACKAGED_MODS_TYPE,
    25,
    (gameId) => gameId === GAME_ID,
    getPackagedModsPath,
    isPackagedMod,
    { name: "World of Tanks packaged mods" },
  );
  context.registerInstaller("worldoftanks-versioned-mod", 25, testSupportedContent, installContent);

  return true;
}

module.exports = {
  default: main,
  GAME_ID,
  STEAM_APP_ID,
  EXECUTABLE,
  VERSION_FILE,
  MODS_DIRECTORY,
  PACKAGED_MODS_DIRECTORY,
  PACKAGED_MODS_TYPE,
  isWoTClientDirectory,
  findClientDirectory,
  findGame,
  linuxSteamCandidates,
  requiresLauncher,
  extractVersion,
  readClientVersion,
  parseVersionedModPath,
  inspectModCompatibility,
  testSupportedContent,
  installContent,
  getPackagedModsPath,
  isPackagedMod,
  queryModPath,
};
