import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";

import {
  DEPLOYMENT_FAULT_POINTS,
  type DeploymentFaultPoint,
  runDeploymentFaultPoint,
} from "./deploymentFaultInjection";

const point = process.argv[2] as DeploymentFaultPoint;
const markerPath = process.argv[3];
const scenario = process.argv[4] as "deploy" | "purge" | undefined;
const stagingPath = process.argv[5];
const targetRoot = process.argv[6];
const deploymentMethod = process.argv[7] ?? "hardlink_activator";

function writeJournal(stagingDir: string, entry: any) {
  const checksum = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  const envelope = { entry, checksum };
  const journalPath = path.join(stagingDir, ".vortex-deployment-journal.json");
  writeFileSync(journalPath, JSON.stringify(envelope, undefined, 2), "utf8");
}

if (!DEPLOYMENT_FAULT_POINTS.includes(point) || markerPath === undefined) {
  process.exitCode = 2;
} else if (scenario === undefined) {
  appendFileSync(markerPath, `entered:${point}\n`);
  runDeploymentFaultPoint(point);
  appendFileSync(markerPath, `completed:${point}\n`);
} else if (scenario === "deploy" && stagingPath !== undefined && targetRoot !== undefined) {
  appendFileSync(markerPath, `entered:${point}\n`);
  const operationId = randomUUID();
  const now = new Date().toISOString();
  const sourcePath = path.join(stagingPath, "mod", "file.txt");
  const targetPath = path.join(targetRoot, "file.txt");
  const backupPath = targetPath + ".vortex_backup";

  const journalEntry: any = {
    version: 1,
    operationId,
    operation: "deploy",
    phase: "prepared",
    gameId: "test-game",
    instanceId: "test-instance",
    deploymentMethod,
    stagingPath,
    targetPaths: [targetRoot],
    startedAt: now,
    updatedAt: now,
  };
  writeJournal(stagingPath, journalEntry);
  runDeploymentFaultPoint("after-prepared");

  journalEntry.phase = "applying";
  journalEntry.updatedAt = new Date().toISOString();
  journalEntry.fileOperations = [
    {
      id: `deploy:${targetPath}`,
      action: "deploy",
      sourcePath,
      targetPath,
      backupPath,
      replace: true,
      restoreBackup: false,
    },
  ];
  writeJournal(stagingPath, journalEntry);

  if (existsSync(targetPath)) {
    renameSync(targetPath, backupPath);
  }
  runDeploymentFaultPoint("after-backup");

  if (deploymentMethod.includes("hardlink")) {
    linkSync(sourcePath, targetPath);
  } else if (deploymentMethod.includes("move")) {
    writeFileSync(sourcePath + ".vortex_lnk", JSON.stringify({ target: targetPath }), "utf8");
    renameSync(sourcePath, targetPath);
  } else {
    symlinkSync(sourcePath, targetPath);
  }
  runDeploymentFaultPoint("after-link");

  const manifest = [{ relPath: "file.txt", source: "mod", time: Date.now() }];
  writeFileSync(path.join(stagingPath, "vortex.deployment.json"), JSON.stringify(manifest), "utf8");
  journalEntry.phase = "manifest-written";
  journalEntry.updatedAt = new Date().toISOString();
  writeJournal(stagingPath, journalEntry);
  runDeploymentFaultPoint("after-manifest-write");

  journalEntry.phase = "committed";
  journalEntry.updatedAt = new Date().toISOString();
  writeJournal(stagingPath, journalEntry);
  runDeploymentFaultPoint("after-commit");

  appendFileSync(markerPath, `completed:${point}\n`);
} else if (scenario === "purge" && stagingPath !== undefined && targetRoot !== undefined) {
  appendFileSync(markerPath, `entered:${point}\n`);
  const operationId = randomUUID();
  const now = new Date().toISOString();
  const sourcePath = path.join(stagingPath, "mod", "file.txt");
  const targetPath = path.join(targetRoot, "file.txt");
  const backupPath = targetPath + ".vortex_backup";

  const journalEntry: any = {
    version: 1,
    operationId,
    operation: "purge",
    phase: "prepared",
    gameId: "test-game",
    instanceId: "test-instance",
    deploymentMethod,
    stagingPath,
    targetPaths: [targetRoot],
    startedAt: now,
    updatedAt: now,
  };
  writeJournal(stagingPath, journalEntry);
  runDeploymentFaultPoint("after-prepared");

  journalEntry.phase = "applying";
  journalEntry.updatedAt = new Date().toISOString();
  journalEntry.fileOperations = [
    {
      id: `remove:${targetPath}`,
      action: "remove",
      sourcePath,
      targetPath,
      backupPath,
      replace: false,
      restoreBackup: true,
    },
  ];
  writeJournal(stagingPath, journalEntry);

  if (existsSync(targetPath)) {
    if (deploymentMethod.includes("move")) {
      renameSync(targetPath, sourcePath);
      if (existsSync(sourcePath + ".vortex_lnk")) {
        unlinkSync(sourcePath + ".vortex_lnk");
      }
    } else {
      unlinkSync(targetPath);
    }
  }
  runDeploymentFaultPoint("after-unlink");

  if (existsSync(backupPath)) {
    renameSync(backupPath, targetPath);
  }
  runDeploymentFaultPoint("after-purge");

  writeFileSync(path.join(stagingPath, "vortex.deployment.json"), "[]", "utf8");
  journalEntry.phase = "manifest-written";
  journalEntry.updatedAt = new Date().toISOString();
  writeJournal(stagingPath, journalEntry);
  runDeploymentFaultPoint("after-manifest-write");

  journalEntry.phase = "committed";
  journalEntry.updatedAt = new Date().toISOString();
  writeJournal(stagingPath, journalEntry);
  runDeploymentFaultPoint("after-commit");

  appendFileSync(markerPath, `completed:${point}\n`);
}
