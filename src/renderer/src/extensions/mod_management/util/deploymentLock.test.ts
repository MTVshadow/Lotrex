import * as nativeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../util/fs", () => ({
  closeAsync: (fd: number) =>
    new Promise<void>((resolve, reject) =>
      nativeFs.close(fd, (err) => (err ? reject(err) : resolve())),
    ),
  ensureDirAsync: (dirPath: string) => fs.mkdir(dirPath, { recursive: true }),
  fsyncAsync: () => Promise.resolve(),
  openAsync: async (filePath: string, flags: string, mode: number) =>
    (await fs.open(filePath, flags, mode)).fd,
  readFileAsync: (filePath: string) => fs.readFile(filePath),
  unlinkAsync: (filePath: string) => fs.unlink(filePath),
  writeAsync: (fd: number, data: Buffer) =>
    new Promise((resolve, reject) => {
      nativeFs.write(fd, data, (err: Error, bytesWritten: number) =>
        err ? reject(err) : resolve({ bytesWritten, buffer: data }),
      );
    }),
}));

import { acquireDeploymentLock, DEPLOYMENT_LOCK_FILE, withDeploymentLock } from "./deploymentLock";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const result = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-deployment-lock-"));
  temporaryDirectories.push(result);
  return result;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

describe("deployment lock", () => {
  it("prevents a second live owner and only releases its own token", async () => {
    const stagingPath = await temporaryDirectory();
    const first = await acquireDeploymentLock(stagingPath, ["/game/Data"], {
      pid: 101,
      isProcessRunning: () => true,
    });
    await expect(
      acquireDeploymentLock(stagingPath, ["/game/Data"], {
        pid: 202,
        isProcessRunning: () => true,
      }),
    ).rejects.toMatchObject({ code: "EDEPLOYMENTLOCKED" });
    await first.release();
    await expect(fs.stat(path.join(stagingPath, DEPLOYMENT_LOCK_FILE))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reclaims an abandoned lock", async () => {
    const stagingPath = await temporaryDirectory();
    await acquireDeploymentLock(stagingPath, ["/game/Data"], {
      pid: 101,
      isProcessRunning: () => true,
    });
    const replacement = await acquireDeploymentLock(stagingPath, ["/game/Data"], {
      pid: 202,
      isProcessRunning: () => false,
    });
    expect(replacement.token).toBeTruthy();
    await replacement.release();
  });

  it("releases the lock when the protected callback fails", async () => {
    const stagingPath = await temporaryDirectory();
    await expect(
      withDeploymentLock(stagingPath, ["/game/Data"], async () => {
        throw new Error("deployment failed");
      }),
    ).rejects.toThrow("deployment failed");
    await expect(fs.stat(path.join(stagingPath, DEPLOYMENT_LOCK_FILE))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
