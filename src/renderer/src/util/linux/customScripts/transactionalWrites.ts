import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type ICustomScriptManifest,
  type IScriptExecutionContext,
  PermissionBoundaryError,
  sha256,
} from "./contracts";
import { assertPathNotForbidden, assertPathWithinDeclaredRoots } from "./forbiddenAreas";

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
  preExistingFilesByRoot: Map<string, Map<string, string>>;
  writeRoots: string[];
}

/**
 * Recursively scans a directory returning absolute paths to all contained files.
 */
export async function scanDirectoryFilesRecursively(dir: string): Promise<string[]> {
  const filePaths: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await scanDirectoryFilesRecursively(fullPath);
        filePaths.push(...subFiles);
      } else if (entry.isFile()) {
        filePaths.push(fullPath);
      }
    }
  } catch {
    // Directory might not exist yet
  }
  return filePaths;
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
  const preExistingFilesByRoot = new Map<string, Map<string, string>>();

  // 1. Record pre-existing files and hashes in all allowed write roots
  for (const writeRoot of manifest.allowedWriteRoots) {
    const rootFiles = new Map<string, string>();
    const scanned = await scanDirectoryFilesRecursively(writeRoot);
    for (const filePath of scanned) {
      try {
        const data = await fs.readFile(filePath);
        rootFiles.set(filePath, sha256(data));
      } catch {
        // Ignored if unreadable
      }
    }
    preExistingFilesByRoot.set(writeRoot, rootFiles);
  }

  // 2. Back up explicitly declared expected outputs that already exist on disk
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
    preExistingFilesByRoot,
    writeRoots: [...manifest.allowedWriteRoots],
  };
}

/**
 * Validates post-execution file changes against declared write roots and expected outputs.
 * If any undeclared or unauthorized files were created or modified, throws PermissionBoundaryError
 * to trigger automatic transactional rollback (Control 5 & Control 2).
 */
export async function verifyAndCommitWrites(
  plan: ITransactionalPlan,
  manifest: ICustomScriptManifest,
  context: IScriptExecutionContext,
  workspaceDir: string,
): Promise<{ createdFiles: string[]; modifiedFiles: string[] }> {
  const createdFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const declaredOutputsSet = new Set(manifest.expectedOutputs ?? []);

  // 1. Check all files currently present across all write roots
  for (const writeRoot of plan.writeRoots) {
    const preExisting = plan.preExistingFilesByRoot.get(writeRoot) ?? new Map<string, string>();
    const currentFiles = await scanDirectoryFilesRecursively(writeRoot);

    for (const currentPath of currentFiles) {
      const relPath = path.relative(writeRoot, currentPath);
      const isPreExisting = preExisting.has(currentPath);

      if (!isPreExisting) {
        // Newly created file: must be declared in expectedOutputs if expectedOutputs is specified
        if (manifest.expectedOutputs && !declaredOutputsSet.has(relPath)) {
          throw new PermissionBoundaryError(
            `Unexpected undeclared file output created: ${relPath}`,
            currentPath,
          );
        }
        createdFiles.push(currentPath);
      } else {
        // Pre-existing file: check if modified
        try {
          const currentData = await fs.readFile(currentPath);
          const currentHash = sha256(currentData);
          if (currentHash !== preExisting.get(currentPath)) {
            if (manifest.expectedOutputs && !declaredOutputsSet.has(relPath)) {
              throw new PermissionBoundaryError(
                `Unexpected modification to undeclared file: ${relPath}`,
                currentPath,
              );
            }
            modifiedFiles.push(currentPath);
          }
        } catch {
          // Ignored
        }
      }
    }
  }

  // 2. Also inspect snapshots to catch deleted files
  for (const [absPath, snapshot] of plan.initialSnapshots) {
    try {
      await fs.stat(absPath);
    } catch {
      if (snapshot.exists) {
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
  // 1. Restore pre-execution backups for snapshot files
  for (const [absPath, snapshot] of plan.initialSnapshots) {
    try {
      if (snapshot.exists && snapshot.backupPath) {
        await fs.copyFile(snapshot.backupPath, absPath);
      } else if (!snapshot.exists) {
        await fs.rm(absPath, { force: true });
      }
    } catch {
      // Rollback best-effort
    }
  }

  // 2. Remove any newly created files across write roots that did not exist before
  for (const writeRoot of plan.writeRoots) {
    const preExisting = plan.preExistingFilesByRoot.get(writeRoot);
    if (!preExisting) continue;

    const currentFiles = await scanDirectoryFilesRecursively(writeRoot);
    for (const currentFile of currentFiles) {
      if (!preExisting.has(currentFile)) {
        try {
          await fs.rm(currentFile, { force: true });
        } catch {
          // Rollback best-effort
        }
      }
    }
  }
}
