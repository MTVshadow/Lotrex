import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

interface IBenchmarkResult {
  cancelled: boolean;
  cancellationLatencyMs?: number;
  coldDeploymentMs: number;
  fileCount: number;
  manifestBytes: number;
  peakHeapBytes: number;
  warmValidationMs: number;
}

function numericArgument(name: string, fallback?: number): number | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be followed by a positive integer`);
  }
  return parsed;
}

async function runBenchmark(fileCount: number, cancelAfterMs?: number): Promise<IBenchmarkResult> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-linux-deployment-bench-"));
  const staging = path.join(root, "staging");
  const data = path.join(root, "data");
  const manifest: Array<{ relPath: string; source: string }> = [];
  let peakHeapBytes = process.memoryUsage().heapUsed;
  let cancelRequestedAt: number | undefined;
  let cancelledAt: number | undefined;
  let timer: NodeJS.Timeout | undefined;

  const requestCancellation = () => {
    cancelRequestedAt ??= performance.now();
  };
  process.once("SIGINT", requestCancellation);
  if (cancelAfterMs !== undefined) timer = setTimeout(requestCancellation, cancelAfterMs);

  try {
    await Promise.all([fs.mkdir(staging), fs.mkdir(data)]);
    const coldStartedAt = performance.now();
    for (let index = 0; index < fileCount; index++) {
      if (cancelRequestedAt !== undefined) {
        cancelledAt = performance.now();
        break;
      }
      const bucket = String(Math.floor(index / 1000)).padStart(4, "0");
      const name = `${String(index).padStart(6, "0")}.bin`;
      const relPath = path.join(bucket, name);
      const source = path.join(staging, relPath);
      const target = path.join(data, relPath);
      if (index % 1000 === 0) {
        await Promise.all([fs.mkdir(path.dirname(source)), fs.mkdir(path.dirname(target))]);
      }
      await fs.writeFile(source, "vortex-benchmark");
      await fs.link(source, target);
      manifest.push({ relPath, source: "benchmark" });
      if (index % 250 === 0) {
        peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    const coldDeploymentMs = performance.now() - coldStartedAt;

    const warmStartedAt = performance.now();
    for (const entry of manifest) {
      const source = await fs.stat(path.join(staging, entry.relPath));
      const target = await fs.stat(path.join(data, entry.relPath));
      if (source.dev !== target.dev || source.ino !== target.ino) {
        throw new Error(`Hardlink identity mismatch: ${entry.relPath}`);
      }
    }

    return {
      cancelled: cancelledAt !== undefined,
      cancellationLatencyMs:
        cancelRequestedAt !== undefined && cancelledAt !== undefined
          ? cancelledAt - cancelRequestedAt
          : undefined,
      coldDeploymentMs,
      fileCount: manifest.length,
      manifestBytes: Buffer.byteLength(JSON.stringify(manifest), "utf8"),
      peakHeapBytes,
      warmValidationMs: performance.now() - warmStartedAt,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    process.removeListener("SIGINT", requestCancellation);
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  if (process.platform !== "linux") throw new Error("This benchmark is Linux-only");
  const fileCount = numericArgument("--files", 100_000)!;
  const cancelAfterMs = numericArgument("--cancel-after-ms");
  const result = await runBenchmark(fileCount, cancelAfterMs);
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
