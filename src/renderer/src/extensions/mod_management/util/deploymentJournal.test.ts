import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../util/fs", () => ({
  ensureDirAsync: (dirPath: string) => fs.mkdir(dirPath, { recursive: true }),
  linkAsync: (sourcePath: string, targetPath: string) => fs.link(sourcePath, targetPath),
  lstatAsync: (filePath: string) => fs.lstat(filePath),
  readFileAsync: (filePath: string) => fs.readFile(filePath),
  readlinkAsync: (filePath: string) => fs.readlink(filePath),
  renameAsync: (sourcePath: string, targetPath: string) => fs.rename(sourcePath, targetPath),
  symlinkAsync: (sourcePath: string, targetPath: string) => fs.symlink(sourcePath, targetPath),
  unlinkAsync: (filePath: string) => fs.unlink(filePath),
}));

vi.mock("../../../util/fsAtomic", () => ({
  writeFileAtomic: (filePath: string, input: string | Buffer) => fs.writeFile(filePath, input),
}));

import {
  advanceDeploymentOperation,
  beginDeploymentOperation,
  buildDeploymentRecoveryPlan,
  completeDeploymentRecovery,
  DEPLOYMENT_JOURNAL_FILE,
  inspectDeploymentJournal,
  isIncompleteDeploymentOperation,
  readDeploymentJournal,
  reconcileDeploymentOperation,
  recordPlannedFileOperations,
  rollbackApplyingDeployment,
} from "./deploymentJournal";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const result = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-deployment-journal-"));
  temporaryDirectories.push(result);
  return result;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

describe("deployment journal", () => {
  it("persists an operation id and each ordered transaction phase", async () => {
    const stagingPath = await temporaryDirectory();
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      profileId: "profile-1",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data", "/game/Data"],
    });

    expect(entry.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.phase).toBe("prepared");
    expect(entry.targetPaths).toEqual(["/game/Data"]);

    for (const phase of ["applying", "manifest-written", "committed"] as const) {
      entry = await advanceDeploymentOperation(entry, phase);
      expect((await readDeploymentJournal(stagingPath))?.phase).toBe(phase);
    }
    expect(isIncompleteDeploymentOperation(entry)).toBe(false);
  });

  it("retains and reports an interrupted operation", async () => {
    const stagingPath = await temporaryDirectory();
    let entry = await beginDeploymentOperation({
      operation: "purge",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data"],
    });
    const interruptedEntry = await advanceDeploymentOperation(entry, "applying");

    await expect(
      beginDeploymentOperation({
        operation: "deploy",
        gameId: "skyrimse",
        instanceId: "instance-1",
        deploymentMethod: "hardlink_activator",
        stagingPath,
        targetPaths: ["/game/Data"],
      }),
    ).rejects.toMatchObject({ code: "EDEPLOYMENTINCOMPLETE" });
    expect(isIncompleteDeploymentOperation(interruptedEntry)).toBe(true);
  });

  it("rejects tampered journal content", async () => {
    const stagingPath = await temporaryDirectory();
    await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data"],
    });
    const filePath = path.join(stagingPath, DEPLOYMENT_JOURNAL_FILE);
    const envelope = JSON.parse(await fs.readFile(filePath, "utf8"));
    envelope.entry.gameId = "tampered";
    await fs.writeFile(filePath, JSON.stringify(envelope));

    await expect(readDeploymentJournal(stagingPath)).rejects.toThrow("integrity check");
    await expect(inspectDeploymentJournal(stagingPath)).resolves.toMatchObject({
      stagingPath,
      status: "invalid",
    });
  });

  it("rejects a valid journal copied into a different staging folder", async () => {
    const originalStagingPath = await temporaryDirectory();
    const otherStagingPath = await temporaryDirectory();
    await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath: originalStagingPath,
      targetPaths: ["/game/Data"],
    });
    await fs.copyFile(
      path.join(originalStagingPath, DEPLOYMENT_JOURNAL_FILE),
      path.join(otherStagingPath, DEPLOYMENT_JOURNAL_FILE),
    );

    await expect(inspectDeploymentJournal(otherStagingPath)).resolves.toMatchObject({
      status: "invalid",
    });
  });

  it("rejects skipped or repeated transaction phases", async () => {
    const stagingPath = await temporaryDirectory();
    const entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data"],
    });

    await expect(advanceDeploymentOperation(entry, "manifest-written")).rejects.toThrow(
      "Invalid deployment journal transition",
    );
  });

  it("allows a new operation after the previous operation committed", async () => {
    const stagingPath = await temporaryDirectory();
    let first = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data"],
    });
    for (const phase of ["applying", "manifest-written", "committed"] as const) {
      first = await advanceDeploymentOperation(first, phase);
    }

    const second = await beginDeploymentOperation({
      operation: "purge",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data"],
    });

    expect(second.operationId).not.toBe(first.operationId);
    expect(second.phase).toBe("prepared");
    expect(second.operation).toBe("purge");
    await expect(inspectDeploymentJournal(stagingPath)).resolves.toMatchObject({
      entry: {
        operation: second.operation,
        operationId: second.operationId,
        phase: second.phase,
        stagingPath: second.stagingPath,
      },
      status: "incomplete",
    });
  });

  it("allows a prepared operation to be safely rolled back", async () => {
    const stagingPath = await temporaryDirectory();
    const entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data"],
    });

    expect(buildDeploymentRecoveryPlan(entry)).toMatchObject({
      action: "rollback",
      safe: true,
    });
    const recovered = await completeDeploymentRecovery(entry, "rollback");
    expect(recovered).toMatchObject({
      phase: "committed",
      recovery: { action: "rollback" },
    });
  });

  it("allows manifest-written recovery but refuses blind applying recovery", async () => {
    const stagingPath = await temporaryDirectory();
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: ["/game/Data"],
    });
    entry = await advanceDeploymentOperation(entry, "applying");
    expect(buildDeploymentRecoveryPlan(entry)).toMatchObject({ safe: false });
    await expect(completeDeploymentRecovery(entry, "rollback")).rejects.toThrow("not safe");

    entry = await advanceDeploymentOperation(entry, "manifest-written");
    expect(buildDeploymentRecoveryPlan(entry)).toMatchObject({ action: "resume", safe: true });
    await expect(completeDeploymentRecovery(entry, "resume")).resolves.toMatchObject({
      phase: "committed",
      recovery: { action: "resume" },
    });
  });

  it("records a bounded per-file plan before managed files are changed", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    entry = await advanceDeploymentOperation(entry, "applying");
    const sourcePath = path.join(stagingPath, "mod", "asset.dds");
    const targetPath = path.join(targetRoot, "asset.dds");

    await recordPlannedFileOperations(stagingPath, [
      {
        id: `deploy:${targetPath}`,
        action: "deploy",
        sourcePath,
        targetPath,
        backupPath: targetPath + ".vortex_backup",
        replace: false,
        restoreBackup: false,
      },
    ]);
    entry = await advanceDeploymentOperation(entry, "manifest-written");

    expect(entry.fileOperations).toHaveLength(1);
    expect(entry.fileOperations[0]).toMatchObject({ sourcePath, targetPath });
  });

  it("rejects planned operations outside managed source and target roots", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    const entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(entry, "applying");
    const targetPath = path.join(targetRoot, "asset.dds");

    await expect(
      recordPlannedFileOperations(stagingPath, [
        {
          id: `deploy:${targetPath}`,
          action: "deploy",
          sourcePath: "/outside/mod/asset.dds",
          targetPath,
          backupPath: targetPath + ".vortex_backup",
          replace: false,
          restoreBackup: false,
        },
      ]),
    ).rejects.toThrow("outside its managed roots");
  });

  it("rejects a planned target below a symlinked directory inside the managed root", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const sourcePath = path.join(stagingPath, "mod", "asset.dds");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "asset");
    await fs.symlink(outside, path.join(targetRoot, "textures"));
    const entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(entry, "applying");
    const targetPath = path.join(targetRoot, "textures", "asset.dds");

    await expect(
      recordPlannedFileOperations(stagingPath, [
        {
          id: `deploy:${targetPath}`,
          action: "deploy",
          sourcePath,
          targetPath,
          backupPath: targetPath + ".vortex_backup",
          replace: false,
          restoreBackup: false,
        },
      ]),
    ).rejects.toMatchObject({
      code: "EDEPLOYMENTSYMLINK",
      path: path.join(targetRoot, "textures"),
    });
  });

  it("reconciles applied and not-started hardlink operations from disk state", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    const sourcePath = path.join(stagingPath, "mod", "asset.dds");
    const appliedTarget = path.join(targetRoot, "applied.dds");
    const pendingTarget = path.join(targetRoot, "pending.dds");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "asset");
    await fs.link(sourcePath, appliedTarget);
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(entry, "applying");
    await recordPlannedFileOperations(
      stagingPath,
      [appliedTarget, pendingTarget].map((targetPath) => ({
        id: `deploy:${targetPath}`,
        action: "deploy" as const,
        sourcePath,
        targetPath,
        backupPath: targetPath + ".vortex_backup",
        replace: false,
        restoreBackup: false,
      })),
    );
    entry = (await readDeploymentJournal(stagingPath))!;

    const reconciliation = await reconcileDeploymentOperation(entry);
    expect(reconciliation.counts).toMatchObject({ applied: 1, "not-started": 1 });
    expect(reconciliation.safe).toBe(true);
  });

  it("marks an unrelated replacement target as ambiguous", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    const sourcePath = path.join(stagingPath, "mod", "asset.dds");
    const targetPath = path.join(targetRoot, "asset.dds");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "source");
    await fs.writeFile(targetPath, "unrelated");
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(entry, "applying");
    await recordPlannedFileOperations(stagingPath, [
      {
        id: `deploy:${targetPath}`,
        action: "deploy",
        sourcePath,
        targetPath,
        backupPath: targetPath + ".vortex_backup",
        replace: false,
        restoreBackup: false,
      },
    ]);
    entry = (await readDeploymentJournal(stagingPath))!;

    const reconciliation = await reconcileDeploymentOperation(entry);
    expect(reconciliation.counts.ambiguous).toBe(1);
    expect(reconciliation.safe).toBe(false);
  });

  it("restores an original target when interrupted after backup but before link", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    const sourcePath = path.join(stagingPath, "mod", "asset.dds");
    const targetPath = path.join(targetRoot, "asset.dds");
    const backupPath = targetPath + ".vortex_backup";
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "modded");
    await fs.writeFile(backupPath, "original");
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(entry, "applying");
    await recordPlannedFileOperations(stagingPath, [
      {
        id: `deploy:${targetPath}`,
        action: "deploy",
        sourcePath,
        targetPath,
        backupPath,
        replace: false,
        restoreBackup: false,
      },
    ]);
    entry = (await readDeploymentJournal(stagingPath))!;

    const reconciliation = await reconcileDeploymentOperation(entry);
    expect(reconciliation.counts["backed-up"]).toBe(1);
    expect(reconciliation.safe).toBe(true);
    const recovered = await rollbackApplyingDeployment(entry);

    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("original");
    await expect(fs.lstat(backupPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(recovered).toMatchObject({ phase: "committed", recovery: { action: "rollback" } });
  });

  it("recreates a removed deployment link when its original backup is still present", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    const sourcePath = path.join(stagingPath, "mod", "asset.dds");
    const targetPath = path.join(targetRoot, "asset.dds");
    const backupPath = targetPath + ".vortex_backup";
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "modded");
    await fs.writeFile(backupPath, "original");
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(entry, "applying");
    await recordPlannedFileOperations(stagingPath, [
      {
        id: `remove:${targetPath}`,
        action: "remove",
        sourcePath,
        targetPath,
        backupPath,
        replace: false,
        restoreBackup: true,
      },
    ]);
    entry = (await readDeploymentJournal(stagingPath))!;

    const reconciliation = await reconcileDeploymentOperation(entry);
    expect(reconciliation.counts.applied).toBe(1);
    expect(reconciliation.safe).toBe(true);
    await rollbackApplyingDeployment(entry);

    const [sourceStats, targetStats] = await Promise.all([
      fs.lstat(sourcePath),
      fs.lstat(targetPath),
    ]);
    expect(targetStats.ino).toBe(sourceStats.ino);
    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe("original");
  });

  it("rolls back an unambiguous interrupted hardlink deployment", async () => {
    const stagingPath = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    const sourcePath = path.join(stagingPath, "mod", "asset.dds");
    const targetPath = path.join(targetRoot, "asset.dds");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "asset");
    await fs.link(sourcePath, targetPath);
    let entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "instance-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(entry, "applying");
    await recordPlannedFileOperations(stagingPath, [
      {
        id: `deploy:${targetPath}`,
        action: "deploy",
        sourcePath,
        targetPath,
        backupPath: targetPath + ".vortex_backup",
        replace: false,
        restoreBackup: false,
      },
    ]);
    entry = (await readDeploymentJournal(stagingPath))!;
    const reconciliation = await reconcileDeploymentOperation(entry);
    expect(buildDeploymentRecoveryPlan(entry, reconciliation)).toMatchObject({
      action: "rollback",
      safe: true,
    });

    const recovered = await rollbackApplyingDeployment(entry);
    await expect(fs.lstat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(recovered).toMatchObject({
      phase: "committed",
      recovery: { action: "rollback" },
    });
    expect(recovered.fileOperations?.[0].recoveryState).toBe("rolled-back");
  });
});
