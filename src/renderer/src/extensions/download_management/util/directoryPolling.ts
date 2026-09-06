import * as fs from "node:fs/promises";
import * as path from "node:path";

export type DirectoryPollEvent = "rename" | "update";

export interface IDirectoryPollChange {
  event: DirectoryPollEvent;
  fileName: string;
}

export const MAX_POLLING_DIRECTORY_ENTRIES = 50_000;

export function isWatcherLimitError(err: unknown): boolean {
  return ["EMFILE", "ENOSPC"].includes((err as NodeJS.ErrnoException)?.code ?? "");
}

export async function snapshotDirectory(
  directoryPath: string,
  maximumEntries = MAX_POLLING_DIRECTORY_ENTRIES,
): Promise<Map<string, string>> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  if (entries.length > maximumEntries) {
    const err = new Error(
      `Polling fallback is limited to ${maximumEntries} directory entries; found ${entries.length}.`,
    );
    err["code"] = "EWATCHPOLLTOOLARGE";
    throw err;
  }

  const snapshot = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stats = await fs.stat(path.join(directoryPath, entry.name));
      snapshot.set(entry.name, `${stats.size}:${stats.mtimeMs}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }
  return snapshot;
}

export function diffDirectorySnapshots(
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): IDirectoryPollChange[] {
  const changes: IDirectoryPollChange[] = [];
  for (const [fileName, signature] of current) {
    if (!previous.has(fileName)) {
      changes.push({ event: "rename", fileName });
    } else if (previous.get(fileName) !== signature) {
      changes.push({ event: "update", fileName });
    }
  }
  for (const fileName of previous.keys()) {
    if (!current.has(fileName)) changes.push({ event: "rename", fileName });
  }
  return changes.sort((lhs, rhs) => lhs.fileName.localeCompare(rhs.fileName));
}
