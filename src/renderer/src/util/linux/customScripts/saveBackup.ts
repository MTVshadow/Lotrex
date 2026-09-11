import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ISaveBackupResult {
  backupDirectory: string;
  backedUpFilesCount: number;
  restored: boolean;
}

/**
 * Creates an atomic identified backup of game save directories before risky script operations.
 * Enforces Control 11 (Save backup before risky actions).
 *
 * @param saveRoots List of game-specific save directories detected by the adapter.
 * @param backupParentDir Directory where save backups are stored (e.g. inside profile directory).
 * @param scriptId Identifying slug of the executing script.
 * @param maxBackups Retention limit for older backups (pruned after creation).
 */
export async function createAtomicSaveBackup(
  saveRoots: string[],
  backupParentDir: string,
  scriptId: string,
  maxBackups = 5,
): Promise<ISaveBackupResult | undefined> {
  if (!saveRoots || saveRoots.length === 0) {
    return undefined;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sanitizedId = scriptId.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const backupDirName = `save-backup-${timestamp}-${sanitizedId}`;
  const backupDirectory = path.join(backupParentDir, "save_backups", backupDirName);

  await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });

  let fileCount = 0;

  for (let i = 0; i < saveRoots.length; i++) {
    const saveRoot = saveRoots[i];
    try {
      const stats = await fs.stat(saveRoot);
      if (!stats.isDirectory()) continue;

      const targetSubdir = path.join(backupDirectory, `root_${i}`);
      await fs.mkdir(targetSubdir, { recursive: true, mode: 0o700 });

      // Copy save files recursively, avoiding cloud credentials and hidden files
      fileCount += await copySaveFilesRecursively(saveRoot, targetSubdir);
    } catch {
      // If save root does not exist, continue
    }
  }

  // Prune older backups according to retention policy
  await pruneOldSaveBackups(path.join(backupParentDir, "save_backups"), maxBackups);

  return {
    backupDirectory,
    backedUpFilesCount: fileCount,
    restored: false,
  };
}

/**
 * Restores game saves from an atomic backup directory if a script failed or corrupted state.
 */
export async function restoreSaveBackup(
  saveRoots: string[],
  backupDirectory: string,
): Promise<void> {
  for (let i = 0; i < saveRoots.length; i++) {
    const targetSubdir = path.join(backupDirectory, `root_${i}`);
    const saveRoot = saveRoots[i];
    try {
      const stats = await fs.stat(targetSubdir);
      if (stats.isDirectory()) {
        await copySaveFilesRecursively(targetSubdir, saveRoot);
      }
    } catch {
      // Ignored if root not backed up
    }
  }
}

/**
 * Copies save files recursively, strictly excluding cloud tokens, credentials, and unrelated state.
 */
async function copySaveFilesRecursively(src: string, dest: string): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip cloud credentials and auth tokens
    const lower = entry.name.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("credential") ||
      lower.includes("auth") ||
      lower.startsWith(".")
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true, mode: 0o700 });
      count += await copySaveFilesRecursively(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/**
 * Retains only the most recent N backups, pruning older ones.
 */
async function pruneOldSaveBackups(backupsDir: string, maxRetention: number): Promise<void> {
  try {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const backupDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("save-backup-"))
      .map((e) => e.name)
      .sort(); // Lexicographical sort corresponds to chronological ISO timestamps

    if (backupDirs.length > maxRetention) {
      const toRemove = backupDirs.slice(0, backupDirs.length - maxRetention);
      for (const name of toRemove) {
        await fs.rm(path.join(backupsDir, name), { recursive: true, force: true });
      }
    }
  } catch {
    // Non-fatal if backups dir does not exist
  }
}
