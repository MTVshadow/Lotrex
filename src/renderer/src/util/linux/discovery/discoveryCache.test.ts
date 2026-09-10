import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { IDiscoveredResource } from "./contracts";
import { computeFilesystemFingerprint, DiscoveryCache } from "./discoveryCache";

describe("Unified Linux Resource Discovery — Phase 6: Cache and Invalidation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-cache-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("computeFilesystemFingerprint", () => {
    it("generates deterministic fingerprint for existing files", async () => {
      const filePath = path.join(tempDir, "manifest.json");
      await fs.writeFile(filePath, '{"version": 1}');

      const fp1 = computeFilesystemFingerprint(filePath);
      const fp2 = computeFilesystemFingerprint(filePath);
      expect(fp1).toBe(fp2);
      expect(fp1).not.toBe("absent");
    });

    it("changes fingerprint when file is modified", async () => {
      const filePath = path.join(tempDir, "manifest.vdf");
      await fs.writeFile(filePath, "initial");
      const fp1 = computeFilesystemFingerprint(filePath);

      // Modify file and mtime
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(filePath, "modified content with longer size");
      const fp2 = computeFilesystemFingerprint(filePath);

      expect(fp1).not.toBe(fp2);
    });

    it("returns 'absent' for non-existent files", () => {
      const missing = path.join(tempDir, "non_existent_file.db");
      expect(computeFilesystemFingerprint(missing)).toBe("absent");
    });
  });

  describe("DiscoveryCache", () => {
    const createMockResource = (id: string): IDiscoveredResource => ({
      id,
      kind: "game",
      provider: "steam",
      canonicalPath: `/games/${id}`,
      packagingContext: { format: "native" },
      evidence: [{ sourceType: "manifest", sourcePath: "/manifest", timestamp: 1 }],
      confidence: "confirmed",
      validationState: { status: "valid" },
      sourceTimestamp: 1,
    });

    it("caches and retrieves successful discovery probes", () => {
      const cache = new DiscoveryCache(10);
      const res = [createMockResource("steam:game:1")];

      cache.set("source:steam:main", "fp-123", res);

      const hit = cache.get("source:steam:main", "fp-123");
      expect(hit.hit).toBe(true);
      expect(hit.isNegative).toBe(false);
      expect(hit.value).toHaveLength(1);
      expect(hit.value?.[0].id).toBe("steam:game:1");

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it("invalidates cached entry when fingerprint drifts", () => {
      const cache = new DiscoveryCache(10);
      cache.set("source:steam:main", "fp-old", [createMockResource("steam:game:1")]);

      // Request with new fingerprint
      const result = cache.get("source:steam:main", "fp-new");
      expect(result.hit).toBe(false);

      // Stale entry must have been evicted
      expect(cache.getStats().misses).toBe(1);
      expect(cache.getStats().size).toBe(0);
    });

    it("supports negative discovery caching (null value)", () => {
      const cache = new DiscoveryCache(10);
      // Cache negative discovery (absent source)
      cache.set("source:lutris:db", "absent", null);

      const result = cache.get("source:lutris:db", "absent");
      expect(result.hit).toBe(true);
      expect(result.isNegative).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it("enforces memory bounds and LRU eviction policy", () => {
      const cache = new DiscoveryCache(3);

      cache.set("key1", "fp1", [createMockResource("1")]);
      cache.set("key2", "fp2", [createMockResource("2")]);
      cache.set("key3", "fp3", [createMockResource("3")]);

      expect(cache.getStats().size).toBe(3);

      // Access key1 to refresh its LRU position
      cache.get("key1", "fp1");

      // Insert key4, should evict key2 (oldest unaccessed)
      cache.set("key4", "fp4", [createMockResource("4")]);

      expect(cache.getStats().size).toBe(3);
      expect(cache.get("key2", "fp2").hit).toBe(false);
      expect(cache.get("key1", "fp1").hit).toBe(true);
      expect(cache.get("key3", "fp3").hit).toBe(true);
      expect(cache.get("key4", "fp4").hit).toBe(true);
    });

    it("supports selective and complete invalidation", () => {
      const cache = new DiscoveryCache(10);
      cache.set("steam:lib1", "fp1", [createMockResource("1")]);
      cache.set("steam:lib2", "fp2", [createMockResource("2")]);
      cache.set("heroic:gog", "fp3", [createMockResource("3")]);

      // Invalidate only steam entries
      cache.invalidate("steam:");
      expect(cache.get("steam:lib1", "fp1").hit).toBe(false);
      expect(cache.get("heroic:gog", "fp3").hit).toBe(true);

      // Clear all
      cache.clear();
      expect(cache.getStats().size).toBe(0);
      expect(cache.getStats().hits).toBe(0);
    });
  });
});
