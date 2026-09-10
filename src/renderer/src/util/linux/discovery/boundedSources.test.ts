import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPathIsBounded,
  getAllRegisteredBoundedSources,
  getHeroicBoundedSources,
  getLutrisBoundedSources,
  getSteamBoundedSources,
  getXdgBaseDirectories,
  UnboundedCrawlError,
} from "./boundedSources";

describe("Unified Linux Resource Discovery — Phase 2: Bounded Source Registry", () => {
  const mockHome = "/home/testuser";
  const mockEnv: NodeJS.ProcessEnv = {
    HOME: mockHome,
    XDG_DATA_HOME: "/home/testuser/.local/share",
    XDG_CONFIG_HOME: "/home/testuser/.config",
  };

  it("respects XDG specification directories and custom env overrides", () => {
    const xdg = getXdgBaseDirectories(mockEnv, mockHome);
    expect(xdg.dataHome).toBe("/home/testuser/.local/share");
    expect(xdg.configHome).toBe("/home/testuser/.config");

    const customEnv: NodeJS.ProcessEnv = {
      HOME: mockHome,
      XDG_DATA_HOME: "/custom/data",
      XDG_CONFIG_HOME: "/custom/config",
    };
    const customXdg = getXdgBaseDirectories(customEnv, mockHome);
    expect(customXdg.dataHome).toBe("/custom/data");
    expect(customXdg.configHome).toBe("/custom/config");
  });

  it("registers bounded Steam sources covering Native, Flatpak, and Snap without broad crawl", () => {
    const steamSources = getSteamBoundedSources(mockHome, mockEnv);

    expect(steamSources.some((s) => s.id === "steam:native:xdg-data")).toBe(true);
    expect(steamSources.some((s) => s.id === "steam:flatpak:var-data")).toBe(true);
    expect(steamSources.some((s) => s.id === "steam:snap:common-data")).toBe(true);

    // Verifies all paths are specific and bounded
    for (const source of steamSources) {
      expect(source.resolvedPath).not.toBe("/");
      expect(source.resolvedPath).not.toBe(mockHome);
      expect(source.provider).toBe("steam");
    }
  });

  it("registers bounded Heroic manifest sources for legendary, GOG, and GamesConfig", () => {
    const heroicSources = getHeroicBoundedSources(mockHome, mockEnv);

    expect(heroicSources.some((s) => s.id === "heroic:native:legendary")).toBe(true);
    expect(heroicSources.some((s) => s.id === "heroic:native:gog")).toBe(true);
    expect(heroicSources.some((s) => s.id === "heroic:flatpak:legendary")).toBe(true);
    expect(heroicSources.some((s) => s.id === "heroic:flatpak:gog")).toBe(true);

    for (const source of heroicSources) {
      expect(source.resolvedPath).toContain("heroic");
      expect(source.provider).toBe("heroic");
    }
  });

  it("registers bounded Lutris database and games config paths", () => {
    const lutrisSources = getLutrisBoundedSources(mockHome, mockEnv);

    expect(lutrisSources.some((s) => s.id === "lutris:native:db")).toBe(true);
    expect(lutrisSources.some((s) => s.id === "lutris:flatpak:db")).toBe(true);

    for (const source of lutrisSources) {
      expect(source.resolvedPath).toContain("lutris");
      expect(source.provider).toBe("lutris");
    }
  });

  it("strictly prohibits unbounded crawl on root directory or user home", () => {
    const allSources = getAllRegisteredBoundedSources(mockHome, mockEnv);

    // Root directory crawl rejection
    expect(() => assertPathIsBounded("/", allSources)).toThrow(UnboundedCrawlError);

    // User home unbounded crawl rejection
    expect(() => assertPathIsBounded(os.homedir(), allSources)).toThrow(UnboundedCrawlError);

    // Arbitrary unapproved filesystem directory rejection
    expect(() => assertPathIsBounded("/var/log", allSources)).toThrow(UnboundedCrawlError);
    expect(() => assertPathIsBounded("/tmp", allSources)).toThrow(UnboundedCrawlError);
  });

  it("allows querying paths that are strictly within bounded sources or approved custom roots", () => {
    const allSources = getAllRegisteredBoundedSources(mockHome, mockEnv, [
      "/mnt/games/SteamLibrary",
    ]);

    // Legitimate bounded child path
    expect(() =>
      assertPathIsBounded("/home/testuser/.local/share/Steam/steamapps/common", allSources),
    ).not.toThrow();

    // User-approved custom root child path
    expect(() =>
      assertPathIsBounded("/mnt/games/SteamLibrary/steamapps/appmanifest_489830.vdf", allSources),
    ).not.toThrow();
  });
});
