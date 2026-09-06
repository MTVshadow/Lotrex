import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverLinuxSteamLibraries, extractSteamLibraryPaths } from "./steamPaths";

describe("extractSteamLibraryPaths", () => {
  const temporaryPaths: string[] = [];

  afterEach(() => {
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
});
