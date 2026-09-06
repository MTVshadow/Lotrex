import { describe, expect, it } from "vitest";

import {
  assessFlatpakDirectoryAccess,
  flatpakAccessAppId,
  getFlatpakOverrideCommand,
  isFlatpakSteam,
} from "./flatpakSupport";

describe("flatpakSupport", () => {
  it("identifies Flatpak Steam paths", () => {
    expect(isFlatpakSteam("/home/user/.var/app/com.valvesoftware.Steam/data/Steam")).toBe(true);
    expect(isFlatpakSteam("/home/user/.local/share/Steam")).toBe(false);
    expect(isFlatpakSteam(undefined)).toBe(false);
  });

  it("generates precise, non-broad flatpak override command", () => {
    const cmd = getFlatpakOverrideCommand("/mnt/games/SteamLibrary");
    expect(cmd).toBe(
      "flatpak override --user --filesystem='/mnt/games/SteamLibrary' 'com.valvesoftware.Steam'",
    );
    expect(cmd).not.toContain("--filesystem=host");
    expect(cmd).not.toContain("--filesystem=home");
  });

  it("shell-quotes paths and app IDs in override commands", () => {
    const command = getFlatpakOverrideCommand("/mnt/Games/it's $(private)", "example.app; false");

    expect(command).toBe(
      "flatpak override --user --filesystem='/mnt/Games/it'\\''s $(private)' 'example.app; false'",
    );
  });

  it("targets the running Vortex Flatpak before the Steam Flatpak", () => {
    const previous = process.env.FLATPAK_ID;
    process.env.FLATPAK_ID = "com.example.Vortex";
    try {
      expect(flatpakAccessAppId("/home/user/.var/app/com.valvesoftware.Steam/data/Steam")).toBe(
        "com.example.Vortex",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.FLATPAK_ID;
      } else {
        process.env.FLATPAK_ID = previous;
      }
    }
  });

  it("does not report Flatpak issues for native Steam", () => {
    const result = assessFlatpakDirectoryAccess(
      "/mnt/games/SteamLibrary",
      "/home/user/.local/share/Steam",
    );
    expect(result).toBeUndefined();
  });
});
