import * as fs from "node:fs";
import * as path from "node:path";

import type { IScaffoldAdapterInput, ISdkAdapterManifest } from "./contracts";
import { LOTREX_ADAPTER_SDK_VERSION } from "./contracts";
import { validateSdkManifest } from "./schemaValidator";

/**
 * Scaffolder creating standalone, fully-typed game adapters with tests and documentation.
 *
 * Implements Phase 8 acceptance criteria:
 * "Complete when a contributor can add a game without searching core code for paths or user-visible strings."
 */
export class AdapterScaffolder {
  /**
   * Generates a complete game adapter template package in the target directory.
   */
  public scaffoldAdapter(
    targetDirectory: string,
    input: IScaffoldAdapterInput,
  ): {
    adapterPath: string;
    filesCreated: string[];
    manifest: ISdkAdapterManifest;
  } {
    if (!input.gameId || !/^[a-z0-9-_]+$/i.test(input.gameId)) {
      throw new Error("Invalid gameId. Must be alphanumeric slug.");
    }
    if (!input.defaultExecutable || path.isAbsolute(input.defaultExecutable)) {
      throw new Error("Executable must be a relative binary name or path.");
    }

    const adapterDir = path.join(targetDirectory, `adapter-${input.gameId}`);
    if (fs.existsSync(adapterDir)) {
      throw new Error(`Target adapter directory already exists: ${adapterDir}`);
    }

    const isWindows = input.platform === "windows-proton";
    const modRoot = isWindows ? "Data" : "mods";

    // 1. Build typed SDK manifest
    const manifest: ISdkAdapterManifest = {
      sdkVersion: LOTREX_ADAPTER_SDK_VERSION,
      id: `${input.gameId}-linux-adapter`,
      name: `${input.gameName} Linux Adapter`,
      version: "1.0.0",
      targetGameId: input.gameId,
      targetEditions: [input.editionId],
      author: input.author || "Community Contributor",
      permissions: {
        allowedRoots: [modRoot, isWindows ? "Mods" : "config"],
        allowedTools: [],
        networkAccess: false,
      },
      localization: {
        namespace: `game-${input.gameId}`,
        defaultLocale: "en",
        strings: {
          game_name: input.gameName,
          primary_mod_type: isWindows ? "Data Archive" : "Engine Plugin",
        },
      },
      diagnosticsMeta: {
        requiredDependencies: isWindows ? ["vcrun2019"] : ["glibc"],
        recommendedRuntimes: isWindows ? ["GE-Proton9-11", "Proton Experimental"] : ["native"],
      },
      capabilities: {
        discovery: {
          kind: "discovery",
          version: "1.0.0",
          supported: true,
          details: {
            defaultExecutableName: input.defaultExecutable,
            storeAppIds: input.storeAppIds ?? {},
          },
        },
        "mod-types": {
          kind: "mod-types",
          version: "1.0.0",
          supported: true,
          details: [
            {
              id: "primary",
              name: isWindows ? "Data Archive" : "Engine Plugin",
              targetPath: modRoot,
              priority: 10,
            },
          ],
        },
        "install-rules": {
          kind: "install-rules",
          version: "1.0.0",
          supported: true,
          details: [
            {
              pattern: isWindows ? "**/*.{esp,esm,esl,pak}" : "**/*.{so,zip}",
              destination: modRoot,
            },
          ],
        },
        "deployment-targets": {
          kind: "deployment-targets",
          version: "1.0.0",
          supported: true,
          details: {
            supportedMethods: ["symlink", "hardlink"],
          },
        },
        "load-order": {
          kind: "load-order",
          version: "1.0.0",
          supported: false,
          unsupportedReason: "Default load order handled automatically by game engine.",
        },
        tools: {
          kind: "tools",
          version: "1.0.0",
          supported: false,
          unsupportedReason: "No external tools configured for this title.",
        },
        saves: {
          kind: "saves",
          version: "1.0.0",
          supported: true,
          details: {
            prefixRelativePath: isWindows
              ? `drive_c/users/steamuser/Documents/My Games/${input.gameName}/Saves`
              : `.local/share/${input.gameId}/saves`,
          },
        },
        launch: {
          kind: "launch",
          version: "1.0.0",
          supported: true,
          details: {
            requiresSteamCompat: isWindows,
          },
        },
        diagnostics: {
          kind: "diagnostics",
          version: "1.0.0",
          supported: true,
          details: {
            checkDependencies: isWindows ? ["vcrun2019"] : ["glibc"],
          },
        },
        migration: {
          kind: "migration",
          version: "1.0.0",
          supported: false,
          unsupportedReason: "Initial release does not require profile migration.",
        },
      },
    };

    // Validate manifest before writing
    const validation = validateSdkManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Scaffold validation failed: ${validation.errors.join("; ")}`);
    }

    // 2. Generate Files
    const filesCreated: string[] = [];
    fs.mkdirSync(adapterDir, { recursive: true });

    // manifest.json
    const manifestPath = path.join(adapterDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    filesCreated.push("manifest.json");

    // adapter.ts
    const adapterCode = `import type {
  AdapterCapabilityKind,
  IAdapterOperationResult,
  ICapabilityDescriptor,
  IGameAdapter,
} from "../../gameAdapters/contracts";
import type { ISdkAdapterManifest } from "../contracts";
import manifestData from "./manifest.json";

/**
 * Auto-generated game adapter for ${input.gameName}.
 * All game-specific logic and paths are declared in manifest.json.
 */
export class ${toPascalCase(input.gameId)}Adapter implements IGameAdapter {
  public readonly manifest: ISdkAdapterManifest = manifestData as ISdkAdapterManifest;

  public hasCapability(kind: AdapterCapabilityKind): boolean {
    return Boolean(this.manifest.capabilities[kind]?.supported);
  }

  public getCapability<T = unknown>(kind: AdapterCapabilityKind): ICapabilityDescriptor<T> {
    const cap = this.manifest.capabilities[kind] as ICapabilityDescriptor<T> | undefined;
    if (!cap) {
      throw new Error(\`Capability '\${kind}' not declared by adapter.\`);
    }
    return cap;
  }

  public async executeCapability<TArgs = unknown, TResult = unknown>(
    kind: AdapterCapabilityKind,
    args: TArgs,
  ): Promise<IAdapterOperationResult<TResult>> {
    const cap = this.getCapability(kind);
    if (!cap.supported) {
      return { success: false, error: \`Capability '\${kind}' is unsupported: \${cap.unsupportedReason}\` };
    }
    return { success: true, data: args as unknown as TResult };
  }
}
`;
    fs.writeFileSync(path.join(adapterDir, "adapter.ts"), adapterCode, "utf-8");
    filesCreated.push("adapter.ts");

    // locales/en.json
    const localesDir = path.join(adapterDir, "locales");
    fs.mkdirSync(localesDir, { recursive: true });
    fs.writeFileSync(
      path.join(localesDir, "en.json"),
      JSON.stringify(manifest.localization.strings, null, 2),
      "utf-8",
    );
    filesCreated.push("locales/en.json");

    // adapter.test.ts
    const testCode = `import { describe, expect, it } from "vitest";
import { runAdapterConformanceSuite } from "../conformanceTester";
import { ${toPascalCase(input.gameId)}Adapter } from "./adapter";

describe("${input.gameName} Adapter Conformance", () => {
  it("passes the Lotrex Adapter SDK conformance test suite", () => {
    const adapter = new ${toPascalCase(input.gameId)}Adapter();
    const report = runAdapterConformanceSuite(adapter, adapter.manifest);

    expect(report.passed).toBe(true);
    expect(report.conformanceScore).toBe(100);
  });
});
`;
    fs.writeFileSync(path.join(adapterDir, "adapter.test.ts"), testCode, "utf-8");
    filesCreated.push("adapter.test.ts");

    // README.md (Comprehensive Contributor Documentation)
    const readmeContent = `# ${input.gameName} Linux Adapter

This game adapter was scaffolded using the **Lotrex Adapter SDK (v${LOTREX_ADAPTER_SDK_VERSION})**.

## How It Works Without Touching Core Code
1. **Manifest-Driven**: All directories, executables, app IDs, and install rules are configured in \`manifest.json\`.
2. **Isolated Localization**: User-visible strings are defined under \`localization\` in \`manifest.json\` and \`locales/en.json\`. The core UI references keys via the \`${manifest.localization.namespace}\` namespace.
3. **Least Privilege**: The adapter explicitly declares its writable directories under \`permissions.allowedRoots\`.
4. **Conformance Testing**: Run \`pnpm test\` to execute \`adapter.test.ts\` which runs the automated 10-capability SDK conformance suite.
`;
    fs.writeFileSync(path.join(adapterDir, "README.md"), readmeContent, "utf-8");
    filesCreated.push("README.md");

    return {
      adapterPath: adapterDir,
      filesCreated,
      manifest,
    };
  }
}

function toPascalCase(str: string): string {
  return str.replace(/(^|[-_])([a-z0-9])/gi, (_, __, char) => char.toUpperCase());
}
