import { describe, expect, it } from "vitest";

import { isFatalDeploymentFilesystemError, translateFilesystemError } from "./filesystemErrors";

describe("translateFilesystemError", () => {
  it.each(["EROFS", "EIO", "ESTALE", "ENODEV", "ENXIO", "EREMOTEIO"])(
    "treats %s as a transaction-fatal storage error",
    (code) => {
      expect(isFatalDeploymentFilesystemError(Object.assign(new Error(code), { code }))).toBe(true);
    },
  );

  it("keeps ordinary per-file conflicts recoverable within finalize", () => {
    expect(
      isFatalDeploymentFilesystemError(
        Object.assign(new Error("target changed"), { code: "EDEPLOYMENTTARGETCHANGED" }),
      ),
    ).toBe(false);
  });
  it("translates EXDEV error with fallback method and settings hint", () => {
    const error = Object.assign(new Error("EXDEV: cross-device link not permitted"), {
      code: "EXDEV",
    });
    const result = translateFilesystemError(error, {
      activeMethod: "hardlink",
      destPath: "/mnt/hdd/SkyrimSE/Data",
      sourcePath: "/home/user/Vortex Mods/skyrimse",
    });

    expect(result.code).toBe("EXDEV");
    expect(result.openSettingsAction).toBe(true);
    expect(result.fallbackMethod).toBe("symlink");
    expect(result.remediation).toContain("Symlink");
  });

  it("translates EROFS error", () => {
    const error = Object.assign(new Error("EROFS: read-only file system"), {
      code: "EROFS",
    });
    const result = translateFilesystemError(error, {
      destPath: "/run/media/user/Disk/game",
    });

    expect(result.code).toBe("EROFS");
    expect(result.openSettingsAction).toBe(false);
    expect(result.remediation).toContain("write access");
  });

  it("translates EACCES / EPERM error", () => {
    const error = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const result = translateFilesystemError(error, {
      destPath: "/var/games/game",
    });

    expect(result.code).toBe("EACCES");
    expect(result.remediation).toContain("ownership");
  });

  it("translates ENOSPC error", () => {
    const error = Object.assign(new Error("ENOSPC: no space left on device"), {
      code: "ENOSPC",
    });
    const result = translateFilesystemError(error);

    expect(result.code).toBe("ENOSPC");
    expect(result.title).toContain("disk space");
  });
});
