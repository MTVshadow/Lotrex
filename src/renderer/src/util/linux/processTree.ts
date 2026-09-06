export type ProcessSignal = "SIGTERM" | "SIGKILL";

export interface IProcessTreeSignalOptions {
  kill?: (pid: number, signal: ProcessSignal) => void;
  platform?: NodeJS.Platform;
}

const MIN_MANAGED_PROCESS_TIMEOUT_MS = 5_000;
const MAX_MANAGED_PROCESS_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export function parseManagedProcessTimeout(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const timeoutMS = Number(value);
  return Number.isSafeInteger(timeoutMS) &&
    timeoutMS >= MIN_MANAGED_PROCESS_TIMEOUT_MS &&
    timeoutMS <= MAX_MANAGED_PROCESS_TIMEOUT_MS
    ? timeoutMS
    : undefined;
}

/** Signal only the process tree rooted in a child that Vortex spawned as a POSIX process group. */
export function signalManagedProcessTree(
  pid: number,
  signal: ProcessSignal,
  options: IProcessTreeSignalOptions = {},
): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  const platform = options.platform ?? process.platform;
  const kill = options.kill ?? process.kill;
  const target = platform === "linux" || platform === "darwin" ? -pid : pid;
  try {
    kill(target, signal);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ESRCH") {
      return false;
    }
    throw err;
  }
}
