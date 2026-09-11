import * as path from "node:path";

/**
 * Supported owning launcher types on Linux (Phase 3).
 */
export type LauncherType = "steam" | "heroic" | "lutris" | "bottles" | "manual";

/**
 * Normalized launch request containing all parameters required to produce a safe launch plan.
 * Launcher providers receive this request to generate execution plans without owning mod semantics.
 */
export interface ILauncherLaunchRequest {
  launcher: LauncherType;
  gameId: string;
  editionId?: string;
  installPath: string;
  executablePath: string;
  isWindows: boolean;
  commandLine?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  prefixPath?: string;
  runtimePath?: string; // Path to Proton directory or wine binary
  bottleName?: string; // Specific to Bottles
  appId?: string; // Steam/Heroic/Lutris App identifier
}

/**
 * Standardized, safe, explainable launch plan produced by a launcher provider (Phase 3).
 * Normalizes native executable, Proton, Wine prefix, environment, working directory,
 * and structured arguments without shell concatenation.
 */
export interface ILaunchPlan {
  /** Owning launcher provider that created this plan */
  launcher: LauncherType;
  /** Primary executable to invoke */
  executable: string;
  /** Structured argument vector (no shell concatenation allowed) */
  arguments: string[];
  /** Sanitized environment variables */
  environment: Record<string, string>;
  /** Resolved working directory */
  workingDirectory: string;
  /** Wine or Proton prefix path if applicable */
  prefixPath?: string;
  /** Proton runtime or Wine binary directory if applicable */
  runtimePath?: string;
  /** Human-readable technical explanation of how and why the launch was structured */
  explanation: string;
  /** Whether the plan is safe for dry-run simulation */
  isDryRunSafe: boolean;
}

/**
 * Contract for a launcher provider adapter (Phase 3).
 * Providers discover and launch, but MUST NOT own mod semantics.
 */
export interface ILauncherProvider {
  readonly launcherType: LauncherType;
  readonly displayName: string;
  generateLaunchPlan(request: ILauncherLaunchRequest): Promise<ILaunchPlan>;
}

/**
 * Validates command line arguments to eliminate null bytes, newlines, and shell injection sequences.
 */
export function assertSafeCommandLineArgs(args: string[]): void {
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new Error(`Invalid non-string argument encountered: ${String(arg)}`);
    }
    if (/[\0\r\n]/.test(arg)) {
      throw new Error(`Command line argument contains forbidden control characters: ${arg}`);
    }
  }
}
