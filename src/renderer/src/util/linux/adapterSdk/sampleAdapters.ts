import type {
  AdapterCapabilityKind,
  IAdapterOperationResult,
  ICapabilityDescriptor,
  IGameAdapter,
} from "../gameAdapters/contracts";
import { type ISdkAdapterManifest, LOTREX_ADAPTER_SDK_VERSION } from "./contracts";

/**
 * Sample Windows/Proton Game Adapter implemented using the Lotrex Adapter SDK (Phase 8).
 * Serves as the canonical reference template for Proton titles.
 */
export class SampleProtonGameAdapter implements IGameAdapter {
  public readonly manifest: ISdkAdapterManifest;

  constructor(overrides: Partial<ISdkAdapterManifest> = {}) {
    this.manifest = {
      sdkVersion: LOTREX_ADAPTER_SDK_VERSION,
      id: "sample-proton-adapter",
      name: "Sample Proton RPG Adapter",
      version: "1.0.0",
      targetGameId: "sample-proton-game",
      targetEditions: ["standard", "enhanced"],
      author: "Lotrex SDK Team",
      permissions: {
        allowedRoots: ["Data", "Mods"],
        allowedTools: ["skse64_loader.exe", "tool.exe"],
        networkAccess: false,
      },
      localization: {
        namespace: "game-sample-proton",
        defaultLocale: "en",
        strings: {
          game_title: "Sample Proton RPG",
          mod_type_data: "Data Files",
          warning_missing_prefix: "Please initialize Proton prefix before launching.",
        },
      },
      diagnosticsMeta: {
        requiredDependencies: ["vcrun2019"],
        recommendedRuntimes: ["GE-Proton9-11", "Proton Experimental"],
      },
      capabilities: {
        discovery: {
          kind: "discovery",
          version: "1.0.0",
          supported: true,
          details: {
            defaultExecutableName: "Game.exe",
            storeAppIds: { steam: "123456" },
          },
        },
        "mod-types": {
          kind: "mod-types",
          version: "1.0.0",
          supported: true,
          details: [{ id: "data", name: "Data Mods", targetPath: "Data", priority: 10 }],
        },
        "install-rules": {
          kind: "install-rules",
          version: "1.0.0",
          supported: true,
          details: [
            { pattern: "**/*.esm", destination: "Data" },
            { pattern: "**/*.esp", destination: "Data" },
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
          supported: true,
          details: {
            fileFormat: "plugins.txt",
            relativeFilePath: "plugins.txt",
          },
        },
        tools: {
          kind: "tools",
          version: "1.0.0",
          supported: true,
          details: [{ id: "loader", name: "Script Loader", executable: "skse64_loader.exe" }],
        },
        saves: {
          kind: "saves",
          version: "1.0.0",
          supported: true,
          details: {
            prefixRelativePath: "drive_c/users/steamuser/Documents/My Games/Sample/Saves",
          },
        },
        launch: {
          kind: "launch",
          version: "1.0.0",
          supported: true,
          details: {
            requiresSteamCompat: true,
          },
        },
        diagnostics: {
          kind: "diagnostics",
          version: "1.0.0",
          supported: true,
          details: {
            checkDependencies: ["vcrun2019"],
          },
        },
        migration: {
          kind: "migration",
          version: "1.0.0",
          supported: false,
          unsupportedReason: "No profile migration required for this engine release.",
        },
      },
      ...overrides,
    };
  }

  public hasCapability(kind: AdapterCapabilityKind): boolean {
    const cap = this.manifest.capabilities[kind];
    return Boolean(cap && cap.supported);
  }

  public getCapability<T = unknown>(kind: AdapterCapabilityKind): ICapabilityDescriptor<T> {
    const cap = this.manifest.capabilities[kind] as ICapabilityDescriptor<T> | undefined;
    if (!cap) {
      throw new Error(`Capability '${kind}' not declared by adapter.`);
    }
    return cap;
  }

  public async executeCapability<TArgs = unknown, TResult = unknown>(
    kind: AdapterCapabilityKind,
    args: TArgs,
  ): Promise<IAdapterOperationResult<TResult>> {
    const cap = this.getCapability(kind);
    if (!cap.supported) {
      return {
        success: false,
        error: `Capability '${kind}' is unsupported: ${cap.unsupportedReason}`,
      };
    }
    return {
      success: true,
      data: args as unknown as TResult,
    };
  }
}

/**
 * Sample Native Linux Game Adapter implemented using the Lotrex Adapter SDK (Phase 8).
 * Serves as the canonical reference template for native Linux titles.
 */
export class SampleNativeGameAdapter implements IGameAdapter {
  public readonly manifest: ISdkAdapterManifest;

  constructor(overrides: Partial<ISdkAdapterManifest> = {}) {
    this.manifest = {
      sdkVersion: LOTREX_ADAPTER_SDK_VERSION,
      id: "sample-native-adapter",
      name: "Sample Native Linux Sim Adapter",
      version: "1.0.0",
      targetGameId: "sample-native-game",
      targetEditions: ["standard"],
      author: "Lotrex SDK Team",
      permissions: {
        allowedRoots: ["mods", "config", "content"],
        allowedTools: ["mod_cli"],
        networkAccess: false,
      },
      localization: {
        namespace: "game-sample-native",
        defaultLocale: "en",
        strings: {
          game_title: "Sample Native Linux Sim",
          mod_type_plugin: "Native Engine Plugins",
        },
      },
      capabilities: {
        discovery: {
          kind: "discovery",
          version: "1.0.0",
          supported: true,
          details: {
            defaultExecutableName: "sim_game.x86_64",
            storeAppIds: { steam: "654321" },
          },
        },
        "mod-types": {
          kind: "mod-types",
          version: "1.0.0",
          supported: true,
          details: [
            { id: "plugins", name: "Plugins", targetPath: "mods", priority: 10 },
            { id: "configs", name: "Configs", targetPath: "config", priority: 20 },
          ],
        },
        "install-rules": {
          kind: "install-rules",
          version: "1.0.0",
          supported: true,
          details: [
            { pattern: "**/*.so", destination: "mods" },
            { pattern: "**/*.json", destination: "config" },
          ],
        },
        "deployment-targets": {
          kind: "deployment-targets",
          version: "1.0.0",
          supported: true,
          details: {
            supportedMethods: ["symlink", "move"],
          },
        },
        "load-order": {
          kind: "load-order",
          version: "1.0.0",
          supported: true,
          details: {
            fileFormat: "mods.json",
            relativeFilePath: "config/mods.json",
          },
        },
        tools: {
          kind: "tools",
          version: "1.0.0",
          supported: true,
          details: [{ id: "cli", name: "Mod Manager CLI", executable: "bin/mod_cli" }],
        },
        saves: {
          kind: "saves",
          version: "1.0.0",
          supported: true,
          details: {
            prefixRelativePath: ".local/share/sample_game/saves",
          },
        },
        launch: {
          kind: "launch",
          version: "1.0.0",
          supported: true,
          details: {
            requiresSteamCompat: false,
          },
        },
        diagnostics: {
          kind: "diagnostics",
          version: "1.0.0",
          supported: true,
          details: {
            checkDependencies: ["glibc", "vulkan"],
          },
        },
        migration: {
          kind: "migration",
          version: "1.0.0",
          supported: false,
          unsupportedReason: "Native schema is stable without migration requirements.",
        },
      },
      ...overrides,
    };
  }

  public hasCapability(kind: AdapterCapabilityKind): boolean {
    const cap = this.manifest.capabilities[kind];
    return Boolean(cap && cap.supported);
  }

  public getCapability<T = unknown>(kind: AdapterCapabilityKind): ICapabilityDescriptor<T> {
    const cap = this.manifest.capabilities[kind] as ICapabilityDescriptor<T> | undefined;
    if (!cap) {
      throw new Error(`Capability '${kind}' not declared by adapter.`);
    }
    return cap;
  }

  public async executeCapability<TArgs = unknown, TResult = unknown>(
    kind: AdapterCapabilityKind,
    args: TArgs,
  ): Promise<IAdapterOperationResult<TResult>> {
    const cap = this.getCapability(kind);
    if (!cap.supported) {
      return {
        success: false,
        error: `Capability '${kind}' is unsupported: ${cap.unsupportedReason}`,
      };
    }
    return {
      success: true,
      data: args as unknown as TResult,
    };
  }
}
