import * as fs from "node:fs";
import * as path from "node:path";

import type { IDiscoveryResult } from "../../extensions/gamemode_management/types/IDiscoveryResult";
import { resolveGameSteamAppId } from "../../extensions/gamemode_management/util/gameCapabilities";
import type { IGame } from "../../types/IGame";
import { findLinuxSteamPath, getLinuxSteamPaths } from "./steamPaths";

/**
 * Структура шляхів префіксу Proton для запущеної гри.
 */
export interface IProtonPaths {
  /** Кореневий каталог префіксу Wine (drive_c, system.reg тощо) */
  prefixPath: string;
  /** Шлях до профілю Windows-користувача (drive_c/users/<user>) */
  userProfilePath: string;
  /** Ім'я виявленого користувача в префіксі (зазвичай "steamuser") */
  userName: string;
  /** Каталог Documents у префіксі Wine */
  documentsPath: string;
  /** Каталог Documents/My Games у префіксі Wine */
  myGamesPath: string;
  /** Каталог AppData/Local у префіксі Wine */
  appDataLocalPath: string;
  /** Каталог AppData/Roaming у префіксі Wine */
  appDataRoamingPath: string;
  /** Каталог встановлення гри */
  gamePath: string;
  /** Визначений Steam AppID гри */
  appId?: string;
  /** Каталог встановлення Steam на хості */
  steamPath?: string;
  /** Каталог обраного або останнього рантайму Proton */
  protonPath?: string;
}

export interface IProtonResolveOptions {
  /** Ідентифікатор гри у Vortex (наприклад, "skyrimse") */
  gameMode?: string;
  /** Результат виявлення гри (discovery) */
  discovery?: IDiscoveryResult;
  /** Метадані гри з розширення або сховища стану */
  game?: Pick<IGame, "capabilities" | "details" | "environment" | "queryArgs">;
  /** Стан Redux (для селекторів) */
  state?: any;
  /** Явний Steam AppID (перевизначає автоматичний пошук) */
  appId?: string;
  /** Ручне перевизначення префіксу (override) */
  prefixPath?: string;
}

/**
 * Системні каталоги Windows у drive_c/users, які не є профілями звичайних користувачів.
 */
const SYSTEM_USER_DIRS = new Set(["public", "all users", "default user", "default"]);

type LogFunction = (level: string, message: string, metadata?: any) => void;
let customLogger: LogFunction | undefined;

/**
 * Встановити кастомну функцію логування (наприклад, з @nexusmods/vortex-api або renderer).
 */
export function setProtonLogger(logFn: LogFunction): void {
  customLogger = logFn;
}

function internalLog(level: string, message: string, metadata?: any): void {
  if (customLogger) {
    customLogger(level, message, metadata);
  }
}

/**
 * Централізований сервіс вирішення шляхів до ігрових префіксів Proton/Wine на Linux.
 */
export class ProtonPaths {
  // Кеш успішних резолвів для уникнення повторного синхронного парсингу маніфестів
  private static cache: Map<string, IProtonPaths> = new Map();

  /**
   * Очистити весь кеш або запис для конкретної гри при перевідкритті/зміні шляхів.
   */
  public static invalidate(gameMode?: string): void {
    if (gameMode !== undefined) {
      for (const key of Array.from(this.cache.keys())) {
        if (key.startsWith(`${gameMode}:`)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Пошук підкаталогу з урахуванням регістру (case-insensitive fallback).
   * Дозволяє безпечно знаходити 'documents' vs 'Documents' або 'my games' vs 'My Games'.
   */
  public static findCaseVariant(parentDir: string, childName: string): string {
    const directPath = path.join(parentDir, childName);
    if (fs.existsSync(directPath)) {
      return directPath;
    }

    try {
      const entries = fs.readdirSync(parentDir);
      const targetLower = childName.toLowerCase();
      const match = entries.find((e) => e.toLowerCase() === targetLower);
      if (match !== undefined) {
        return path.join(parentDir, match);
      }
    } catch {
      // Якщо каталог недоступний для читання, повертаємо дефолтний шлях
    }

    return directPath;
  }

  /**
   * Пошук останнього встановленого рантайму Proton у каталозі Steam.
   */
  public static findLatestProton(steamPath: string): string | undefined {
    const commonPath = path.join(steamPath, "steamapps", "common");
    try {
      if (fs.existsSync(commonPath)) {
        const entries = fs.readdirSync(commonPath);
        const protonDirs = entries
          .filter((e) => e.toLowerCase().startsWith("proton"))
          .sort()
          .reverse();

        if (protonDirs.length > 0) {
          return path.join(commonPath, protonDirs[0]);
        }
      }
    } catch {
      // Ігноруємо помилки читання директорії
    }
    return undefined;
  }

  /**
   * Пошук Steam AppID за метаданими гри або шляхом парсингу файлів appmanifest_*.acf.
   * Уникає вразливих регулярних виразів при перевірці installdir.
   */
  public static resolveAppId(
    discovery?: IDiscoveryResult,
    game?: IGame | any,
    explicitAppId?: string,
  ): string | undefined {
    if (explicitAppId) {
      return explicitAppId;
    }

    // Typed capability is authoritative, followed by discovery and legacy metadata.
    const metadataAppId = resolveGameSteamAppId(game, "linux", discovery?.environment?.SteamAPPId);
    if (metadataAppId !== undefined) return metadataAppId;

    // Fall back to scanning manifests when the extension has no metadata.
    if (discovery?.path) {
      try {
        const steamAppsDir = path.dirname(path.dirname(discovery.path));
        const installDirName = path.basename(discovery.path).toLowerCase();

        if (fs.existsSync(steamAppsDir)) {
          const files = fs.readdirSync(steamAppsDir);
          for (const file of files) {
            if (file.startsWith("appmanifest_") && file.endsWith(".acf")) {
              const manifestPath = path.join(steamAppsDir, file);
              const content = fs.readFileSync(manifestPath, "utf8");

              // Парсимо installdir безпечно без regex injection
              if (this.manifestMatchesInstallDir(content, installDirName)) {
                return file.slice("appmanifest_".length, -".acf".length);
              }
            }
          }
        }
      } catch (err: any) {
        internalLog("debug", "ProtonPaths: error scanning steam manifests", {
          error: err?.message,
        });
      }
    }

    return undefined;
  }

  /**
   * Перевіряє, чи відповідає вміст маніфесту вказаному імені директорії встановлення.
   * Працює надійно як з багаторядковими, так і з однорядковими VDF маніфестами без використання regex.
   */
  private static manifestMatchesInstallDir(
    manifestContent: string,
    targetInstallDirLower: string,
  ): boolean {
    const lower = manifestContent.toLowerCase();
    const token = '"installdir"';
    let idx = lower.indexOf(token);
    while (idx !== -1) {
      const after = manifestContent.slice(idx + token.length).trim();
      if (after.startsWith('"')) {
        const closingQuote = after.indexOf('"', 1);
        if (closingQuote !== -1) {
          const val = after.slice(1, closingQuote).toLowerCase();
          if (val === targetInstallDirLower) {
            return true;
          }
        }
      }
      idx = lower.indexOf(token, idx + token.length);
    }
    return false;
  }

  /**
   * Пошук активного каталогу профілю Windows у drive_c/users.
   * Не прив'язується виключно до "steamuser", підтримує довільні Wine/Proton імена.
   */
  public static resolveUserProfile(prefixPath: string): {
    userProfilePath: string;
    userName: string;
  } {
    const usersDir = path.join(prefixPath, "drive_c", "users");
    const defaultUser = "steamuser";
    const defaultPath = path.join(usersDir, defaultUser);

    if (!fs.existsSync(usersDir)) {
      return { userProfilePath: defaultPath, userName: defaultUser };
    }

    try {
      const entries = fs.readdirSync(usersDir);
      const candidates = entries.filter((name) => {
        const lower = name.toLowerCase();
        return !SYSTEM_USER_DIRS.has(lower);
      });

      // Перевіряємо кандидатів на наявність AppData або Documents
      for (const candidate of candidates) {
        const candPath = path.join(usersDir, candidate);
        const hasAppData =
          fs.existsSync(path.join(candPath, "AppData")) ||
          fs.existsSync(path.join(candPath, "appdata"));
        const hasDocs =
          fs.existsSync(path.join(candPath, "Documents")) ||
          fs.existsSync(path.join(candPath, "documents"));

        if (hasAppData || hasDocs) {
          return { userProfilePath: candPath, userName: candidate };
        }
      }

      // Якщо перевірка структури не виявила AppData/Documents, шукаємо steamuser або $USER
      if (candidates.includes("steamuser")) {
        return { userProfilePath: path.join(usersDir, "steamuser"), userName: "steamuser" };
      }

      const linuxUser = process.env.USER;
      if (linuxUser && candidates.includes(linuxUser)) {
        return { userProfilePath: path.join(usersDir, linuxUser), userName: linuxUser };
      }

      if (candidates.length > 0) {
        return { userProfilePath: path.join(usersDir, candidates[0]), userName: candidates[0] };
      }
    } catch (err: any) {
      internalLog("debug", "ProtonPaths: error inspecting wine users", {
        error: err?.message,
      });
    }

    return { userProfilePath: defaultPath, userName: defaultUser };
  }

  /**
   * Пошук шляху до префіксу Wine (compatdata/<appId>/pfx або ручний WINEPREFIX).
   */
  public static resolvePrefixPath(
    discovery?: IDiscoveryResult,
    appId?: string,
    explicitPrefix?: string,
  ): string | undefined {
    // 1. Ручні перевизначення через змінні середовища або параметри
    const manualPrefix =
      explicitPrefix ||
      process.env.VORTEX_PROTON_PREFIX ||
      discovery?.environment?.WINEPREFIX ||
      process.env.WINEPREFIX;

    if (manualPrefix && fs.existsSync(manualPrefix)) {
      // Якщо вказаний безпосередньо корінь префіксу
      if (fs.existsSync(path.join(manualPrefix, "drive_c"))) {
        return manualPrefix;
      }
      // Якщо вказано compatdata шлях
      const pfxSubdir = path.join(manualPrefix, "pfx");
      if (fs.existsSync(path.join(pfxSubdir, "drive_c"))) {
        return pfxSubdir;
      }
    }

    const manualCompatData =
      discovery?.environment?.STEAM_COMPAT_DATA_PATH || process.env.STEAM_COMPAT_DATA_PATH;

    if (manualCompatData) {
      const pfxPath = path.join(manualCompatData, "pfx");
      if (fs.existsSync(path.join(pfxPath, "drive_c"))) {
        return pfxPath;
      }
    }

    if (!appId) {
      return undefined;
    }

    // 2. Пошук у тій же бібліотеці Steam, де встановлена гра
    if (discovery?.path) {
      const gameSteamApps = path.dirname(path.dirname(discovery.path));
      const localPrefix = path.join(gameSteamApps, "compatdata", appId, "pfx");
      if (fs.existsSync(path.join(localPrefix, "drive_c"))) {
        return localPrefix;
      }
    }

    // 3. Пошук у головній інсталяції Steam (native / Flatpak / Snap)
    const steamCandidates = getLinuxSteamPaths();
    for (const steamCandidate of steamCandidates) {
      const candidatePrefix = path.join(steamCandidate, "steamapps", "compatdata", appId, "pfx");
      if (fs.existsSync(path.join(candidatePrefix, "drive_c"))) {
        return candidatePrefix;
      }
    }

    return undefined;
  }

  /**
   * Головний метод резолву структури шляхів префіксу Proton.
   * Повертає undefined на Windows, для не-Proton ігор, або якщо префікс ще не створено Steam.
   */
  public static resolve(options: IProtonResolveOptions): IProtonPaths | undefined {
    // На Windows Proton не використовується
    if (process.platform === "win32") {
      return undefined;
    }

    const discovery = options.discovery;
    const gamePath = discovery?.path;

    if (!gamePath && !options.prefixPath) {
      return undefined;
    }

    // Перевірка підтримки магазину: якщо магазин не steam і немає явного префіксу, пропускаємо
    const isSteam =
      discovery?.store === "steam" || (!discovery?.store && gamePath?.includes("steamapps"));
    const hasManualOverride = Boolean(
      options.prefixPath ||
      process.env.VORTEX_PROTON_PREFIX ||
      process.env.STEAM_COMPAT_DATA_PATH ||
      process.env.WINEPREFIX ||
      discovery?.environment?.STEAM_COMPAT_DATA_PATH ||
      discovery?.environment?.WINEPREFIX,
    );

    if (!isSteam && !hasManualOverride) {
      return undefined;
    }

    // Визначаємо Steam AppID
    const appId = this.resolveAppId(discovery, options.game, options.appId);

    // Знаходимо каталог Wine префіксу
    const prefixPath = this.resolvePrefixPath(discovery, appId, options.prefixPath);
    if (!prefixPath) {
      internalLog("debug", "ProtonPaths: prefix not found or uninitialized", {
        gameMode: options.gameMode,
        appId,
        gamePath,
      });
      return undefined;
    }

    // Resolve the effective identity before consulting the cache: overrides and
    // discovery metadata can change while the installation directory stays put.
    const cacheKey = `${options.gameMode ?? ""}:${JSON.stringify([
      gamePath,
      discovery?.store,
      appId,
      prefixPath,
    ])}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Визначаємо профіль користувача
    const { userProfilePath, userName } = this.resolveUserProfile(prefixPath);

    // Резолвимо каталоги з урахуванням чутливості до регістру
    const documentsRoot = this.findCaseVariant(userProfilePath, "Documents");
    const myGamesRoot = this.findCaseVariant(documentsRoot, "My Games");
    const appDataRoot = this.findCaseVariant(userProfilePath, "AppData");
    const appDataLocal = this.findCaseVariant(appDataRoot, "Local");
    const appDataRoaming = this.findCaseVariant(appDataRoot, "Roaming");

    const steamPath = findLinuxSteamPath();
    let protonPath: string | undefined;

    if (steamPath) {
      try {
        protonPath = this.findLatestProton(steamPath);
      } catch {
        // Помилка пошуку рантайму не є блокуючою для резолву шляхів даних
      }
    }

    const result: IProtonPaths = {
      prefixPath,
      userProfilePath,
      userName,
      documentsPath: documentsRoot,
      myGamesPath: myGamesRoot,
      appDataLocalPath: appDataLocal,
      appDataRoamingPath: appDataRoaming,
      gamePath: gamePath ?? "",
      appId,
      steamPath,
      protonPath,
    };

    // Кешуємо лише успішний результат
    this.cache.set(cacheKey, result);

    internalLog("info", "ProtonPaths: successfully resolved proton prefix paths", {
      gameMode: options.gameMode,
      appId,
      prefixPath,
      myGamesPath: myGamesRoot,
      appDataLocalPath: appDataLocal,
    });

    return result;
  }
}

export default ProtonPaths;
