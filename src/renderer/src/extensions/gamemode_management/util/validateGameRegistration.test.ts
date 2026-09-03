import { describe, expect, it } from "vitest";

import { validateGameRegistration } from "./validateGameRegistration";

const validGame = {
  executable: () => "game.exe",
  id: "example",
  name: "Example Game",
  queryModPath: () => "mods",
  requiredFiles: ["game.exe"],
};

describe("validateGameRegistration", () => {
  it("accepts a complete game definition", () => {
    expect(validateGameRegistration(validGame)).toEqual([]);
  });

  it("reports malformed third-party definitions together", () => {
    expect(validateGameRegistration({ id: "", requiredFiles: "game.exe" })).toEqual([
      "id must be a non-empty string",
      "name must be a non-empty string",
      "requiredFiles must be an array of strings",
      "executable must be a function",
      "queryModPath must be a function",
    ]);
  });

  it("checks the documented path-function contracts", () => {
    const errors = validateGameRegistration({
      ...validGame,
      executable: () => {
        throw new Error("path required");
      },
      queryModPath: () => "",
    });

    expect(errors).toEqual([
      "executable(undefined) threw: path required",
      "queryModPath(gamePath) must return a non-empty path",
    ]);
  });

  it("rejects duplicate game ids", () => {
    expect(validateGameRegistration(validGame, new Set(["example"]))).toEqual([
      'game id "example" is already registered',
    ]);
  });

  it("validates typed platform capabilities", () => {
    expect(
      validateGameRegistration({
        ...validGame,
        capabilities: {
          platforms: { linux: { launch: "container", steamAppId: true } },
        },
      }),
    ).toEqual([
      "capabilities.platforms.linux.launch is invalid",
      "capabilities.platforms.linux.steamAppId must be a string or number",
    ]);
  });
});
