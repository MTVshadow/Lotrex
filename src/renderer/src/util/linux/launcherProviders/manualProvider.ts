import * as path from "node:path";

import {
  assertSafeCommandLineArgs,
  type ILauncherLaunchRequest,
  type ILauncherProvider,
  type ILaunchPlan,
} from "./contracts";

/**
 * Manual/Standalone launcher provider adapter (Phase 3).
 * Normalizes launch plans for standalone native or manually configured Windows games.
 */
export class ManualLauncherProvider implements ILauncherProvider {
  public readonly launcherType = "manual" as const;
  public readonly displayName = "Manual / Standalone";

  public async generateLaunchPlan(request: ILauncherLaunchRequest): Promise<ILaunchPlan> {
    const rawArgs = request.commandLine ?? [];
    assertSafeCommandLineArgs(rawArgs);

    const cwd = request.workingDirectory ?? path.dirname(request.executablePath);
    const env: Record<string, string> = { ...request.environment };

    // 1. Native Linux executable
    if (!request.isWindows) {
      return {
        launcher: "manual",
        executable: request.executablePath,
        arguments: [...rawArgs],
        environment: env,
        workingDirectory: cwd,
        explanation: `Launching manual standalone native Linux game '${request.gameId}' directly.`,
        isDryRunSafe: true,
      };
    }

    // 2. Windows executable via Wine or Proton
    const runner = request.runtimePath ?? "/usr/bin/wine";
    const prefix = request.prefixPath ?? path.join(request.installPath, "prefix");
    env["WINEPREFIX"] = prefix;

    const isProton = runner.includes("proton");
    const executable = isProton ? path.join(runner, "proton") : runner;
    const args = isProton
      ? ["run", request.executablePath, ...rawArgs]
      : [request.executablePath, ...rawArgs];

    return {
      launcher: "manual",
      executable,
      arguments: args,
      environment: env,
      workingDirectory: cwd,
      prefixPath: prefix,
      runtimePath: runner,
      explanation: `Launching manual Windows executable for '${request.gameId}' via '${runner}' in prefix '${prefix}'.`,
      isDryRunSafe: true,
    };
  }
}
