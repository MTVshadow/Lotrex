import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEPLOYMENT_FAULT_POINTS,
  DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE,
  isDeploymentFaultEnabled,
  runDeploymentFaultPoint,
} from "./deploymentFaultInjection";

interface IChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function runChild(
  point: (typeof DEPLOYMENT_FAULT_POINTS)[number],
  markerPath: string,
  faultEnabled: boolean,
): Promise<IChildResult> {
  const childPath = path.join(__dirname, "deploymentFaultInjection.child.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", childPath, point, markerPath], {
      env: {
        ...process.env,
        VORTEX_DEPLOYMENT_FAULT_INJECTION: faultEnabled
          ? DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE
          : "",
        VORTEX_DEPLOYMENT_FAULT_POINT: faultEnabled ? point : "",
      },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

describe("deployment fault injection", () => {
  it("is disabled unless both the explicit opt-in and exact point match", () => {
    expect(isDeploymentFaultEnabled("after-link", {})).toBe(false);
    expect(
      isDeploymentFaultEnabled("after-link", {
        VORTEX_DEPLOYMENT_FAULT_INJECTION: DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE,
        VORTEX_DEPLOYMENT_FAULT_POINT: "after-backup",
      }),
    ).toBe(false);
    expect(
      isDeploymentFaultEnabled("after-link", {
        VORTEX_DEPLOYMENT_FAULT_INJECTION: DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE,
        VORTEX_DEPLOYMENT_FAULT_POINT: "after-link",
      }),
    ).toBe(true);
  });

  it("calls the injected terminator only at the selected point", () => {
    const terminate = vi.fn(() => {
      throw new Error("terminated");
    });
    const environment = {
      VORTEX_DEPLOYMENT_FAULT_INJECTION: DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE,
      VORTEX_DEPLOYMENT_FAULT_POINT: "after-purge",
    };
    expect(() => runDeploymentFaultPoint("after-link", environment, terminate)).not.toThrow();
    expect(() => runDeploymentFaultPoint("after-purge", environment, terminate)).toThrow(
      "terminated",
    );
    expect(terminate).toHaveBeenCalledOnce();
  });

  it.runIf(process.platform !== "win32")(
    "terminates and cleanly restarts a child process at every deployment boundary",
    async () => {
      const temporaryDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "vortex-deployment-fault-"),
      );
      try {
        for (const point of DEPLOYMENT_FAULT_POINTS) {
          const markerPath = path.join(temporaryDirectory, `${point}.log`);
          await expect(runChild(point, markerPath, true)).resolves.toEqual({
            code: null,
            signal: "SIGKILL",
          });
          await expect(fs.readFile(markerPath, "utf8")).resolves.toBe(`entered:${point}\n`);

          await expect(runChild(point, markerPath, false)).resolves.toEqual({
            code: 0,
            signal: null,
          });
          await expect(fs.readFile(markerPath, "utf8")).resolves.toBe(
            `entered:${point}\nentered:${point}\ncompleted:${point}\n`,
          );
        }
      } finally {
        await fs.rm(temporaryDirectory, { recursive: true });
      }
    },
    30_000,
  );
});
