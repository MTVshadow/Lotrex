import * as path from "node:path";

import calculateFolderSize from "./calculateFolderSize";
import * as fs from "./fs";

interface IFolderFingerprint {
  ctimeMs: number;
  dev: number;
  ino: number;
  mtimeMs: number;
}

interface IFolderSizeCacheEntry {
  fingerprint: string;
  size: Promise<number>;
}

type CalculateSize = (dirPath: string) => Promise<number>;
type ReadFingerprint = (dirPath: string) => Promise<IFolderFingerprint>;

export class FolderSizeCache {
  private readonly mEntries = new Map<string, IFolderSizeCacheEntry>();

  constructor(
    private readonly mCalculateSize: CalculateSize,
    private readonly mReadFingerprint: ReadFingerprint,
  ) {}

  public async get(dirPath: string): Promise<number> {
    const key = path.resolve(dirPath);
    let fingerprint: string;
    try {
      const stats = await this.mReadFingerprint(key);
      fingerprint = `${stats.dev}:${stats.ino}:${stats.mtimeMs}:${stats.ctimeMs}`;
    } catch {
      this.mEntries.delete(key);
      return this.mCalculateSize(key);
    }

    const cached = this.mEntries.get(key);
    if (cached?.fingerprint === fingerprint) return cached.size;

    const size = this.mCalculateSize(key).catch((err) => {
      if (this.mEntries.get(key)?.size === size) this.mEntries.delete(key);
      throw err;
    });
    this.mEntries.set(key, { fingerprint, size });
    return size;
  }

  public invalidate(dirPath?: string): void {
    if (dirPath === undefined) {
      this.mEntries.clear();
      return;
    }
    const root = path.resolve(dirPath);
    for (const key of this.mEntries.keys()) {
      const relative = path.relative(root, key);
      if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
        this.mEntries.delete(key);
      }
    }
  }
}

const folderSizeCache = new FolderSizeCache(calculateFolderSize, async (dirPath) => {
  const stats = await fs.statAsync(dirPath);
  return {
    ctimeMs: stats.ctimeMs,
    dev: stats.dev,
    ino: stats.ino,
    mtimeMs: stats.mtimeMs,
  };
});

export const calculateFolderSizeCached = (dirPath: string): Promise<number> =>
  folderSizeCache.get(dirPath);

export const invalidateFolderSizeCache = (dirPath?: string): void =>
  folderSizeCache.invalidate(dirPath);
