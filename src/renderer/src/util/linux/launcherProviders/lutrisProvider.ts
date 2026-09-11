import * as path from "node:path";

import {
  assertSafeCommandLineArgs,
  type ILauncherLaunchRequest,
  type ILauncherProvider,
  type ILaunchPlan,
} from "./contracts";

/**
 * Lutris launcher provider adapter (Phase 3).
 * Normalizes launch plans for games managed by Lutris.
 */
export class LutrisLauncherProvider implements ILauncherProvider {
  public readonly launcherType = "lutris" as const;
  public readonly displayName = "Lutris";

  public async generateLaunchPlan(request: ILauncherLaunchRequest): Promise<ILaunchPlan> {
    const rawArgs = request.commandLine ?? [];
    assertSafeCommandLineArgs(rawArgs);

    const cwd = request.workingDirectory ?? path.dirname(request.executablePath);
    const env: Record<string, string> = { ...request.environment };

    // 1. Native Linux executable
    if (!request.isWindows) {
      return {
        launcher: "lutris",
        executable: request.executablePath,
        arguments: [...rawArgs],
        environment: env,
        workingDirectory: cwd,
        explanation: `Launching native Linux binary for Lutris game '${request.gameId}' directly.`,
        isDryRunSafe: true,
      };
    }

    // 2. Windows executable via Lutris runner
    const runner = request.runtimePath ?? "/usr/bin/wine";
    const prefix = request.prefixPath ?? path.join(request.installPath, "prefix");
    env["WINEPREFIX"] = prefix;

    const isProton = runner.includes("proton");
    const executable = isProton ? path.join(runner, "proton") : runner;
    const args = isProton
      ? ["run", request.executablePath, ...rawArgs]
      : [request.executablePath, ...rawArgs];

    return {
      launcher: "lutris",
      executable,
      arguments: args,
      environment: env,
      workingDirectory: cwd,
      prefixPath: prefix,
      runtimePath: runner,
      explanation: `Launching Windows executable for Lutris game '${request.gameId}' via runner '${runner}' using prefix '${prefix}'.`,
      isDryRunSafe: true,
    };
  }
}
