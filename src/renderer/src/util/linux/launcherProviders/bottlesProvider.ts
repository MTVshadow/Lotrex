import * as path from "node:path";

import {
  assertSafeCommandLineArgs,
  type ILauncherLaunchRequest,
  type ILauncherProvider,
  type ILaunchPlan,
} from "./contracts";

/**
 * Bottles launcher provider adapter (Phase 3).
 * Uses bottles-cli to launch Windows games within isolated bottles.
 */
export class BottlesLauncherProvider implements ILauncherProvider {
  public readonly launcherType = "bottles" as const;
  public readonly displayName = "Bottles";

  public async generateLaunchPlan(request: ILauncherLaunchRequest): Promise<ILaunchPlan> {
    const rawArgs = request.commandLine ?? [];
    assertSafeCommandLineArgs(rawArgs);

    const cwd = request.workingDirectory ?? path.dirname(request.executablePath);
    const env: Record<string, string> = { ...request.environment };
    const bottleName = request.bottleName ?? request.gameId;

    // Reject dangerous bottle names
    if (!/^[a-zA-Z0-9_\-\s.]+$/.test(bottleName)) {
      throw new Error(`Invalid bottle name specified: ${bottleName}`);
    }

    const bottlesCliExecutable = "/usr/bin/bottles-cli";
    const args = [
      "run",
      "-b",
      bottleName,
      "-e",
      request.executablePath,
      ...(rawArgs.length > 0 ? ["--args", rawArgs.join(" ")] : []),
    ];

    return {
      launcher: "bottles",
      executable: bottlesCliExecutable,
      arguments: args,
      environment: env,
      workingDirectory: cwd,
      prefixPath: request.prefixPath,
      explanation: `Launching game '${request.gameId}' through Bottles in bottle '${bottleName}' via bottles-cli.`,
      isDryRunSafe: true,
    };
  }
}
