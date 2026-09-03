import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { extractSteamLibraryPaths } from "./steamPaths";

describe("extractSteamLibraryPaths", () => {
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
});
