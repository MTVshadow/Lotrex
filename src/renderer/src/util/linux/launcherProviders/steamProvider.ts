import * as path from "node:path";

import {
  assertSafeCommandLineArgs,
  type ILauncherLaunchRequest,
  type ILauncherProvider,
  type ILaunchPlan,
} from "./contracts";

/**
 * Steam launcher provider adapter (Phase 3).
 * Knows where Steam games reside and how to invoke them via Proton or native binary,
 * while strictly separating launch orchestration from mod management semantics.
 */
export class SteamLauncherProvider implements ILauncherProvider {
  public readonly launcherType = "steam" as const;
  public readonly displayName = "Steam";

  public async generateLaunchPlan(request: ILauncherLaunchRequest): Promise<ILaunchPlan> {
    const rawArgs = request.commandLine ?? [];
    assertSafeCommandLineArgs(rawArgs);

    const cwd = request.workingDirectory ?? path.dirname(request.executablePath);
    const env: Record<string, string> = { ...request.environment };

    if (request.appId) {
      env["SteamAppId"] = request.appId;
      env["SteamGameId"] = request.appId;
    }

    // 1. Native Linux executable
    if (!request.isWindows) {
      return {
        launcher: "steam",
        executable: request.executablePath,
        arguments: [...rawArgs],
        environment: env,
        workingDirectory: cwd,
        explanation: `Launching native Linux binary for Steam game '${request.gameId}' directly without a compatibility layer.`,
        isDryRunSafe: true,
      };
    }

    // 2. Windows executable via Proton
    const protonDir = request.runtimePath ?? "/usr/share/steam/compatibilitytools.d/proton";
    const protonBinary = path.join(protonDir, "proton");
    const prefix = request.prefixPath ?? path.join(request.installPath, "compatdata", "pfx");

    env["STEAM_COMPAT_DATA_PATH"] = path.dirname(prefix);
    env["WINEPREFIX"] = prefix;

    const args = ["run", request.executablePath, ...rawArgs];

    return {
      launcher: "steam",
      executable: protonBinary,
      arguments: args,
      environment: env,
      workingDirectory: cwd,
      prefixPath: prefix,
      runtimePath: protonDir,
      explanation: `Launching Windows executable for Steam game '${request.gameId}' via Proton runtime at '${protonDir}' using prefix '${prefix}'.`,
      isDryRunSafe: true,
    };
  }
}
