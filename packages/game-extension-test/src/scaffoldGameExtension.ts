import * as fs from "node:fs";
import * as path from "node:path";

export interface IGameExtensionScaffoldInput {
  executable: string;
  gameId: string;
  gameName: string;
  nexusDomain: string;
  steamAppId: string;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9-]*$/;
const STEAM_APP_ID = /^\d+$/;

function validateInput(input: IGameExtensionScaffoldInput): void {
  if (!IDENTIFIER.test(input.gameId)) throw new Error("Game ID must be a lowercase slug.");
  if (!IDENTIFIER.test(input.nexusDomain))
    throw new Error("Nexus domain must be a lowercase slug.");
  if (!STEAM_APP_ID.test(input.steamAppId))
    throw new Error("Steam App ID must contain digits only.");
  if (!input.gameName.trim()) throw new Error("Game name is required.");
  if (!input.executable.trim() || path.isAbsolute(input.executable)) {
    throw new Error("Executable must be a relative path.");
  }
}

function templates(input: IGameExtensionScaffoldInput): Record<string, string> {
  const value = (inputValue: string) => JSON.stringify(inputValue);
  return {
    "build.mjs": `import * as path from "node:path";\n\nimport { bundle, createConfig } from "../../../scripts/extensions-rolldown.mjs";\n\nconst extensionPath = path.resolve(import.meta.dirname);\nawait bundle(createConfig(path.join(extensionPath, "src/index.ts"), path.join(extensionPath, "dist/index.cjs")));\n`,
    "package.json": `${JSON.stringify(
      {
        name: `game-${input.gameId}`,
        version: "0.1.0",
        description: `Vortex support for ${input.gameName}`,
        scripts: {
          build: "node build.mjs && pnpm extractInfo",
          test: "vitest run --config vitest.config.ts",
          typecheck: "pnpm exec tsc -p tsconfig.json",
        },
        license: "GPL-3.0",
        type: "commonjs",
        private: true,
        config: { game: input.gameName },
        devDependencies: {
          "@nexusmods/vortex-api": "workspace:*",
          "@vortex/game-extension-test": "workspace:*",
          typescript: "catalog:",
          vitest: "catalog:",
        },
        nx: { tags: ["vortex:extension"] },
      },
      null,
      2,
    )}\n`,
    "src/diagnostics.ts": `import type { types } from "@nexusmods/vortex-api";\n\nexport const gameFilesDiagnostic = async (): Promise<types.ITestResult> => undefined;\n`,
    "src/index.test.ts": `import { describe, expect, it } from "vitest";\n\nimport { game } from "./index";\n\ndescribe(${value(input.gameName)}, () => {\n  it("declares Linux launch and deployment capabilities", () => {\n    expect(game.capabilities?.platforms?.linux).toMatchObject({ launch: "steam-proton", steamAppId: ${value(input.steamAppId)} });\n    expect(game.executable()).toBe(${value(input.executable)});\n  });\n});\n`,
    "src/index.ts": `import * as path from "node:path";\n\nimport type { types } from "@nexusmods/vortex-api";\n\nimport { gameFilesDiagnostic } from "./diagnostics";\nimport { install, testSupported } from "./installer";\n\nexport const game: types.IGame = {\n  id: ${value(input.gameId)},\n  name: ${value(input.gameName)},\n  executable: () => ${value(input.executable)},\n  requiredFiles: [${value(input.executable)}],\n  queryArgs: { steam: [${value(input.steamAppId)}] },\n  queryModPath: (gamePath) => path.join(gamePath, "mods"),\n  capabilities: {\n    platforms: { linux: { launch: "steam-proton", steamAppId: ${value(input.steamAppId)} } },\n    deployment: { hardlink: true, move: false, symlink: true },\n  },\n};\n\nexport default function init(context: types.IExtensionContext): boolean {\n  context.registerGame(game);\n  context.registerInstaller(${value(`${input.gameId}-mods`)}, 25, testSupported, install);\n  context.registerTest(${value(`${input.gameId}-files`)}, "gamemode-activated", gameFilesDiagnostic);\n  return true;\n}\n`,
    "src/installer.ts": `import type { types } from "@nexusmods/vortex-api";\n\nexport async function testSupported(files: string[]): Promise<types.ISupportedResult> {\n  return { requiredFiles: [], supported: files.length > 0 };\n}\n\nexport async function install(files: string[]): Promise<types.IInstallResult> {\n  return { instructions: files.map((file) => ({ destination: file, source: file, type: "copy" })) };\n}\n`,
    "src/testDescriptor.ts": `import type { IGameExtensionTestDescriptor } from "@vortex/game-extension-test";\n\nexport const testDescriptor: IGameExtensionTestDescriptor = {\n  gameId: ${value(input.gameId)},\n  nexusGameDomain: ${value(input.nexusDomain)},\n  fixtures: { all: false, allCollections: false, mostPopular: 1, mostRecent: 1, oldest: 1 },\n  syntheticContent: {},\n};\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        $schema: "https://www.schemastore.org/tsconfig.json",
        extends: "../../tsconfig.extensions.json",
        include: ["src"],
      },
      null,
      2,
    )}\n`,
    "vitest.config.ts": `import { defineConfig, mergeConfig } from "vitest/config";\n\nimport baseConfig from "../../../vitest.base.config";\n\nexport default mergeConfig(baseConfig, defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } }));\n`,
  };
}

export function scaffoldGameExtension(
  gamesDirectory: string,
  input: IGameExtensionScaffoldInput,
): string {
  validateInput(input);
  const target = path.join(gamesDirectory, `game-${input.gameId}`);
  if (fs.existsSync(target)) throw new Error(`Target already exists: ${target}`);

  fs.mkdirSync(gamesDirectory, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(gamesDirectory, ".game-extension-"));
  try {
    for (const [relativePath, content] of Object.entries(templates(input))) {
      const output = path.join(temporary, relativePath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, content, "utf8");
    }
    fs.renameSync(temporary, target);
    return target;
  } catch (err) {
    fs.rmSync(temporary, { force: true, recursive: true });
    throw err;
  }
}
