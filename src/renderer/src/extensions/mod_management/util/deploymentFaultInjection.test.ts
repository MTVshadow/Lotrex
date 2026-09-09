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
  statAsync: (filePath: string) => fs.stat(filePath),
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
  executeDeploymentOperation,
  inspectDeploymentJournal,
  isVolumeUnavailableError,
  readDeploymentJournal,
  reconcileDeploymentOperation,
  recordPlannedFileOperations,
  rollbackApplyingDeployment,
} from "./deploymentJournal";
import type { IDeploymentFileOperation } from "./deploymentJournal";

describe("Deployment durability and process-kill fault injection", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
    );
  });

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-fault-injection-"));
    tempDirs.push(dir);
    return dir;
  }

  it("recovers from fault at pre-apply boundary (prepared phase)", async () => {
    const stagingPath = await createTempDir();
    const targetRoot = await createTempDir();

    // 1. Transaction begins and persists prepared journal
    const entry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "inst-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    expect(entry.phase).toBe("prepared");

    // Process kill simulation: crash happens before advancing to applying.
    // 2. On next startup: inspection finds incomplete prepared journal
    const inspection = await inspectDeploymentJournal(stagingPath);
    expect(inspection?.status).toBe("incomplete");
    expect(inspection?.entry?.phase).toBe("prepared");

    if (inspection?.entry == null) {
      throw new Error("Expected incomplete journal entry");
    }

    // 3. Recovery plan recommends safe rollback (canceling the unstarted operation)
    const plan = buildDeploymentRecoveryPlan(inspection.entry);
    expect(plan.safe).toBe(true);
    expect(plan.action).toBe("rollback");

    // 4. Recovery completes and marks journal committed
    const recovered = await completeDeploymentRecovery(inspection.entry, "rollback");
    expect(recovered.phase).toBe("committed");
    expect(recovered.recovery?.action).toBe("rollback");
  });

  it("recovers from fault at backup boundary (backup created, target not yet linked)", async () => {
    const stagingPath = await createTempDir();
    const targetRoot = await createTempDir();

    const sourcePath = path.join(stagingPath, "mod", "config.json");
    const targetPath = path.join(targetRoot, "config.json");
    const backupPath = targetPath + ".vortex_backup";

    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "new-mod-config");
    // Target was backed up, so backup exists, but target is temporarily missing before new link is placed
    await fs.writeFile(backupPath, "vanilla-config");

    const initialEntry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "inst-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(initialEntry, "applying");
    await recordPlannedFileOperations(stagingPath, [
      {
        id: `deploy:${targetPath}`,
        action: "deploy",
        sourcePath,
        targetPath,
        backupPath,
        replace: true,
        restoreBackup: false,
      },
    ]);

    // Process kill simulation: crash occurs right here.
    const reloaded = await readDeploymentJournal(stagingPath);
    if (reloaded == null) {
      throw new Error("Expected journal entry");
    }
    const reconciliation = await reconcileDeploymentOperation(reloaded);
    expect(reconciliation.counts["backed-up"]).toBe(1);
    expect(reconciliation.safe).toBe(true);

    // Rollback must restore the vanilla config from backupPath to targetPath
    const recovered = await rollbackApplyingDeployment(reloaded);
    expect(recovered.phase).toBe("committed");
    expect(recovered.recovery?.action).toBe("rollback");

    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("vanilla-config");
    await expect(fs.lstat(backupPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers from fault mid-apply (partial deployment: 2 applied, 3 not-started)", async () => {
    const stagingPath = await createTempDir();
    const targetRoot = await createTempDir();

    const files = ["file1.dds", "file2.dds", "file3.dds", "file4.dds", "file5.dds"];
    const plannedOps: IDeploymentFileOperation[] = [];

    for (const file of files) {
      const src = path.join(stagingPath, file);
      const dst = path.join(targetRoot, file);
      await fs.writeFile(src, `content-${file}`);
      plannedOps.push({
        id: `deploy:${dst}`,
        action: "deploy",
        sourcePath: src,
        targetPath: dst,
        backupPath: dst + ".vortex_backup",
        replace: false,
        restoreBackup: false,
      });
    }

    const initialEntry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "inst-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(initialEntry, "applying");
    await recordPlannedFileOperations(stagingPath, plannedOps);

    // Simulate partial deployment: files 0 and 1 are linked, files 2, 3, 4 are not touched
    await fs.link(plannedOps[0].sourcePath, plannedOps[0].targetPath);
    await fs.link(plannedOps[1].sourcePath, plannedOps[1].targetPath);

    // Process kill simulation: crash occurs after 2 of 5 files deployed.
    const reloaded = await readDeploymentJournal(stagingPath);
    if (reloaded == null) {
      throw new Error("Expected journal entry");
    }
    const reconciliation = await reconcileDeploymentOperation(reloaded);
    expect(reconciliation.counts.applied).toBe(2);
    expect(reconciliation.counts["not-started"]).toBe(3);
    expect(reconciliation.safe).toBe(true);

    const plan = buildDeploymentRecoveryPlan(reloaded, reconciliation);
    expect(plan.action).toBe("rollback");
    expect(plan.safe).toBe(true);

    // Rollback unlinks files 0 and 1, leaving the game folder completely clean
    const recovered = await rollbackApplyingDeployment(reloaded);
    expect(recovered.phase).toBe("committed");
    expect(recovered.recovery?.action).toBe("rollback");

    for (const file of files) {
      await expect(fs.lstat(path.join(targetRoot, file))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });

  it("recovers from fault at post-apply boundary (manifest-written phase)", async () => {
    const stagingPath = await createTempDir();
    const targetRoot = await createTempDir();
    const manifestPath = path.join(stagingPath, "deployment-manifest.json");

    const initialEntry = await beginDeploymentOperation({
      operation: "deploy",
      gameId: "skyrimse",
      instanceId: "inst-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    const applyingEntry = await advanceDeploymentOperation(initialEntry, "applying");
    // Write manifest
    await fs.writeFile(manifestPath, JSON.stringify({ version: 1, files: [] }));
    await advanceDeploymentOperation(applyingEntry, "manifest-written");

    // Process kill simulation: crash occurs right before phase advances to committed.
    const inspection = await inspectDeploymentJournal(stagingPath);
    expect(inspection?.status).toBe("incomplete");
    expect(inspection?.entry?.phase).toBe("manifest-written");

    if (inspection?.entry == null) {
      throw new Error("Expected incomplete journal entry");
    }

    // Recovery plan must choose resume (since manifest is already written)
    const plan = buildDeploymentRecoveryPlan(inspection.entry);
    expect(plan.action).toBe("resume");
    expect(plan.safe).toBe(true);

    const recovered = await completeDeploymentRecovery(inspection.entry, "resume");
    expect(recovered.phase).toBe("committed");
    expect(recovered.recovery?.action).toBe("resume");

    // Manifest must remain intact
    await expect(fs.readFile(manifestPath, "utf8")).resolves.toContain('"version":1');
  });

  it("recovers from fault during purge mid-apply (restores unlinked files)", async () => {
    const stagingPath = await createTempDir();
    const targetRoot = await createTempDir();

    const src1 = path.join(stagingPath, "mod1.dds");
    const dst1 = path.join(targetRoot, "mod1.dds");
    const src2 = path.join(stagingPath, "mod2.dds");
    const dst2 = path.join(targetRoot, "mod2.dds");

    await fs.writeFile(src1, "content1");
    await fs.writeFile(src2, "content2");
    // Initially both files were deployed
    await fs.link(src2, dst2); // dst2 is still present
    // dst1 was unlinked during purge

    const initialEntry = await beginDeploymentOperation({
      operation: "purge",
      gameId: "skyrimse",
      instanceId: "inst-1",
      deploymentMethod: "hardlink_activator",
      stagingPath,
      targetPaths: [targetRoot],
    });
    await advanceDeploymentOperation(initialEntry, "applying");
    await recordPlannedFileOperations(stagingPath, [
      {
        id: `remove:${dst1}`,
        action: "remove",
        sourcePath: src1,
        targetPath: dst1,
        backupPath: dst1 + ".vortex_backup",
        replace: false,
        restoreBackup: false,
      },
      {
        id: `remove:${dst2}`,
        action: "remove",
        sourcePath: src2,
        targetPath: dst2,
        backupPath: dst2 + ".vortex_backup",
        replace: false,
        restoreBackup: false,
      },
    ]);

    // Process kill simulation: crash after removing dst1, before dst2
    const reloaded = await readDeploymentJournal(stagingPath);
    if (reloaded == null) {
      throw new Error("Expected journal entry");
    }
    const reconciliation = await reconcileDeploymentOperation(reloaded);
    expect(reconciliation.counts.applied).toBe(1); // dst1 removed
    expect(reconciliation.counts["not-started"]).toBe(1); // dst2 still present
    expect(reconciliation.safe).toBe(true);

    // Rollback must recreate dst1 hardlink pointing to src1
    const recovered = await rollbackApplyingDeployment(reloaded);
    expect(recovered.phase).toBe("committed");
    expect(recovered.recovery?.action).toBe("rollback");

    const [statSrc, statDst] = await Promise.all([fs.lstat(src1), fs.lstat(dst1)]);
    expect(statDst.ino).toBe(statSrc.ino);
  });

  describe("removable volume disconnect detection", () => {
    it("recognizes standard storage detachment error codes", () => {
      expect(isVolumeUnavailableError({ code: "EDEPLOYMENTVOLUMEUNAVAILABLE" })).toBe(true);
      expect(isVolumeUnavailableError({ code: "ENODEV" })).toBe(true);
      expect(isVolumeUnavailableError({ code: "ENXIO" })).toBe(true);
      expect(isVolumeUnavailableError({ code: "ESTALE" })).toBe(true);
      expect(isVolumeUnavailableError({ code: "EIO" })).toBe(true);
      expect(isVolumeUnavailableError({ code: "EREMOTEIO" })).toBe(true);
      expect(isVolumeUnavailableError({ code: "EEXIST" })).toBe(false);
      expect(isVolumeUnavailableError({ code: "EPERM" })).toBe(false);
    });

    it("detects volume disconnect during applyAndWriteManifest and raises EDEPLOYMENTVOLUMEUNAVAILABLE", async () => {
      const stagingPath = await createTempDir();
      const targetRoot = await createTempDir();

      const disconnectedError = Object.assign(new Error("Storage detached: I/O error"), {
        code: "ENODEV",
      });

      await expect(
        executeDeploymentOperation(
          {
            deploymentMethod: "hardlink_activator",
            gameId: "skyrimse",
            instanceId: "inst-1",
            operation: "deploy",
            stagingPath,
            targetPaths: [targetRoot],
          },
          async () => {
            await Promise.reject(disconnectedError);
          },
        ),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTVOLUMEUNAVAILABLE",
      });

      // Journal remains in applying state ready for guided resume/rollback once reconnected
      const journal = await readDeploymentJournal(stagingPath);
      expect(journal?.phase).toBe("applying");
    });

    it("detects volume unavailable during reconciliation and aborts recovery", async () => {
      const stagingPath = await createTempDir();
      const targetRoot = await createTempDir();

      const sourcePath = path.join(stagingPath, "mod.dds");
      const targetPath = path.join(targetRoot, "mod.dds");
      await fs.writeFile(sourcePath, "data");

      const initialEntry = await beginDeploymentOperation({
        operation: "deploy",
        gameId: "skyrimse",
        instanceId: "inst-1",
        deploymentMethod: "hardlink_activator",
        stagingPath,
        targetPaths: [targetRoot],
      });
      await advanceDeploymentOperation(initialEntry, "applying");
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

      // Simulate volume disconnected: remove targetRoot from disk entirely
      await fs.rm(targetRoot, { force: true, recursive: true });

      const reloaded = await readDeploymentJournal(stagingPath);
      if (reloaded == null) {
        throw new Error("Expected journal entry");
      }
      await expect(reconcileDeploymentOperation(reloaded)).rejects.toMatchObject({
        code: "EDEPLOYMENTVOLUMEUNAVAILABLE",
      });
    });

    it("detects volume identity change (wrong disk connected) and rejects recovery", async () => {
      const stagingPath = await createTempDir();
      const targetRoot = await createTempDir();

      await beginDeploymentOperation({
        operation: "deploy",
        gameId: "skyrimse",
        instanceId: "inst-1",
        deploymentMethod: "hardlink_activator",
        stagingPath,
        targetPaths: [targetRoot],
      });

      // Tamper pathIdentities device ID to simulate a different mounted USB volume
      const reloaded = await readDeploymentJournal(stagingPath);
      if (reloaded?.pathIdentities?.[0] != null) {
        reloaded.pathIdentities[0].device = 99999999;
        await expect(advanceDeploymentOperation(reloaded, "applying")).rejects.toMatchObject({
          code: "EDEPLOYMENTVOLUMECHANGED",
        });
      }
    });
  });
});
