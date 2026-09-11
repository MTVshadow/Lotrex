import type { ILaunchPlan, LauncherType } from "../launcherProviders/contracts";
import type { IProcessExitDiagnostic } from "../processDiagnostics";

/**
 * Standard request for launching an external modding tool or game binary (Phase 6).
 * Accepts per-tool runtime/prefix overrides and inherited environments without shell concatenation.
 */
export interface IToolLaunchRequest {
  toolId: string;
  toolName: string;
  executablePath: string;
  commandLine?: string[];
  workingDirectory?: string;
  environmentOverrides?: Record<string, string>;
  runtimeOverride?: string; // e.g. "GE-Proton9-11", "wine-staging", "system"
  prefixOverride?: string; // e.g. dedicated wine prefix for tool
  isWindowsBinary?: boolean;
  gameId: string;
  gameInstallPath: string;
  defaultRuntime?: string;
  defaultPrefixPath?: string;
  inheritedEnvironment?: Record<string, string>;
  timeoutMs?: number;
  dllOverrides?: Record<string, string>;
}

/**
 * Trusted tool launch plan extending the core ILaunchPlan (Phase 6).
 * Always vector-based, never concatenated to a raw shell command.
 */
export interface IToolLaunchPlan extends ILaunchPlan {
  toolId: string;
  toolName: string;
  isProtonOrWine: boolean;
  logFilePath: string;
}

/**
 * Preview summary for dry-run inspection before execution.
 */
export interface IToolPlanPreview {
  plan: IToolLaunchPlan;
  effectiveRuntime: string;
  effectivePrefix: string;
  warnings: string[];
  sanitizedEnvironment: Record<string, string>;
}

/**
 * Complete outcome of tool execution with process exit classification.
 */
export interface IToolExecutionResult {
  success: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  logFilePath: string;
  diagnostic: IProcessExitDiagnostic;
  failureExplanation?: string;
}

/**
 * Active process handle providing cancellation and wait supervisor.
 */
export interface IToolExecutionHandle {
  operationId: string;
  pid: number;
  cancel: (reason?: string) => Promise<void>;
  wait: () => Promise<IToolExecutionResult>;
}
