import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attestUnmanagedCriticalBaseline,
  ensureCriticalDeploymentBaseline,
  inspectProtectedRestoreJournal,
  rollbackInterruptedProtectedRestore,
  restoreCriticalBaselineFiles,
} from "./protectedBaseline";

const linuxIt = process.platform === "linux" ? it : it.skip;

describe("protected critical-file baseline", () => {
  let root: string;
  let targetRoot: string;
  let stagingPath: string;
  let baselineRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "lotrex-protected-baseline-"));
    targetRoot = path.join(root, "game");
    stagingPath = path.join(root, "staging");
    baselineRoot = path.join(root, "separate-user-data", "baselines");
    await fs.mkdir(path.join(targetRoot, "scripts"), { recursive: true });
    await fs.mkdir(stagingPath, { recursive: true });
    await fs.writeFile(path.join(targetRoot, "scripts", "Script_Game.dll"), "vanilla");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  linuxIt("captures existing and absent critical targets outside game and staging", async () => {
    const baseline = await ensureCriticalDeploymentBaseline({
      baselineRoot,
      gameId: "gothic3",
      relativePaths: ["scripts/Script_Game.dll", "bin/missing.exe", "Data/content.pak"],
      stagingPath,
      targetRoot,
    });

    expect(baseline?.files["scripts/Script_Game.dll"]).toMatchObject({
      exists: true,
      size: 7,
    });
    expect(baseline?.files["bin/missing.exe"]).toEqual({ exists: false });
    expect(baseline?.files["Data/content.pak"]).toBeUndefined();

    const storedFiles = await fs.readdir(baselineRoot, { recursive: true });
    const baselineRelativePath = storedFiles.find((entry) => entry.endsWith(".json"));
    const baselinePath = path.join(baselineRoot, baselineRelativePath!);
    const backupPath = path.resolve(
      path.dirname(baselinePath),
      baseline?.files["scripts/Script_Game.dll"].backupPath!,
    );
    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe("vanilla");
    const [sourceStats, backupStats] = await Promise.all([
      fs.stat(path.join(targetRoot, "scripts", "Script_Game.dll")),
      fs.stat(backupPath),
    ]);
    expect(backupStats.ino).not.toBe(sourceStats.ino);
  });

  linuxIt("refuses to redefine a changed file as the new clean baseline", async () => {
    const options = {
      baselineRoot,
      gameId: "gothic3",
      relativePaths: ["scripts/Script_Game.dll"],
      stagingPath,
      targetRoot,
    };
    await ensureCriticalDeploymentBaseline(options);
    await fs.writeFile(path.join(targetRoot, "scripts", "Script_Game.dll"), "contaminated");

    await expect(ensureCriticalDeploymentBaseline(options)).rejects.toMatchObject({
      code: "EBASELINEDIVERGED",
      path: "scripts/Script_Game.dll",
    });
  });

  linuxIt("rejects baseline storage inside the managed game tree", async () => {
    await expect(
      ensureCriticalDeploymentBaseline({
        baselineRoot: path.join(targetRoot, ".lotrex-baseline"),
        gameId: "gothic3",
        relativePaths: ["scripts/Script_Game.dll"],
        stagingPath,
        targetRoot,
      }),
    ).rejects.toMatchObject({ code: "EBASELINELOCATION" });
  });

  linuxIt("fails post-purge attestation when a critical file was not restored", async () => {
    const options = {
      baselineRoot,
      gameId: "gothic3",
      relativePaths: ["scripts/Script_Game.dll"],
      stagingPath,
      targetRoot,
    };
    await ensureCriticalDeploymentBaseline(options);
    await fs.writeFile(path.join(targetRoot, "scripts", "Script_Game.dll"), "modded");

    await expect(attestUnmanagedCriticalBaseline(options, [])).rejects.toMatchObject({
      code: "EBASELINEATTESTATION",
      files: ["scripts/Script_Game.dll"],
    });
    await expect(
      attestUnmanagedCriticalBaseline(options, ["scripts/Script_Game.dll"]),
    ).resolves.toEqual({ checked: 0, skippedManaged: 1 });
  });

  linuxIt("restores a divergent critical file from an independently copied backup", async () => {
    const options = {
      baselineRoot,
      gameId: "gothic3",
      relativePaths: ["scripts/Script_Game.dll"],
      stagingPath,
      targetRoot,
    };
    await ensureCriticalDeploymentBaseline(options);
    const targetPath = path.join(targetRoot, "scripts", "Script_Game.dll");
    await fs.writeFile(targetPath, "modded");

    await restoreCriticalBaselineFiles(options, ["scripts/Script_Game.dll"]);

    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("vanilla");
    await expect(attestUnmanagedCriticalBaseline(options, [])).resolves.toEqual({
      checked: 1,
      skippedManaged: 0,
    });
  });

  linuxIt(
    "removes an unexpected critical file when the protected baseline records absence",
    async () => {
      const relativePath = "bin/unexpected.exe";
      const options = {
        baselineRoot,
        gameId: "gothic3",
        relativePaths: [relativePath],
        stagingPath,
        targetRoot,
      };
      await ensureCriticalDeploymentBaseline(options);
      const targetPath = path.join(targetRoot, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, "unexpected");

      await restoreCriticalBaselineFiles(options, [relativePath]);

      await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  linuxIt(
    "does not mutate any target when one backup in a multi-file restore is invalid",
    async () => {
      const firstRelativePath = "scripts/Script_Game.dll";
      const secondRelativePath = "scripts/Engine.dll";
      const secondTargetPath = path.join(targetRoot, secondRelativePath);
      await fs.writeFile(secondTargetPath, "engine-vanilla");
      const options = {
        baselineRoot,
        gameId: "gothic3",
        relativePaths: [firstRelativePath, secondRelativePath],
        stagingPath,
        targetRoot,
      };
      const baseline = await ensureCriticalDeploymentBaseline(options);
      const storedFiles = await fs.readdir(baselineRoot, { recursive: true });
      const baselineRelativePath = storedFiles.find((entry) => entry.endsWith(".json"));
      const baselinePath = path.join(baselineRoot, baselineRelativePath!);
      const secondBackupPath = path.resolve(
        path.dirname(baselinePath),
        baseline?.files[secondRelativePath].backupPath!,
      );
      await fs.writeFile(path.join(targetRoot, firstRelativePath), "first-modded");
      await fs.writeFile(secondTargetPath, "second-modded");
      await fs.writeFile(secondBackupPath, "corrupt");

      await expect(
        restoreCriticalBaselineFiles(options, [firstRelativePath, secondRelativePath]),
      ).rejects.toMatchObject({ code: "EBASELINEBACKUPINTEGRITY" });
      await expect(fs.readFile(path.join(targetRoot, firstRelativePath), "utf8")).resolves.toBe(
        "first-modded",
      );
      await expect(fs.readFile(secondTargetPath, "utf8")).resolves.toBe("second-modded");
    },
  );

  linuxIt("rolls back a persisted interrupted restore transaction", async () => {
    const relativePath = "scripts/Script_Game.dll";
    const options = {
      baselineRoot,
      gameId: "gothic3",
      relativePaths: [relativePath],
      stagingPath,
      targetRoot,
    };
    await ensureCriticalDeploymentBaseline(options);
    const storedFiles = await fs.readdir(baselineRoot, { recursive: true });
    const baselineRelativePath = storedFiles.find((entry) => entry.endsWith(".json"));
    const baselinePath = path.join(baselineRoot, baselineRelativePath!);
    const targetPath = path.join(targetRoot, relativePath);
    const rollbackPath = `${targetPath}.lotrex-rollback-fixture`;
    const restoredPath = `${targetPath}.lotrex-restore-fixture`;
    await fs.writeFile(targetPath, "modded-before-restore");
    await fs.rename(targetPath, rollbackPath);
    await fs.writeFile(targetPath, "vanilla");
    const journal = {
      version: 1,
      transactionId: "fixture-transaction",
      baselinePath,
      phase: "applying",
      operations: [
        {
          applied: true,
          entryExists: true,
          movedCurrent: true,
          originalExisted: true,
          relativePath,
          restoredPath,
          rollbackPath,
          targetPath,
        },
      ],
      updatedAt: new Date(0).toISOString(),
    };
    const envelope = {
      journal,
      checksum: createHash("sha256").update(JSON.stringify(journal)).digest("hex"),
    };
    await fs.writeFile(`${baselinePath}.restore-journal.json`, JSON.stringify(envelope));

    await expect(inspectProtectedRestoreJournal(options)).resolves.toMatchObject({
      files: [relativePath],
      phase: "applying",
      status: "incomplete",
      transactionId: "fixture-transaction",
    });
    await expect(rollbackInterruptedProtectedRestore(options)).resolves.toBe(true);
    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("modded-before-restore");
    await expect(fs.stat(rollbackPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(`${baselinePath}.restore-journal.json`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  linuxIt("reports a damaged restore journal as invalid without attempting recovery", async () => {
    const options = {
      baselineRoot,
      gameId: "gothic3",
      relativePaths: ["scripts/Script_Game.dll"],
      stagingPath,
      targetRoot,
    };
    await ensureCriticalDeploymentBaseline(options);
    const storedFiles = await fs.readdir(baselineRoot, { recursive: true });
    const baselineRelativePath = storedFiles.find((entry) => entry.endsWith(".json"));
    const baselinePath = path.join(baselineRoot, baselineRelativePath!);
    await fs.writeFile(`${baselinePath}.restore-journal.json`, "not-json");

    await expect(inspectProtectedRestoreJournal(options)).resolves.toMatchObject({
      status: "invalid",
    });
  });
});
