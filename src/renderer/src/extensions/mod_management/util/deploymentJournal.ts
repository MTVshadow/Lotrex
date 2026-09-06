import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import * as path from "node:path";

import { getErrorCode, getErrorMessageOrDefault } from "@vortex/shared";

import * as fs from "../../../util/fs";
import { writeFileAtomic } from "../../../util/fsAtomic";
import { assertLinuxPathLimits } from "../../../util/linux/pathLimits";
import { assertLinuxPathHasNoSymlinkAncestors } from "../../../util/linux/pathSafety";

export const DEPLOYMENT_JOURNAL_FILE = ".vortex-deployment-journal.json";
export const DEPLOYMENT_JOURNAL_VERSION = 1;

export type DeploymentOperationKind = "deploy" | "purge";
export type DeploymentOperationPhase = "prepared" | "applying" | "manifest-written" | "committed";

export interface IDeploymentJournalEntry {
  version: typeof DEPLOYMENT_JOURNAL_VERSION;
  operationId: string;
  operation: DeploymentOperationKind;
  phase: DeploymentOperationPhase;
  gameId: string;
  profileId?: string;
  instanceId: string;
  deploymentMethod: string;
  stagingPath: string;
  targetPaths: string[];
  startedAt: string;
  updatedAt: string;
  fileOperations?: IDeploymentFileOperation[];
  recovery?: {
    action: DeploymentRecoveryAction;
    resolvedAt: string;
  };
}

export interface IDeploymentFileOperation {
  id: string;
  action: "deploy" | "remove";
  sourcePath: string;
  targetPath: string;
  backupPath: string;
  replace: boolean;
  restoreBackup: boolean;
  recoveryState?: "rolling-back" | "rolled-back";
}

export type DeploymentFileOperationState =
  | "not-started"
  | "backed-up"
  | "applied"
  | "rolled-back"
  | "ambiguous"
  | "unsafe";

export interface IDeploymentFileReconciliation {
  operation: IDeploymentFileOperation;
  state: DeploymentFileOperationState;
  reason: string;
}

export interface IDeploymentReconciliation {
  operationId: string;
  files: IDeploymentFileReconciliation[];
  counts: Record<DeploymentFileOperationState, number>;
  safe: boolean;
}

export type DeploymentRecoveryAction = "resume" | "rollback";

export interface IDeploymentRecoveryPlan {
  operationId: string;
  phase: DeploymentOperationPhase;
  action?: DeploymentRecoveryAction;
  safe: boolean;
  reason: string;
  affectedPaths: string[];
}

export interface IDeploymentJournalInspection {
  stagingPath: string;
  status: "incomplete" | "invalid";
  entry?: IDeploymentJournalEntry;
  error?: Error;
  reconciliation?: IDeploymentReconciliation;
}

interface IDeploymentJournalEnvelope {
  entry: IDeploymentJournalEntry;
  checksum: string;
}

const phaseOrder: DeploymentOperationPhase[] = [
  "prepared",
  "applying",
  "manifest-written",
  "committed",
];

function stableEntryJson(entry: IDeploymentJournalEntry): string {
  return JSON.stringify(entry);
}

function journalChecksum(entry: IDeploymentJournalEntry): string {
  return createHash("sha256").update(stableEntryJson(entry)).digest("hex");
}

function journalPath(stagingPath: string): string {
  return path.join(stagingPath, DEPLOYMENT_JOURNAL_FILE);
}

function isValidEntry(entry: IDeploymentJournalEntry, stagingPath: string): boolean {
  return (
    entry?.version === DEPLOYMENT_JOURNAL_VERSION &&
    typeof entry.operationId === "string" &&
    entry.operationId.length > 0 &&
    ["deploy", "purge"].includes(entry.operation) &&
    phaseOrder.includes(entry.phase) &&
    typeof entry.gameId === "string" &&
    typeof entry.instanceId === "string" &&
    typeof entry.deploymentMethod === "string" &&
    typeof entry.stagingPath === "string" &&
    path.resolve(entry.stagingPath) === path.resolve(stagingPath) &&
    Array.isArray(entry.targetPaths) &&
    entry.targetPaths.every((targetPath) => typeof targetPath === "string") &&
    (entry.fileOperations === undefined ||
      (Array.isArray(entry.fileOperations) &&
        entry.fileOperations.every(
          (operation) =>
            typeof operation.id === "string" &&
            ["deploy", "remove"].includes(operation.action) &&
            typeof operation.sourcePath === "string" &&
            typeof operation.targetPath === "string" &&
            typeof operation.backupPath === "string" &&
            typeof operation.replace === "boolean" &&
            typeof operation.restoreBackup === "boolean" &&
            (operation.recoveryState === undefined ||
              ["rolling-back", "rolled-back"].includes(operation.recoveryState)),
        ))) &&
    typeof entry.startedAt === "string" &&
    typeof entry.updatedAt === "string"
  );
}

function isWithinPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function persist(entry: IDeploymentJournalEntry): Promise<IDeploymentJournalEntry> {
  const envelope: IDeploymentJournalEnvelope = {
    entry,
    checksum: journalChecksum(entry),
  };
  await fs.ensureDirAsync(entry.stagingPath);
  await writeFileAtomic(journalPath(entry.stagingPath), JSON.stringify(envelope, undefined, 2));
  return entry;
}

export async function readDeploymentJournal(
  stagingPath: string,
): Promise<IDeploymentJournalEntry | undefined> {
  let raw: Buffer;
  try {
    raw = await fs.readFileAsync(journalPath(stagingPath));
  } catch (err: unknown) {
    if (getErrorCode(err) === "ENOENT") {
      return undefined;
    }
    throw err;
  }

  let envelope: IDeploymentJournalEnvelope;
  try {
    envelope = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    throw new Error(`Deployment journal is not valid JSON: ${getErrorMessageOrDefault(err)}`, {
      cause: err,
    });
  }

  if (
    !isValidEntry(envelope?.entry, stagingPath) ||
    typeof envelope.checksum !== "string" ||
    journalChecksum(envelope.entry) !== envelope.checksum
  ) {
    throw new Error("Deployment journal failed its integrity check");
  }
  return envelope.entry;
}

export async function inspectDeploymentJournal(
  stagingPath: string,
): Promise<IDeploymentJournalInspection | undefined> {
  try {
    const entry = await readDeploymentJournal(stagingPath);
    if (entry === undefined || !isIncompleteDeploymentOperation(entry)) {
      return undefined;
    }
    const reconciliation =
      entry.phase === "applying" && (entry.fileOperations?.length ?? 0) > 0
        ? await reconcileDeploymentOperation(entry)
        : undefined;
    return { stagingPath, status: "incomplete", entry, reconciliation };
  } catch (err: unknown) {
    return {
      stagingPath,
      status: "invalid",
      error: err instanceof Error ? err : new Error("Failed to read deployment journal"),
    };
  }
}

export async function beginDeploymentOperation(input: {
  operation: DeploymentOperationKind;
  gameId: string;
  profileId?: string;
  instanceId: string;
  deploymentMethod: string;
  stagingPath: string;
  targetPaths: string[];
}): Promise<IDeploymentJournalEntry> {
  assertLinuxPathLimits([input.stagingPath, journalPath(input.stagingPath), ...input.targetPaths]);
  const previous = await readDeploymentJournal(input.stagingPath);
  if (previous !== undefined && previous.phase !== "committed") {
    const err = new Error(
      `Deployment operation ${previous.operationId} is incomplete at phase ${previous.phase}`,
    );
    err["code"] = "EDEPLOYMENTINCOMPLETE";
    err["journal"] = journalPath(input.stagingPath);
    throw err;
  }

  const now = new Date().toISOString();
  return persist({
    version: DEPLOYMENT_JOURNAL_VERSION,
    operationId: randomUUID(),
    operation: input.operation,
    phase: "prepared",
    gameId: input.gameId,
    profileId: input.profileId,
    instanceId: input.instanceId,
    deploymentMethod: input.deploymentMethod,
    stagingPath: input.stagingPath,
    targetPaths: [...new Set(input.targetPaths)].sort(),
    startedAt: now,
    updatedAt: now,
  });
}

export async function advanceDeploymentOperation(
  entry: IDeploymentJournalEntry,
  phase: DeploymentOperationPhase,
): Promise<IDeploymentJournalEntry> {
  const currentIndex = phaseOrder.indexOf(entry.phase);
  const nextIndex = phaseOrder.indexOf(phase);
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Invalid deployment journal transition ${entry.phase} -> ${phase}`);
  }

  const current = await readDeploymentJournal(entry.stagingPath);
  if (current?.operationId !== entry.operationId || current.phase !== entry.phase) {
    throw new Error("Deployment journal changed while the operation was running");
  }

  return persist({ ...current, phase, updatedAt: new Date().toISOString() });
}

export async function recordPlannedFileOperations(
  stagingPath: string,
  operations: IDeploymentFileOperation[],
): Promise<IDeploymentJournalEntry | undefined> {
  assertLinuxPathLimits([
    stagingPath,
    journalPath(stagingPath),
    ...operations.flatMap((operation) => [
      operation.sourcePath,
      operation.targetPath,
      operation.backupPath,
    ]),
  ]);
  const entry = await readDeploymentJournal(stagingPath);
  if (entry === undefined || entry.phase === "committed") {
    return undefined;
  }
  if (entry.phase !== "applying") {
    throw new Error("File operations can only be recorded for an applying deployment");
  }

  const invalidOperation = operations.find(
    (operation) =>
      !isWithinPath(stagingPath, operation.sourcePath) ||
      !entry.targetPaths.some((targetRoot) => isWithinPath(targetRoot, operation.targetPath)) ||
      operation.backupPath !== operation.targetPath + ".vortex_backup",
  );
  if (invalidOperation !== undefined) {
    throw new Error(`Refusing to journal a file operation outside its managed roots`);
  }

  await Promise.all(
    operations.flatMap((operation) => {
      const targetRoot = entry.targetPaths.find((root) => isWithinPath(root, operation.targetPath));
      return [
        assertLinuxPathHasNoSymlinkAncestors(stagingPath, operation.sourcePath),
        assertLinuxPathHasNoSymlinkAncestors(targetRoot!, operation.targetPath),
        assertLinuxPathHasNoSymlinkAncestors(targetRoot!, operation.backupPath),
      ];
    }),
  );

  const knownIds = new Set((entry.fileOperations ?? []).map((operation) => operation.id));
  if (operations.some((operation) => knownIds.has(operation.id))) {
    throw new Error("Deployment journal contains a duplicate file operation id");
  }

  return persist({
    ...entry,
    fileOperations: [...(entry.fileOperations ?? []), ...operations],
    updatedAt: new Date().toISOString(),
  });
}

async function lstatIfPresent(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.lstatAsync(filePath);
  } catch (err: unknown) {
    if (getErrorCode(err) === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

async function targetMatchesSource(
  deploymentMethod: string,
  operation: IDeploymentFileOperation,
  source: Stats | undefined,
  target: Stats | undefined,
): Promise<boolean> {
  if (target === undefined) {
    return false;
  }
  if (deploymentMethod.includes("symlink")) {
    if (!target.isSymbolicLink()) {
      return false;
    }
    const linkTarget = await fs.readlinkAsync(operation.targetPath);
    return (
      path.resolve(path.dirname(operation.targetPath), linkTarget) ===
      path.resolve(operation.sourcePath)
    );
  }
  if (deploymentMethod.includes("hardlink")) {
    return source !== undefined && source.dev === target.dev && source.ino === target.ino;
  }
  if (deploymentMethod.includes("move")) {
    return source === undefined;
  }
  return false;
}

async function reconcileFileOperation(
  entry: IDeploymentJournalEntry,
  operation: IDeploymentFileOperation,
): Promise<IDeploymentFileReconciliation> {
  try {
    const [source, target, backup] = await Promise.all([
      lstatIfPresent(operation.sourcePath),
      lstatIfPresent(operation.targetPath),
      lstatIfPresent(operation.backupPath),
    ]);
    const matchesSource = await targetMatchesSource(
      entry.deploymentMethod,
      operation,
      source,
      target,
    );

    if (operation.action === "deploy") {
      if (matchesSource && backup === undefined) {
        return { operation, state: "applied", reason: "Target matches the planned source." };
      }
      if (target === undefined && source !== undefined && backup === undefined) {
        return {
          operation,
          state: "not-started",
          reason: "Source exists and target was not created.",
        };
      }
      if (target === undefined && backup !== undefined) {
        return {
          operation,
          state: "backed-up",
          reason: "The original target is safely stored in the expected backup path.",
        };
      }
      if (matchesSource && backup !== undefined) {
        return {
          operation,
          state: "applied",
          reason: "Target matches the source and the original target remains in the backup.",
        };
      }
      return {
        operation,
        state: source === undefined ? "unsafe" : "ambiguous",
        reason:
          source === undefined
            ? "The planned source is missing and the target cannot be verified."
            : "The target exists but does not match the planned source.",
      };
    }

    if (matchesSource) {
      return { operation, state: "not-started", reason: "The deployed target is still present." };
    }
    if (!operation.restoreBackup && target === undefined) {
      return { operation, state: "applied", reason: "The planned target was removed." };
    }
    if (operation.restoreBackup && target === undefined && backup !== undefined) {
      return {
        operation,
        state: "applied",
        reason: "The deployed target was removed and its original backup remains available.",
      };
    }
    if (operation.restoreBackup && target !== undefined && backup === undefined) {
      return {
        operation,
        state: "rolled-back",
        reason: "The deployed target is gone and its backup occupies the target path.",
      };
    }
    return {
      operation,
      state: target === undefined && backup === undefined ? "unsafe" : "ambiguous",
      reason:
        target === undefined && backup === undefined
          ? "Neither the target nor its expected backup can be verified."
          : "Target and backup state requires explicit recovery selection.",
    };
  } catch (err: unknown) {
    return {
      operation,
      state: "unsafe",
      reason: `Filesystem inspection failed: ${getErrorMessageOrDefault(err)}`,
    };
  }
}

export async function reconcileDeploymentOperation(
  entry: IDeploymentJournalEntry,
): Promise<IDeploymentReconciliation> {
  const files = await Promise.all(
    (entry.fileOperations ?? []).map((operation) => reconcileFileOperation(entry, operation)),
  );
  const counts: Record<DeploymentFileOperationState, number> = {
    "not-started": 0,
    "backed-up": 0,
    applied: 0,
    "rolled-back": 0,
    ambiguous: 0,
    unsafe: 0,
  };
  files.forEach((file) => ++counts[file.state]);
  return {
    operationId: entry.operationId,
    files,
    counts,
    safe: files.length > 0 && counts.ambiguous === 0 && counts.unsafe === 0,
  };
}

async function updateFileRecoveryState(
  entry: IDeploymentJournalEntry,
  operationId: string,
  recoveryState: "rolling-back" | "rolled-back",
): Promise<IDeploymentJournalEntry> {
  const current = await readDeploymentJournal(entry.stagingPath);
  if (current?.operationId !== entry.operationId || current.phase !== "applying") {
    throw new Error("Deployment journal changed while file recovery was running");
  }
  const index =
    current.fileOperations?.findIndex((operation) => operation.id === operationId) ?? -1;
  if (index < 0) {
    throw new Error(`File operation ${operationId} is missing from the deployment journal`);
  }
  const fileOperations = [...current.fileOperations];
  fileOperations[index] = { ...fileOperations[index], recoveryState };
  return persist({ ...current, fileOperations, updatedAt: new Date().toISOString() });
}

async function rollbackFileOperation(
  entry: IDeploymentJournalEntry,
  operation: IDeploymentFileOperation,
): Promise<IDeploymentJournalEntry> {
  if (operation.recoveryState === "rolled-back") {
    return entry;
  }
  const reconciliation = await reconcileFileOperation(entry, operation);
  if (reconciliation.state === "unsafe") {
    throw new Error(`Unsafe recovery state for ${operation.targetPath}: ${reconciliation.reason}`);
  }

  let current = await updateFileRecoveryState(entry, operation.id, "rolling-back");
  const backup = await lstatIfPresent(operation.backupPath);

  if (operation.action === "deploy") {
    if (reconciliation.state === "applied") {
      await fs.unlinkAsync(operation.targetPath);
    } else if (reconciliation.state === "ambiguous" && operation.recoveryState !== "rolling-back") {
      throw new Error(`Ambiguous recovery state for ${operation.targetPath}`);
    }
    if (backup !== undefined) {
      const target = await lstatIfPresent(operation.targetPath);
      if (target !== undefined) {
        throw new Error(
          `Refusing to overwrite a changed target during recovery: ${operation.targetPath}`,
        );
      }
      await fs.renameAsync(operation.backupPath, operation.targetPath);
    }
  } else if (reconciliation.state === "applied") {
    await fs.ensureDirAsync(path.dirname(operation.targetPath));
    if (entry.deploymentMethod.includes("hardlink")) {
      await fs.linkAsync(operation.sourcePath, operation.targetPath);
    } else {
      await fs.symlinkAsync(operation.sourcePath, operation.targetPath);
    }
  } else if (reconciliation.state === "ambiguous") {
    throw new Error(`Ambiguous recovery state for ${operation.targetPath}`);
  }

  current = await updateFileRecoveryState(current, operation.id, "rolled-back");
  return current;
}

export async function rollbackApplyingDeployment(
  entry: IDeploymentJournalEntry,
): Promise<IDeploymentJournalEntry> {
  if (
    entry.phase !== "applying" ||
    entry.operation !== "deploy" ||
    (!entry.deploymentMethod.includes("hardlink") && !entry.deploymentMethod.includes("symlink")) ||
    (entry.fileOperations?.length ?? 0) === 0
  ) {
    throw new Error("This applying operation does not support automatic rollback");
  }

  let current = entry;
  for (const operation of [...entry.fileOperations].reverse()) {
    current = await rollbackFileOperation(current, operation);
  }

  const resolvedAt = new Date().toISOString();
  return persist({
    ...current,
    phase: "committed",
    updatedAt: resolvedAt,
    recovery: { action: "rollback", resolvedAt },
  });
}

export function isIncompleteDeploymentOperation(entry: IDeploymentJournalEntry): boolean {
  return entry.phase !== "committed";
}

export function buildDeploymentRecoveryPlan(
  entry: IDeploymentJournalEntry,
  reconciliation?: IDeploymentReconciliation,
): IDeploymentRecoveryPlan {
  if (entry.phase === "prepared") {
    return {
      operationId: entry.operationId,
      phase: entry.phase,
      action: "rollback",
      safe: true,
      reason:
        "The operation stopped before the applying boundary, so no managed file writes began.",
      affectedPaths: entry.targetPaths,
    };
  }
  if (entry.phase === "manifest-written") {
    return {
      operationId: entry.operationId,
      phase: entry.phase,
      action: "resume",
      safe: true,
      reason:
        "Managed file changes and manifests completed; only the final commit marker is missing.",
      affectedPaths: entry.targetPaths,
    };
  }
  if (entry.phase === "committed") {
    return {
      operationId: entry.operationId,
      phase: entry.phase,
      safe: true,
      reason: "The operation is already committed.",
      affectedPaths: entry.targetPaths,
    };
  }
  if (
    entry.phase === "applying" &&
    entry.operation === "deploy" &&
    reconciliation?.safe === true &&
    reconciliation.files.length > 0 &&
    (entry.deploymentMethod.includes("hardlink") || entry.deploymentMethod.includes("symlink"))
  ) {
    return {
      operationId: entry.operationId,
      phase: entry.phase,
      action: "rollback",
      safe: true,
      reason:
        "Every planned file has an unambiguous disk state and can be rolled back with a pre-mutation recheck.",
      affectedPaths: entry.targetPaths,
    };
  }
  return {
    operationId: entry.operationId,
    phase: entry.phase,
    safe: false,
    reason:
      "The process stopped while managed files may have been changing. Per-file reconciliation is required before recovery.",
    affectedPaths: entry.targetPaths,
  };
}

export async function completeDeploymentRecovery(
  entry: IDeploymentJournalEntry,
  action: DeploymentRecoveryAction,
): Promise<IDeploymentJournalEntry> {
  const plan = buildDeploymentRecoveryPlan(entry);
  if (!plan.safe || plan.action !== action) {
    throw new Error(`Recovery action ${action} is not safe for phase ${entry.phase}`);
  }

  const current = await readDeploymentJournal(entry.stagingPath);
  if (current?.operationId !== entry.operationId || current.phase !== entry.phase) {
    throw new Error("Deployment journal changed while recovery was being confirmed");
  }

  const resolvedAt = new Date().toISOString();
  return persist({
    ...current,
    phase: "committed",
    updatedAt: resolvedAt,
    recovery: { action, resolvedAt },
  });
}
