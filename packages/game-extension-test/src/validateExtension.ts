import * as fs from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);

const vortexApiMock = {
  fs: new Proxy({}, { get: () => () => Promise.resolve() }),
  selectors: {
    activeGameId: () => "mock",
    installPath: () => "/mock/install",
    discoveryByGame: () => ({}),
  },
  util: {
    getSafe: (_o: any, _p: any[], d: any) => d,
    makeOverlayableDictionary: () => ({ get: () => () => "" }),
    toBluebird: (p: any) => p,
    opn: () => Promise.resolve(),
    getVortexPath: (t: string) => `/mock/${t}`,
  },
  types: {},
  actions: {},
};

const exeVersionMock = {
  getFileVersion: () => Promise.resolve("1.0.0"),
  getFileVersionLocalized: () => Promise.resolve("1.0.0"),
};

const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request === "@nexusmods/vortex-api") {
    return vortexApiMock;
  }
  if (request === "exe-version") {
    return exeVersionMock;
  }
  return originalLoad.apply(this, arguments);
};

export interface IExtensionValidationReport {
  gameId: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: {
    name?: string;
    installersCount: number;
    hasLinuxCapabilities: boolean;
    launchMode?: string;
    steamAppId?: string | number;
    stores: string[];
  };
}

export interface IStubbedGame {
  id?: string;
  name?: string;
  executable?: (gamePath?: string) => string;
  requiredFiles?: string[];
  queryModPath?: (gamePath: string) => string;
  queryArgs?: Record<string, unknown>;
  capabilities?: {
    platforms?: Record<string, { launch?: string; steamAppId?: string | number }>;
    deployment?: Record<string, boolean>;
  };
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

const VALID_LAUNCH_MODES = new Set(["auto", "native", "steam", "steam-proton", "wine"]);
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[a-zA-Z]:\\/;

/**
 * Перевірка розширення гри на відповідність контракту IGame та вимогам Linux-сумісності.
 */
export function validateGameContract(game: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (game === null || typeof game !== "object") {
    return { errors: ["Визначення гри має бути об'єктом."], warnings: [] };
  }

  const g = game as IStubbedGame;

  // 1. Обов'язкові базові поля
  if (typeof g.id !== "string" || g.id.trim().length === 0) {
    errors.push("Поле 'id' має бути непорожнім рядком.");
  }
  if (typeof g.name !== "string" || g.name.trim().length === 0) {
    errors.push("Поле 'name' має бути непорожнім рядком.");
  }
  if (!Array.isArray(g.requiredFiles) || g.requiredFiles.length === 0) {
    errors.push("Поле 'requiredFiles' має бути непорожнім масивом рядків.");
  }

  // 2. Функція executable()
  if (typeof g.executable !== "function") {
    errors.push("Поле 'executable' має бути функцією.");
  } else {
    try {
      const exe = g.executable();
      if (typeof exe !== "string" || exe.trim().length === 0) {
        errors.push("executable() має повертати непорожній відносний шлях.");
      } else if (WINDOWS_ABSOLUTE_PATH_REGEX.test(exe) || path.isAbsolute(exe)) {
        errors.push(`executable() повертає абсолютний шлях ('${exe}'), очікується відносний.`);
      }
    } catch (err: any) {
      errors.push(`executable() викинув помилку: ${err?.message || err}`);
    }
  }

  // 3. Функція queryModPath()
  if (typeof g.queryModPath !== "function") {
    errors.push("Поле 'queryModPath' має бути функцією.");
  } else {
    try {
      const modPath = g.queryModPath("/games/example");
      if (typeof modPath !== "string" || modPath.trim().length === 0) {
        errors.push("queryModPath() має повертати непорожній шлях.");
      } else if (WINDOWS_ABSOLUTE_PATH_REGEX.test(modPath)) {
        errors.push(`queryModPath() повертає абсолютний Windows-шлях: '${modPath}'.`);
      }
    } catch (err: any) {
      errors.push(`queryModPath() викинув помилку: ${err?.message || err}`);
    }
  }

  // 4. Перевірка платформових можливостей Linux
  const linuxCap = g.capabilities?.platforms?.linux;
  if (linuxCap) {
    if (linuxCap.launch && !VALID_LAUNCH_MODES.has(linuxCap.launch)) {
      errors.push(`Неприпустимий режим запуску для Linux: '${linuxCap.launch}'.`);
    }
    if (
      linuxCap.steamAppId !== undefined &&
      !["string", "number"].includes(typeof linuxCap.steamAppId)
    ) {
      errors.push("capabilities.platforms.linux.steamAppId має бути рядком або числом.");
    }
  } else {
    warnings.push(
      "Розширення не містить явних декларацій 'capabilities.platforms.linux' (рекомендовано для коректного виявлення у Proton).",
    );
  }

  // 5. Перевірка конфігурації магазинів
  if (!g.queryArgs && !g.queryPath) {
    warnings.push(
      "Не вказано ані 'queryArgs', ані 'queryPath'. Автоматичне виявлення гри через Steam/GOG може бути недоступним.",
    );
  }

  return { errors, warnings };
}

/**
 * Повна валідація каталогу розширення гри.
 */
export async function validateGameExtensionDir(
  extensionDir: string,
): Promise<IExtensionValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let gameId = path.basename(extensionDir);

  const packageJsonPath = path.join(extensionDir, "package.json");
  const infoJsonPath = path.join(extensionDir, "info.json");
  if (!fs.existsSync(packageJsonPath) && !fs.existsSync(infoJsonPath)) {
    errors.push("У каталозі розширення відсутній package.json або info.json.");
  }

  let stubbedGame: IStubbedGame | undefined;
  let installersCount = 0;

  const stubContext = {
    registerGame(g: IStubbedGame) {
      stubbedGame = g;
    },
    registerInstaller(_id: string, _prio: number) {
      installersCount++;
    },
    once(_cb: () => void) {},
    api: {},
  };

  const proxyContext = new Proxy(stubContext, {
    get(target, prop, receiver) {
      const known = Reflect.get(target, prop, receiver);
      if (known !== undefined) return known;
      if (typeof prop === "string" && prop.startsWith("register")) {
        return () => {};
      }
      return undefined;
    },
  });

  const entryCandidates = [
    path.join(extensionDir, "src", "index.ts"),
    path.join(extensionDir, "src", "index.js"),
    path.join(extensionDir, "index.ts"),
    path.join(extensionDir, "index.js"),
    path.join(extensionDir, "dist", "index.js"),
  ];
  const entryFile = entryCandidates.find((f) => fs.existsSync(f));

  if (!entryFile) {
    errors.push(
      `Не знайдено точку входу розширення (очікувалось одне з: ${entryCandidates.join(", ")}).`,
    );
    return {
      gameId,
      valid: false,
      errors,
      warnings,
      info: {
        installersCount: 0,
        hasLinuxCapabilities: false,
        stores: [],
      },
    };
  }

  try {
    let mod: any;
    if (entryFile.endsWith(".js") || entryFile.endsWith(".cjs")) {
      mod = require_(entryFile);
    } else {
      mod = await import(entryFile);
    }
    const init = typeof mod === "function" ? mod : (mod.default ?? mod.init);
    if (typeof init !== "function") {
      errors.push(`Файл '${entryFile}' не експортує функцію за замовчуванням або init().`);
    } else {
      init(proxyContext);
    }
  } catch (err: any) {
    errors.push(`Помилка під час ініціалізації розширення: ${err?.message || err}`);
  }

  if (stubbedGame) {
    gameId = stubbedGame.id || gameId;
    const contractResult = validateGameContract(stubbedGame);
    errors.push(...contractResult.errors);
    warnings.push(...contractResult.warnings);
  } else {
    errors.push("Розширення не викликало context.registerGame() під час ініціалізації.");
  }

  const linuxCap = stubbedGame?.capabilities?.platforms?.linux;
  const stores = Object.keys(stubbedGame?.queryArgs || {});

  return {
    gameId,
    valid: errors.length === 0,
    errors,
    warnings,
    info: {
      name: stubbedGame?.name,
      installersCount,
      hasLinuxCapabilities: Boolean(linuxCap),
      launchMode: linuxCap?.launch,
      steamAppId: linuxCap?.steamAppId,
      stores,
    },
  };
}
