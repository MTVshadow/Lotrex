import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as nativeFs from "node:fs/promises";
import * as path from "node:path";

import { getErrorCode } from "@vortex/shared";

import { writeFileAtomic } from "../../../util/fsAtomic";
import getVortexPath from "../../../util/getVortexPath";
import { assertLinuxPathHasNoSymlinkAncestors } from "../../../util/linux/pathSafety";
import { isCriticalHardlinkDeploymentPath } from "./linuxHardlinkSafety";

const BASELINE_VERSION = 1;

export interface IProtectedBaselineFile {
  backupPath?: string;
  exists: boolean;
  mode?: number;
  mtimeMs?: number;
  sha256?: string;
  size?: number;
}

export interface IProtectedBaseline {
  version: typeof BASELINE_VERSION;
  gameId: string;
  targetRoot: string;
  createdAt: string;
  updatedAt: string;
  files: Record<string, IProtectedBaselineFile>;
}

interface IProtectedBaselineEnvelope {
  baseline: IProtectedBaseline;
  checksum: string;
}

export interface IProtectedBaselineOptions {
  gameId: string;
  previousManagedRelativePaths?: string[];
  relativePaths: string[];
  stagingPath: string;
  targetRoot: string;
  baselineRoot?: string;
}

function checksum(baseline: IProtectedBaseline): string {
  return createHash("sha256").update(JSON.stringify(baseline)).digest("hex");
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function baselineFilePath(options: IProtectedBaselineOptions): string {
  const identity = createHash("sha256")
    .update(`${options.gameId}\0${path.resolve(options.targetRoot)}`)
    .digest("hex")
    .slice(0, 24);
  const root = options.baselineRoot ?? path.join(getVortexPath("userData"), "protected-baselines");
  if (
    isWithin(options.targetRoot, root) ||
    isWithin(root, options.targetRoot) ||
    isWithin(options.stagingPath, root) ||
    isWithin(root, options.stagingPath)
  ) {
    const err = new Error("Protected baseline storage must be separate from game and staging data");
    err["code"] = "EBASELINELOCATION";
    throw err;
  }
  const safeGameId = options.gameId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  const gameKey = `game-${safeGameId}-${createHash("sha256").update(options.gameId).digest("hex").slice(0, 8)}`;
  return path.join(root, gameKey, `${identity}.json`);
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("data", (chunk) => digest.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(digest.digest("hex")));
  });
}

async function ensureBackupBlob(
  sourcePath: string,
  baselinePath: string,
  snapshot: IProtectedBaselineFile,
): Promise<string> {
  const blobDirectory = `${baselinePath}.blobs`;
  const blobName = snapshot.sha256!;
  const blobPath = path.join(blobDirectory, blobName);
  const relativeBlobPath = path.relative(path.dirname(baselinePath), blobPath);
  await nativeFs.mkdir(blobDirectory, { recursive: true });
  try {
    const stats = await nativeFs.lstat(blobPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== snapshot.size) {
      throw Object.assign(new Error("Protected backup blob has an unsafe file type or size"), {
        code: "EBASELINEBACKUPINTEGRITY",
      });
    }
    if ((await hashFile(blobPath)) !== snapshot.sha256) {
      throw Object.assign(new Error("Protected backup blob failed its integrity check"), {
        code: "EBASELINEBACKUPINTEGRITY",
      });
    }
    return relativeBlobPath;
  } catch (err: unknown) {
    if (getErrorCode(err) !== "ENOENT") throw err;
  }

  const temporaryPath = path.join(blobDirectory, `.${blobName}.${randomUUID()}.tmp`);
  try {
    await nativeFs.copyFile(sourcePath, temporaryPath);
    const copiedHash = await hashFile(temporaryPath);
    if (copiedHash !== snapshot.sha256) {
      throw Object.assign(
        new Error("Critical file changed while its protected backup was copied"),
        {
          code: "EBASELINECHANGED",
        },
      );
    }
    await nativeFs.rename(temporaryPath, blobPath).catch(async (err: unknown) => {
      if (getErrorCode(err) !== "EEXIST") throw err;
    });
  } finally {
    await nativeFs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return relativeBlobPath;
}

async function snapshotFile(filePath: string): Promise<IProtectedBaselineFile> {
  try {
    const stats = await nativeFs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      const err = new Error(`Critical baseline target is not a regular file: ${filePath}`);
      err["code"] = "EBASELINEUNSAFE";
      throw err;
    }
    return {
      exists: true,
      mtimeMs: stats.mtimeMs,
      mode: stats.mode,
      sha256: await hashFile(filePath),
      size: stats.size,
    };
  } catch (err: unknown) {
    if (getErrorCode(err) === "ENOENT") return { exists: false };
    throw err;
  }
}

async function readBaseline(filePath: string): Promise<IProtectedBaseline | undefined> {
  let raw: string;
  try {
    const stats = await nativeFs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      const err = new Error("Protected baseline record is not a regular file");
      err["code"] = "EBASELINEUNSAFE";
      throw err;
    }
    raw = await nativeFs.readFile(filePath, "utf8");
  } catch (err: unknown) {
    if (getErrorCode(err) === "ENOENT") return undefined;
    throw err;
  }
  const envelope = JSON.parse(raw) as IProtectedBaselineEnvelope;
  if (
    envelope?.baseline?.version !== BASELINE_VERSION ||
    envelope.checksum !== checksum(envelope.baseline)
  ) {
    const err = new Error("Protected baseline failed its integrity check");
    err["code"] = "EBASELINEINTEGRITY";
    throw err;
  }
  return envelope.baseline;
}

function equalSnapshot(left: IProtectedBaselineFile, right: IProtectedBaselineFile): boolean {
  return (
    left.exists === right.exists &&
    (!left.exists || (left.size === right.size && left.sha256 === right.sha256))
  );
}

/**
 * Captures immutable metadata for critical files before their first managed mutation. Existing
 * entries are never refreshed from disk: a mismatch means the game is already divergent and the
 * deployment must stop instead of redefining the contaminated file as the new clean baseline.
 */
export async function ensureCriticalDeploymentBaseline(
  options: IProtectedBaselineOptions,
): Promise<IProtectedBaseline | undefined> {
  if (process.platform !== "linux") return undefined;
  const relativePaths = [
    ...new Set(
      options.relativePaths
        .map((value) => value.replaceAll("\\", "/"))
        .filter(isCriticalHardlinkDeploymentPath),
    ),
  ].sort();
  if (relativePaths.length === 0) return undefined;

  const filePath = baselineFilePath(options);
  const existing = await readBaseline(filePath);
  if (
    existing !== undefined &&
    (existing.gameId !== options.gameId ||
      path.resolve(existing.targetRoot) !== path.resolve(options.targetRoot))
  ) {
    const err = new Error("Protected baseline identity does not match this game installation");
    err["code"] = "EBASELINEIDENTITY";
    throw err;
  }

  const now = new Date().toISOString();
  const baseline: IProtectedBaseline = existing ?? {
    version: BASELINE_VERSION,
    gameId: options.gameId,
    targetRoot: path.resolve(options.targetRoot),
    createdAt: now,
    updatedAt: now,
    files: {},
  };
  const previouslyManaged = new Set(
    (options.previousManagedRelativePaths ?? []).map((value) =>
      value.replaceAll("\\", "/").toLocaleLowerCase("en-US"),
    ),
  );
  let changed = false;
  for (const relativePath of relativePaths) {
    const original = baseline.files[relativePath];
    if (original !== undefined && previouslyManaged.has(relativePath.toLocaleLowerCase("en-US"))) {
      continue;
    }
    const targetPath = path.resolve(options.targetRoot, relativePath);
    await assertLinuxPathHasNoSymlinkAncestors(options.targetRoot, targetPath);
    const current = await snapshotFile(targetPath);
    if (original === undefined) {
      if (current.exists) {
        current.backupPath = await ensureBackupBlob(targetPath, filePath, current);
      }
      baseline.files[relativePath] = current;
      changed = true;
    } else if (!equalSnapshot(original, current)) {
      const err = new Error(
        `Critical game file differs from its protected baseline: ${relativePath}`,
      );
      err["code"] = "EBASELINEDIVERGED";
      err["path"] = relativePath;
      throw err;
    }
  }

  if (changed) {
    baseline.updatedAt = now;
    await nativeFs.mkdir(path.dirname(filePath), { recursive: true });
    const envelope: IProtectedBaselineEnvelope = { baseline, checksum: checksum(baseline) };
    await writeFileAtomic(filePath, JSON.stringify(envelope, undefined, 2));
  }
  return baseline;
}

export interface IProtectedBaselineAttestation {
  checked: number;
  skippedManaged: number;
}

/** Verifies critical baseline entries that are no longer present in the active deployment plan. */
export async function attestUnmanagedCriticalBaseline(
  options: IProtectedBaselineOptions,
  managedRelativePaths: string[],
): Promise<IProtectedBaselineAttestation | undefined> {
  if (process.platform !== "linux") return undefined;
  const baselinePath = baselineFilePath(options);
  const baseline = await readBaseline(baselinePath);
  if (baseline === undefined) return undefined;
  const managed = new Set(
    managedRelativePaths.map((value) => value.replaceAll("\\", "/").toLocaleLowerCase("en-US")),
  );
  const divergent: string[] = [];
  let checked = 0;
  let skippedManaged = 0;
  for (const [relativePath, expected] of Object.entries(baseline.files)) {
    if (managed.has(relativePath.toLocaleLowerCase("en-US"))) {
      ++skippedManaged;
      continue;
    }
    const targetPath = path.resolve(options.targetRoot, relativePath);
    await assertLinuxPathHasNoSymlinkAncestors(options.targetRoot, targetPath);
    const actual = await snapshotFile(targetPath);
    ++checked;
    if (!equalSnapshot(expected, actual)) divergent.push(relativePath);
  }
  if (divergent.length > 0) {
    const err = new Error(
      `Critical files were not restored to their protected baseline: ${divergent.join(", ")}`,
    );
    err["code"] = "EBASELINEATTESTATION";
    err["files"] = divergent;
    throw err;
  }
  return { checked, skippedManaged };
}

async function verifyBackupBlob(
  baselinePath: string,
  entry: IProtectedBaselineFile,
): Promise<string> {
  if (!entry.exists || entry.backupPath === undefined || entry.sha256 === undefined) {
    throw Object.assign(new Error("Protected baseline has no restorable backup for this file"), {
      code: "EBASELINEBACKUPMISSING",
    });
  }
  const blobRoot = path.resolve(`${baselinePath}.blobs`);
  const blobPath = path.resolve(path.dirname(baselinePath), entry.backupPath);
  if (!isWithin(blobRoot, blobPath)) {
    throw Object.assign(new Error("Protected backup path escapes its content store"), {
      code: "EBASELINEBACKUPINTEGRITY",
    });
  }
  const stats = await nativeFs.lstat(blobPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== entry.size) {
    throw Object.assign(new Error("Protected backup is not a verified regular file"), {
      code: "EBASELINEBACKUPINTEGRITY",
    });
  }
  if ((await hashFile(blobPath)) !== entry.sha256) {
    throw Object.assign(new Error("Protected backup checksum does not match the baseline"), {
      code: "EBASELINEBACKUPINTEGRITY",
    });
  }
  return blobPath;
}

interface IPreparedBaselineRestore {
  applied: boolean;
  entry: IProtectedBaselineFile;
  movedCurrent: boolean;
  originalExisted: boolean;
  relativePath: string;
  restoredPath?: string;
  rollbackPath: string;
  targetPath: string;
}

type ProtectedRestorePhase = "prepared" | "applying" | "committed";

interface IProtectedRestoreJournalOperation {
  applied: boolean;
  entryExists: boolean;
  movedCurrent: boolean;
  originalExisted: boolean;
  relativePath: string;
  restoredPath?: string;
  rollbackPath: string;
  targetPath: string;
}

interface IProtectedRestoreJournal {
  version: 1;
  transactionId: string;
  baselinePath: string;
  phase: ProtectedRestorePhase;
  operations: IProtectedRestoreJournalOperation[];
  updatedAt: string;
}

interface IProtectedRestoreJournalEnvelope {
  journal: IProtectedRestoreJournal;
  checksum: string;
}

function restoreJournalPath(baselinePath: string): string {
  return `${baselinePath}.restore-journal.json`;
}

function restoreJournalChecksum(journal: IProtectedRestoreJournal): string {
  return createHash("sha256").update(JSON.stringify(journal)).digest("hex");
}

async function persistRestoreJournal(
  journal: IProtectedRestoreJournal,
): Promise<IProtectedRestoreJournal> {
  const updated = { ...journal, updatedAt: new Date().toISOString() };
  const envelope: IProtectedRestoreJournalEnvelope = {
    journal: updated,
    checksum: restoreJournalChecksum(updated),
  };
  await writeFileAtomic(
    restoreJournalPath(updated.baselinePath),
    JSON.stringify(envelope, undefined, 2),
  );
  return updated;
}

async function readRestoreJournal(
  baselinePath: string,
): Promise<IProtectedRestoreJournal | undefined> {
  const filePath = restoreJournalPath(baselinePath);
  let raw: string;
  try {
    const stats = await nativeFs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw Object.assign(new Error("Protected restore journal is not a regular file"), {
        code: "EBASELINERESTOREJOURNALINTEGRITY",
      });
    }
    raw = await nativeFs.readFile(filePath, "utf8");
  } catch (err: unknown) {
    if (getErrorCode(err) === "ENOENT") return undefined;
    throw err;
  }
  const envelope = JSON.parse(raw) as IProtectedRestoreJournalEnvelope;
  const journal = envelope?.journal;
  if (
    journal?.version !== 1 ||
    path.resolve(journal.baselinePath) !== path.resolve(baselinePath) ||
    !["prepared", "applying", "committed"].includes(journal.phase) ||
    !Array.isArray(journal.operations) ||
    envelope.checksum !== restoreJournalChecksum(journal)
  ) {
    throw Object.assign(new Error("Protected restore journal failed its integrity check"), {
      code: "EBASELINERESTOREJOURNALINTEGRITY",
    });
  }
  return journal;
}

function toRestoreJournalOperations(
  prepared: IPreparedBaselineRestore[],
): IProtectedRestoreJournalOperation[] {
  return prepared.map((operation) => ({
    applied: operation.applied,
    entryExists: operation.entry.exists,
    movedCurrent: operation.movedCurrent,
    originalExisted: operation.originalExisted,
    relativePath: operation.relativePath,
    restoredPath: operation.restoredPath,
    rollbackPath: operation.rollbackPath,
    targetPath: operation.targetPath,
  }));
}

async function retireCommittedRestoreJournal(journal: IProtectedRestoreJournal): Promise<void> {
  await Promise.all(
    journal.operations.flatMap((operation) => [
      operation.restoredPath !== undefined
        ? nativeFs.rm(operation.restoredPath, { force: true }).catch(() => undefined)
        : Promise.resolve(),
      nativeFs.rm(operation.rollbackPath, { force: true }).catch(() => undefined),
    ]),
  );
  await nativeFs.rm(restoreJournalPath(journal.baselinePath), { force: true });
}

async function prepareBaselineRestore(
  baselinePath: string,
  targetRoot: string,
  relativePath: string,
  entry: IProtectedBaselineFile,
): Promise<IPreparedBaselineRestore> {
  const targetPath = path.resolve(targetRoot, relativePath);
  await assertLinuxPathHasNoSymlinkAncestors(targetRoot, targetPath);
  await nativeFs.mkdir(path.dirname(targetPath), { recursive: true });
  const rollbackPath = `${targetPath}.lotrex-rollback-${randomUUID()}`;
  let restoredPath: string | undefined;
  let originalExisted = false;
  try {
    const current = await nativeFs.lstat(targetPath);
    if (!current.isFile() && !current.isSymbolicLink()) {
      throw Object.assign(new Error(`Refusing to replace a non-file target: ${relativePath}`), {
        code: "EBASELINERESTOREUNSAFE",
      });
    }
    originalExisted = true;
  } catch (err: unknown) {
    if (getErrorCode(err) !== "ENOENT") throw err;
  }
  if (entry.exists) {
    const blobPath = await verifyBackupBlob(baselinePath, entry);
    restoredPath = `${targetPath}.lotrex-restore-${randomUUID()}`;
    await nativeFs.copyFile(blobPath, restoredPath);
    if ((await hashFile(restoredPath)) !== entry.sha256) {
      await nativeFs.rm(restoredPath, { force: true });
      throw Object.assign(new Error("Restored temporary file failed checksum verification"), {
        code: "EBASELINERESTOREINTEGRITY",
      });
    }
    if (entry.mode !== undefined) await nativeFs.chmod(restoredPath, entry.mode);
  }
  return {
    applied: false,
    entry,
    movedCurrent: false,
    originalExisted,
    relativePath,
    restoredPath,
    rollbackPath,
    targetPath,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await nativeFs.lstat(filePath);
    return true;
  } catch (err: unknown) {
    if (getErrorCode(err) === "ENOENT") return false;
    throw err;
  }
}

/** Rolls an interrupted protected restore back to the pre-restore filesystem state. */
export async function rollbackInterruptedProtectedRestore(
  options: IProtectedBaselineOptions,
): Promise<boolean> {
  if (process.platform !== "linux") return false;
  const baselinePath = baselineFilePath(options);
  const journal = await readRestoreJournal(baselinePath);
  if (journal === undefined) return false;
  if (journal.phase === "committed") {
    await retireCommittedRestoreJournal(journal);
    return true;
  }
  const baseline = await readBaseline(baselinePath);
  if (baseline === undefined) {
    throw Object.assign(new Error("Cannot recover restore transaction without its baseline"), {
      code: "EBASELINEMISSING",
    });
  }

  const unsafe: string[] = [];
  for (const operation of [...journal.operations].reverse()) {
    const expectedTargetPath = path.resolve(options.targetRoot, operation.relativePath);
    const rollbackPrefix = `${expectedTargetPath}.lotrex-rollback-`;
    const restorePrefix = `${expectedTargetPath}.lotrex-restore-`;
    if (
      path.resolve(operation.targetPath) !== expectedTargetPath ||
      !path.resolve(operation.rollbackPath).startsWith(rollbackPrefix) ||
      (operation.restoredPath !== undefined &&
        !path.resolve(operation.restoredPath).startsWith(restorePrefix))
    ) {
      throw Object.assign(new Error("Protected restore journal contains an unsafe path"), {
        code: "EBASELINERESTOREJOURNALINTEGRITY",
      });
    }
    await assertLinuxPathHasNoSymlinkAncestors(options.targetRoot, operation.targetPath);
    if (await pathExists(operation.rollbackPath)) {
      if (await pathExists(operation.targetPath)) {
        const targetStats = await nativeFs.lstat(operation.targetPath);
        if (!targetStats.isFile() && !targetStats.isSymbolicLink()) {
          unsafe.push(operation.relativePath);
          continue;
        }
        await nativeFs.rm(operation.targetPath, { force: true });
      }
      await nativeFs.rename(operation.rollbackPath, operation.targetPath);
    } else if (operation.movedCurrent && operation.originalExisted) {
      unsafe.push(operation.relativePath);
      continue;
    } else if (!operation.originalExisted && (await pathExists(operation.targetPath))) {
      const expected = baseline.files[operation.relativePath];
      const actual = await snapshotFile(operation.targetPath);
      if (expected === undefined || !equalSnapshot(expected, actual)) {
        unsafe.push(operation.relativePath);
        continue;
      }
      await nativeFs.rm(operation.targetPath, { force: true });
    }
    if (operation.restoredPath !== undefined) {
      await nativeFs.rm(operation.restoredPath, { force: true }).catch(() => undefined);
    }
  }
  if (unsafe.length > 0) {
    throw Object.assign(new Error(`Interrupted restore is ambiguous for: ${unsafe.join(", ")}`), {
      code: "EBASELINERESTOREAMBIGUOUS",
      files: unsafe,
      journal: restoreJournalPath(baselinePath),
    });
  }
  await nativeFs.rm(restoreJournalPath(baselinePath), { force: true });
  return true;
}

export interface IProtectedRestoreInspection {
  error?: Error;
  files: string[];
  phase?: ProtectedRestorePhase;
  status: "incomplete" | "invalid";
  transactionId?: string;
}

export async function inspectProtectedRestoreJournal(
  options: IProtectedBaselineOptions,
): Promise<IProtectedRestoreInspection | undefined> {
  if (process.platform !== "linux") return undefined;
  try {
    const journal = await readRestoreJournal(baselineFilePath(options));
    if (journal === undefined) return undefined;
    return {
      files: journal.operations.map((operation) => operation.relativePath),
      phase: journal.phase,
      status: "incomplete",
      transactionId: journal.transactionId,
    };
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err : new Error("Failed to inspect protected restore journal"),
      files: [],
      status: "invalid",
    };
  }
}

/** Restores selected critical files only after an explicit user-approved recovery action. */
export async function restoreCriticalBaselineFiles(
  options: IProtectedBaselineOptions,
  relativePaths: string[],
): Promise<void> {
  if (process.platform !== "linux") return;
  const baselinePath = baselineFilePath(options);
  const baseline = await readBaseline(baselinePath);
  if (baseline === undefined) {
    throw Object.assign(new Error("No protected baseline exists for this installation"), {
      code: "EBASELINEMISSING",
    });
  }
  const previousJournal = await readRestoreJournal(baselinePath);
  if (previousJournal?.phase === "committed") {
    await retireCommittedRestoreJournal(previousJournal);
  } else if (previousJournal !== undefined) {
    throw Object.assign(
      new Error(
        `Protected restore transaction ${previousJournal.transactionId} is incomplete at phase ${previousJournal.phase}`,
      ),
      {
        code: "EBASELINERESTOREINCOMPLETE",
        journal: restoreJournalPath(baselinePath),
        transactionId: previousJournal.transactionId,
      },
    );
  }
  const prepared: IPreparedBaselineRestore[] = [];
  let committed = false;
  let journal: IProtectedRestoreJournal | undefined;
  try {
    for (const relativePath of [...new Set(relativePaths)].sort()) {
      const entry = baseline.files[relativePath];
      if (entry === undefined) {
        throw Object.assign(
          new Error(`File is not present in the protected baseline: ${relativePath}`),
          { code: "EBASELINEENTRYMISSING" },
        );
      }
      prepared.push(
        await prepareBaselineRestore(baselinePath, options.targetRoot, relativePath, entry),
      );
    }

    const now = new Date().toISOString();
    journal = await persistRestoreJournal({
      version: 1,
      transactionId: randomUUID(),
      baselinePath,
      phase: "prepared",
      operations: toRestoreJournalOperations(prepared),
      updatedAt: now,
    });
    journal = await persistRestoreJournal({ ...journal, phase: "applying" });

    for (const operation of prepared) {
      try {
        await nativeFs.rename(operation.targetPath, operation.rollbackPath);
        operation.movedCurrent = true;
        journal = await persistRestoreJournal({
          ...journal,
          operations: toRestoreJournalOperations(prepared),
        });
      } catch (err: unknown) {
        if (getErrorCode(err) !== "ENOENT") throw err;
      }
      if (operation.entry.exists) {
        await nativeFs.rename(operation.restoredPath!, operation.targetPath);
        operation.restoredPath = undefined;
      }
      operation.applied = true;
      journal = await persistRestoreJournal({
        ...journal,
        operations: toRestoreJournalOperations(prepared),
      });
    }
    journal = await persistRestoreJournal({
      ...journal,
      phase: "committed",
      operations: toRestoreJournalOperations(prepared),
    });
    committed = true;
  } catch (err: unknown) {
    let rollbackError: unknown;
    for (const operation of [...prepared].reverse()) {
      if (operation.entry.exists && operation.restoredPath === undefined) {
        await nativeFs.rm(operation.targetPath, { force: true }).catch(() => undefined);
      }
      if (operation.movedCurrent) {
        try {
          await nativeFs.rename(operation.rollbackPath, operation.targetPath);
          operation.movedCurrent = false;
        } catch (restoreErr: unknown) {
          rollbackError ??= restoreErr;
        }
      }
      operation.applied = false;
    }
    if (rollbackError !== undefined) {
      if (journal !== undefined) {
        await persistRestoreJournal({
          ...journal,
          operations: toRestoreJournalOperations(prepared),
        }).catch(() => undefined);
      }
      throw Object.assign(
        new Error("Protected restore failed and rollback is incomplete", { cause: err }),
        {
          code: "EBASELINEROLLBACKINCOMPLETE",
          rollbackError,
          rollbackPaths: prepared
            .filter((operation) => operation.movedCurrent)
            .map((operation) => operation.rollbackPath),
        },
      );
    }
    if (journal !== undefined) {
      await nativeFs.rm(restoreJournalPath(baselinePath), { force: true }).catch(() => undefined);
    }
    throw err;
  } finally {
    await Promise.all(
      prepared.flatMap((operation) => [
        operation.restoredPath !== undefined
          ? nativeFs.rm(operation.restoredPath, { force: true }).catch(() => undefined)
          : Promise.resolve(),
        committed || !operation.movedCurrent
          ? nativeFs.rm(operation.rollbackPath, { force: true }).catch(() => undefined)
          : Promise.resolve(),
      ]),
    );
    if (committed && journal !== undefined) {
      await nativeFs.rm(restoreJournalPath(baselinePath), { force: true }).catch(() => undefined);
    }
  }
}
