import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocking log and steam paths before importing ProtonPaths
vi.mock("../log", () => ({
  log: vi.fn(),
}));

import { ProtonPaths } from "./ProtonPaths";

describe("ProtonPaths", () => {
  let tmpDir: string;
  let steamApps: string;
  let gameDir: string;
  let compatData: string;
  let pfx: string;
  let userDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-proton-paths-test-"));
    steamApps = path.join(tmpDir, "steamapps");
    gameDir = path.join(steamApps, "common", "Skyrim Special Edition");
    compatData = path.join(steamApps, "compatdata", "489830");
    pfx = path.join(compatData, "pfx");
    userDir = path.join(pfx, "drive_c", "users", "steamuser");

    fs.mkdirSync(gameDir, { recursive: true });
    fs.mkdirSync(path.join(userDir, "Documents", "My Games"), { recursive: true });
    fs.mkdirSync(path.join(userDir, "AppData", "Local"), { recursive: true });
    fs.mkdirSync(path.join(userDir, "AppData", "Roaming"), { recursive: true });

    ProtonPaths.invalidate();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  });

  it("resolves paths via Steam appmanifest when AppId is not in metadata", () => {
    fs.writeFileSync(
      path.join(steamApps, "appmanifest_489830.acf"),
      `"AppState"
{
  "appid" "489830"
  "installdir" "Skyrim Special Edition"
}`,
    );

    const result = ProtonPaths.resolve({
      gameMode: "skyrimse",
      discovery: {
        path: gameDir,
        store: "steam",
      },
    });

    expect(result).toBeDefined();
    expect(result?.appId).toBe("489830");
    expect(result?.prefixPath).toBe(pfx);
    expect(result?.userProfilePath).toBe(userDir);
    expect(result?.userName).toBe("steamuser");
    expect(result?.documentsPath).toBe(path.join(userDir, "Documents"));
    expect(result?.myGamesPath).toBe(path.join(userDir, "Documents", "My Games"));
    expect(result?.appDataLocalPath).toBe(path.join(userDir, "AppData", "Local"));
    expect(result?.appDataRoamingPath).toBe(path.join(userDir, "AppData", "Roaming"));
  });

  it("prefers explicit or game environment SteamAppId over scanning manifests", () => {
    // Note: no appmanifest written to disk
    const result = ProtonPaths.resolve({
      gameMode: "skyrimse",
      discovery: {
        path: gameDir,
        store: "steam",
        environment: {
          SteamAPPId: "489830",
        },
      },
    });

    expect(result).toBeDefined();
    expect(result?.appId).toBe("489830");
    expect(result?.prefixPath).toBe(pfx);
  });

  it("prefers the typed Linux capability over legacy metadata", () => {
    expect(
      ProtonPaths.resolveAppId(undefined, {
        capabilities: { platforms: { linux: { steamAppId: 489830 } } },
        details: { steamAppId: 1 },
        environment: { SteamAPPId: "2" },
      }),
    ).toBe("489830");
  });

  it("handles non-steamuser custom Wine username", () => {
    const customUserDir = path.join(pfx, "drive_c", "users", "customgamer");
    fs.mkdirSync(path.join(customUserDir, "Documents", "My Games"), { recursive: true });
    fs.mkdirSync(path.join(customUserDir, "AppData", "Local"), { recursive: true });

    // Remove the default steamuser directory to simulate a custom Wine environment
    fs.rmSync(userDir, { recursive: true, force: true });

    const result = ProtonPaths.resolve({
      gameMode: "skyrimse",
      appId: "489830",
      discovery: {
        path: gameDir,
        store: "steam",
      },
    });

    expect(result).toBeDefined();
    expect(result?.userName).toBe("customgamer");
    expect(result?.userProfilePath).toBe(customUserDir);
    expect(result?.myGamesPath).toBe(path.join(customUserDir, "Documents", "My Games"));
  });

  it("resolves case-variant folder names like lowercase documents and appdata", () => {
    const caseVariantUser = path.join(pfx, "drive_c", "users", "caseuser");
    fs.mkdirSync(path.join(caseVariantUser, "documents", "my games"), { recursive: true });
    fs.mkdirSync(path.join(caseVariantUser, "appdata", "local"), { recursive: true });
    fs.rmSync(userDir, { recursive: true, force: true });

    const result = ProtonPaths.resolve({
      gameMode: "skyrimse",
      appId: "489830",
      discovery: {
        path: gameDir,
        store: "steam",
      },
    });

    expect(result).toBeDefined();
    expect(result?.documentsPath).toBe(path.join(caseVariantUser, "documents"));
    expect(result?.myGamesPath).toBe(path.join(caseVariantUser, "documents", "my games"));
    expect(result?.appDataLocalPath).toBe(path.join(caseVariantUser, "appdata", "local"));
  });

  it("respects manual prefix override via STEAM_COMPAT_DATA_PATH", () => {
    const manualCompatDir = path.join(tmpDir, "manual_compat");
    const manualPfx = path.join(manualCompatDir, "pfx");
    const manualUser = path.join(manualPfx, "drive_c", "users", "steamuser");
    fs.mkdirSync(path.join(manualUser, "Documents", "My Games"), { recursive: true });
    fs.mkdirSync(path.join(manualUser, "AppData", "Local"), { recursive: true });

    const result = ProtonPaths.resolve({
      gameMode: "skyrimse",
      discovery: {
        path: gameDir,
        store: "steam",
        environment: {
          STEAM_COMPAT_DATA_PATH: manualCompatDir,
        },
      },
    });

    expect(result).toBeDefined();
    expect(result?.prefixPath).toBe(manualPfx);
    expect(result?.userProfilePath).toBe(manualUser);
  });

  it("returns undefined when prefix does not exist (uninitialized game)", () => {
    fs.rmSync(compatData, { recursive: true, force: true });

    const result = ProtonPaths.resolve({
      gameMode: "skyrimse",
      appId: "489830",
      discovery: {
        path: gameDir,
        store: "steam",
      },
    });

    expect(result).toBeUndefined();
  });

  it("refreshes the prefix when an override changes at the same game path", () => {
    const alternate = path.join(tmpDir, "alternate-prefix");
    fs.mkdirSync(path.join(alternate, "drive_c", "users", "steamuser", "Documents"), {
      recursive: true,
    });
    const options = {
      gameMode: "skyrimse",
      appId: "489830",
      discovery: { path: gameDir, store: "steam" },
    };
    expect(ProtonPaths.resolve(options)?.prefixPath).toBe(pfx);
    expect(ProtonPaths.resolve({ ...options, prefixPath: alternate })?.prefixPath).toBe(alternate);
  });

  it("does not reuse a cached Steam prefix after switching stores", () => {
    const options = {
      gameMode: "skyrimse",
      appId: "489830",
      discovery: { path: gameDir, store: "steam" },
    };
    expect(ProtonPaths.resolve(options)).toBeDefined();
    expect(
      ProtonPaths.resolve({
        ...options,
        discovery: { path: gameDir, store: "gog" },
      }),
    ).toBeUndefined();
  });

  it("does not return cached paths after the prefix is removed", () => {
    const options = {
      gameMode: "skyrimse",
      appId: "489830",
      discovery: { path: gameDir, store: "steam" },
    };
    expect(ProtonPaths.resolve(options)).toBeDefined();
    fs.renameSync(pfx, path.join(compatData, "old-prefix"));
    expect(ProtonPaths.resolve(options)).toBeUndefined();
  });

  it("caches successful resolutions and clears them on invalidate()", () => {
    const opts = {
      gameMode: "skyrimse",
      appId: "489830",
      discovery: {
        path: gameDir,
        store: "steam",
      },
    };

    const first = ProtonPaths.resolve(opts);
    expect(first).toBeDefined();
    expect(ProtonPaths.resolve(opts)).toBe(first);

    // Invalidate and verify re-resolution
    ProtonPaths.invalidate("skyrimse");
    const second = ProtonPaths.resolve(opts);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("refreshes cached profile paths when the prefix user directory changes", () => {
    const options = {
      gameMode: "skyrimse",
      appId: "489830",
      discovery: { path: gameDir, store: "steam" },
    };
    const first = ProtonPaths.resolve(options);
    expect(first?.userName).toBe("steamuser");

    fs.rmSync(userDir, { force: true, recursive: true });
    const replacementUser = path.join(pfx, "drive_c", "users", "replacement");
    fs.mkdirSync(path.join(replacementUser, "Documents", "My Games"), { recursive: true });
    const usersDir = path.join(pfx, "drive_c", "users");
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(usersDir, future, future);

    const refreshed = ProtonPaths.resolve(options);
    expect(refreshed?.userName).toBe("replacement");
    expect(refreshed).not.toBe(first);
  });

  describe("translateWindowsPath", () => {
    it("translates Windows environment variables to Proton prefix directories", () => {
      const proton = ProtonPaths.resolve({
        gameMode: "skyrimse",
        appId: "489830",
        discovery: { path: gameDir, store: "steam" },
      })!;

      expect(
        ProtonPaths.translateWindowsPath(
          "%LOCALAPPDATA%\\Skyrim Special Edition\\plugins.txt",
          proton,
          "linux",
        ),
      ).toBe(path.join(proton.appDataLocalPath, "Skyrim Special Edition", "plugins.txt"));

      expect(
        ProtonPaths.translateWindowsPath("%APPDATA%\\ModOrganizer\\settings.ini", proton, "linux"),
      ).toBe(path.join(proton.appDataRoamingPath, "ModOrganizer", "settings.ini"));

      expect(
        ProtonPaths.translateWindowsPath("%USERPROFILE%\\Saved Games\\save1.ess", proton, "linux"),
      ).toBe(path.join(proton.userProfilePath, "Saved Games", "save1.ess"));

      expect(
        ProtonPaths.translateWindowsPath(
          "%DOCUMENTS%\\My Games\\Skyrim Special Edition\\Skyrim.ini",
          proton,
          "linux",
        ),
      ).toBe(path.join(proton.documentsPath, "My Games", "Skyrim Special Edition", "Skyrim.ini"));
    });

    it("translates Windows drive paths to Proton drive_c directories", () => {
      const proton = ProtonPaths.resolve({
        gameMode: "skyrimse",
        appId: "489830",
        discovery: { path: gameDir, store: "steam" },
      })!;

      expect(
        ProtonPaths.translateWindowsPath(
          "C:\\Program Files (x86)\\Common Files\\test.dll",
          proton,
          "linux",
        ),
      ).toBe(
        path.join(proton.prefixPath, "drive_c", "Program Files (x86)", "Common Files", "test.dll"),
      );

      // Translates C:\users\<user>\AppData\Local to appDataLocalPath
      expect(
        ProtonPaths.translateWindowsPath(
          "C:\\users\\steamuser\\AppData\\Local\\Skyrim Special Edition\\loadorder.txt",
          proton,
          "linux",
        ),
      ).toBe(path.join(proton.appDataLocalPath, "Skyrim Special Edition", "loadorder.txt"));
    });

    it("enforces 255-byte component limits on translated paths", () => {
      const proton = ProtonPaths.resolve({
        gameMode: "skyrimse",
        appId: "489830",
        discovery: { path: gameDir, store: "steam" },
      })!;

      const longName = "a".repeat(256);
      expect(() =>
        ProtonPaths.translateWindowsPath(`%LOCALAPPDATA%\\${longName}`, proton, "linux"),
      ).toThrow(
        expect.objectContaining({
          code: "ENAMETOOLONG",
          limitBytes: 255,
        }),
      );
    });
  });
});
