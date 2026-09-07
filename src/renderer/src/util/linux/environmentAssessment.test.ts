import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assessLinuxEnvironment, assessLinuxEnvironmentAsync } from "./environmentAssessment";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-linux-assessment-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("environmentAssessment", () => {
  it("reports incremental progress for every assessed path", async () => {
    const root = temporaryDirectory();
    const paths = ["game", "staging", "prefix", "mods"].map((name) => path.join(root, name));
    paths.forEach((entry) => fs.mkdirSync(entry));
    const progress: Array<{ completed: number; total: number }> = [];

    await assessLinuxEnvironmentAsync(
      {
        deploymentPaths: [paths[3]],
        gamePath: paths[0],
        platform: "linux",
        prefixPath: paths[2],
        stagingPath: paths[1],
      },
      { onProgress: ({ completed, total }) => progress.push({ completed, total }) },
    );

    expect(progress).toEqual([
      { completed: 1, total: 4 },
      { completed: 2, total: 4 },
      { completed: 3, total: 4 },
      { completed: 4, total: 4 },
    ]);
  });

  it("cancels between path probes without running the remaining work", async () => {
    const root = temporaryDirectory();
    const paths = ["game", "staging", "mods"].map((name) => path.join(root, name));
    paths.forEach((entry) => fs.mkdirSync(entry));
    const controller = new AbortController();
    const progress: number[] = [];

    await expect(
      assessLinuxEnvironmentAsync(
        {
          deploymentPaths: [paths[2]],
          gamePath: paths[0],
          platform: "linux",
          stagingPath: paths[1],
        },
        {
          signal: controller.signal,
          onProgress: ({ completed }) => {
            progress.push(completed);
            controller.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ code: "ECANCELED", name: "AbortError" });
    expect(progress).toEqual([1]);
  });
  it("does not run Linux checks on other platforms", () => {
    expect(
      assessLinuxEnvironment({
        gamePath: "/games/example",
        platform: "win32",
      }),
    ).toEqual({ blocking: false, issues: [] });
  });

  it("reports blocking mount options for game and prefix paths", () => {
    const root = temporaryDirectory();
    const gamePath = path.join(root, "game");
    const prefixPath = path.join(root, "prefix");
    fs.mkdirSync(gamePath);
    fs.mkdirSync(prefixPath);

    const result = assessLinuxEnvironment({
      gamePath,
      mounts: [
        {
          device: "/dev/test",
          fsType: "ext4",
          mountPoint: root,
          options: ["ro", "noexec"],
        },
      ],
      platform: "linux",
      prefixPath,
    });

    expect(result.blocking).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "read-only", purpose: "game" }),
        expect.objectContaining({ code: "noexec", purpose: "game" }),
        expect.objectContaining({ code: "read-only", purpose: "prefix" }),
        expect.objectContaining({ code: "noexec", purpose: "prefix" }),
      ]),
    );
  });

  it("accepts writable paths on a compatible filesystem", () => {
    const root = temporaryDirectory();
    const gamePath = path.join(root, "game");
    const stagingPath = path.join(root, "staging");
    fs.mkdirSync(gamePath);
    fs.mkdirSync(stagingPath);

    expect(
      assessLinuxEnvironment({
        deploymentMethodId: "hardlink_activator",
        deploymentPaths: [gamePath],
        gamePath,
        mounts: [
          {
            device: "/dev/test",
            fsType: "ext4",
            mountPoint: root,
            options: ["rw"],
          },
        ],
        platform: "linux",
        stagingPath,
      }),
    ).toEqual({ blocking: false, issues: [] });
  });

  it.each(["nfs", "nfs4", "cifs", "smbfs", "fuse.sshfs", "9p"])(
    "blocks link deployment on the %s network filesystem",
    (fsType) => {
      const root = temporaryDirectory();
      const gamePath = path.join(root, "game");
      const stagingPath = path.join(root, "staging");
      fs.mkdirSync(gamePath);
      fs.mkdirSync(stagingPath);

      const result = assessLinuxEnvironment({
        deploymentMethodId: "hardlink_activator",
        deploymentPaths: [gamePath],
        gamePath,
        mounts: [{ device: "server:/games", fsType, mountPoint: root, options: ["rw"] }],
        platform: "linux",
        stagingPath,
      });

      expect(result.blocking).toBe(true);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "network-filesystem",
            fsType,
            severity: "error",
          }),
        ]),
      );
    },
  );

  it("warns without blocking when a network path is only being assessed", () => {
    const root = temporaryDirectory();
    const gamePath = path.join(root, "game");
    fs.mkdirSync(gamePath);

    const result = assessLinuxEnvironment({
      gamePath,
      mounts: [{ device: "server:/games", fsType: "nfs4", mountPoint: root, options: ["rw"] }],
      platform: "linux",
    });

    expect(result.blocking).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "network-filesystem", severity: "warning" }),
    ]);
  });

  it("probes symlink support and removes the probe directory", () => {
    const root = temporaryDirectory();
    const gamePath = path.join(root, "game");
    const stagingPath = path.join(root, "staging");
    fs.mkdirSync(gamePath);
    fs.mkdirSync(stagingPath);

    const result = assessLinuxEnvironment({
      deploymentMethodId: "symlink_activator",
      deploymentPaths: [gamePath],
      gamePath,
      platform: "linux",
      stagingPath,
    });

    expect(result).toEqual({ blocking: false, issues: [] });
    expect(fs.readdirSync(gamePath)).toEqual([]);
  });

  it("blocks symlink deployment when the destination cannot contain links", () => {
    const root = temporaryDirectory();
    const invalidDestination = path.join(root, "not-a-directory");
    fs.writeFileSync(invalidDestination, "file");

    const result = assessLinuxEnvironment({
      deploymentMethodId: "symlink_activator",
      deploymentPaths: [invalidDestination],
      platform: "linux",
    });

    expect(result.blocking).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "symlink-unavailable", purpose: "deployment" }),
      ]),
    );
  });

  it("blocks deployment when the estimated copy exceeds available space", () => {
    const root = temporaryDirectory();
    const destination = path.join(root, "game");
    fs.mkdirSync(destination);
    const stats = fs.statfsSync(destination);
    const availableBytes = stats.bavail * stats.bsize;

    const result = assessLinuxEnvironment({
      deploymentPaths: [destination],
      platform: "linux",
      requiredBytesByDeploymentPath: {
        [destination]: availableBytes,
      },
    });

    expect(result.blocking).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableBytes: expect.any(Number),
          code: "insufficient-disk-space",
          purpose: "deployment",
          requiredBytes: availableBytes,
          reserveBytes: expect.any(Number),
        }),
      ]),
    );
  });
});
