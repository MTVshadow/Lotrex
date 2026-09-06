import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldGameExtension } from "./scaffoldGameExtension";

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((entry) => fs.rmSync(entry, { force: true, recursive: true })),
);

describe("game extension scaffold", () => {
  it("creates the typed Linux-ready extension structure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-game-template-"));
    temporary.push(root);
    const output = scaffoldGameExtension(root, {
      executable: "ExampleGame.exe",
      gameId: "example-game",
      gameName: "Example Game",
      nexusDomain: "examplegame",
      steamAppId: "123456",
    });

    expect(fs.readdirSync(path.join(output, "src")).sort()).toEqual([
      "diagnostics.ts",
      "index.test.ts",
      "index.ts",
      "installer.ts",
      "testDescriptor.ts",
    ]);
    expect(fs.readFileSync(path.join(output, "src/index.ts"), "utf8")).toContain(
      'launch: "steam-proton"',
    );
    expect(fs.readFileSync(path.join(output, "src/testDescriptor.ts"), "utf8")).toContain(
      'nexusGameDomain: "examplegame"',
    );
  });

  it("rejects invalid input and never overwrites an existing extension", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-game-template-"));
    temporary.push(root);
    const input = {
      executable: "ExampleGame.exe",
      gameId: "example-game",
      gameName: "Example Game",
      nexusDomain: "examplegame",
      steamAppId: "123456",
    };
    scaffoldGameExtension(root, input);
    expect(() => scaffoldGameExtension(root, input)).toThrow("Target already exists");
    expect(() => scaffoldGameExtension(root, { ...input, gameId: "../unsafe" })).toThrow(
      "lowercase slug",
    );
  });
});
