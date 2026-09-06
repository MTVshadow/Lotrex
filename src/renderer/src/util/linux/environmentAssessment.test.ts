import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assessLinuxEnvironment } from "./environmentAssessment";

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
        }),
      ]),
    );
  });
});
