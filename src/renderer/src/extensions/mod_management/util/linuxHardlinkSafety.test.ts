import { describe, expect, it } from "vitest";

import {
  assertLinuxHardlinkPlanSafe,
  isCriticalHardlinkDeploymentPath,
} from "./linuxHardlinkSafety";

describe("Linux hardlink deployment safety", () => {
  it.each([
    "scripts/Script_Game.DLL",
    "bin\\patch.EXE",
    "tools/install.sh",
    "runtime/plugin.so",
    "installer.msi",
  ])("classifies %s as critical", (filePath) => {
    expect(isCriticalHardlinkDeploymentPath(filePath)).toBe(true);
  });

  it.each(["Data/Plugin.esp", "textures/world.dds", "localization/Strings.pak"])(
    "does not classify %s as critical",
    (filePath) => {
      expect(isCriticalHardlinkDeploymentPath(filePath)).toBe(false);
    },
  );

  it("blocks a Linux hardlink plan before critical files can be deployed", () => {
    expect(() =>
      assertLinuxHardlinkPlanSafe("hardlink_activator", "linux", [
        "safe.esp",
        "z/patch.exe",
        "a/Script_Game.dll",
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: "ELINUXHARDLINKCRITICAL",
        files: ["a/Script_Game.dll", "z/patch.exe"],
      }),
    );
  });

  it("does not apply the Linux-only policy to symlinks or another platform", () => {
    expect(() =>
      assertLinuxHardlinkPlanSafe("symlink_activator", "linux", ["Script_Game.dll"]),
    ).not.toThrow();
    expect(() =>
      assertLinuxHardlinkPlanSafe("hardlink_activator", "win32", ["Script_Game.dll"]),
    ).not.toThrow();
  });
});
