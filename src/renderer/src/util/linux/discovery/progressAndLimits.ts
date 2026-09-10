import type { DiscoveredResourceKind, DiscoveryProviderId, IDiscoveredResource } from "./contracts";

export interface IDiscoveryProgress {
  phase: string;
  provider?: DiscoveryProviderId;
  current: number;
  total?: number;
  message?: string;
}

export interface IDiscoveryLimits {
  /** Maximum number of resources allowed per provider */
  maxEntriesPerProvider?: number;
  /** Maximum total resources returned by the engine */
  maxTotalResources?: number;
  /** Overall timeout in milliseconds */
  timeoutMs?: number;
  /** Interval in ms after which to yield control to the UI event loop */
  yieldIntervalMs?: number;
}

export class DiscoveryTimeoutError extends Error {
  public readonly code = "ETIMEDOUT";
  constructor(timeoutMs: number) {
    super(`Resource discovery timed out after ${timeoutMs}ms`);
    this.name = "DiscoveryTimeoutError";
  }
}

export class DiscoveryCancelledError extends Error {
  public readonly code = "ECANCELED";
  constructor(message = "Resource discovery was cancelled") {
    super(message);
    this.name = "DiscoveryCancelledError";
  }
}

/**
 * Yields control to the UI event loop cooperatively to prevent UI stutter (Phase 7).
 *
 * Educational comment:
 * Periodic yielding ensures Electron's main/renderer thread can process DOM updates,
 * keyboard input, and user cancellations during extensive discovery probes.
 */
export function yieldToUiLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Checks whether cancellation was requested via AbortSignal.
 */
export function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DiscoveryCancelledError();
  }
}

/**
 * Executes a discovery operation with strict timeout and cancellation guarantees.
 */
export async function withDiscoveryLimits<T>(
  operation: () => Promise<T>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { timeoutMs, signal } = options;

  checkCancellation(signal);

  if (!timeoutMs || timeoutMs <= 0) {
    return operation();
  }

  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DiscoveryTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const abortPromise = new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new DiscoveryCancelledError());
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(new DiscoveryCancelledError());
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([operation(), timeoutPromise, abortPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Enforces per-provider and total resource limits to prevent unbounded memory growth.
 */
export function enforceResourceLimits(
  resources: IDiscoveredResource[],
  limits: IDiscoveryLimits = {},
): IDiscoveredResource[] {
  const { maxEntriesPerProvider = 1000, maxTotalResources = 5000 } = limits;

  const providerCounts: Record<string, number> = {};
  const bounded: IDiscoveredResource[] = [];

  for (const res of resources) {
    if (bounded.length >= maxTotalResources) {
      break;
    }

    const currentCount = providerCounts[res.provider] || 0;
    if (currentCount >= maxEntriesPerProvider) {
      continue;
    }

    providerCounts[res.provider] = currentCount + 1;
    bounded.push(res);
  }

  return bounded;
}
