import { describe, expect, it } from "vitest";

import {
  assessSnapDirectoryAccess,
  getSnapRemovableMediaCommand,
  isRemovableOrSecondaryPath,
  isSnapSteam,
  isVortexInSnap,
  snapAccessAppId,
} from "./snapSupport";

describe("snapSupport", () => {
  it("detects Snap Steam paths correctly", () => {
    expect(isSnapSteam("/home/user/snap/steam/common/.local/share/Steam")).toBe(true);
    expect(isSnapSteam("/snap/steam/current/usr/bin/steam")).toBe(true);
    expect(isSnapSteam("/home/user/.local/share/Steam")).toBe(false);
    expect(isSnapSteam(undefined)).toBe(false);
  });

  it("detects whether Vortex is running inside Snap sandbox", () => {
    expect(isVortexInSnap({ SNAP: "/snap/vortex/1" })).toBe(true);
    expect(isVortexInSnap({ SNAP_NAME: "vortex" })).toBe(true);
    expect(isVortexInSnap({})).toBe(false);
  });

  it("identifies removable and secondary media paths", () => {
    expect(isRemovableOrSecondaryPath("/media/user/ExternalSSD")).toBe(true);
    expect(isRemovableOrSecondaryPath("/run/media/user/FlashDrive")).toBe(true);
    expect(isRemovableOrSecondaryPath("/mnt/secondary_drive/games")).toBe(true);
    expect(isRemovableOrSecondaryPath("/home/user/.local/share/Steam")).toBe(false);
  });

  it("generates correct snap connect command for removable media", () => {
    expect(getSnapRemovableMediaCommand("steam")).toBe("snap connect 'steam':removable-media");
    expect(getSnapRemovableMediaCommand("vortex")).toBe("snap connect 'vortex':removable-media");
  });

  it("identifies the active Snap application ID", () => {
    expect(snapAccessAppId(undefined, { SNAP_NAME: "vortex" })).toBe("vortex");
    expect(snapAccessAppId("/home/user/snap/steam/common/.steam", {})).toBe("steam");
    expect(snapAccessAppId("/home/user/.local/share/Steam", {})).toBeUndefined();
  });

  it("assesses Snap directory access for secondary/removable storage", () => {
    const issue = assessSnapDirectoryAccess(
      "/media/user/Games/Skyrim",
      "/home/user/snap/steam/common/.steam",
    );
    expect(issue).toBeDefined();
    expect(issue?.code).toBe("snap-permission-missing");
    expect(issue?.command).toBe("snap connect 'steam':removable-media");
    expect(issue?.message).toContain("Snap sandbox 'steam' requires permission");
  });

  it("returns undefined for native Steam outside snap confinement", () => {
    const issue = assessSnapDirectoryAccess(
      "/home/user/.local/share/Steam/steamapps/common/Skyrim",
      "/home/user/.local/share/Steam",
      {},
    );
    expect(issue).toBeUndefined();
  });
});
