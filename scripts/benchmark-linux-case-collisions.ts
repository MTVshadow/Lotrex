import { performance } from "node:perf_hooks";

import {
  detectCaseCollisions,
  type ICaseCollisionItem,
} from "../src/renderer/src/util/linux/caseCollisions";

interface ICaseCollisionBenchmarkResult {
  collisionCount: number;
  durationMs: number;
  entryCount: number;
  heapBudgetBytes: number;
  heapGrowthBytes: number;
  peakHeapBytes: number;
  progressEvents: number;
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

function* collisionItems(entryCount: number): Iterable<ICaseCollisionItem> {
  const deliberateCollisionEntries = Math.min(20, entryCount - (entryCount % 2));
  for (let index = 0; index < deliberateCollisionEntries; index++) {
    const pair = Math.floor(index / 2);
    yield {
      modId: `collision-mod-${index}`,
      relPath:
        index % 2 === 0
          ? `Textures/Benchmark/Collision-${pair}.dds`
          : `textures/benchmark/collision-${pair}.dds`,
    };
  }
  for (let index = deliberateCollisionEntries; index < entryCount; index++) {
    const bucket = String(Math.floor(index / 1_000)).padStart(4, "0");
    yield {
      modId: `benchmark-mod-${index % 250}`,
      relPath: `textures/benchmark/${bucket}/file-${String(index).padStart(6, "0")}.dds`,
    };
  }
}

function main(): void {
  if (process.platform !== "linux") throw new Error("This benchmark is Linux-only");
  const entryCount = numericArgument("--entries", 500_000);
  const heapBudgetBytes = numericArgument("--heap-budget-mib", 384) * 1024 * 1024;
  const expectedCollisions = Math.min(10, Math.floor(entryCount / 2));
  const initialHeapBytes = process.memoryUsage().heapUsed;
  let peakHeapBytes = initialHeapBytes;
  let progressEvents = 0;

  const startedAt = performance.now();
  const collisions = detectCaseCollisions(collisionItems(entryCount), {
    maxEntries: entryCount,
    onProgress: () => {
      ++progressEvents;
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    },
  });
  const durationMs = performance.now() - startedAt;
  peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
  const heapGrowthBytes = Math.max(0, peakHeapBytes - initialHeapBytes);

  if (collisions.length !== expectedCollisions) {
    throw new Error(`Expected ${expectedCollisions} collisions, found ${collisions.length}`);
  }
  if (heapGrowthBytes > heapBudgetBytes) {
    throw new Error(
      `Case-collision scan exceeded its ${heapBudgetBytes}-byte heap-growth budget: ${heapGrowthBytes}`,
    );
  }

  const result: ICaseCollisionBenchmarkResult = {
    collisionCount: collisions.length,
    durationMs,
    entryCount,
    heapBudgetBytes,
    heapGrowthBytes,
    peakHeapBytes,
    progressEvents,
  };
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
