const path = require("path");
let api;
try {
  api = require("@nexusmods/vortex-api");
} catch (e) {
  try {
    api = require("@vortex/extension-test-mocks");
  } catch {
    api = {};
  }
}
const { fs, log, util } = api;

/**
 * Ідентифікатори гри Gothic 3 (Piranha Bytes / JoWooD / THQ Nordic)
 * Nexus Mods домен: https://www.nexusmods.com/gothic3
 */
const GAME_ID = "gothic3";
const STEAM_APP_ID = "39500";
const FORSAKEN_GODS_STEAM_ID = "65610";
const GOG_APP_ID = "1207658986";
const FORSAKEN_GODS_GOG_ID = "1435828767";

const PRIMARY_EXE = "Gothic3.exe";
const FINAL_EXE = "Gothic3Final.exe";
const GE3_INI = path.join("Ini", "ge3.ini");
const MOUNTLIST_INI = path.join("Ini", "mountlist.INI");

/**
 * ПРИНЦИП РОБОТИ РУШІЯ GOTHIC 3 ТА СИСТЕМИ МОДИНГУ:
 * 1. Архітектура віртуальної файлової системи (VFS):
 *    Рушій Gothic 3 монтує архіви та каталоги згідно з конфігурацією Ini/mountlist.ini.
 *    Усі основні ігрові дані завантажуються з директорії Data/.
 *
 * 2. Пріоритет завантаження файлів рушієм (ієрархія перевизначення):
 *    - .pak: Базові архіви оригінальної гри (найнижчий пріоритет).
 *    - .cpt / .c00 - .c99: Архіви Community Patch (перевизначають .pak).
 *    - .mod / .m00 - .m99: Архіви модифікацій (перевизначають .pak та .cpt).
 *    - .nod / .n00 - .n99: Архіви модифікацій для режиму Alternative Balancing (найвищий пріоритет).
 *    - Розпаковані файли у Data/<Папка> (наприклад Data/Materials) завантажуються з VFS безпосередньо.
 *
 * 3. Конфігураційні файли:
 *    Знаходяться у підкаталозі Ini/ (ge3.ini, mountlist.ini, controls.ini).
 *
 * 4. Бінарні хуки, скрипти та рендери:
 *    - Модифікації графіки (DXVK, ReShade, d3d9.dll), патчі пам'яті розміщуються в корені гри.
 *    - Скриптові розширення розміщуються в каталозі Scripts/ або в корені.
 */

// Стандартні підкаталоги Data/ згідно з точками монтування mountlist.ini
const GOTHIC3_DATA_FOLDERS = new Set([
  "materials",
  "video",
  "music",
  "_intern",
  "_compiledimage",
  "_compiledanimation",
  "_compiledmaterial",
  "_compiledmesh",
  "_compiledphysic",
  "animation",
  "gui",
  "infos",
  "library",
  "lightmaps",
  "meshes",
  "projects",
  "projects_compiled",
  "quests",
  "sound",
  "speedtrees",
  "strings",
  "templates",
  "brushpresets",
  "logicaleditor",
  "speech_english",
  "speech_german",
  "speech_russian",
  "speech_polish",
  "speech_italian",
  "speech_spanish",
  "speech_french",
]);

// Конфігураційні файли Gothic 3, які мають знаходитися в Ini/
const GOTHIC3_INI_FILES = new Set([
  "ge3.ini",
  "ge3local.ini",
  "mountlist.ini",
  "controls.ini",
  "debug.ini",
  "events.ini",
  "imagequality.ini",
  "log.ini",
  "logo.ini",
]);

/**
 * Перевірка, чи є розширення файлу архівом ресурсів Gothic 3 (.pak, .cpt, .mod, .nod та покоління .m00, .n00 тощо)
 */
function isGothic3DataArchive(ext) {
  return /^\.(pak|cpt|mod|nod|[pcm][0-9]{2}|n[0-9]{2})$/i.test(ext);
}

/**
 * Перевірка розширень розпакованих ресурсних файлів Gothic 3
 */
function isGothic3DataFile(ext) {
  return /^\.(lrentdat|wrldatasc|hdr|ximg|xmat|xmsh|xmot|xact|xshd|xsnd|tga|dds|ase)$/i.test(ext);
}

/**
 * Детекція встановлення гри (Steam, GOG, реєстр Windows та Linux-шляхи)
 */
function findGame() {
  return util.steam
    .findByAppId(STEAM_APP_ID)
    .then((game) => game.gamePath)
    .catch(() =>
      util.GameStoreHelper.findByAppId(
        [STEAM_APP_ID, FORSAKEN_GODS_STEAM_ID, GOG_APP_ID, FORSAKEN_GODS_GOG_ID],
        "steam",
      )
        .then((game) => game.gamePath)
        .catch(() =>
          util.GameStoreHelper.findByRegistry(
            [
              {
                hive: "HKLM",
                key: `Software\\GOG.com\\Games\\${GOG_APP_ID}`,
                value: "PATH",
              },
              {
                hive: "HKLM",
                key: `Software\\WOW6432Node\\GOG.com\\Games\\${GOG_APP_ID}`,
                value: "PATH",
              },
              {
                hive: "HKLM",
                key: "Software\\JoWooD\\Gothic III",
                value: "InstallDir",
              },
              {
                hive: "HKLM",
                key: "Software\\WOW6432Node\\JoWooD\\Gothic III",
                value: "InstallDir",
              },
              {
                hive: "HKLM",
                key: "Software\\JoWooD Productions Software AG\\Gothic III",
                value: "InstallDir",
              },
            ],
            PRIMARY_EXE,
          ),
        ),
    )
    .catch(() => {
      // Резервний пошук на системі Linux для стандартних бібліотек Steam
      if (process.platform === "linux") {
        const home = process.env.HOME || "";
        const candidatePaths = [
          path.join(home, ".local", "share", "Steam", "steamapps", "common", "Gothic 3"),
          path.join(home, ".steam", "steam", "steamapps", "common", "Gothic 3"),
          path.join(
            home,
            ".var",
            "app",
            "com.valvesoftware.Steam",
            ".local",
            "share",
            "Steam",
            "steamapps",
            "common",
            "Gothic 3",
          ),
        ];

        for (const candidate of candidatePaths) {
          try {
            const stat = fs.statSync(path.join(candidate, PRIMARY_EXE));
            if (stat.isFile()) {
              return Promise.resolve(candidate);
            }
          } catch (e) {
            // Шлях відсутній, перевіряємо наступний
          }
        }
      }

      return Promise.reject(new util.ProcessCanceled("Gothic 3 not found"));
    });
}

/**
 * Визначення виконуваного файлу для запуску (Gothic3.exe або Gothic3Final.exe)
 */
function getExecutable(discoveryPath) {
  if (!discoveryPath) {
    return PRIMARY_EXE;
  }

  try {
    const finalStat = fs.statSync(path.join(discoveryPath, FINAL_EXE));
    if (finalStat.isFile()) {
      return FINAL_EXE;
    }
  } catch (err) {
    // Gothic3Final.exe відсутній, використовуємо Gothic3.exe
  }

  return PRIMARY_EXE;
}

/**
 * Підготовка середовища до модингу:
 * 1. Створення та перевірка прав запису для каталогів Data, Ini, Scripts, snapshots.
 * 2. Забезпечення наявності прав на виконання (chmod +x) на Linux.
 */
async function prepareForModding(discovery) {
  const folders = ["Data", "Ini", "Scripts", "snapshots"];
  for (const folder of folders) {
    const target = path.join(discovery.path, folder);
    try {
      await fs.ensureDirWritableAsync(target, () => Promise.resolve());
    } catch (err) {
      log("warn", `Failed to ensure writable directory ${target}`, { error: err.message });
    }
  }

  // На Linux створюємо lowercase-посилання для конфігів із розширенням .INI,
  // щоб запобігти проблемам чутливості до регістру (case-sensitivity) на ext4/btrfs
  if (process.platform === "linux") {
    const iniDir = path.join(discovery.path, "Ini");
    const iniFiles = ["ge3", "mountlist"];
    for (const base of iniFiles) {
      const upperPath = path.join(iniDir, `${base}.INI`);
      const lowerPath = path.join(iniDir, `${base}.ini`);
      try {
        let hasUpper = false;
        let hasLower = false;
        try {
          hasUpper = fs.statSync(upperPath).isFile();
        } catch {}
        try {
          hasLower = fs.statSync(lowerPath).isFile();
        } catch {}
        if (hasUpper && !hasLower) {
          try {
            await fs.symlinkAsync(`${base}.INI`, lowerPath);
            log("info", `Created lowercase symlink for ${base}.ini on Linux`);
          } catch {}
        }
      } catch (err) {
        // Ігноруємо помилки створення симлінків
      }
    }

    const binaries = [PRIMARY_EXE, FINAL_EXE];
    for (const bin of binaries) {
      const fullPath = path.join(discovery.path, bin);
      try {
        await fs.chmodAsync(fullPath, 0o755);
      } catch (err) {
        // Якщо бінарник відсутній або права не вдалося змінити, ігноруємо
      }
    }
  }
}

/**
 * Знаходження спільного кореневого каталогу-обгортки в архіві моду.
 * Якщо всі файли знаходяться всередині однієї кореневої папки (наприклад "MyMod_v1.0/..."),
 * і ця папка не є системною для гри (Data, Ini, Scripts, Docs), ми її відсікаємо.
 */
function findCommonRoot(files) {
  const partsList = files.map((f) => f.split(/[\\/]/).filter(Boolean));
  if (partsList.length === 0 || partsList.some((p) => p.length < 2)) {
    return "";
  }

  const firstDir = partsList[0][0];
  const firstDirLower = firstDir.toLowerCase();

  // Не відсікаємо, якщо перша папка є цільовою для рушія
  if (["data", "ini", "scripts", "docs"].includes(firstDirLower)) {
    return "";
  }

  const allShareFirst = partsList.every((p) => p[0].toLowerCase() === firstDirLower);
  return allShareFirst ? `${firstDir}/` : "";
}

/**
 * Нормалізація відносного шляху встановлення моду для Gothic 3:
 * Кореневий каталог модингу у Vortex налаштовано як "." (корінь гри),
 * тому інсталятор направляє файли у відповідні підкаталоги (Data/, Ini/, Scripts/ або корінь).
 */
function normalizeGothic3Path(filePath, rootPrefix = "") {
  let rel = filePath;
  if (rootPrefix && rel.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
    rel = rel.slice(rootPrefix.length);
  }
  rel = rel.replace(/^[/\\]+/, "");
  const segments = rel.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0) {
    return rel;
  }

  const firstLower = segments[0].toLowerCase();
  const baseName = segments[segments.length - 1];
  const ext = path.extname(baseName).toLowerCase();

  // 1. Файли, які вже структуровані всередині Data/, Ini/, Scripts/, Docs/
  if (firstLower === "data") {
    return path.join("Data", ...segments.slice(1));
  }
  if (firstLower === "ini") {
    return path.join("Ini", ...segments.slice(1));
  }
  if (firstLower === "scripts") {
    return path.join("Scripts", ...segments.slice(1));
  }
  if (firstLower === "docs") {
    return path.join("Docs", ...segments.slice(1));
  }

  // 2. Якщо перший сегмент є відомою підпапкою mountlist (наприклад Materials/ або Video/)
  if (GOTHIC3_DATA_FOLDERS.has(firstLower)) {
    return path.join("Data", ...segments);
  }

  // 3. Відомі конфігураційні .ini файли на верхньому рівні моду направляються в Ini/
  if (GOTHIC3_INI_FILES.has(baseName.toLowerCase()) && segments.length === 1) {
    return path.join("Ini", baseName);
  }

  // 4. Архіви (.pak, .mod, .nod, .m00...) або розпаковані ресурси гри направляються в Data/
  if (isGothic3DataArchive(ext) || isGothic3DataFile(ext)) {
    return path.join("Data", ...segments);
  }

  // 5. Усі інші файли (.dll, .asi, reshade, dxvk, кореневі текстові файли) лишаються у корені
  return path.join(...segments);
}

/**
 * Валідація підтримки моду інсталятором
 */
function testSupportedContent(files, gameId) {
  if (gameId !== GAME_ID) {
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  const supported = files.some((file) => {
    const lower = file.toLowerCase();
    const parts = lower.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return false;

    // Наявність підкаталогів рушія
    if (parts.includes("data") || parts.includes("ini") || parts.includes("scripts")) {
      return true;
    }

    // Підкаталоги з mountlist.ini
    if (parts.some((p) => GOTHIC3_DATA_FOLDERS.has(p))) {
      return true;
    }

    const baseName = parts[parts.length - 1];
    const ext = path.extname(baseName).toLowerCase();

    // Архіви даних або ресурсні файли
    if (isGothic3DataArchive(ext) || isGothic3DataFile(ext)) {
      return true;
    }

    // Конфігураційні файли
    if (GOTHIC3_INI_FILES.has(baseName.toLowerCase())) {
      return true;
    }

    // Системні DLL або хуки рендера (d3d9, dxvk, reshade)
    if (ext === ".dll" || ext === ".asi") {
      return true;
    }

    return false;
  });

  return Promise.resolve({ supported, requiredFiles: [] });
}

/**
 * Розумний інсталятор для розгортання модифікацій Gothic 3
 */
function installContent(files) {
  const realFiles = files.filter((f) => !/[\\/]$/.test(f));
  const rootPrefix = findCommonRoot(realFiles);

  const instructions = realFiles.map((file) => {
    const destination = normalizeGothic3Path(file, rootPrefix);
    return {
      type: "copy",
      source: file,
      destination,
    };
  });

  return Promise.resolve({ instructions });
}

function requiresLauncher(gamePath, store) {
  return store === "steam" ? Promise.resolve({ launcher: "steam" }) : Promise.resolve(undefined);
}

/**
 * Реєстрація інструментів Gothic 3
 */
const supportedTools = [
  {
    id: "g3-final",
    name: "Gothic 3 Final (Community Patch)",
    shortName: "G3 Final",
    executable: () => FINAL_EXE,
    requiredFiles: [FINAL_EXE],
    relative: true,
    defaultArgs: [],
  },
  {
    id: "g3-modstarter",
    name: "Gothic 3 Mod Starter (MDS)",
    shortName: "Mod Starter",
    executable: () => "G3ModStarter.exe",
    requiredFiles: ["G3ModStarter.exe"],
    relative: true,
    defaultArgs: [],
  },
  {
    id: "g3-ge3ini",
    name: "Gothic 3 Config (ge3.ini)",
    shortName: "ge3.ini",
    executable: () => GE3_INI,
    requiredFiles: [GE3_INI],
    relative: true,
    defaultArgs: [],
  },
];

/**
 * Точка входу розширення Vortex
 */
function main(context) {
  context.registerGame({
    id: GAME_ID,
    name: "Gothic 3",
    mergeMods: true,
    queryPath: findGame,
    queryModPath: () => ".",
    logo: "gameart.jpg",
    executable: (discoveryPath) => getExecutable(discoveryPath),
    requiredFiles: [PRIMARY_EXE],
    setup: prepareForModding,
    requiresLauncher,
    environment: {
      SteamAPPId: STEAM_APP_ID,
    },
    details: {
      steamAppId: parseInt(STEAM_APP_ID, 10),
      gogAppId: GOG_APP_ID,
    },
    capabilities: {
      platforms: {
        linux: {
          steamAppId: STEAM_APP_ID,
        },
        win32: {
          steamAppId: STEAM_APP_ID,
        },
      },
    },
    queryArgs: {
      steam: [STEAM_APP_ID, FORSAKEN_GODS_STEAM_ID],
      gog: [GOG_APP_ID, FORSAKEN_GODS_GOG_ID],
      registry: [
        `HKEY_LOCAL_MACHINE:SOFTWARE\\GOG.com\\Games\\${GOG_APP_ID}:PATH`,
        `HKEY_LOCAL_MACHINE:SOFTWARE\\WOW6432Node\\GOG.com\\Games\\${GOG_APP_ID}:PATH`,
        "HKEY_LOCAL_MACHINE:SOFTWARE\\JoWooD\\Gothic III:InstallDir",
        "HKEY_LOCAL_MACHINE:SOFTWARE\\WOW6432Node\\JoWooD\\Gothic III:InstallDir",
        "HKEY_LOCAL_MACHINE:SOFTWARE\\JoWooD Productions Software AG\\Gothic III:InstallDir",
      ],
    },
    supportedTools,
  });

  context.registerInstaller("gothic3-mod", 25, testSupportedContent, installContent);

  return true;
}

module.exports = {
  default: main,
  GAME_ID,
  PRIMARY_EXE,
  FINAL_EXE,
  STEAM_APP_ID,
  GOG_APP_ID,
  GOTHIC3_DATA_FOLDERS,
  GOTHIC3_INI_FILES,
  isGothic3DataArchive,
  isGothic3DataFile,
  findCommonRoot,
  normalizeGothic3Path,
  testSupportedContent,
  installContent,
  getExecutable,
  supportedTools,
};
