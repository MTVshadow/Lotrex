import * as crypto from "node:crypto";

/**
 * Supported lifecycle hook events for custom scripts.
 */
export type ScriptLifecycleEvent =
  | "before-install"
  | "after-install"
  | "before-deploy"
  | "after-deploy"
  | "before-purge"
  | "after-purge"
  | "before-tool-launch"
  | "after-tool-launch"
  | "before-game-launch"
  | "after-game-launch"
  | "before-backup"
  | "after-backup"
  | "before-profile-switch"
  | "after-profile-switch"
  | "manual";

/**
 * The initiating origin of a script execution attempt.
 * Only "user-direct" is permitted to approve or execute scripts (Control 1).
 */
export type ScriptTriggerSource =
  | "user-direct"
  | "mod"
  | "collection"
  | "adapter"
  | "imported-profile"
  | "update"
  | "dependency-install";

/**
 * Approval status of a custom script manifest.
 */
export type ScriptApprovalStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "revoked"
  | "disabled";

/**
 * Declarative manifest describing a custom script, its permissions, requirements, and outputs.
 */
export interface ICustomScriptManifest {
  /** Unique script identifier */
  id: string;
  /** Human-readable script name */
  name: string;
  /** Script version */
  version: string;
  /** Optional description */
  description?: string;
  /** Expected game adapter version if bound to an adapter */
  adapterVersion?: string;
  /** Origin metadata */
  source: {
    type: "user" | "mod" | "collection" | "adapter" | "profile";
    id?: string;
  };
  /** Lifecycle hook events where this script is eligible to execute */
  lifecycleEvents: ScriptLifecycleEvent[];
  /** Interpreter executable (e.g. /bin/bash, /usr/bin/python3, node) */
  interpreter: string;
  /** Inlined script source code or relative path to script file */
  scriptContent?: string;
  /** Optional relative path to script source within staging/mod area */
  scriptPath?: string;
  /** Structured argument list (no shell concatenation allowed) */
  arguments: string[];
  /** Optional working directory */
  workingDirectory?: string;
  /** Execution timeout limit in milliseconds */
  timeoutMs: number;
  /** Optional allowed environment variables to inherit from host */
  environmentAllowlist?: string[];
  /** Static environment variables declared by the script */
  declaredEnvironment?: Record<string, string>;
  /** Explicitly declared directory roots granted for read access */
  allowedReadRoots: string[];
  /** Explicitly declared directory roots granted for write access */
  allowedWriteRoots: string[];
  /** Expected files created or modified by this script */
  expectedOutputs?: string[];
  /** Whether outbound network access is requested */
  networkAccess?: boolean;
  /** Whether script requires Proton/Wine prefix binding */
  requiresProtonPrefix?: boolean;
  /** Whether script modifies or accesses game save files */
  touchesSaveFiles?: boolean;
}

/**
 * Persisted cryptographic record of a user's approval of a custom script.
 */
export interface IScriptApprovalRecord {
  scriptId: string;
  manifestHash: string;
  contentHash: string;
  approvedAt: string;
  approvedBy: string;
  interpreter: string;
  arguments: string[];
  allowedReadRoots: string[];
  allowedWriteRoots: string[];
  lifecycleEvents: ScriptLifecycleEvent[];
  adapterVersion?: string;
  status: ScriptApprovalStatus;
}

/**
 * Runtime execution context provided by Lotrex.
 */
export interface IScriptExecutionContext {
  gameId: string;
  gameInstallPath: string;
  stagingPath: string;
  profilePath: string;
  saveRoots?: string[];
  prefixPath?: string;
  triggerSource: ScriptTriggerSource;
  lifecycleEvent: ScriptLifecycleEvent;
  safeMode?: boolean;
  dryRun?: boolean;
  customRoots?: string[];
}

/**
 * Pre-execution audit preview presented to user before approval or execution (Control 4).
 */
export interface IScriptExecutionPreview {
  scriptIdentity: {
    id: string;
    name: string;
    version: string;
    source: string;
    contentHash: string;
    manifestHash: string;
  };
  command: {
    interpreter: string;
    arguments: string[];
    workingDirectory: string;
  };
  lifecycleEvent: ScriptLifecycleEvent;
  environmentAllowlist: string[];
  filesystem: {
    readableRoots: string[];
    writableRoots: string[];
    touchesSaveFiles: boolean;
  };
  networkAccess: boolean;
  timeoutMs: number;
  expectedOutputs: string[];
  transaction: {
    willJournal: boolean;
    willBackupOutputs: boolean;
    willBackupSaves: boolean;
    rollbackSupported: boolean;
  };
  cleanupPlan: string;
  approvalStatus: ScriptApprovalStatus;
  canExecute: boolean;
  rejectionReasons: string[];
  isPredictableDryRun: boolean;
}

/**
 * Result of script execution with telemetry and audit diagnostics.
 */
export interface IScriptExecutionResult {
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  dryRun: boolean;
  stdout: string;
  stderr: string;
  createdFiles: string[];
  modifiedFiles: string[];
  rolledBack: boolean;
  diagnostics: string[];
  durationMs: number;
  operationId: string;
}

/**
 * Base security exception for Custom Script Security Gate.
 */
export class CustomScriptSecurityError extends Error {
  public readonly code: string;
  constructor(message: string, code = "ESCRIPTSECURITY") {
    super(message);
    this.name = "CustomScriptSecurityError";
    this.code = code;
  }
}

/**
 * Control 1: No automatic execution violation.
 */
export class ScriptExecutionForbiddenError extends CustomScriptSecurityError {
  constructor(message: string) {
    super(message, "ESCRIPTNOAUTOEXEC");
    this.name = "ScriptExecutionForbiddenError";
  }
}

/**
 * Control 2: Undeclared or unpermitted filesystem access.
 */
export class PermissionBoundaryError extends CustomScriptSecurityError {
  public readonly attemptedPath: string;
  constructor(message: string, attemptedPath: string) {
    super(message, "ESCRIPTPERMISSIONBOUNDARY");
    this.name = "PermissionBoundaryError";
    this.attemptedPath = attemptedPath;
  }
}

/**
 * Control 3: Forbidden host areas violation (e.g. /, ~/.ssh, /etc, keyrings).
 */
export class ForbiddenHostAreaError extends CustomScriptSecurityError {
  public readonly attemptedPath: string;
  constructor(message: string, attemptedPath: string) {
    super(message, "ESCRIPTFORBIDDENHOSTAREA");
    this.name = "ForbiddenHostAreaError";
    this.attemptedPath = attemptedPath;
  }
}

/**
 * Control 6: Wine/Proton prefix isolation violation.
 */
export class PrefixBoundaryError extends CustomScriptSecurityError {
  public readonly attemptedPath: string;
  constructor(message: string, attemptedPath: string) {
    super(message, "ESCRIPTPREFIXBOUNDARY");
    this.name = "PrefixBoundaryError";
    this.attemptedPath = attemptedPath;
  }
}

/**
 * Control 9: Approval invalidation due to changes in content or manifest.
 */
export class ApprovalRevokedError extends CustomScriptSecurityError {
  public readonly reason: string;
  constructor(reason: string) {
    super(`Custom script approval has been revoked: ${reason}`, "ESCRIPTAPPROVALREVOKED");
    this.name = "ApprovalRevokedError";
    this.reason = reason;
  }
}

/**
 * Control 10: Safe mode active rejection.
 */
export class SafeModeActiveError extends CustomScriptSecurityError {
  constructor(
    message = "Safe mode is active: all custom script execution and automation is disabled",
  ) {
    super(message, "ESCRIPTSAFEMODE");
    this.name = "SafeModeActiveError";
  }
}

/**
 * Control 13: Privilege escalation (sudo/pkexec/doas) attempt.
 */
export class PrivilegeEscalationForbiddenError extends CustomScriptSecurityError {
  public readonly commandOrArg: string;
  constructor(commandOrArg: string) {
    super(
      `Privileged command execution (sudo/pkexec/doas/su) is strictly prohibited: ${commandOrArg}`,
      "ESCRIPTPRIVILEGEESCALATION",
    );
    this.name = "PrivilegeEscalationForbiddenError";
    this.commandOrArg = commandOrArg;
  }
}

/**
 * Calculates SHA-256 hash for raw content.
 */
export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
