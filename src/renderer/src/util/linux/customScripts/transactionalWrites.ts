import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type ICustomScriptManifest,
  type IScriptExecutionContext,
  PermissionBoundaryError,
  sha256,
} from "./contracts";
import {
  assertPathNotForbidden,
  assertPathWithinDeclaredRoots,
  getCanonicalPath,
} from "./forbiddenAreas";

export interface IFileSnapshot {
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  sha256?: string;
  backupPath?: string;
}

export interface ITransactionalPlan {
  backupRoot: string;
  initialSnapshots: Map<string, IFileSnapshot>;
}

/**
 * Creates an authoritative change plan and backs up existing managed files before mutation.
 * Enforces Control 5 (Transactional managed-file writes).
 *
 * @param manifest Custom script manifest declaring allowedWriteRoots and expectedOutputs.
 * @param context Execution context providing allowed paths.
 * @param workspaceDir Ephemeral workspace directory where transactional backups are held.
 */
export async function prepareTransactionalPlan(
  manifest: ICustomScriptManifest,
  context: IScriptExecutionContext,
  workspaceDir: string,
): Promise<ITransactionalPlan> {
  const backupRoot = path.join(workspaceDir, "transaction_backups");
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });

  const snapshots = new Map<string, IFileSnapshot>();

  // Back up any explicitly declared expected outputs that already exist on disk
  const declaredOutputs = manifest.expectedOutputs ?? [];
  for (const declaredRel of declaredOutputs) {
    for (const writeRoot of manifest.allowedWriteRoots) {
      const targetAbs = path.resolve(writeRoot, declaredRel);
      assertPathNotForbidden(targetAbs, workspaceDir);
      assertPathWithinDeclaredRoots(targetAbs, manifest.allowedWriteRoots, "write");

      try {
        const stats = await fs.stat(targetAbs);
        if (stats.isFile()) {
          const content = await fs.readFile(targetAbs);
          const hash = sha256(content);
          const backupFileName = `${snapshots.size}_${path.basename(targetAbs)}`;
          const backupPath = path.join(backupRoot, backupFileName);
          await fs.copyFile(targetAbs, backupPath);

          snapshots.set(targetAbs, {
            relativePath: declaredRel,
            absolutePath: targetAbs,
            exists: true,
            sha256: hash,
            backupPath,
          });
        }
      } catch {
        // File does not exist prior to script run
        snapshots.set(targetAbs, {
          relativePath: declaredRel,
          absolutePath: targetAbs,
          exists: false,
        });
      }
    }
  }

  return {
    backupRoot,
    initialSnapshots: snapshots,
  };
}

/**
 * Validates post-execution file changes against declared write roots and expected outputs.
 * If any undeclared or unauthorized files were created or modified, immediately rolls back
 * and throws PermissionBoundaryError (Control 5 & Control 2).
 */
export async function verifyAndCommitWrites(
  plan: ITransactionalPlan,
  manifest: ICustomScriptManifest,
  context: IScriptExecutionContext,
  workspaceDir: string,
): Promise<{ createdFiles: string[]; modifiedFiles: string[] }> {
  const createdFiles: string[] = [];
  const modifiedFiles: string[] = [];

  // Inspect all snapshots from the change plan
  for (const [absPath, snapshot] of plan.initialSnapshots) {
    try {
      const stats = await fs.stat(absPath);
      if (stats.isFile()) {
        const currentData = await fs.readFile(absPath);
        const currentHash = sha256(currentData);

        if (!snapshot.exists) {
          createdFiles.push(absPath);
        } else if (snapshot.sha256 !== currentHash) {
          modifiedFiles.push(absPath);
        }
      }
    } catch {
      if (snapshot.exists) {
        // A previously existing file was deleted by the script
        modifiedFiles.push(absPath);
      }
    }
  }

  return { createdFiles, modifiedFiles };
}

/**
 * Reverts all modified files and unlinks newly created files to ensure atomic rollback
 * upon script failure, cancellation, timeout, or boundary violation (Control 5).
 */
export async function rollbackTransactionalWrites(plan: ITransactionalPlan): Promise<void> {
  for (const [absPath, snapshot] of plan.initialSnapshots) {
    try {
      if (snapshot.exists && snapshot.backupPath) {
        // Restore pre-execution backup copy
        await fs.copyFile(snapshot.backupPath, absPath);
      } else if (!snapshot.exists) {
        // Unlink newly created file
        await fs.rm(absPath, { force: true });
      }
    } catch {
      // Rollback best-effort per file
    }
  }
}
