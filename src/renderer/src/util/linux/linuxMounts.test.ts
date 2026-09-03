import { describe, expect, it, vi } from "vitest";

import {
  assessDirectoryFileSystem,
  decodeMountPath,
  findMountForPath,
  parseMounts,
  type IMountEntry,
} from "./linuxMounts";

const SAMPLE_MOUNTS = `
rootfs / rootfs rw 0 0
sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
/dev/nvme0n1p2 / ext4 rw,relatime 0 0
/dev/nvme0n1p3 /home ext4 rw,relatime 0 0
/dev/sda1 /mnt/steam\\040drive ext4 ro,relatime 0 0
/dev/sdb1 /mnt/windows ntfs3 rw,noexec,uid=1000,gid=1000 0 0
/dev/sdc1 /mnt/external exfat rw,uid=1000,gid=1000 0 0
`;

describe("linuxMounts", () => {
  it("decodes octal escape sequences in mount points", () => {
    expect(decodeMountPath("/mnt/steam\\040drive")).toBe("/mnt/steam drive");
    expect(decodeMountPath("/normal/path")).toBe("/normal/path");
  });

  it("parses mounts table correctly", () => {
    const mounts = parseMounts(SAMPLE_MOUNTS);
    expect(mounts.length).toBe(8);

    const homeMount = mounts.find((m) => m.mountPoint === "/home");
    expect(homeMount).toBeDefined();
    expect(homeMount?.fsType).toBe("ext4");
    expect(homeMount?.options).toContain("rw");

    const spaceMount = mounts.find((m) => m.mountPoint === "/mnt/steam drive");
    expect(spaceMount).toBeDefined();
    expect(spaceMount?.options).toContain("ro");
  });

  it("finds the longest matching mount point for a path", () => {
    const mounts = parseMounts(SAMPLE_MOUNTS);

    const rootFile = findMountForPath("/etc/fstab", mounts);
    expect(rootFile?.mountPoint).toBe("/");

    const homeFile = findMountForPath("/home/user/.config", mounts);
    expect(homeFile?.mountPoint).toBe("/home");

    const spacedFile = findMountForPath("/mnt/steam drive/steamapps/common/Skyrim", mounts);
    expect(spacedFile?.mountPoint).toBe("/mnt/steam drive");
  });

  it("detects read-only mount issues", () => {
    const mounts = parseMounts(SAMPLE_MOUNTS);
    const issues = assessDirectoryFileSystem(
      "/mnt/steam drive/steamapps/common/Skyrim",
      "game",
      mounts,
    );

    const roIssue = issues.find((i) => i.code === "read-only");
    expect(roIssue).toBeDefined();
    expect(roIssue?.severity).toBe("error");
  });

  it("detects noexec on game execution directories", () => {
    const mounts = parseMounts(SAMPLE_MOUNTS);
    const issues = assessDirectoryFileSystem("/mnt/windows/Game", "game", mounts);

    const noExecIssue = issues.find((i) => i.code === "noexec");
    expect(noExecIssue).toBeDefined();
    expect(noExecIssue?.severity).toBe("error");
  });

  it("warns about Proton prefix on NTFS/exFAT filesystem", () => {
    const mounts = parseMounts(SAMPLE_MOUNTS);
    const issues = assessDirectoryFileSystem(
      "/mnt/windows/SteamLibrary/compatdata/489830/pfx",
      "prefix",
      mounts,
    );

    const ntfsIssue = issues.find((i) => i.code === "ntfs-prefix");
    expect(ntfsIssue).toBeDefined();
    expect(ntfsIssue?.severity).toBe("warning");
  });
});
