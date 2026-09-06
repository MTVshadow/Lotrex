import { randomUUID } from "node:crypto";
import * as path from "node:path";

import { getErrorCode, getErrorMessageOrDefault } from "@vortex/shared";

import * as fs from "../../../util/fs";

export const DEPLOYMENT_LOCK_FILE = ".vortex-deployment.lock";

interface IDeploymentLockRecord {
  version: 1;
  token: string;
  pid: number;
  createdAt: string;
  stagingPath: string;
  targetPaths: string[];
}

export interface IDeploymentLock {
  path: string;
  token: string;
  release: () => Promise<void>;
}

export interface IDeploymentLockOptions {
  pid?: number;
  isProcessRunning?: (pid: number) => boolean;
}

function defaultIsProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return getErrorCode(err) === "EPERM";
  }
}

async function readLock(lockPath: string): Promise<IDeploymentLockRecord> {
  const raw = await fs.readFileAsync(lockPath);
  const record = JSON.parse(raw.toString("utf8")) as IDeploymentLockRecord;
  if (
    record?.version !== 1 ||
    typeof record.token !== "string" ||
    !Number.isSafeInteger(record.pid) ||
    typeof record.stagingPath !== "string" ||
    path.resolve(record.stagingPath) !== path.resolve(path.dirname(lockPath)) ||
    !Array.isArray(record.targetPaths) ||
    !record.targetPaths.every((targetPath) => typeof targetPath === "string")
  ) {
    throw new Error("Deployment lock metadata is invalid");
  }
  return record;
}

async function writeExclusive(lockPath: string, record: IDeploymentLockRecord): Promise<void> {
  const data = Buffer.from(JSON.stringify(record, undefined, 2));
  const fd = await fs.openAsync(lockPath, "wx", 0o600);
  try {
    await fs.writeAsync(fd, data, 0, data.length, 0);
    await fs.fsyncAsync(fd).catch(() => undefined);
  } finally {
    await fs.closeAsync(fd).catch(() => undefined);
  }
}

export async function acquireDeploymentLock(
  stagingPath: string,
  targetPaths: string[],
  options: IDeploymentLockOptions = {},
): Promise<IDeploymentLock> {
  await fs.ensureDirAsync(stagingPath);
  const lockPath = path.join(stagingPath, DEPLOYMENT_LOCK_FILE);
  const pid = options.pid ?? process.pid;
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const record: IDeploymentLockRecord = {
    version: 1,
    token: randomUUID(),
    pid,
    createdAt: new Date().toISOString(),
    stagingPath,
    targetPaths: [...new Set(targetPaths)].sort(),
  };

  for (let attempt = 0; attempt < 2; ++attempt) {
    try {
      await writeExclusive(lockPath, record);
      return {
        path: lockPath,
        token: record.token,
        release: async () => {
          let current: IDeploymentLockRecord;
          try {
            current = await readLock(lockPath);
          } catch (err: unknown) {
            if (getErrorCode(err) === "ENOENT") {
              return;
            }
            throw err;
          }
          if (current.token !== record.token) {
            throw new Error("Refusing to release a deployment lock owned by another process");
          }
          await fs.unlinkAsync(lockPath);
        },
      };
    } catch (err: unknown) {
      if (getErrorCode(err) !== "EEXIST") {
        throw err;
      }
      let owner: IDeploymentLockRecord;
      try {
        owner = await readLock(lockPath);
      } catch (readErr: unknown) {
        throw new Error(
          `Deployment lock exists but cannot be validated: ${getErrorMessageOrDefault(readErr)}`,
          { cause: readErr },
        );
      }
      if (isProcessRunning(owner.pid)) {
        const lockError = new Error(
          `Deployment paths are locked by Vortex process ${owner.pid} since ${owner.createdAt}`,
        );
        lockError["code"] = "EDEPLOYMENTLOCKED";
        lockError["lock"] = lockPath;
        throw lockError;
      }
      await fs.unlinkAsync(lockPath).catch((unlinkErr: unknown) => {
        if (getErrorCode(unlinkErr) !== "ENOENT") {
          throw unlinkErr;
        }
      });
    }
  }
  throw new Error("Failed to acquire deployment lock after reclaiming an abandoned lock");
}

export async function withDeploymentLock<T>(
  stagingPath: string,
  targetPaths: string[],
  callback: () => Promise<T>,
): Promise<T> {
  const lock = await acquireDeploymentLock(stagingPath, targetPaths);
  try {
    return await callback();
  } finally {
    await lock.release();
  }
}
