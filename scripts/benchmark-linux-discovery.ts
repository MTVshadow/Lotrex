import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

import { ProtonPaths } from "../src/renderer/src/util/linux/ProtonPaths";
import {
  discoverLinuxSteamLibrariesAsync,
  invalidateLinuxSteamLibraryCache,
} from "../src/renderer/src/util/linux/steamPaths";

interface IDiscoveryBenchmarkResult {
  libraryColdMs: number;
  libraryCount: number;
  libraryWarmMs: number;
  peakHeapBytes: number;
  prefixColdMs: number;
  prefixCount: number;
  prefixInvalidationMs: number;
  prefixWarmMs: number;
  startupBudgetMs: number;
}

function numericArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be followed by a positive integer`);
  }
  return parsed;
}

function libraryVdf(steamRoot: string, count: number): string {
  const entries = Array.from({ length: count }, (_, index) => {
    const libraryPath =
      index === 0 ? steamRoot : path.join(steamRoot, `library-${String(index).padStart(4, "0")}`);
    return `  "${index}"\n  {\n    "path" "${libraryPath}"\n  }`;
  });
  return `"libraryfolders"\n{\n${entries.join("\n")}\n}`;
}

async function createPrefix(steamApps: string, index: number): Promise<void> {
  const appId = String(1_000_000 + index);
  await fs.mkdir(
    path.join(steamApps, "compatdata", appId, "pfx", "drive_c", "users", "steamuser"),
    { recursive: true },
  );
  await fs.mkdir(path.join(steamApps, "common", `Benchmark Game ${index}`), { recursive: true });
}

function resolvePrefix(steamApps: string, index: number) {
  return ProtonPaths.resolve({
    appId: String(1_000_000 + index),
    discovery: {
      path: path.join(steamApps, "common", `Benchmark Game ${index}`),
      store: "steam",
    },
    gameMode: `linux-discovery-benchmark-${index}`,
  });
}

async function runBenchmark(
  libraryCount: number,
  prefixCount: number,
  startupBudgetMs: number,
): Promise<IDiscoveryBenchmarkResult> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-linux-discovery-bench-"));
  const steamRoot = path.join(root, "Steam");
  const steamApps = path.join(steamRoot, "steamapps");
  const vdfPath = path.join(steamRoot, "config", "libraryfolders.vdf");
  let peakHeapBytes = process.memoryUsage().heapUsed;

  try {
    await fs.mkdir(path.dirname(vdfPath), { recursive: true });
    await fs.writeFile(vdfPath, libraryVdf(steamRoot, libraryCount));
    for (let index = 0; index < prefixCount; index++) await createPrefix(steamApps, index);
    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);

    invalidateLinuxSteamLibraryCache(steamRoot);
    const libraryColdStartedAt = performance.now();
    const coldLibraries = await discoverLinuxSteamLibrariesAsync(steamRoot);
    const libraryColdMs = performance.now() - libraryColdStartedAt;
    if (coldLibraries.length !== libraryCount) {
      throw new Error(`Expected ${libraryCount} unique libraries, found ${coldLibraries.length}`);
    }

    const libraryWarmStartedAt = performance.now();
    const warmLibraries = await discoverLinuxSteamLibrariesAsync(steamRoot);
    const libraryWarmMs = performance.now() - libraryWarmStartedAt;
    if (warmLibraries.length !== coldLibraries.length)
      throw new Error("Warm library cache mismatch");

    ProtonPaths.invalidate();
    const prefixColdStartedAt = performance.now();
    const coldPrefixes = Array.from({ length: prefixCount }, (_, index) =>
      resolvePrefix(steamApps, index),
    );
    const prefixColdMs = performance.now() - prefixColdStartedAt;
    if (coldPrefixes.some((prefix) => prefix === undefined)) {
      throw new Error("At least one generated compatdata prefix was not resolved");
    }

    const prefixWarmStartedAt = performance.now();
    const warmPrefixes = Array.from({ length: prefixCount }, (_, index) =>
      resolvePrefix(steamApps, index),
    );
    const prefixWarmMs = performance.now() - prefixWarmStartedAt;
    if (warmPrefixes.some((prefix, index) => prefix !== coldPrefixes[index])) {
      throw new Error("Warm compatdata lookup did not reuse every cached result");
    }

    const firstUsers = path.join(steamApps, "compatdata", "1000000", "pfx", "drive_c", "users");
    await fs.rename(path.join(firstUsers, "steamuser"), path.join(firstUsers, "replacement"));
    const future = new Date(Date.now() + 2_000);
    await fs.utimes(firstUsers, future, future);
    const invalidationStartedAt = performance.now();
    const refreshed = resolvePrefix(steamApps, 0);
    const prefixInvalidationMs = performance.now() - invalidationStartedAt;
    if (refreshed === coldPrefixes[0] || refreshed?.userName !== "replacement") {
      throw new Error("Compatdata fingerprint did not invalidate a rebuilt user profile");
    }

    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    if (libraryColdMs + prefixColdMs > startupBudgetMs) {
      throw new Error(
        `Cold discovery exceeded ${startupBudgetMs} ms budget: ${(libraryColdMs + prefixColdMs).toFixed(2)} ms`,
      );
    }

    return {
      libraryColdMs,
      libraryCount,
      libraryWarmMs,
      peakHeapBytes,
      prefixColdMs,
      prefixCount,
      prefixInvalidationMs,
      prefixWarmMs,
      startupBudgetMs,
    };
  } finally {
    ProtonPaths.invalidate();
    invalidateLinuxSteamLibraryCache(steamRoot);
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  if (process.platform !== "linux") throw new Error("This benchmark is Linux-only");
  const libraryCount = numericArgument("--libraries", 250);
  const prefixCount = numericArgument("--prefixes", 250);
  const startupBudgetMs = numericArgument("--startup-budget-ms", 5_000);
  const result = await runBenchmark(libraryCount, prefixCount, startupBudgetMs);
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
