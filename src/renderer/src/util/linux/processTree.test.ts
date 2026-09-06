import { describe, expect, it, vi } from "vitest";

import { parseManagedProcessTimeout, signalManagedProcessTree } from "./processTree";

describe("managed process tree signaling", () => {
  it("accepts only explicit bounded process timeouts", () => {
    expect(parseManagedProcessTimeout(undefined)).toBeUndefined();
    expect(parseManagedProcessTimeout("4999")).toBeUndefined();
    expect(parseManagedProcessTimeout("5000")).toBe(5000);
    expect(parseManagedProcessTimeout("60000")).toBe(60000);
    expect(parseManagedProcessTimeout("86400001")).toBeUndefined();
    expect(parseManagedProcessTimeout("not-a-number")).toBeUndefined();
  });

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
