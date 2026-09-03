const path = require("path");
const { fs, log, util } = require("@nexusmods/vortex-api");

// Nexus Mods id для S.T.A.L.K.E.R.: Shadow of Chernobyl (https://www.nexusmods.com/stalker)
const GAME_ID = "stalker";
const STEAM_APP_ID = "4500";
const GOG_APP_ID = "1435826920";

const GAME_EXE = path.join("bin", "XR_3DA.exe");
const FSGAME_LTX = "fsgame.ltx";

// Стандартні підкаталоги gamedata в модах S.T.A.L.K.E.R.
const STALKER_FOLDERS = new Set([
  "config",
  "configs",
  "scripts",
  "textures",
  "sounds",
  "meshes",
  "spawns",
  "anims",
  "levels",
  "shaders",
  "ai",
]);

function findGame() {
  return util.steam
    .findByAppId(STEAM_APP_ID)
    .then((game) => game.gamePath)
    .catch(() =>
      util.GameStoreHelper.findByAppId([STEAM_APP_ID], "steam")
        .then((game) => game.gamePath)
        .catch(() =>
          util.GameStoreHelper.findByRegistry(
            [
              {
                hive: "HKLM",
                key: "Software\\GSC Game World\\STALKER-SHOC",
                value: "InstallPath",
              },
              {
                hive: "HKLM",
                key: "Software\\GOG.com\\Games\\1435826920",
                value: "PATH",
              },
            ],
            GAME_EXE,
          ),
        ),
    );
}

/**
 * Автоматична перевірка та налаштування fsgame.ltx
 * Щоб рушій X-Ray підвантажував моди з каталогу gamedata/,
 * директива $game_data$ повинна містити прапорець true:
 * $game_data$ = false| true| $fs_root$| gamedata\
 */
async function prepareForModding(discovery) {
  const ltxPath = path.join(discovery.path, FSGAME_LTX);
  const gamedataPath = path.join(discovery.path, "gamedata");

  try {
    await fs.ensureDirWritableAsync(gamedataPath, () => Promise.resolve());
  } catch (err) {
    log("warn", "Failed to ensure writable gamedata folder", { error: err.message });
  }

  try {
    const content = await fs.readFileAsync(ltxPath, { encoding: "utf8" });
    const lines = content.split("\n");
    let changed = false;
    const newLines = lines.map((line) => {
      if (line.trim().startsWith("$game_data$")) {
        const parts = line.split("|");
        if (parts.length >= 4 && !parts[1].trim().toLowerCase().includes("true")) {
          parts[1] = "\ttrue";
          changed = true;
          return parts.join("|");
        }
      }
      return line;
    });

    if (changed) {
      await fs.writeFileAsync(ltxPath, newLines.join("\n"), { encoding: "utf8" });
      log("info", "Automatically enabled mod loading in fsgame.ltx for STALKER", { ltxPath });
    }
  } catch (err) {
    log("warn", "Could not check/update fsgame.ltx for STALKER", { error: err.message });
  }
}

/**
 * Перевірка підтримки моду для S.T.A.L.K.E.R.
 */
function testSupportedContent(files, gameId) {
  if (gameId !== GAME_ID) {
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  const supported = files.some((file) => {
    const lower = file.toLowerCase();
    const parts = lower.split(/[\\/]/).filter(Boolean);
    if (parts.includes("gamedata")) {
      return true;
    }
    if (parts.length > 0 && STALKER_FOLDERS.has(parts[0])) {
      return true;
    }
    if (parts.length > 1 && STALKER_FOLDERS.has(parts[1])) {
      return true;
    }
    return lower.endsWith(".db") || lower.endsWith(".xdb") || lower.endsWith(".ltx");
  });

  return Promise.resolve({ supported, requiredFiles: [] });
}

/**
 * Смарт-інсталер для модів S.T.A.L.K.E.R.:
 * Нормалізує структуру так, щоб файли завжди потрапляли в правильні підкаталоги gamedata/,
 * усуваючи помилку подвійного вкладення (gamedata/gamedata/...).
 */
function installContent(files) {
  const realFiles = files.filter((f) => !/[\\/]$/.test(f));

  let gamedataPrefix = "";
  for (const f of realFiles) {
    const parts = f.split(/[\\/]/).filter(Boolean);
    const gIdx = parts.findIndex((p) => p.toLowerCase() === "gamedata");
    if (gIdx !== -1) {
      gamedataPrefix = parts.slice(0, gIdx + 1).join(path.sep);
      break;
    }
  }

  const instructions = [];

  for (const file of realFiles) {
    const norm = path.normalize(file);
    let destination = norm;

    if (gamedataPrefix && norm.toLowerCase().startsWith(gamedataPrefix.toLowerCase())) {
      destination = norm.slice(gamedataPrefix.length);
      if (destination.startsWith(path.sep) || destination.startsWith("/")) {
        destination = destination.slice(1);
      }
    } else {
      const parts = norm.split(path.sep).filter(Boolean);
      const folderIdx = parts.findIndex((p) => STALKER_FOLDERS.has(p.toLowerCase()));
      if (folderIdx !== -1) {
        destination = parts.slice(folderIdx).join(path.sep);
      }
    }

    instructions.push({
      type: "copy",
      source: file,
      destination,
    });
  }

  return Promise.resolve({ instructions });
}

function requiresLauncher(gamePath, store) {
  return store === "steam" ? Promise.resolve({ launcher: "steam" }) : Promise.resolve(undefined);
}

function main(context) {
  context.registerGame({
    id: GAME_ID,
    name: "S.T.A.L.K.E.R.: Shadow of Chernobyl",
    mergeMods: true,
    queryPath: findGame,
    queryModPath: () => "gamedata",
    logo: "gameart.jpg",
    executable: () => GAME_EXE,
    requiredFiles: [GAME_EXE, FSGAME_LTX],
    setup: prepareForModding,
    requiresLauncher,
    environment: {
      SteamAPPId: STEAM_APP_ID,
    },
    details: {
      steamAppId: parseInt(STEAM_APP_ID, 10),
      gogAppId: GOG_APP_ID,
    },
  });

  context.registerInstaller("stalker-mod", 25, testSupportedContent, installContent);

  return true;
}

module.exports = {
  default: main,
};
