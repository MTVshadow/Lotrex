import type { ProcessLayer } from "./processDiagnostics";

export type ProcessSignal = "SIGTERM" | "SIGKILL";

export interface IProcessTreeSignalOptions {
  kill?: (pid: number, signal: ProcessSignal) => void;
  platform?: NodeJS.Platform;
}

export const MIN_MANAGED_PROCESS_TIMEOUT_MS = 5_000;
export const MAX_MANAGED_PROCESS_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_SLOW_START_THRESHOLD_MS = 15_000;
export const DEFAULT_SIGKILL_ESCALATION_MS = 5_000;

export type ManagedProcessState = "starting" | "ready" | "terminated";

/**
 * Parses and bounds the opt-in launch timeout (VORTEX_PROTON_LAUNCH_TIMEOUT_MS).
 * Bounds the value between 5 seconds and 24 hours to prevent unbounded execution
 * while avoiding prematurely killing legitimate slow workloads.
 */
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

/**
 * Parses the slow-start warning threshold (VORTEX_PROTON_SLOW_START_MS).
 * If undefined or invalid, defaults to 15,000 ms (capped at timeoutMS if smaller).
 */
export function parseManagedProcessSlowStartThreshold(
  value: string | undefined,
  timeoutMS?: number,
): number {
  if (value !== undefined && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 1_000) {
      return timeoutMS !== undefined ? Math.min(parsed, timeoutMS) : parsed;
    }
  }
  return timeoutMS !== undefined
    ? Math.min(DEFAULT_SLOW_START_THRESHOLD_MS, timeoutMS)
    : DEFAULT_SLOW_START_THRESHOLD_MS;
}

/**
 * Signal only the process tree rooted in a child that Vortex spawned as a POSIX process group.
 * On Linux/macOS, passing a negative PID (-pid) targets the entire process group rooted at that child.
 * On Windows, process groups do not follow POSIX PID negation semantics, so the PID is passed directly.
 */
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
    // ESRCH means the process or process group does not exist (already stopped or reaped)
    if ((err as NodeJS.ErrnoException)?.code === "ESRCH") {
      return false;
    }
    throw err;
  }
}

export interface IProcessTimeoutErrorOptions {
  pid: number;
  processLayer: ProcessLayer;
  timeoutMS: number;
  isSlowStart: boolean;
  remediation?: string;
}

/**
 * Dedicated error thrown when a managed process exceeds its configured lifetime limit.
 * Preserves structured metadata (code, processLayer, pid, timeoutMS, state) for analytics and UI.
 */
export class ProcessTimeoutError extends Error {
  public readonly code = "EPROCESSTIMEOUT";
  public readonly pid: number;
  public readonly processLayer: ProcessLayer;
  public readonly timeoutMS: number;
  public readonly isSlowStart: boolean;
  public readonly state: "hung" | "slow-start";
  public readonly remediation: string;

  constructor(options: IProcessTimeoutErrorOptions) {
    const state = options.isSlowStart ? "slow-start" : "hung";
    const defaultRemediation = options.isSlowStart
      ? `The ${options.processLayer} process (PID ${options.pid}) exceeded the launch timeout of ${options.timeoutMS}ms during initial startup. Wine prefix configuration or shader compilation may be stalled.`
      : `The ${options.processLayer} process (PID ${options.pid}) stopped responding and exceeded the execution timeout of ${options.timeoutMS}ms.`;
    const remediation = options.remediation ?? defaultRemediation;

    super(
      `Process timeout (${options.processLayer}, PID ${options.pid}) after ${options.timeoutMS}ms [state: ${state}]: ${remediation}`,
    );
    this.name = "ProcessTimeoutError";
    this.pid = options.pid;
    this.processLayer = options.processLayer;
    this.timeoutMS = options.timeoutMS;
    this.isSlowStart = options.isSlowStart;
    this.state = state;
    this.remediation = remediation;
  }
}

export interface IProcessTreeSupervisorOptions extends IProcessTreeSignalOptions {
  pid: number;
  processLayer?: ProcessLayer;
  timeoutMS?: number;
  slowStartThresholdMS?: number;
  sigkillEscalationGraceMS?: number;
  onSlowStart?: (elapsedMS: number) => void;
  onTimeout?: (error: ProcessTimeoutError) => void;
  onEscalateToKill?: (pid: number) => void;
  onTerminated?: (signal: ProcessSignal) => void;
  setTimeoutFn?: (callback: () => void, ms: number) => any;
  clearTimeoutFn?: (timerId: any) => void;
  registerExitHook?: boolean;
}

/**
 * ProcessTreeSupervisor manages the full POSIX lifecycle of a spawned Proton runtime or native child:
 * 1. Tracks startup readiness (distinguishing slow prefix/shader initialization from hung gameplay).
 * 2. Manages timeout boundaries via opt-in VORTEX_PROTON_LAUNCH_TIMEOUT_MS.
 * 3. Enforces two-phase process group shutdown: graceful SIGTERM escalated to unblockable SIGKILL
 *    after a 5-second grace period.
 * 4. Ensures clean shutdown on Vortex exit without leaving orphaned Wine or Proton processes.
 */
export class ProcessTreeSupervisor {
  private readonly mPid: number;
  private readonly mProcessLayer: ProcessLayer;
  private readonly mTimeoutMS?: number;
  private readonly mSlowStartThresholdMS?: number;
  private readonly mEscalationGraceMS: number;
  private readonly mSignalOptions: IProcessTreeSignalOptions;
  private readonly mOptions: IProcessTreeSupervisorOptions;

  private readonly mSetTimeout: (cb: () => void, ms: number) => any;
  private readonly mClearTimeout: (id: any) => void;

  private mState: ManagedProcessState = "starting";
  private mSlowStartTimer?: any;
  private mTimeoutTimer?: any;
  private mForceKillTimer?: any;
  private mOnVortexExit?: () => void;

  constructor(options: IProcessTreeSupervisorOptions) {
    this.mPid = options.pid;
    this.mProcessLayer = options.processLayer ?? "proton-runtime";
    this.mTimeoutMS = options.timeoutMS;
    this.mSlowStartThresholdMS = options.slowStartThresholdMS;
    this.mEscalationGraceMS = options.sigkillEscalationGraceMS ?? DEFAULT_SIGKILL_ESCALATION_MS;
    this.mSignalOptions = {
      kill: options.kill,
      platform: options.platform,
    };
    this.mOptions = options;
    this.mSetTimeout = options.setTimeoutFn ?? setTimeout;
    this.mClearTimeout = options.clearTimeoutFn ?? clearTimeout;

    // Register host exit hook to cleanly kill children if Vortex quits
    if (options.registerExitHook !== false) {
      this.mOnVortexExit = () => {
        this.signalManagedTree("SIGTERM");
      };
      process.once("exit", this.mOnVortexExit);
    }

    // Arm slow-start detection timer
    if (this.mSlowStartThresholdMS !== undefined && this.mSlowStartThresholdMS > 0) {
      this.mSlowStartTimer = this.mSetTimeout(() => {
        this.mSlowStartTimer = undefined;
        if (this.mState === "starting") {
          this.mOptions.onSlowStart?.(this.mSlowStartThresholdMS!);
        }
      }, this.mSlowStartThresholdMS);
      if (typeof this.mSlowStartTimer?.unref === "function") {
        this.mSlowStartTimer.unref();
      }
    }

    // Arm process lifetime timeout timer
    if (this.mTimeoutMS !== undefined && this.mTimeoutMS > 0) {
      this.mTimeoutTimer = this.mSetTimeout(() => {
        this.mTimeoutTimer = undefined;
        const isSlowStart = this.mState === "starting";
        const timeoutError = new ProcessTimeoutError({
          pid: this.mPid,
          processLayer: this.mProcessLayer,
          timeoutMS: this.mTimeoutMS!,
          isSlowStart,
        });

        // Trigger two-phase termination escalation upon timeout
        this.terminate("timeout");
        this.mOptions.onTimeout?.(timeoutError);
      }, this.mTimeoutMS);
      if (typeof this.mTimeoutTimer?.unref === "function") {
        this.mTimeoutTimer.unref();
      }
    }
  }

  public get state(): ManagedProcessState {
    return this.mState;
  }

  public get isReady(): boolean {
    return this.mState === "ready";
  }

  /**
   * Signals that the runtime has finished initializing (e.g. Proton prefix is ready or game window loaded).
   * Transitions state from 'starting' to 'ready' and disarms the slow-start warning timer.
   */
  public markReady(): void {
    if (this.mState === "starting") {
      this.mState = "ready";
      if (this.mSlowStartTimer !== undefined) {
        this.mClearTimeout(this.mSlowStartTimer);
        this.mSlowStartTimer = undefined;
      }
      if (this.mTimeoutTimer !== undefined) {
        this.mClearTimeout(this.mTimeoutTimer);
        this.mTimeoutTimer = undefined;
      }
    }
  }

  /**
   * Initiates two-phase graceful shutdown:
   * 1. Sends SIGTERM immediately to the process group.
   * 2. Schedules SIGKILL escalation after the grace period (default 5000ms).
   */
  public terminate(_reason = "termination-requested"): void {
    if (this.mState === "terminated" && this.mForceKillTimer === undefined) {
      return;
    }

    this.clearLaunchTimers();

    // Send initial graceful SIGTERM
    this.signalManagedTree("SIGTERM");
    this.mOptions.onTerminated?.("SIGTERM");

    // Arm SIGKILL escalation timer if not already running
    if (this.mForceKillTimer === undefined) {
      this.mForceKillTimer = this.mSetTimeout(() => {
        this.mForceKillTimer = undefined;
        this.signalManagedTree("SIGKILL");
        this.mOptions.onEscalateToKill?.(this.mPid);
        this.mOptions.onTerminated?.("SIGKILL");
        this.cleanupExitHook();
        this.mState = "terminated";
      }, this.mEscalationGraceMS);
      if (typeof this.mForceKillTimer?.unref === "function") {
        this.mForceKillTimer.unref();
      }
    }
  }

  /**
   * Invoked when the child process exits (e.g. from 'close' or 'error' event).
   * Disarms all escalation and timeout timers and removes exit hooks.
   */
  public onProcessExit(): void {
    this.clearAllTimers();
    this.cleanupExitHook();
    this.mState = "terminated";
  }

  private signalManagedTree(signal: ProcessSignal): boolean {
    return signalManagedProcessTree(this.mPid, signal, this.mSignalOptions);
  }

  private clearLaunchTimers(): void {
    if (this.mSlowStartTimer !== undefined) {
      this.mClearTimeout(this.mSlowStartTimer);
      this.mSlowStartTimer = undefined;
    }
    if (this.mTimeoutTimer !== undefined) {
      this.mClearTimeout(this.mTimeoutTimer);
      this.mTimeoutTimer = undefined;
    }
  }

  private clearAllTimers(): void {
    this.clearLaunchTimers();
    if (this.mForceKillTimer !== undefined) {
      this.mClearTimeout(this.mForceKillTimer);
      this.mForceKillTimer = undefined;
    }
  }

  private cleanupExitHook(): void {
    if (this.mOnVortexExit !== undefined) {
      process.removeListener("exit", this.mOnVortexExit);
      this.mOnVortexExit = undefined;
    }
  }
}
