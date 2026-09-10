import * as fs from "node:fs";

import type { IDiscoveredResource } from "./contracts";

export interface ICacheEntry<T> {
  key: string;
  fingerprint: string;
  value: T | null; // null indicates negative discovery (source is absent/empty)
  timestamp: number;
}

export interface ICacheLookupResult<T> {
  hit: boolean;
  isNegative: boolean;
  value?: T;
}

export interface IDiscoveryCacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
}

/**
 * Computes a deterministic filesystem fingerprint for a path based on mtime, size, and inode.
 *
 * Educational comment:
 * Allows detecting whether a manifest file (appmanifest, libraryfolders.vdf, installed.json, pga.db)
 * or directory has changed without re-parsing its full contents.
 */
export function computeFilesystemFingerprint(targetPath: string): string {
  try {
    const stat = fs.statSync(targetPath);
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return "absent";
    }
    return `error:${err?.code || "unknown"}`;
  }
}

/**
 * Memory-bounded LRU cache for discovery results with negative caching support (Phase 6).
 *
 * Educational comment:
 * Caches expensive manifest parsing and discovery probes.
 * Supports:
 * 1. Fingerprint-based validation (invalidates automatically when mtime/size/inode drifts).
 * 2. Negative discovery caching (remembers missing paths to avoid redundant I/O probes).
 * 3. Bounded memory consumption via LRU eviction policy.
 * 4. Explicit invalidation and refresh operations.
 */
export class DiscoveryCache {
  private readonly mMaxEntries: number;
  private readonly mEntries: Map<string, ICacheEntry<IDiscoveredResource[]>> = new Map();
  private mHits: number = 0;
  private mMisses: number = 0;

  constructor(maxEntries: number = 500) {
    this.mMaxEntries = Math.max(1, maxEntries);
  }

  /**
   * Looks up a cached entry by key and validates it against the current fingerprint.
   */
  public get(key: string, currentFingerprint: string): ICacheLookupResult<IDiscoveredResource[]> {
    const entry = this.mEntries.get(key);
    if (!entry) {
      this.mMisses++;
      return { hit: false, isNegative: false };
    }

    // Invalidate stale entry if fingerprint drifted
    if (entry.fingerprint !== currentFingerprint) {
      this.mEntries.delete(key);
      this.mMisses++;
      return { hit: false, isNegative: false };
    }

    // Re-insert for LRU freshness
    this.mEntries.delete(key);
    this.mEntries.set(key, entry);

    this.mHits++;
    if (entry.value === null) {
      return { hit: true, isNegative: true };
    }

    return { hit: true, isNegative: false, value: entry.value };
  }

  /**
   * Stores discovery results or a negative probe result in the cache.
   */
  public set(key: string, fingerprint: string, resources: IDiscoveredResource[] | null): void {
    if (this.mEntries.has(key)) {
      this.mEntries.delete(key);
    }

    // Evict oldest entries if capacity reached
    while (this.mEntries.size >= this.mMaxEntries) {
      const oldestKey = this.mEntries.keys().next().value;
      if (oldestKey !== undefined) {
        this.mEntries.delete(oldestKey);
      } else {
        break;
      }
    }

    this.mEntries.set(key, {
      key,
      fingerprint,
      value: resources ? [...resources] : null,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidates specific entries matching a key or pattern, or all entries if omitted.
   */
  public invalidate(pattern?: string | RegExp): void {
    if (!pattern) {
      this.mEntries.clear();
      return;
    }

    for (const key of Array.from(this.mEntries.keys())) {
      const matches = typeof pattern === "string" ? key.includes(pattern) : pattern.test(key);
      if (matches) {
        this.mEntries.delete(key);
      }
    }
  }

  /**
   * Clears the cache completely and resets hit/miss counters.
   */
  public clear(): void {
    this.mEntries.clear();
    this.mHits = 0;
    this.mMisses = 0;
  }

  /**
   * Returns cache metrics and memory statistics.
   */
  public getStats(): IDiscoveryCacheStats {
    return {
      size: this.mEntries.size,
      maxEntries: this.mMaxEntries,
      hits: this.mHits,
      misses: this.mMisses,
    };
  }
}
