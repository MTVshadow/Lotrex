import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverLinuxSteamLibraries,
  discoverLinuxSteamLibrariesAsync,
  extractSteamLibraryPaths,
  invalidateLinuxSteamLibraryCache,
} from "./steamPaths";

describe("extractSteamLibraryPaths", () => {
  const temporaryPaths: string[] = [];

  afterEach(() => {
    invalidateLinuxSteamLibraryCache();
    temporaryPaths
      .splice(0)
      .forEach((temporaryPath) => fs.rmSync(temporaryPath, { force: true, recursive: true }));
  });
  const basePath = path.join(path.sep, "home", "user", ".local", "share", "Steam");

  it("finds modern Steam libraries even when numeric keys have gaps", () => {
    const result = extractSteamLibraryPaths(
      {
        0: { path: basePath },
        1: { path: path.join(path.sep, "mnt", "games") },
        3: { path: path.join(path.sep, "media", "ssd", "SteamLibrary") },
        contentstatsid: "ignored metadata",
      },
      basePath,
    );

    expect(result).toEqual([
      basePath,
      path.join(path.sep, "mnt", "games"),
      path.join(path.sep, "media", "ssd", "SteamLibrary"),
    ]);
  });

  it("supports legacy string-valued library entries", () => {
    const extraPath = path.join(path.sep, "mnt", "legacy-library");

    expect(extractSteamLibraryPaths({ 1: extraPath }, basePath)).toEqual([basePath, extraPath]);
  });

  it("ignores malformed entries and removes duplicates", () => {
    expect(
      extractSteamLibraryPaths(
        {
          0: { path: basePath },
          1: { path: 42 },
          2: null,
        },
        basePath,
      ),
    ).toEqual([basePath]);
  });

  it("reads external libraries from a Steam VDF", () => {
    const steamPath = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-steam-libraries-"));
    temporaryPaths.push(steamPath);
    fs.mkdirSync(path.join(steamPath, "config"));
    fs.writeFileSync(
      path.join(steamPath, "config", "libraryfolders.vdf"),
      '"libraryfolders"\n{\n  "0"\n  {\n    "path" "/tmp/Steam"\n  }\n  "2"\n  {\n    "path" "/mnt/Games"\n  }\n}',
    );

    expect(discoverLinuxSteamLibraries(steamPath)).toEqual([steamPath, "/tmp/Steam", "/mnt/Games"]);
  });

  it("invalidates cached libraries when the VDF metadata changes", () => {
    const steamPath = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-steam-cache-"));
    const configPath = path.join(steamPath, "config");
    const vdfPath = path.join(configPath, "libraryfolders.vdf");
    temporaryPaths.push(steamPath);
    fs.mkdirSync(configPath);
    fs.writeFileSync(vdfPath, '"libraryfolders"\n{\n  "0"\n  {\n    "path" "/tmp/Steam"\n  }\n}');

    const first = discoverLinuxSteamLibraries(steamPath);
    first.push("mutated-by-caller");
    expect(discoverLinuxSteamLibraries(steamPath)).toEqual([steamPath, "/tmp/Steam"]);

    fs.writeFileSync(
      vdfPath,
      '"libraryfolders"\n{\n  "0"\n  {\n    "path" "/mnt/NewLibrary"\n  }\n}',
    );
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(vdfPath, future, future);
    expect(discoverLinuxSteamLibraries(steamPath)).toEqual([steamPath, "/mnt/NewLibrary"]);
  });

  it("supports asynchronous discovery and cancellation", async () => {
    const steamPath = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-steam-async-"));
    const configPath = path.join(steamPath, "config");
    temporaryPaths.push(steamPath);
    fs.mkdirSync(configPath);
    fs.writeFileSync(
      path.join(configPath, "libraryfolders.vdf"),
      '"libraryfolders"\n{\n  "0"\n  {\n    "path" "/mnt/Async"\n  }\n}',
    );

    await expect(discoverLinuxSteamLibrariesAsync(steamPath)).resolves.toEqual([
      steamPath,
      "/mnt/Async",
    ]);
    await expect(
      discoverLinuxSteamLibrariesAsync(steamPath, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "ECANCELED" });
  });
});
