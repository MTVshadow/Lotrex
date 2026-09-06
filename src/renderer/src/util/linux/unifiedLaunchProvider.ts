import * as os from "node:os";
import * as path from "node:path";

import { buildProtonEnvironment, isWindowsExecutable } from "./protonLaunch";
import ProtonPaths from "./ProtonPaths";
import { discoverAvailableProtonRuntimes } from "./protonRuntimes";
import type { ICustomProtonValidationOptions } from "./protonRuntimes";
import {
  type IProtonRuntimePreference,
  resolveProtonRuntimePreference,
} from "./protonRuntimeSelection";
import { ProtonUnavailable } from "./ProtonUnavailable";

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
  protonContext?: IUnifiedProtonContext;
  protonRuntimePreference?: IProtonRuntimePreference;
  protonRuntimeValidation?: ICustomProtonValidationOptions;
  enableProtonLogs?: boolean;
}

export interface IUnifiedProtonContext {
  appId?: string;
  gamePath?: string;
  prefixPath?: string;
  protonPath?: string;
  steamPath?: string;
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

/** Build one launch plan for native binaries, launcher URIs, and Windows binaries on Linux. */
export function resolveUnifiedLaunch(request: IUnifiedLaunchRequest): IUnifiedLaunchResult {
  const {
    executablePath,
    commandLine = [],
    workingDirectory,
    environment = {},
    isGame,
    gameId,
    gameName,
    discovery,
    gameMetadata,
    enableProtonLogs = false,
  } = request;

  const cwd = workingDirectory || path.dirname(executablePath || ".");
  const diagnostics: string[] = [];

  if (executablePath.startsWith("heroic://")) {
    diagnostics.push("Using the Heroic Games Launcher URI protocol.");
    return {
      mode: "heroic-uri",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  if (executablePath.startsWith("lutris:")) {
    diagnostics.push("Using the Lutris URI protocol.");
    return {
      mode: "lutris-uri",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  if (executablePath.startsWith("steam://")) {
    diagnostics.push("Using the Steam URI protocol.");
    return {
      mode: "steam-uri",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  if (!isWindowsExecutable(executablePath)) {
    diagnostics.push("The target is native to Linux; launching without a compatibility layer.");
    return {
      mode: "native",
      executable: executablePath,
      parameters: commandLine,
      environment: { ...environment },
      workingDirectory: cwd,
      diagnostics,
    };
  }

  const proton =
    request.protonContext ??
    ProtonPaths.resolve({
      gameMode: gameId,
      discovery,
      game: gameMetadata,
    });

  const selectedRuntime = request.protonRuntimePreference
    ? resolveProtonRuntimePreference(
        request.protonRuntimePreference,
        proton?.protonPath,
        discoverAvailableProtonRuntimes(proton?.steamPath),
        request.protonRuntimeValidation,
      )
    : { path: undefined, type: "auto" as const };
  if (selectedRuntime.error !== undefined) {
    throw new Error(selectedRuntime.error);
  }
  const effectiveProtonRuntime = selectedRuntime.path || proton?.protonPath;
  const effectivePrefix = proton?.prefixPath;

  if (!effectivePrefix) {
    diagnostics.push(`No Proton prefix was found for '${gameName || gameId}'.`);
    throw new ProtonUnavailable("prefix-not-found", proton?.appId);
  }

  if (!effectiveProtonRuntime) {
    diagnostics.push(`No Proton runtime was found for '${gameName || gameId}'.`);
    throw new ProtonUnavailable("runtime-not-found", proton?.appId);
  }

  const launchEnv = buildProtonEnvironment(
    path.dirname(effectivePrefix),
    proton?.steamPath ?? "",
    environment,
    effectiveProtonRuntime,
    proton?.gamePath ?? discovery?.path ?? path.dirname(executablePath),
  );

  let logFilePath: string | undefined;
  if (enableProtonLogs) {
    launchEnv.PROTON_LOG = "1";
    launchEnv.PROTON_LOG_DIR = path.join(os.homedir(), ".config", "Vortex", "logs");
    logFilePath = path.join(launchEnv.PROTON_LOG_DIR, `proton-${gameId}.log`);
    diagnostics.push(`Proton logging enabled: ${logFilePath}`);
  }

  const protonExecutable = path.join(effectiveProtonRuntime, "proton");
  const parameters = ["run", executablePath, ...commandLine];

  diagnostics.push(`Launching a Windows executable through Proton (${isGame ? "game" : "tool"}).`);
  diagnostics.push(`Prefix: ${effectivePrefix}`);
  diagnostics.push(`Runtime: ${effectiveProtonRuntime}`);

  return {
    mode: selectedRuntime.type === "custom" ? "custom-proton" : "steam-proton",
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
