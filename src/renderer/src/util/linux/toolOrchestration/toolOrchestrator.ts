import * as child_process from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { assertSafeCommandLineArgs } from "../launcherProviders/contracts";
import { classifyProcessExit } from "../processDiagnostics";
import { isWindowsExecutable } from "../protonLaunch";
import type {
  IToolExecutionHandle,
  IToolExecutionResult,
  IToolLaunchPlan,
  IToolLaunchRequest,
  IToolPlanPreview,
} from "./contracts";

/**
 * Standard tool process runner and supervisor (Phase 6).
 *
 * Implements:
 * 1. Single trusted launch-plan contract for games and external tools (SKSE, LOOT, xEdit, BodySlide, Nemesis).
 * 2. Per-tool runtime and prefix overrides with inherited environments.
 * 3. Strict vector-based argument arrays (NEVER shell concatenation).
 * 4. Detached POSIX process groups with graceful SIGTERM and SIGKILL escalation.
 * 5. Full process exit classification and diagnostic explanations for native, Proton, and Wine.
 */
export class ToolOrchestrator {
  /**
   * Constructs an immutable, trusted IToolLaunchPlan from an IToolLaunchRequest.
   */
  public buildToolLaunchPlan(request: IToolLaunchRequest): IToolLaunchPlan {
    const rawArgs = request.commandLine ?? [];
    assertSafeCommandLineArgs(rawArgs);

    const isWindows = request.isWindowsBinary ?? isWindowsExecutable(request.executablePath);

    // Resolve per-tool runtime override or fallback to default
    const effectiveRuntime =
      request.runtimeOverride ?? request.defaultRuntime ?? (isWindows ? "proton" : "native");

    // Resolve per-tool prefix override or fallback to default game prefix
    const effectivePrefix = request.prefixOverride ?? request.defaultPrefixPath;

    let executable = request.executablePath;
    let finalArgs: string[] = [...rawArgs];
    const isProtonOrWine = isWindows;

    if (isWindows) {
      if (effectiveRuntime.toLowerCase().includes("wine")) {
        // Execute under Wine
        executable = "wine";
        finalArgs = [request.executablePath, ...rawArgs];
      } else {
        // Execute under Proton
        const protonBin = effectiveRuntime.endsWith("proton")
          ? effectiveRuntime
          : path.join(effectiveRuntime, "proton");
        executable = protonBin;
        finalArgs = ["run", request.executablePath, ...rawArgs];
      }
    }

    // Compose sanitized environment variables
    const environment: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      USER: process.env.USER ?? "user",
      DISPLAY: process.env.DISPLAY ?? ":0",
      ...(process.env.WAYLAND_DISPLAY ? { WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY } : {}),
      ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}),
      ...(request.inheritedEnvironment ?? {}),
    };

    if (isWindows && effectivePrefix) {
      environment.WINEPREFIX = effectivePrefix;
      environment.STEAM_COMPAT_DATA_PATH = effectivePrefix;
      environment.STEAM_COMPAT_CLIENT_INSTALL_PATH = path.dirname(request.gameInstallPath);
    }

    // Apply custom DLL overrides if requested (e.g. WINEDLLOVERRIDES="dinput8=n,b")
    if (request.dllOverrides && Object.keys(request.dllOverrides).length > 0) {
      const overridesStr = Object.entries(request.dllOverrides)
        .map(([dll, setting]) => `${dll}=${setting}`)
        .join(";");
      environment.WINEDLLOVERRIDES = overridesStr;
    }

    // Apply explicit environment overrides
    if (request.environmentOverrides) {
      Object.assign(environment, request.environmentOverrides);
    }

    const workingDirectory = request.workingDirectory ?? request.gameInstallPath;

    const opId = crypto.randomBytes(6).toString("hex");
    const logFilePath = `/tmp/vortex_tool_logs/${request.toolId}_${opId}.log`;

    const explanation = isWindows
      ? `Tool '${request.toolName}' (${request.toolId}) configured as Windows binary via ${effectiveRuntime} using prefix '${effectivePrefix ?? "none"}'. Invoking: ${executable} with [${finalArgs.join(", ")}]. Shell concatenation strictly omitted.`
      : `Tool '${request.toolName}' (${request.toolId}) configured as native Linux binary. Invoking: ${executable} with [${finalArgs.join(", ")}]. Shell concatenation strictly omitted.`;

    return {
      launcher: "manual",
      toolId: request.toolId,
      toolName: request.toolName,
      executable,
      arguments: finalArgs,
      environment,
      workingDirectory,
      prefixPath: effectivePrefix,
      runtimePath: effectiveRuntime,
      explanation,
      isDryRunSafe: true,
      isProtonOrWine,
      logFilePath,
    };
  }

  /**
   * Previews a tool launch plan and checks for potential environment or path anomalies.
   */
  public previewToolLaunchPlan(request: IToolLaunchRequest): IToolPlanPreview {
    const plan = this.buildToolLaunchPlan(request);
    const warnings: string[] = [];

    const effectiveRuntime = request.runtimeOverride ?? request.defaultRuntime ?? "default";
    const effectivePrefix = request.prefixOverride ?? request.defaultPrefixPath ?? "none";

    if (plan.isProtonOrWine && !request.prefixOverride && !request.defaultPrefixPath) {
      warnings.push(
        `Windows tool '${request.toolName}' has no prefix configured. A Wine or Proton prefix is strongly recommended.`,
      );
    }

    if (request.executablePath.includes(" ")) {
      warnings.push(
        `Executable path contains whitespace ('${request.executablePath}'). Verified argument vector formatting without shell quoting issues.`,
      );
    }

    return {
      plan,
      effectiveRuntime,
      effectivePrefix,
      warnings,
      sanitizedEnvironment: plan.environment,
    };
  }

  /**
   * Spawns and manages the tool process with timeout supervisor, cancellation, and logging.
   */
  public launchTool(
    plan: IToolLaunchPlan,
    options: {
      timeoutMs?: number;
      spawnFn?: typeof child_process.spawn;
    } = {},
  ): IToolExecutionHandle {
    const operationId = crypto.randomBytes(8).toString("hex");
    const spawnFn = options.spawnFn ?? child_process.spawn;
    const timeoutMs = options.timeoutMs ?? 300_000; // Default 5 minutes

    // Ensure log directory exists
    const logDir = path.dirname(plan.logFilePath);
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
      // Ignore if exists or error
    }

    let logStream: fs.WriteStream | null = null;
    try {
      logStream = fs.createWriteStream(plan.logFilePath, { flags: "a" });
    } catch {
      // Ignore log stream creation failure in restricted environments
    }

    const startTime = Date.now();
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let isCancelled = false;
    let isTimedOut = false;

    // Spawn detached child process in its own process group
    const child = spawnFn(plan.executable, plan.arguments, {
      cwd: plan.workingDirectory,
      env: plan.environment,
      detached: true,
    });

    const pid = child.pid ?? -1;

    // Pipe stdout and stderr
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      logStream?.write(text);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrBuffer += text;
      logStream?.write(text);
    });

    let timeoutTimer: NodeJS.Timeout | null = null;
    let escalationTimer: NodeJS.Timeout | null = null;

    // Armed timeout supervisor
    if (timeoutMs > 0 && pid > 0) {
      timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        this.terminateProcessGroup(pid, "SIGTERM");
        escalationTimer = setTimeout(() => {
          this.terminateProcessGroup(pid, "SIGKILL");
        }, 2000);
      }, timeoutMs);
    }

    const waitPromise = new Promise<IToolExecutionResult>((resolve) => {
      child.on("close", (code, signal) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (escalationTimer) clearTimeout(escalationTimer);
        logStream?.end();

        const durationMs = Date.now() - startTime;
        const processLayer = plan.isProtonOrWine ? "proton-runtime" : "native-tool";

        // Classify process exit
        const diagnostic = classifyProcessExit({
          executable: plan.executable,
          processLayer,
          exitCode: code,
          signal: signal as string | null,
          timedOut: isTimedOut,
          outputSnippet: (stderrBuffer || stdoutBuffer).slice(-500),
        });

        const success = code === 0 && !isTimedOut && !isCancelled;
        const failureExplanation = success
          ? undefined
          : isCancelled
            ? "Process was cancelled by user request."
            : isTimedOut
              ? `Process timed out after ${timeoutMs}ms and was terminated.`
              : diagnostic.userFacingMessage;

        resolve({
          success,
          exitCode: code,
          signal: signal as string | null,
          timedOut: isTimedOut,
          cancelled: isCancelled,
          durationMs,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          logFilePath: plan.logFilePath,
          diagnostic,
          failureExplanation,
        });
      });

      child.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (escalationTimer) clearTimeout(escalationTimer);
        logStream?.end();

        const durationMs = Date.now() - startTime;
        const processLayer = plan.isProtonOrWine ? "proton-runtime" : "native-tool";

        const diagnostic = classifyProcessExit({
          executable: plan.executable,
          processLayer,
          exitCode: -1,
          outputSnippet: err.message,
        });

        resolve({
          success: false,
          exitCode: -1,
          signal: null,
          timedOut: false,
          cancelled: false,
          durationMs,
          stdout: stdoutBuffer,
          stderr: stderrBuffer + "\n" + err.message,
          logFilePath: plan.logFilePath,
          diagnostic,
          failureExplanation: `Spawn error: ${err.message}`,
        });
      });
    });

    return {
      operationId,
      pid,
      cancel: async (_reason?: string) => {
        if (pid <= 0) return;
        isCancelled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        this.terminateProcessGroup(pid, "SIGTERM");
        escalationTimer = setTimeout(() => {
          this.terminateProcessGroup(pid, "SIGKILL");
        }, 2000);
      },
      wait: () => waitPromise,
    };
  }

  /**
   * Sends POSIX signals to an entire process group using negative PID.
   */
  private terminateProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
    try {
      // Negative PID targets the entire process group created by detached: true
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Process might already be dead
      }
    }
  }
}
