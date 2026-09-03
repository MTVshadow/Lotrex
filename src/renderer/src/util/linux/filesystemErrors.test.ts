import { describe, expect, it } from "vitest";

import { translateFilesystemError } from "./filesystemErrors";

describe("translateFilesystemError", () => {
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
    expect(result.remediation).toContain("/etc/fstab");
  });

  it("translates EACCES / EPERM error", () => {
    const error = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const result = translateFilesystemError(error, {
      destPath: "/var/games/game",
    });

    expect(result.code).toBe("EACCES");
    expect(result.remediation).toContain("chown");
  });

  it("translates ENOSPC error", () => {
    const error = Object.assign(new Error("ENOSPC: no space left on device"), {
      code: "ENOSPC",
    });
    const result = translateFilesystemError(error);

    expect(result.code).toBe("ENOSPC");
    expect(result.title).toContain("місця");
  });
});
