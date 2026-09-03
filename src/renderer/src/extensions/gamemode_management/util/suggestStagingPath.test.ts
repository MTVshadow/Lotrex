import * as path from "path";

import { describe, expect, it } from "vitest";

import { suggestStagingPathPattern } from "./suggestStagingPath";

describe("suggestStagingPathPattern", () => {
  it("uses user data when it is on the same filesystem", () => {
    expect(suggestStagingPathPattern("linux", true, "/games/example", "Vortex Mods")).toBe(
      path.join("{USERDATA}", "{game}", "mods"),
    );
  });

  it("keeps Linux staging beside the game when user data is on another filesystem", () => {
    expect(suggestStagingPathPattern("linux", false, "/mnt/games/example", "Vortex Mods")).toBe(
      path.join("/mnt/games", "Vortex Mods", "{game}"),
    );
  });

  it("uses the game volume on Windows when user data is on another drive", () => {
    expect(
      suggestStagingPathPattern("win32", false, "D:\\Games\\Example", "Vortex Mods", "D:\\"),
    ).toBe(path.join("D:\\", "Vortex Mods", "{game}"));
  });
});
