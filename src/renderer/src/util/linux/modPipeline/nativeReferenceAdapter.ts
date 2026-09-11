import type {
  AdapterCapabilityKind,
  IAdapterOperationResult,
  ICapabilityDescriptor,
  IGameAdapter,
  IGameAdapterManifest,
} from "../gameAdapters/contracts";

/**
 * Native Linux Game Reference Adapter (Phase 5).
 *
 * Structurally different reference game from SkyrimSE:
 * - Native Linux execution platform
 * - Modern directory layout: 'mods/' and 'config/' instead of Bethesda's 'Data/'
 * - JSON manifest-based load order ('mods.json') instead of 'plugins.txt'
 * - Native Linux save paths (~/.local/share/...) instead of Windows drive_c user paths
 *
 * Demonstrates that the mod pipeline engine is fully game-agnostic and relies
 * purely on composable capabilities rather than hardcoded core branches.
 */
export class NativeReferenceAdapter implements IGameAdapter {
  public readonly manifest: IGameAdapterManifest;

  constructor(overrides: Partial<IGameAdapterManifest> = {}) {
    this.manifest = {
      id: "native-linux-adapter",
      name: "Native Linux Engine Reference Adapter",
      version: "1.0.0",
      targetGameId: "native-game",
      targetEditions: ["standard"],
      author: "Lotrex Team",
      capabilities: {
        discovery: {
          kind: "discovery",
          version: "1.0.0",
          supported: true,
          details: {
            defaultExecutableName: "native_game.x86_64",
            storeAppIds: { steam: "999999", heroic: "native_game" },
          },
        },
        "mod-types": {
          kind: "mod-types",
          version: "1.0.0",
          supported: true,
          details: [
            { id: "plugins", name: "Game Plugins", targetPath: "mods", priority: 10 },
            { id: "configs", name: "Configuration Files", targetPath: "config", priority: 20 },
            { id: "assets", name: "Raw Assets", targetPath: "content/assets", priority: 30 },
          ],
        },
        "install-rules": {
          kind: "install-rules",
          version: "1.0.0",
          supported: true,
          details: [
            { pattern: "**/*.so", destination: "mods" },
            { pattern: "**/*.json", destination: "config" },
            { pattern: "**/*.asset", destination: "content/assets" },
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
          details: [
            { id: "asset_compiler", name: "Asset Compiler CLI", executable: "bin/compiler" },
          ],
        },
        saves: {
          kind: "saves",
          version: "1.0.0",
          supported: true,
          details: {
            prefixRelativePath: ".local/share/native_game/saves",
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
            checkDependencies: ["libvulkan1", "glibc"],
          },
        },
        migration: {
          kind: "migration",
          version: "1.0.0",
          supported: true,
          details: {
            schemaVersion: 2,
          },
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
      throw new Error(`Capability '${kind}' is not declared by adapter '${this.manifest.id}'`);
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
