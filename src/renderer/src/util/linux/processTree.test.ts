import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseManagedProcessSlowStartThreshold,
  parseManagedProcessTimeout,
  ProcessTimeoutError,
  ProcessTreeSupervisor,
  signalManagedProcessTree,
} from "./processTree";

describe("managed process tree signaling and supervision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("parseManagedProcessTimeout", () => {
    it("accepts only explicit bounded process timeouts", () => {
      expect(parseManagedProcessTimeout(undefined)).toBeUndefined();
      expect(parseManagedProcessTimeout("4999")).toBeUndefined();
      expect(parseManagedProcessTimeout("5000")).toBe(5000);
      expect(parseManagedProcessTimeout("60000")).toBe(60000);
      expect(parseManagedProcessTimeout("86400001")).toBeUndefined();
      expect(parseManagedProcessTimeout("not-a-number")).toBeUndefined();
    });
  });

  describe("parseManagedProcessSlowStartThreshold", () => {
    it("defaults to 15000ms or bounds by timeoutMS", () => {
      expect(parseManagedProcessSlowStartThreshold(undefined)).toBe(15000);
      expect(parseManagedProcessSlowStartThreshold(undefined, 8000)).toBe(8000);
      expect(parseManagedProcessSlowStartThreshold("20000", 30000)).toBe(20000);
      expect(parseManagedProcessSlowStartThreshold("45000", 30000)).toBe(30000);
      expect(parseManagedProcessSlowStartThreshold("invalid")).toBe(15000);
    });
  });

  describe("signalManagedProcessTree", () => {
    it("signals only the POSIX process group rooted at the spawned pid", () => {
      const kill = vi.fn();
      expect(signalManagedProcessTree(4123, "SIGTERM", { kill, platform: "linux" })).toBe(true);
      expect(kill).toHaveBeenCalledWith(-4123, "SIGTERM");
    });

    it("uses the child pid rather than a process group on Windows", () => {
      const kill = vi.fn();
      expect(signalManagedProcessTree(4123, "SIGKILL", { kill, platform: "win32" })).toBe(true);
      expect(kill).toHaveBeenCalledWith(4123, "SIGKILL");
    });

    it("rejects invalid pids and treats an already exited group as stopped", () => {
      const kill = vi.fn(() => {
        const err = new Error("missing");
        err["code"] = "ESRCH";
        throw err;
      });

      expect(signalManagedProcessTree(0, "SIGTERM", { kill, platform: "linux" })).toBe(false);
      expect(signalManagedProcessTree(4123, "SIGTERM", { kill, platform: "linux" })).toBe(false);
      expect(kill).toHaveBeenCalledOnce();
    });
  });

  describe("ProcessTreeSupervisor", () => {
    it("escalates SIGTERM to SIGKILL after the 5000ms grace period", () => {
      const kill = vi.fn();
      const onEscalateToKill = vi.fn();
      const onTerminated = vi.fn();

      const supervisor = new ProcessTreeSupervisor({
        pid: 5001,
        platform: "linux",
        kill,
        onEscalateToKill,
        onTerminated,
        registerExitHook: false,
      });

      expect(supervisor.state).toBe("starting");

      // Initiate termination
      supervisor.terminate("user-cancel");

      // SIGTERM should be sent immediately
      expect(kill).toHaveBeenCalledWith(-5001, "SIGTERM");
      expect(onTerminated).toHaveBeenCalledWith("SIGTERM");
      expect(kill).not.toHaveBeenCalledWith(-5001, "SIGKILL");

      // Advance by 4999ms - SIGKILL must not have fired yet
      vi.advanceTimersByTime(4999);
      expect(kill).toHaveBeenCalledTimes(1);

      // Advance past 5000ms - SIGKILL should fire
      vi.advanceTimersByTime(1);
      expect(kill).toHaveBeenCalledWith(-5001, "SIGKILL");
      expect(onEscalateToKill).toHaveBeenCalledWith(5001);
      expect(onTerminated).toHaveBeenCalledWith("SIGKILL");
      expect(supervisor.state).toBe("terminated");
    });

    it("disarms SIGKILL escalation if the process exits gracefully before grace period", () => {
      const kill = vi.fn();
      const onEscalateToKill = vi.fn();

      const supervisor = new ProcessTreeSupervisor({
        pid: 5002,
        platform: "linux",
        kill,
        onEscalateToKill,
        registerExitHook: false,
      });

      supervisor.terminate("closing");
      expect(kill).toHaveBeenCalledWith(-5002, "SIGTERM");

      // Process exits at 2000ms
      vi.advanceTimersByTime(2000);
      supervisor.onProcessExit();
      expect(supervisor.state).toBe("terminated");

      // Advance past 5000ms - SIGKILL should never be called
      vi.advanceTimersByTime(5000);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(onEscalateToKill).not.toHaveBeenCalled();
    });

    it("stops the launch timeout after the process reports ready", () => {
      const kill = vi.fn();
      const onTimeout = vi.fn();

      // Case A: Timeout occurs while still in 'starting' phase (Slow-start timeout)
      const supervisorSlow = new ProcessTreeSupervisor({
        pid: 6001,
        processLayer: "proton-runtime",
        timeoutMS: 10000,
        platform: "linux",
        kill,
        onTimeout,
        registerExitHook: false,
      });

      expect(supervisorSlow.state).toBe("starting");
      expect(supervisorSlow.isReady).toBe(false);

      vi.advanceTimersByTime(10000);

      expect(onTimeout).toHaveBeenCalledOnce();
      const slowError = onTimeout.mock.calls[0][0];
      expect(slowError).toBeInstanceOf(ProcessTimeoutError);
      expect(slowError.code).toBe("EPROCESSTIMEOUT");
      expect(slowError.isSlowStart).toBe(true);
      expect(slowError.state).toBe("slow-start");
      expect(slowError.timeoutMS).toBe(10000);
      expect(kill).toHaveBeenCalledWith(-6001, "SIGTERM");
      supervisorSlow.onProcessExit();

      // Case B: Process marks ready before timeout; the launch timer must not kill gameplay.
      kill.mockClear();
      onTimeout.mockClear();

      const supervisorHung = new ProcessTreeSupervisor({
        pid: 6002,
        processLayer: "proton-runtime",
        timeoutMS: 20000,
        platform: "linux",
        kill,
        onTimeout,
        registerExitHook: false,
      });

      // Mark ready at 5000ms
      vi.advanceTimersByTime(5000);
      supervisorHung.markReady();
      expect(supervisorHung.isReady).toBe(true);
      expect(supervisorHung.state).toBe("ready");

      // Advance beyond the original launch timeout.
      vi.advanceTimersByTime(15000);
      expect(onTimeout).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    });

    it("triggers onSlowStart callback when slow-start threshold expires without readiness", () => {
      const onSlowStart = vi.fn();
      const supervisor = new ProcessTreeSupervisor({
        pid: 7001,
        slowStartThresholdMS: 12000,
        onSlowStart,
        registerExitHook: false,
      });

      vi.advanceTimersByTime(11999);
      expect(onSlowStart).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onSlowStart).toHaveBeenCalledWith(12000);
    });

    it("does not trigger onSlowStart callback if markReady is called beforehand", () => {
      const onSlowStart = vi.fn();
      const supervisor = new ProcessTreeSupervisor({
        pid: 7002,
        slowStartThresholdMS: 12000,
        onSlowStart,
        registerExitHook: false,
      });

      vi.advanceTimersByTime(5000);
      supervisor.markReady();
      expect(supervisor.isReady).toBe(true);

      vi.advanceTimersByTime(10000);
      expect(onSlowStart).not.toHaveBeenCalled();
    });
  });
});
