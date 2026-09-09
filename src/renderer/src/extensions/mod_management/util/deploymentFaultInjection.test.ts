import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../util/fs", () => ({
  ensureDirAsync: (dirPath: string) => fs.mkdir(dirPath, { recursive: true }),
  linkAsync: (sourcePath: string, targetPath: string) => fs.link(sourcePath, targetPath),
  lstatAsync: (filePath: string) => fs.lstat(filePath),
  readFileAsync: (filePath: string) => fs.readFile(filePath),
  readlinkAsync: (filePath: string) => fs.readlink(filePath),
  renameAsync: (sourcePath: string, targetPath: string) => fs.rename(sourcePath, targetPath),
  statAsync: (filePath: string) => fs.stat(filePath),
  symlinkAsync: (sourcePath: string, targetPath: string) => fs.symlink(sourcePath, targetPath),
  unlinkAsync: (filePath: string) => fs.unlink(filePath),
}));

vi.mock("../../../util/fsAtomic", () => ({
  writeFileAtomic: (filePath: string, input: string | Buffer) => fs.writeFile(filePath, input),
}));

import {
  DEPLOYMENT_FAULT_POINTS,
  DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE,
  isDeploymentFaultEnabled,
  runDeploymentFaultPoint,
} from "./deploymentFaultInjection";
import {
  completeDeploymentRecovery,
  inspectDeploymentJournal,
  readDeploymentJournal,
} from "./deploymentJournal";

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

function runScenarioChild(
  point: (typeof DEPLOYMENT_FAULT_POINTS)[number],
  markerPath: string,
  scenario: "deploy" | "purge",
  stagingPath: string,
  targetRoot: string,
  deploymentMethod: string,
): Promise<IChildResult> {
  const childPath = path.join(__dirname, "deploymentFaultInjection.child.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        childPath,
        point,
        markerPath,
        scenario,
        stagingPath,
        targetRoot,
        deploymentMethod,
      ],
      {
        env: {
          ...process.env,
          VORTEX_DEPLOYMENT_FAULT_INJECTION: DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE,
          VORTEX_DEPLOYMENT_FAULT_POINT: point,
        },
        stdio: "ignore",
      },
    );
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

  it.runIf(process.platform !== "win32")(
    "recovers cleanly after SIGKILL at every deployment phase boundary without data loss",
    async () => {
      const deployPoints: (typeof DEPLOYMENT_FAULT_POINTS)[number][] = [
        "after-prepared",
        "after-backup",
        "after-link",
        "after-manifest-write",
        "after-commit",
      ];
      for (const method of ["hardlink_activator", "symlink_activator", "move_activator"]) {
        for (const point of deployPoints) {
          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-deploy-crash-"));
          const stagingPath = path.join(tempDir, "staging");
          const targetRoot = path.join(tempDir, "target");
          const markerPath = path.join(tempDir, "marker.log");
          const modSource = path.join(stagingPath, "mod", "file.txt");
          const vanillaTarget = path.join(targetRoot, "file.txt");

          try {
            await fs.mkdir(path.dirname(modSource), { recursive: true });
            await fs.mkdir(targetRoot, { recursive: true });
            await fs.writeFile(modSource, "mod content");
            await fs.writeFile(vanillaTarget, "vanilla content");

            const childRes = await runScenarioChild(
              point,
              markerPath,
              "deploy",
              stagingPath,
              targetRoot,
              method,
            );
            expect(childRes.signal).toBe("SIGKILL");

            const inspection = await inspectDeploymentJournal(stagingPath);
            if (point === "after-commit") {
              expect(inspection).toBeUndefined();
              const journal = await readDeploymentJournal(stagingPath);
              expect(journal?.phase).toBe("committed");
            } else {
              expect(inspection?.status).toBe("incomplete");
              const action =
                inspection!.entry!.phase === "manifest-written" ? "resume" : "rollback";
              const recovered = await completeDeploymentRecovery(
                inspection!.entry!,
                action,
                inspection!.reconciliation,
              );
              expect(recovered.phase).toBe("committed");
            }

            if (point === "after-manifest-write" || point === "after-commit") {
              await expect(fs.readFile(vanillaTarget, "utf8")).resolves.toBe("mod content");
              await expect(fs.readFile(vanillaTarget + ".vortex_backup", "utf8")).resolves.toBe(
                "vanilla content",
              );
            } else {
              await expect(fs.readFile(vanillaTarget, "utf8")).resolves.toBe("vanilla content");
            }
          } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        }
      }
    },
    60_000,
  );

  it.runIf(process.platform !== "win32")(
    "recovers cleanly after SIGKILL at every purge phase boundary preserving vanilla backups",
    async () => {
      const purgePoints: (typeof DEPLOYMENT_FAULT_POINTS)[number][] = [
        "after-prepared",
        "after-unlink",
        "after-purge",
        "after-manifest-write",
        "after-commit",
      ];
      for (const method of ["hardlink_activator", "symlink_activator", "move_activator"]) {
        for (const point of purgePoints) {
          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-purge-crash-"));
          const stagingPath = path.join(tempDir, "staging");
          const targetRoot = path.join(tempDir, "target");
          const markerPath = path.join(tempDir, "marker.log");
          const modSource = path.join(stagingPath, "mod", "file.txt");
          const targetPath = path.join(targetRoot, "file.txt");
          const backupPath = targetPath + ".vortex_backup";

          try {
            await fs.mkdir(path.dirname(modSource), { recursive: true });
            await fs.mkdir(targetRoot, { recursive: true });
            await fs.writeFile(backupPath, "vanilla content");

            if (method.includes("move")) {
              await fs.writeFile(modSource + ".vortex_lnk", JSON.stringify({ target: targetPath }));
              await fs.writeFile(targetPath, "mod content");
            } else if (method.includes("hardlink")) {
              await fs.writeFile(modSource, "mod content");
              await fs.link(modSource, targetPath);
            } else {
              await fs.writeFile(modSource, "mod content");
              await fs.symlink(modSource, targetPath);
            }

            const childRes = await runScenarioChild(
              point,
              markerPath,
              "purge",
              stagingPath,
              targetRoot,
              method,
            );
            expect(childRes.signal).toBe("SIGKILL");

            const inspection = await inspectDeploymentJournal(stagingPath);
            if (point === "after-commit") {
              expect(inspection).toBeUndefined();
              const journal = await readDeploymentJournal(stagingPath);
              expect(journal?.phase).toBe("committed");
            } else {
              expect(inspection?.status).toBe("incomplete");
              const action =
                inspection!.entry!.phase === "manifest-written" ? "resume" : "rollback";
              const recovered = await completeDeploymentRecovery(
                inspection!.entry!,
                action,
                inspection!.reconciliation,
              );
              expect(recovered.phase).toBe("committed");
            }

            const targetContent = await fs.readFile(targetPath, "utf8").catch(() => null);
            const backupContent = await fs.readFile(backupPath, "utf8").catch(() => null);
            const hasVanilla =
              targetContent === "vanilla content" || backupContent === "vanilla content";
            expect(hasVanilla).toBe(true);
          } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        }
      }
    },
    60_000,
  );
});
