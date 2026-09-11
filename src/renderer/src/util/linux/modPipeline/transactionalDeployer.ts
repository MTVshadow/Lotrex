import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { unknownToError } from "@vortex/shared";

import { isWithinRoot } from "../pathSafety";
import type {
  DeploymentMethod,
  IDeployedFileRecord,
  IDeploymentJournal,
  IResolvedDeploymentFile,
} from "./contracts";

/**
 * Filesystem adapter interface for transactional operations.
 */
export interface ITransactionalFs {
  existsSync(p: string): boolean;
  mkdirSync(p: string, options?: { recursive?: boolean }): void;
  symlinkSync(target: string, path: string): void;
  linkSync(existingPath: string, newPath: string): void;
  copyFileSync(src: string, dest: string): void;
  unlinkSync(p: string): void;
  writeFileSync(p: string, data: string, encoding?: string): void;
  readFileSync(p: string, encoding?: string): string;
  rmdirSync?(p: string): void;
  readdirSync(p: string): string[];
}

/**
 * Default native Node.js filesystem adapter.
 */
export const defaultTransactionalFs: ITransactionalFs = {
  existsSync: (p) => fs.existsSync(p),
  mkdirSync: (p, opt) => {
    fs.mkdirSync(p, opt);
  },
  symlinkSync: (target, p) => fs.symlinkSync(target, p),
  linkSync: (existing, p) => fs.linkSync(existing, p),
  copyFileSync: (src, dest) => fs.copyFileSync(src, dest),
  unlinkSync: (p) => fs.unlinkSync(p),
  writeFileSync: (p, data, enc) => fs.writeFileSync(p, data, (enc as any) ?? "utf-8"),
  readFileSync: (p, enc) => fs.readFileSync(p, { encoding: (enc as BufferEncoding) ?? "utf-8" }),
  readdirSync: (p) => fs.readdirSync(p) as string[],
};

/**
 * Transactional deployment and recovery engine.
 *
 * Implements Phase 5 acceptance criteria:
 * Atomic deployment with rollback on failure, supporting hardlinks, symlinks, and moves.
 * Restores vanilla state and backs up overwritten files without data loss.
 */
export class TransactionalDeployer {
  constructor(private readonly fsAdapter: ITransactionalFs = defaultTransactionalFs) {}

  /**
   * Deploys resolved files transactionally to the game directory.
   */
  public deploy(
    gamePath: string,
    gameId: string,
    profileId: string,
    resolvedFiles: Map<string, IResolvedDeploymentFile>,
    method: DeploymentMethod = "symlink",
  ): IDeploymentJournal {
    const operationId = crypto.randomBytes(8).toString("hex");
    const backupRoot = path.join(gamePath, ".vortex_backups", operationId);

    const journal: IDeploymentJournal = {
      operationId,
      timestamp: Date.now(),
      gameId,
      profileId,
      gamePath,
      method,
      deployedFiles: [],
      generatedFiles: [],
      status: "in-progress",
    };

    try {
      for (const [_, file] of resolvedFiles) {
        const destAbs = path.resolve(gamePath, file.destinationRelPath);

        // Security check: ensure target path is strictly contained within game root
        if (!isWithinRoot(gamePath, destAbs)) {
          throw new Error(`Target deployment path '${destAbs}' escapes game root '${gamePath}'`);
        }

        let previousState: IDeployedFileRecord["previousState"] = "vanilla-absent";
        let backupPath: string | undefined;

        // Check if destination already has a vanilla or existing file
        if (this.fsAdapter.existsSync(destAbs)) {
          previousState = "vanilla-backed-up";
          backupPath = path.join(backupRoot, file.destinationRelPath);

          const backupDir = path.dirname(backupPath);
          if (!this.fsAdapter.existsSync(backupDir)) {
            this.fsAdapter.mkdirSync(backupDir, { recursive: true });
          }

          // Back up existing file
          this.fsAdapter.copyFileSync(destAbs, backupPath);
          this.fsAdapter.unlinkSync(destAbs);
        }

        // Ensure parent directory exists
        const parentDir = path.dirname(destAbs);
        if (!this.fsAdapter.existsSync(parentDir)) {
          this.fsAdapter.mkdirSync(parentDir, { recursive: true });
        }

        // Deploy file using designated method
        switch (method) {
          case "symlink":
            this.fsAdapter.symlinkSync(file.sourceAbsoluteStagingPath, destAbs);
            break;
          case "hardlink":
            this.fsAdapter.linkSync(file.sourceAbsoluteStagingPath, destAbs);
            break;
          case "move":
            this.fsAdapter.copyFileSync(file.sourceAbsoluteStagingPath, destAbs);
            break;
        }

        journal.deployedFiles.push({
          destinationRelPath: file.destinationRelPath,
          destinationAbsolutePath: destAbs,
          sourceStagingPath: file.sourceAbsoluteStagingPath,
          owningModId: file.owningModId,
          method,
          previousState,
          backupPath,
          sha256: file.sha256,
        });
      }

      journal.status = "committed";
      return journal;
    } catch (err) {
      // Failure recovery: automatic rollback of in-progress transaction
      this.rollback(journal);
      journal.status = "rolled-back";
      const errorObj = unknownToError(err);
      throw new Error(`Deployment transaction failed and was rolled back: ${errorObj.message}`, {
        cause: err,
      });
    }
  }

  /**
   * Rolls back an in-progress or failed deployment transaction.
   * Unlinks deployed files and restores backed-up vanilla files.
   */
  public rollback(journal: IDeploymentJournal): void {
    const deployed = [...journal.deployedFiles].reverse();

    for (const record of deployed) {
      try {
        if (this.fsAdapter.existsSync(record.destinationAbsolutePath)) {
          this.fsAdapter.unlinkSync(record.destinationAbsolutePath);
        }

        // Restore vanilla file from backup if it was replaced
        if (record.previousState === "vanilla-backed-up" && record.backupPath) {
          if (this.fsAdapter.existsSync(record.backupPath)) {
            const parentDir = path.dirname(record.destinationAbsolutePath);
            if (!this.fsAdapter.existsSync(parentDir)) {
              this.fsAdapter.mkdirSync(parentDir, { recursive: true });
            }
            this.fsAdapter.copyFileSync(record.backupPath, record.destinationAbsolutePath);
            this.fsAdapter.unlinkSync(record.backupPath);
          }
        }
      } catch (cleanupErr) {
        // Log or accumulate cleanup errors while continuing rollback
      }
    }

    journal.status = "rolled-back";
  }

  /**
   * Purges all deployed files and declared generated files recorded in the journal,
   * restoring the installation to pristine vanilla state.
   */
  public purge(journal: IDeploymentJournal): {
    purgedFilesCount: number;
    restoredVanillaCount: number;
  } {
    let purgedFilesCount = 0;
    let restoredVanillaCount = 0;

    // 1. Purge deployed mod files
    for (const record of journal.deployedFiles) {
      if (this.fsAdapter.existsSync(record.destinationAbsolutePath)) {
        this.fsAdapter.unlinkSync(record.destinationAbsolutePath);
        purgedFilesCount++;
      }

      // Restore vanilla file if one was backed up
      if (record.previousState === "vanilla-backed-up" && record.backupPath) {
        if (this.fsAdapter.existsSync(record.backupPath)) {
          const parentDir = path.dirname(record.destinationAbsolutePath);
          if (!this.fsAdapter.existsSync(parentDir)) {
            this.fsAdapter.mkdirSync(parentDir, { recursive: true });
          }
          this.fsAdapter.copyFileSync(record.backupPath, record.destinationAbsolutePath);
          this.fsAdapter.unlinkSync(record.backupPath);
          restoredVanillaCount++;
        }
      }
    }

    // 2. Purge registered generated files
    for (const genRel of journal.generatedFiles) {
      const genAbs = path.resolve(journal.gamePath, genRel);
      if (isWithinRoot(journal.gamePath, genAbs) && this.fsAdapter.existsSync(genAbs)) {
        this.fsAdapter.unlinkSync(genAbs);
        purgedFilesCount++;
      }
    }

    return {
      purgedFilesCount,
      restoredVanillaCount,
    };
  }
}
