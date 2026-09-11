import {
  type AdapterCapabilityKind,
  type IAdapterOperationResult,
  type ICapabilityDescriptor,
  type IGameAdapter,
  type IGameAdapterManifest,
} from "./contracts";

/**
 * Reference implementation of a capability-based game adapter (Phase 2).
 * Demonstrates declaration of all 10 versioned capabilities, including an explicit
 * unsupported capability with a visible diagnostic explanation.
 */
export class ReferenceGameAdapter implements IGameAdapter {
  public readonly manifest: IGameAdapterManifest;

  constructor(overrides: Partial<IGameAdapterManifest> = {}) {
    this.manifest = {
      id: "skyrimse-linux-adapter",
      name: "The Elder Scrolls V: Skyrim Special Edition Adapter",
      version: "1.0.0",
      targetGameId: "skyrimse",
      targetEditions: ["special-edition", "anniversary"],
      author: "Lotrex Team",
      capabilities: {
        discovery: {
          kind: "discovery",
          version: "1.0.0",
          supported: true,
          details: {
            storeAppIds: { steam: "489830", gog: "1711230643" },
            defaultExecutableName: "SkyrimSE.exe",
          },
        },
        "mod-types": {
          kind: "mod-types",
          version: "1.0.0",
          supported: true,
          details: [
            { id: "data", name: "Data Mods", targetPath: "Data", priority: 10 },
            { id: "root", name: "Engine Injectors", targetPath: "", priority: 20 },
          ],
        },
        "install-rules": {
          kind: "install-rules",
          version: "1.0.0",
          supported: true,
          details: [
            { pattern: "**/*.{esp,esm,esl,bsa}", destination: "Data" },
            { pattern: "skse64_*.dll", destination: "" },
          ],
        },
        "deployment-targets": {
          kind: "deployment-targets",
          version: "1.0.0",
          supported: true,
          details: {
            supportedMethods: ["hardlink", "symlink", "move"],
          },
        },
        "load-order": {
          kind: "load-order",
          version: "1.0.0",
          supported: true,
          details: {
            fileFormat: "plugins.txt",
            lootIntegration: true,
          },
        },
        tools: {
          kind: "tools",
          version: "1.0.0",
          supported: true,
          details: [
            { id: "skse64", name: "SKSE64 Loader", executable: "skse64_loader.exe" },
            { id: "loot", name: "LOOT", executable: "LOOT.exe" },
          ],
        },
        saves: {
          kind: "saves",
          version: "1.0.0",
          supported: true,
          details: {
            prefixRelativePath:
              "drive_c/users/steamuser/Documents/My Games/Skyrim Special Edition/Saves",
          },
        },
        launch: {
          kind: "launch",
          version: "1.0.0",
          supported: true,
          details: {
            defaultProton: "Proton Experimental",
            requiresSteamCompat: true,
          },
        },
        diagnostics: {
          kind: "diagnostics",
          version: "1.0.0",
          supported: true,
          details: {
            checkDependencies: ["vcrun2019", "d3dcompiler_47"],
          },
        },
        migration: {
          kind: "migration",
          version: "1.0.0",
          supported: false,
          unsupportedReason:
            "No profile migration is required for standard Skyrim Special Edition installations",
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
    const cap = this.manifest.capabilities[kind];
    if (!cap) {
      return {
        kind,
        version: "0.0.0",
        supported: false,
        unsupportedReason: `Capability '${kind}' is not implemented by this adapter`,
      };
    }
    return cap as ICapabilityDescriptor<T>;
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
      data: { executedKind: kind, args } as unknown as TResult,
    };
  }
}
