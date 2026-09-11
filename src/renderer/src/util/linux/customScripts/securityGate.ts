import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import { signalManagedProcessTree } from "../processTree";
import {
  ApprovalRevokedError,
  type ICustomScriptManifest,
  type IScriptApprovalRecord,
  type IScriptExecutionContext,
  type IScriptExecutionPreview,
  type IScriptExecutionResult,
  SafeModeActiveError,
  ScriptExecutionForbiddenError,
  sha256,
} from "./contracts";
import { redactScriptOutput, sanitizeScriptEnvironment } from "./environmentSanitization";
import { createEphemeralWorkspace, type IEphemeralWorkspace } from "./ephemeralWorkspace";
import {
  assertNoPrivilegeEscalation,
  assertPathNotForbidden,
  assertPathWithinDeclaredRoots,
  assertPrefixIsolation,
} from "./forbiddenAreas";
import { createAtomicSaveBackup, type ISaveBackupResult, restoreSaveBackup } from "./saveBackup";
import {
  type ITransactionalPlan,
  prepareTransactionalPlan,
  rollbackTransactionalWrites,
  verifyAndCommitWrites,
} from "./transactionalWrites";

export interface IExecuteScriptOptions {
  platform?: NodeJS.Platform;
  abortSignal?: AbortSignal;
}

/**
 * Computes deterministic cryptographic hash of a script's source content.
 */
export function computeScriptContentHash(content: string): string {
  return sha256(content);
}

/**
 * Computes deterministic cryptographic hash of a script's declarative manifest.
 * Used for Control 9 (Approval invalidation upon manifest tampering).
 */
export function computeManifestHash(manifest: ICustomScriptManifest): string {
  const normalized = {
    id: manifest.id,
    version: manifest.version,
    adapterVersion: manifest.adapterVersion ?? "",
    interpreter: manifest.interpreter,
    arguments: manifest.arguments,
    workingDirectory: manifest.workingDirectory ?? "",
    timeoutMs: manifest.timeoutMs,
    environmentAllowlist: (manifest.environmentAllowlist ?? []).slice().sort(),
    allowedReadRoots: manifest.allowedReadRoots.slice().sort(),
    allowedWriteRoots: manifest.allowedWriteRoots.slice().sort(),
    expectedOutputs: (manifest.expectedOutputs ?? []).slice().sort(),
    networkAccess: manifest.networkAccess ?? false,
    requiresProtonPrefix: manifest.requiresProtonPrefix ?? false,
    touchesSaveFiles: manifest.touchesSaveFiles ?? false,
    lifecycleEvents: manifest.lifecycleEvents.slice().sort(),
  };
  return sha256(JSON.stringify(normalized));
}

/**
 * Checks whether Safe Mode is currently active via context, environment, or command line (Control 10).
 */
export function isSafeModeActive(context?: IScriptExecutionContext): boolean {
  if (context?.safeMode === true) {
    return true;
  }
  if (process.env.VORTEX_SAFE_MODE === "1" || process.env.VORTEX_SAFE_MODE === "true") {
    return true;
  }
  if (process.argv && process.argv.includes("--safe-mode")) {
    return true;
  }
  return false;
}

/**
 * Validates whether an existing approval record remains valid for the current script content and manifest.
 * Enforces Control 9 (Approval invalidation).
 */
export function validateScriptApproval(
  approval: IScriptApprovalRecord,
  manifest: ICustomScriptManifest,
  currentContent: string,
): { valid: boolean; reason?: string } {
  if (approval.status !== "approved") {
    return { valid: false, reason: `Script approval status is '${approval.status}'` };
  }

  const currentContentHash = computeScriptContentHash(currentContent);
  if (approval.contentHash !== currentContentHash) {
    return {
      valid: false,
      reason: "Script executable content has changed since approval (hash mismatch)",
    };
  }

  const currentManifestHash = computeManifestHash(manifest);
  if (approval.manifestHash !== currentManifestHash) {
    return {
      valid: false,
      reason: "Script manifest specifications have changed since approval",
    };
  }

  if (approval.interpreter !== manifest.interpreter) {
    return { valid: false, reason: "Script interpreter has changed" };
  }

  if (JSON.stringify(approval.arguments) !== JSON.stringify(manifest.arguments)) {
    return { valid: false, reason: "Script arguments have changed" };
  }

  return { valid: true };
}

/**
 * Records user approval for a script manifest and content (Control 1).
 */
export function createScriptApproval(
  manifest: ICustomScriptManifest,
  scriptContent: string,
  approvedBy = "user-interactive",
): IScriptApprovalRecord {
  return {
    scriptId: manifest.id,
    manifestHash: computeManifestHash(manifest),
    contentHash: computeScriptContentHash(scriptContent),
    approvedAt: new Date().toISOString(),
    approvedBy,
    interpreter: manifest.interpreter,
    arguments: [...manifest.arguments],
    allowedReadRoots: [...manifest.allowedReadRoots],
    allowedWriteRoots: [...manifest.allowedWriteRoots],
    lifecycleEvents: [...manifest.lifecycleEvents],
    adapterVersion: manifest.adapterVersion,
    status: "approved",
  };
}

/**
 * Generates an exact pre-execution audit preview (Control 4).
 */
export function generateScriptPreview(
  manifest: ICustomScriptManifest,
  context: IScriptExecutionContext,
  approval?: IScriptApprovalRecord,
  scriptContent = "",
): IScriptExecutionPreview {
  const contentHash = computeScriptContentHash(scriptContent);
  const manifestHash = computeManifestHash(manifest);
  const rejectionReasons: string[] = [];

  // 1. Safe mode evaluation (Control 10)
  if (isSafeModeActive(context)) {
    rejectionReasons.push("Safe mode is active: all custom script execution is disabled");
  }

  // 2. Trigger source evaluation (Control 1)
  if (context.triggerSource !== "user-direct") {
    rejectionReasons.push(
      `Direct user action required: triggered by unprivileged source '${context.triggerSource}'`,
    );
  }

  // 3. Privilege escalation check (Control 13)
  try {
    assertNoPrivilegeEscalation(manifest.interpreter, manifest.arguments, scriptContent);
  } catch (err: any) {
    rejectionReasons.push(err.message);
  }

  // 4. Host boundary verification for declared roots (Control 2 & Control 3)
  for (const r of manifest.allowedReadRoots) {
    try {
      assertPathNotForbidden(r);
    } catch (err: any) {
      rejectionReasons.push(`Readable root violates forbidden host boundary: ${err.message}`);
    }
  }
  for (const w of manifest.allowedWriteRoots) {
    try {
      assertPathNotForbidden(w);
    } catch (err: any) {
      rejectionReasons.push(`Writable root violates forbidden host boundary: ${err.message}`);
    }
  }

  // 5. Prefix boundary check (Control 6)
  if (context.prefixPath) {
    for (const p of [...manifest.allowedReadRoots, ...manifest.allowedWriteRoots]) {
      try {
        assertPrefixIsolation(p, context.prefixPath);
      } catch (err: any) {
        rejectionReasons.push(`Prefix isolation error: ${err.message}`);
      }
    }
  }

  // 6. Approval check (Control 1 & Control 9)
  let approvalStatus: IScriptApprovalRecord["status"] = approval?.status ?? "pending_approval";
  if (approval) {
    const val = validateScriptApproval(approval, manifest, scriptContent);
    if (!val.valid) {
      approvalStatus = "revoked";
      rejectionReasons.push(`Approval invalid: ${val.reason}`);
    }
  } else {
    rejectionReasons.push("Script has not been approved by direct user confirmation");
  }

  const canExecute = rejectionReasons.length === 0;

  return {
    scriptIdentity: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      source: `${manifest.source.type}${manifest.source.id ? `:${manifest.source.id}` : ""}`,
      contentHash,
      manifestHash,
    },
    command: {
      interpreter: manifest.interpreter,
      arguments: manifest.arguments,
      workingDirectory: manifest.workingDirectory ?? "ephemeral_workspace",
    },
    lifecycleEvent: context.lifecycleEvent,
    environmentAllowlist: manifest.environmentAllowlist ?? [],
    filesystem: {
      readableRoots: manifest.allowedReadRoots,
      writableRoots: manifest.allowedWriteRoots,
      touchesSaveFiles: Boolean(manifest.touchesSaveFiles),
    },
    networkAccess: Boolean(manifest.networkAccess),
    timeoutMs: manifest.timeoutMs,
    expectedOutputs: manifest.expectedOutputs ?? [],
    transaction: {
      willJournal: true,
      willBackupOutputs: (manifest.expectedOutputs ?? []).length > 0,
      willBackupSaves: Boolean(manifest.touchesSaveFiles && context.saveRoots?.length),
      rollbackSupported: true,
    },
    cleanupPlan: "Per-operation ephemeral workspace will be purged recursively upon termination",
    approvalStatus,
    canExecute,
    rejectionReasons,
    isPredictableDryRun: !manifest.scriptContent?.includes("rm -rf"),
  };
}

/**
 * Main execution orchestrator enforcing all 13 controls of the Custom Script Security Gate.
 */
export async function executeCustomScript(
  manifest: ICustomScriptManifest,
  scriptContent: string,
  context: IScriptExecutionContext,
  approval: IScriptApprovalRecord,
  options: IExecuteScriptOptions = {},
): Promise<IScriptExecutionResult> {
  const startTime = Date.now();
  const operationId = crypto.randomBytes(8).toString("hex");
  const diagnostics: string[] = [];

  // CONTROL 10: Safe mode check
  if (isSafeModeActive(context)) {
    throw new SafeModeActiveError();
  }

  // CONTROL 13: Privilege escalation check
  assertNoPrivilegeEscalation(manifest.interpreter, manifest.arguments, scriptContent);

  // CONTROL 1: No automatic execution - must originate from direct user action
  if (context.triggerSource !== "user-direct") {
    throw new ScriptExecutionForbiddenError(
      `Automated script execution rejected: source '${context.triggerSource}' cannot execute scripts`,
    );
  }

  // CONTROL 1 & 9: Approval validation
  const approvalValidation = validateScriptApproval(approval, manifest, scriptContent);
  if (!approvalValidation.valid) {
    throw new ApprovalRevokedError(approvalValidation.reason ?? "Approval invalid");
  }

  // CONTROL 2 & 3: Minimum filesystem permissions & forbidden host areas
  for (const readRoot of manifest.allowedReadRoots) {
    assertPathNotForbidden(readRoot);
  }
  for (const writeRoot of manifest.allowedWriteRoots) {
    assertPathNotForbidden(writeRoot);
  }

  // CONTROL 6: Isolated Proton/Wine prefixes
  if (context.prefixPath) {
    for (const p of [...manifest.allowedReadRoots, ...manifest.allowedWriteRoots]) {
      assertPrefixIsolation(p, context.prefixPath);
    }
  }

  // CONTROL 12: Dry run and declared effects preview
  if (context.dryRun) {
    return {
      success: true,
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      dryRun: true,
      stdout: "[DRY RUN] Script execution simulated without side effects.",
      stderr: "",
      createdFiles: [],
      modifiedFiles: [],
      rolledBack: false,
      diagnostics: ["Dry run completed successfully"],
      durationMs: Date.now() - startTime,
      operationId,
    };
  }

  // Ephemeral workspace setup
  let workspace: IEphemeralWorkspace | undefined;
  let saveBackupResult: ISaveBackupResult | undefined;
  let transactionalPlan: ITransactionalPlan | undefined;

  try {
    workspace = await createEphemeralWorkspace(manifest.id, scriptContent);

    // Verify workspace integrity
    const expectedHash = computeScriptContentHash(scriptContent);
    if (workspace.scriptChecksum !== expectedHash) {
      throw new ApprovalRevokedError("Staged workspace script content mismatch");
    }

    // CONTROL 11: Save backup before risky actions
    if (manifest.touchesSaveFiles && context.saveRoots && context.saveRoots.length > 0) {
      saveBackupResult = await createAtomicSaveBackup(
        context.saveRoots,
        context.profilePath,
        manifest.id,
      );
      if (saveBackupResult) {
        diagnostics.push(
          `Created atomic save backup with ${saveBackupResult.backedUpFilesCount} files`,
        );
      }
    }

    // CONTROL 5: Transactional managed-file writes (pre-execution snapshots)
    transactionalPlan = await prepareTransactionalPlan(manifest, context, workspace.workspacePath);

    // CONTROL 7: Sanitized process environment
    const sanitizedEnv = sanitizeScriptEnvironment(manifest, context, workspace.workspacePath);

    // Execution working directory: prefer workspace or validated custom directory
    const workingDir = manifest.workingDirectory
      ? manifest.workingDirectory
      : workspace.workspacePath;
    assertPathNotForbidden(workingDir, workspace.workspacePath);

    // CONTROL 8: Process execution with process group supervisor & timeout
    const executionOutcome = await runScriptProcessWithTimeout({
      interpreter: manifest.interpreter,
      scriptPath: workspace.scriptFilePath,
      args: manifest.arguments,
      cwd: workingDir,
      env: sanitizedEnv,
      timeoutMs: manifest.timeoutMs,
      abortSignal: options.abortSignal,
    });

    // Check if execution failed or timed out
    if (!executionOutcome.success) {
      // CONTROL 5: Roll back transactional changes
      await rollbackTransactionalWrites(transactionalPlan);
      if (saveBackupResult && context.saveRoots) {
        await restoreSaveBackup(context.saveRoots, saveBackupResult.backupDirectory);
      }

      return {
        success: false,
        exitCode: executionOutcome.exitCode,
        timedOut: executionOutcome.timedOut,
        cancelled: executionOutcome.cancelled,
        dryRun: false,
        stdout: redactScriptOutput(executionOutcome.stdout),
        stderr: redactScriptOutput(executionOutcome.stderr),
        createdFiles: [],
        modifiedFiles: [],
        rolledBack: true,
        diagnostics: [...diagnostics, "Execution failed or timed out; state safely rolled back."],
        durationMs: Date.now() - startTime,
        operationId,
      };
    }

    // CONTROL 5: Verify and commit outputs
    try {
      const writeVerification = await verifyAndCommitWrites(
        transactionalPlan,
        manifest,
        context,
        workspace.workspacePath,
      );

      return {
        success: true,
        exitCode: executionOutcome.exitCode,
        timedOut: false,
        cancelled: false,
        dryRun: false,
        stdout: redactScriptOutput(executionOutcome.stdout),
        stderr: redactScriptOutput(executionOutcome.stderr),
        createdFiles: writeVerification.createdFiles,
        modifiedFiles: writeVerification.modifiedFiles,
        rolledBack: false,
        diagnostics: [...diagnostics, "Execution completed successfully."],
        durationMs: Date.now() - startTime,
        operationId,
      };
    } catch (err: any) {
      // Automatic rollback if unexpected outputs or mutations were detected
      await rollbackTransactionalWrites(transactionalPlan);
      if (saveBackupResult && context.saveRoots) {
        await restoreSaveBackup(context.saveRoots, saveBackupResult.backupDirectory);
      }

      return {
        success: false,
        exitCode: executionOutcome.exitCode,
        timedOut: false,
        cancelled: false,
        dryRun: false,
        stdout: redactScriptOutput(executionOutcome.stdout),
        stderr: redactScriptOutput(err.message),
        createdFiles: [],
        modifiedFiles: [],
        rolledBack: true,
        diagnostics: [
          ...diagnostics,
          `Output verification failed: ${err.message}. Changes safely rolled back.`,
        ],
        durationMs: Date.now() - startTime,
        operationId,
      };
    }
  } finally {
    // Ephemeral workspace cleanup
    if (workspace) {
      await workspace.cleanup();
    }
  }
}

interface IProcessRunResult {
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Spawns child in an isolated POSIX process group and terminates it cleanly upon timeout (Control 8).
 */
async function runScriptProcessWithTimeout(params: {
  interpreter: string;
  scriptPath: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<IProcessRunResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let cancelled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let timeoutTimer: NodeJS.Timeout | undefined;

    // Spawn detached process group
    const child = spawn(params.interpreter, [params.scriptPath, ...params.args], {
      cwd: params.cwd,
      env: params.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const terminateChild = (signal: "SIGTERM" | "SIGKILL") => {
      if (child.pid) {
        signalManagedProcessTree(child.pid, signal);
      }
    };

    // Timeout supervisor
    if (params.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateChild("SIGTERM");
        setTimeout(() => terminateChild("SIGKILL"), 1500).unref();
      }, params.timeoutMs);
    }

    // Cancellation support
    if (params.abortSignal) {
      params.abortSignal.addEventListener("abort", () => {
        cancelled = true;
        terminateChild("SIGTERM");
        setTimeout(() => terminateChild("SIGKILL"), 1500).unref();
      });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBuffer.length < 100_000) {
        stdoutBuffer += chunk.toString("utf8");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuffer.length < 100_000) {
        stderrBuffer += chunk.toString("utf8");
      }
    });

    child.on("close", (exitCode) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      resolve({
        success: exitCode === 0 && !timedOut && !cancelled,
        exitCode,
        timedOut,
        cancelled,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      });
    });

    child.on("error", (err) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      resolve({
        success: false,
        exitCode: -1,
        timedOut,
        cancelled,
        stdout: stdoutBuffer,
        stderr: err.message,
      });
    });
  });
}
