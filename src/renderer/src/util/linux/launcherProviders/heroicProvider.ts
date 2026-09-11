import * as path from "node:path";

import {
  assertSafeCommandLineArgs,
  type ILauncherLaunchRequest,
  type ILauncherProvider,
  type ILaunchPlan,
} from "./contracts";

/**
 * Heroic Games Launcher provider adapter (Phase 3).
 * Normalizes launch plans for Epic/GOG games managed by Heroic.
 */
export class HeroicLauncherProvider implements ILauncherProvider {
  public readonly launcherType = "heroic" as const;
  public readonly displayName = "Heroic Games Launcher";

  public async generateLaunchPlan(request: ILauncherLaunchRequest): Promise<ILaunchPlan> {
    const rawArgs = request.commandLine ?? [];
    assertSafeCommandLineArgs(rawArgs);

    const cwd = request.workingDirectory ?? path.dirname(request.executablePath);
    const env: Record<string, string> = { ...request.environment };

    // 1. Native Linux executable
    if (!request.isWindows) {
      return {
        launcher: "heroic",
        executable: request.executablePath,
        arguments: [...rawArgs],
        environment: env,
        workingDirectory: cwd,
        explanation: `Launching native Linux binary for Heroic game '${request.gameId}' directly.`,
        isDryRunSafe: true,
      };
    }

    // 2. Windows executable via Wine/Proton runner configured in Heroic
    const runner = request.runtimePath ?? "/usr/bin/wine";
    const prefix = request.prefixPath ?? path.join(request.installPath, "prefix");
    env["WINEPREFIX"] = prefix;

    const isProton = runner.includes("proton");
    const executable = isProton ? path.join(runner, "proton") : runner;
    const args = isProton
      ? ["run", request.executablePath, ...rawArgs]
      : [request.executablePath, ...rawArgs];

    return {
      launcher: "heroic",
      executable,
      arguments: args,
      environment: env,
      workingDirectory: cwd,
      prefixPath: prefix,
      runtimePath: runner,
      explanation: `Launching Windows executable for Heroic game '${request.gameId}' via runner '${runner}' using prefix '${prefix}'.`,
      isDryRunSafe: true,
    };
  }
}
