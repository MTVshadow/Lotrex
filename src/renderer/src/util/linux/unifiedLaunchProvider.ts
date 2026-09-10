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

/**
 * Validates that an executable path or launcher URI does not use unsafe protocols,
 * shell metacharacters, or command injection sequences.
 *
 * Educational note:
 * On Linux, game launchers and mod configurations may attempt to invoke external protocols or URIs.
 * If protocols like `file:`, `javascript:`, or `data:` are accepted, or if launcher URIs contain
 * shell metacharacters (such as `;`, `&`, `|`, `` ` ``, `$()`), they can lead to arbitrary code execution
 * or local file inclusion. We strictly whitelist allowed launcher schemes (`steam:`, `heroic:`, `lutris:`)
 * and enforce strict identifier grammar, while ensuring Windows drive paths (e.g. `C:\...`) remain valid.
 */
export function validateExecutableOrUri(executablePath: string): void {
  if (typeof executablePath !== "string" || executablePath.trim().length === 0) {
    throw new Error("Executable path or launcher URI must be a non-empty string");
  }

  // Reject null bytes and newline injection
  if (/[\0\r\n]/.test(executablePath)) {
    throw new Error(`Executable path contains invalid control characters: ${executablePath}`);
  }

  // Check if string starts with a URI protocol scheme (excluding Windows drive letters like C:\)
  const uriSchemeMatch = executablePath.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (uriSchemeMatch && !/^[a-zA-Z]:[/\\]/.test(executablePath)) {
    const scheme = uriSchemeMatch[1].toLowerCase();

    if (scheme === "steam") {
      // Validate Steam URI structure and reject shell metacharacters
      const steamPattern =
        /^steam:\/\/(?:run|rungameid|launch|app)\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.~%/-]*)?$/;
      if (!steamPattern.test(executablePath) || executablePath.includes("..")) {
        throw new Error(`Refusing to launch unsafe Steam URI: ${executablePath}`);
      }
      return;
    }

    if (scheme === "heroic") {
      // Validate Heroic URI structure and reject shell metacharacters
      const heroicPattern = /^heroic:\/\/launch(?:\?[a-zA-Z0-9_.~%&=-]*|\/[a-zA-Z0-9_.-]+)?$/;
      if (!heroicPattern.test(executablePath) || executablePath.includes("..")) {
        throw new Error(`Refusing to launch unsafe Heroic URI: ${executablePath}`);
      }
      return;
    }

    if (scheme === "lutris") {
      // Validate Lutris URI structure and reject shell metacharacters
      const lutrisPattern = /^lutris:(?:rungame\/|rungameid\/)?[a-zA-Z0-9_.-]+$/;
      if (!lutrisPattern.test(executablePath) || executablePath.includes("..")) {
        throw new Error(`Refusing to launch unsafe Lutris URI: ${executablePath}`);
      }
      return;
    }

    // All other URI schemes (e.g. file:, javascript:, data:, http:, etc.) are rejected
    throw new Error(`Refusing to launch unsafe protocol: ${scheme}`);
  }
}

/**
 * Validates that command line arguments do not contain null bytes or control character injections.
 * Parameters are strictly passed as an isolated string array to child_process.spawn to avoid shell concatenation.
 */
export function validateCommandLineArguments(commandLine: string[]): void {
  for (const arg of commandLine) {
    if (typeof arg !== "string" || /[\0\r\n]/.test(arg)) {
      throw new Error(`Command line argument contains invalid control characters: ${arg}`);
    }
  }
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

  validateExecutableOrUri(executablePath);
  validateCommandLineArguments(commandLine);

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
