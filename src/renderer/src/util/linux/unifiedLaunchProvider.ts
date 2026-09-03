import * as os from "node:os";
import * as path from "node:path";

import ProtonPaths from "./ProtonPaths";
import { ProtonUnavailable } from "./ProtonUnavailable";

export function isWindowsExecutable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".exe", ".bat", ".cmd"].includes(ext);
}

export type LinuxLaunchMode =
  | "native"
  | "steam-proton"
  | "steam-uri"
  | "heroic-uri"
  | "lutris-uri"
  | "custom-proton";

export interface IUnifiedLaunchRequest {
  executablePath: string;
  commandLine?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  isGame: boolean;
  gameId: string;
  gameName?: string;
  store?: string;
  discovery?: any;
  gameMetadata?: any;
  userProtonRuntime?: string;
  enableProtonLogs?: boolean;
}

export interface IUnifiedLaunchResult {
  mode: LinuxLaunchMode;
  executable: string;
  parameters: string[];
  environment: Record<string, string>;
  workingDirectory: string;
  prefixPath?: string;
  protonPath?: string;
  logFilePath?: string;
  diagnostics: string[];
}

/**
 * Єдиний провайдер запуску для Linux (Unified Linux Launch Provider).
 * Консолідує логіку вибору середовища (нативний двійковий файл, Steam Proton, Heroic або Lutris URI)
 * та налаштування змінних оточення (STEAM_COMPAT_DATA_PATH, PROTON_LOG тощо).
 */
export function resolveUnifiedLaunch(request: IUnifiedLaunchRequest): IUnifiedLaunchResult {
  const {
    executablePath,
    commandLine = [],
    workingDirectory,
    environment = {},
    isGame,
    gameId,
    gameName,
    store,
    discovery,
    gameMetadata,
    userProtonRuntime,
    enableProtonLogs = false,
  } = request;

  const cwd = workingDirectory || path.dirname(executablePath || ".");
  const diagnostics: string[] = [];

  // 1. Якщо це виклик URI запуску через Heroic Games Launcher
  if (store === "heroic" || executablePath.startsWith("heroic://")) {
    diagnostics.push("Використовується URI-протокол запуску Heroic Games Launcher.");
    return {
      mode: "heroic-uri",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  // 2. Якщо це виклик URI запуску через Lutris
  if (store === "lutris" || executablePath.startsWith("lutris:")) {
    diagnostics.push("Використовується URI-протокол запуску Lutris.");
    return {
      mode: "lutris-uri",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  // 3. Якщо це Steam URI
  if (executablePath.startsWith("steam://")) {
    diagnostics.push("Використовується URI-протокол запуску Steam.");
    return {
      mode: "steam-uri",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  // 4. Якщо це не Windows-бінарник (ELF, shell script тощо), запускаємо нативно
  if (!isWindowsExecutable(executablePath)) {
    diagnostics.push(
      "Цільовий виконуваний файл є нативним для Linux (non-PE). Запуск без емуляції.",
    );
    return {
      mode: "native",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  // 4. Windows-виконуваний файл (гра або сторонній мод-тул: LOOT, xEdit, BodySlide)
  const proton = ProtonPaths.resolve({
    gameMode: gameId,
    discovery,
    game: gameMetadata,
  });

  const effectiveProtonRuntime = userProtonRuntime || proton?.protonPath;
  const effectivePrefix = proton?.prefixPath;

  if (!effectivePrefix) {
    diagnostics.push(`Префікс Proton для гри '${gameName || gameId}' не знайдено.`);
    throw new ProtonUnavailable("prefix-not-found", proton?.appId);
  }

  if (!effectiveProtonRuntime) {
    diagnostics.push(`Виконуване середовище Proton для гри '${gameName || gameId}' не знайдено.`);
    throw new ProtonUnavailable("runtime-not-found", proton?.appId);
  }

  // Формування оточення сумісності Steam Proton
  const launchEnv: Record<string, string> = {
    ...environment,
    STEAM_COMPAT_DATA_PATH: path.dirname(effectivePrefix),
    STEAM_COMPAT_CLIENT_INSTALL_PATH: proton?.steamPath || "",
  };

  let logFilePath: string | undefined;
  if (enableProtonLogs) {
    launchEnv.PROTON_LOG = "1";
    launchEnv.PROTON_LOG_DIR = path.join(os.homedir(), ".config", "Vortex", "logs");
    logFilePath = path.join(launchEnv.PROTON_LOG_DIR, `proton-${gameId}.log`);
    diagnostics.push(`Увімкнено журнал Proton: ${logFilePath}`);
  }

  const protonExecutable = path.join(effectiveProtonRuntime, "proton");
  const parameters = ["run", executablePath, ...commandLine];

  diagnostics.push(
    `Запуск Windows-виконуваного файлу через Proton (${isGame ? "Основна гра" : "Інструмент"})`,
  );
  diagnostics.push(`Використовується префікс: ${effectivePrefix}`);
  diagnostics.push(`Використовується рантайм: ${effectiveProtonRuntime}`);

  return {
    mode: userProtonRuntime ? "custom-proton" : "steam-proton",
    executable: protonExecutable,
    parameters,
    environment: launchEnv,
    workingDirectory: cwd,
    prefixPath: effectivePrefix,
    protonPath: effectiveProtonRuntime,
    logFilePath,
    diagnostics,
  };
}
