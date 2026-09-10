import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IDiscoveredResource } from "./contracts";
import { DiscoveryCache } from "./discoveryCache";
import {
  checkCancellation,
  DiscoveryCancelledError,
  DiscoveryTimeoutError,
  enforceResourceLimits,
  withDiscoveryLimits,
  yieldToUiLoop,
  type IDiscoveryProgress,
} from "./progressAndLimits";
import { runUnifiedResourceDiscovery } from "./resourceDiscoveryEngine";

describe("Unified Linux Resource Discovery — Phase 7: Async Progress, Cancellation, and Limits", () => {
  let tempDir: string;
  let homeDir: string;
  let mockEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-progress-test-"));
    homeDir = path.join(tempDir, "user");
    mockEnv = {
      HOME: homeDir,
      XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
      XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    };

    await fs.mkdir(path.join(mockEnv.XDG_DATA_HOME!, "Steam", "steamapps"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("progress and limits primitives", () => {
    it("yieldToUiLoop resolves cooperatively", async () => {
      let yielded = false;
      const promise = yieldToUiLoop().then(() => {
        yielded = true;
      });
      expect(yielded).toBe(false);
      await promise;
      expect(yielded).toBe(true);
    });

    it("throws DiscoveryCancelledError when signal is already aborted", () => {
      const controller = new AbortController();
      controller.abort();

      expect(() => checkCancellation(controller.signal)).toThrow(DiscoveryCancelledError);
    });

    it("enforces timeout with DiscoveryTimeoutError", async () => {
      const slowOp = () => new Promise((resolve) => setTimeout(resolve, 200));

      await expect(withDiscoveryLimits(slowOp, { timeoutMs: 30 })).rejects.toThrow(
        DiscoveryTimeoutError,
      );
    });

    it("enforces resource limits per provider and overall total", () => {
      const createMock = (provider: "steam" | "heroic", id: string): IDiscoveredResource => ({
        id,
        kind: "game",
        provider,
        canonicalPath: `/path/${id}`,
        packagingContext: { format: "native" },
        evidence: [{ sourceType: "manifest", sourcePath: "/path", timestamp: 1 }],
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: 1,
      });

      const resources: IDiscoveredResource[] = [
        createMock("steam", "s1"),
        createMock("steam", "s2"),
        createMock("steam", "s3"),
        createMock("heroic", "h1"),
        createMock("heroic", "h2"),
      ];

      // Limit max 2 per provider
      const providerLimited = enforceResourceLimits(resources, {
        maxEntriesPerProvider: 2,
        maxTotalResources: 10,
      });
      expect(providerLimited).toHaveLength(4); // 2 steam + 2 heroic

      // Limit max total to 3
      const totalLimited = enforceResourceLimits(resources, {
        maxEntriesPerProvider: 5,
        maxTotalResources: 3,
      });
      expect(totalLimited).toHaveLength(3);
    });
  });

  describe("integrated progress, caching, and limits in engine", () => {
    it("reports all discovery phases via onProgress callback", async () => {
      const progressReports: IDiscoveryProgress[] = [];

      const report = await runUnifiedResourceDiscovery({
        env: mockEnv,
        homeDir,
        providers: ["steam", "heroic"],
        onProgress: (p) => progressReports.push(p),
      });

      expect(report.scannedSourcesCount).toBeGreaterThan(0);
      expect(progressReports.length).toBeGreaterThanOrEqual(4);

      const phases = progressReports.map((p) => p.phase);
      expect(phases).toContain("initializing");
      expect(phases).toContain("probing-steam");
      expect(phases).toContain("validating-candidates");
      expect(phases).toContain("canonicalizing");
      expect(phases).toContain("completed");
    });

    it("utilizes DiscoveryCache across runs and respects forceRefresh", async () => {
      const steamRoot = path.join(mockEnv.XDG_DATA_HOME!, "Steam");
      await fs.writeFile(
        path.join(steamRoot, "steamapps", "libraryfolders.vdf"),
        `"libraryfolders" { "0" { "path" "${steamRoot}" } }`,
      );

      const cache = new DiscoveryCache(50);

      // First run populates cache
      const report1 = await runUnifiedResourceDiscovery({
        env: mockEnv,
        homeDir,
        providers: ["steam"],
        cache,
      });
      expect(report1.resources.length).toBeGreaterThan(0);
      expect(cache.getStats().size).toBeGreaterThan(0);

      const initialHits = cache.getStats().hits;

      // Second run reuses cache
      const report2 = await runUnifiedResourceDiscovery({
        env: mockEnv,
        homeDir,
        providers: ["steam"],
        cache,
        forceRefresh: false,
      });
      expect(report2.resources).toHaveLength(report1.resources.length);
      expect(cache.getStats().hits).toBeGreaterThan(initialHits);

      // Third run with forceRefresh bypasses cache
      const hitsBeforeForce = cache.getStats().hits;
      await runUnifiedResourceDiscovery({
        env: mockEnv,
        homeDir,
        providers: ["steam"],
        cache,
        forceRefresh: true,
      });
      expect(cache.getStats().hits).toBe(hitsBeforeForce);
    });

    it("aborts execution when signal is triggered mid-scan", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        runUnifiedResourceDiscovery({
          env: mockEnv,
          homeDir,
          signal: controller.signal,
        }),
      ).rejects.toThrow(DiscoveryCancelledError);
    });
  });
});
