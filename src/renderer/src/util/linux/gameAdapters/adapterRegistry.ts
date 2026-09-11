import {
  ALL_ADAPTER_CAPABILITY_KINDS,
  type AdapterCapabilityKind,
  type ICapabilityDescriptor,
  type IGameAdapter,
  type IGameAdapterManifest,
} from "./contracts";

export interface IAdapterValidationResult {
  valid: boolean;
  errors: string[];
}

export interface IAdapterRegistrationEntry {
  adapter: IGameAdapter;
  enabled: boolean;
  installedAt: number;
  lastUpgradedAt?: number;
}

/**
 * Registry managing versioned game adapters.
 *
 * Enforces Phase 2 acceptance criteria:
 * 1. Adapters can be installed, upgraded, disabled, and removed without modifying core source or corrupting profiles.
 * 2. Every adapter must declare all mandatory capabilities explicitly; unsupported capabilities must be visible.
 */
export class GameAdapterRegistry {
  private readonly mEntries = new Map<string, IAdapterRegistrationEntry>();

  /**
   * Validates that an adapter declares all required capabilities and provides explanations for unsupported ones.
   */
  public validateAdapter(adapter: IGameAdapter): IAdapterValidationResult {
    const errors: string[] = [];
    const manifest = adapter.manifest;

    if (!manifest.id || typeof manifest.id !== "string") {
      errors.push("Adapter manifest must have a non-empty string 'id'");
    }
    if (!manifest.version || typeof manifest.version !== "string") {
      errors.push("Adapter manifest must have a valid 'version'");
    }
    if (!manifest.targetGameId || typeof manifest.targetGameId !== "string") {
      errors.push("Adapter manifest must have a non-empty 'targetGameId'");
    }
    if (!Array.isArray(manifest.targetEditions) || manifest.targetEditions.length === 0) {
      errors.push("Adapter manifest must declare at least one target edition in 'targetEditions'");
    }

    if (!manifest.capabilities || typeof manifest.capabilities !== "object") {
      errors.push("Adapter manifest must declare a 'capabilities' record");
      return { valid: false, errors };
    }

    // Verify all 10 mandatory capabilities are declared
    for (const kind of ALL_ADAPTER_CAPABILITY_KINDS) {
      const desc = manifest.capabilities[kind] as ICapabilityDescriptor | undefined;
      if (!desc) {
        errors.push(`Missing mandatory capability declaration: '${kind}'`);
      } else {
        if (typeof desc.supported !== "boolean") {
          errors.push(`Capability '${kind}' must specify boolean 'supported'`);
        }
        if (!desc.version) {
          errors.push(`Capability '${kind}' must specify a 'version'`);
        }
        // If unsupported, must provide an explicit, visible reason
        if (
          desc.supported === false &&
          (!desc.unsupportedReason || desc.unsupportedReason.trim() === "")
        ) {
          errors.push(
            `Unsupported capability '${kind}' must provide an explicit 'unsupportedReason'`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Installs and registers a new game adapter.
   */
  public registerAdapter(adapter: IGameAdapter): void {
    const validation = this.validateAdapter(adapter);
    if (!validation.valid) {
      throw new Error(
        `Failed to register game adapter '${adapter.manifest?.id}': ${validation.errors.join("; ")}`,
      );
    }

    const adapterId = adapter.manifest.id;
    if (this.mEntries.has(adapterId)) {
      throw new Error(
        `Adapter with ID '${adapterId}' is already registered. Use upgradeAdapter to update it.`,
      );
    }

    this.mEntries.set(adapterId, {
      adapter,
      enabled: true,
      installedAt: Date.now(),
    });
  }

  /**
   * Upgrades an existing registered adapter to a newer version without corrupting profiles or losing state.
   */
  public upgradeAdapter(newAdapter: IGameAdapter): { previousVersion: string; newVersion: string } {
    const validation = this.validateAdapter(newAdapter);
    if (!validation.valid) {
      throw new Error(
        `Cannot upgrade adapter '${newAdapter.manifest?.id}': ${validation.errors.join("; ")}`,
      );
    }

    const adapterId = newAdapter.manifest.id;
    const existing = this.mEntries.get(adapterId);
    if (!existing) {
      throw new Error(
        `Cannot upgrade unregistered adapter '${adapterId}'. Use registerAdapter first.`,
      );
    }

    const previousVersion = existing.adapter.manifest.version;
    const newVersion = newAdapter.manifest.version;

    // Atomically swap adapter implementation while preserving enabled status and installation record
    this.mEntries.set(adapterId, {
      adapter: newAdapter,
      enabled: existing.enabled,
      installedAt: existing.installedAt,
      lastUpgradedAt: Date.now(),
    });

    return { previousVersion, newVersion };
  }

  /**
   * Disables an adapter without removing its configuration or corrupting user profiles.
   */
  public disableAdapter(adapterId: string): void {
    const entry = this.mEntries.get(adapterId);
    if (!entry) {
      throw new Error(`Cannot disable adapter: '${adapterId}' not found.`);
    }
    entry.enabled = false;
  }

  /**
   * Re-enables a disabled adapter.
   */
  public enableAdapter(adapterId: string): void {
    const entry = this.mEntries.get(adapterId);
    if (!entry) {
      throw new Error(`Cannot enable adapter: '${adapterId}' not found.`);
    }
    entry.enabled = true;
  }

  /**
   * Unregisters and removes an adapter from the active registry.
   */
  public unregisterAdapter(adapterId: string): boolean {
    return this.mEntries.delete(adapterId);
  }

  /**
   * Checks whether an adapter is registered and currently enabled.
   */
  public isAdapterEnabled(adapterId: string): boolean {
    const entry = this.mEntries.get(adapterId);
    return entry ? entry.enabled : false;
  }

  /**
   * Retrieves an adapter by its unique identifier.
   */
  public getAdapter(adapterId: string): IGameAdapter | undefined {
    return this.mEntries.get(adapterId)?.adapter;
  }

  /**
   * Resolves the active enabled adapter for a given gameId and optional editionId.
   */
  public getAdapterForGame(gameId: string, editionId?: string): IGameAdapter | undefined {
    for (const entry of this.mEntries.values()) {
      if (!entry.enabled) continue;
      const manifest = entry.adapter.manifest;
      if (manifest.targetGameId === gameId) {
        if (!editionId || manifest.targetEditions.includes(editionId)) {
          return entry.adapter;
        }
      }
    }
    return undefined;
  }

  /**
   * Lists all registered adapters.
   */
  public listAdapters(): IGameAdapter[] {
    return Array.from(this.mEntries.values()).map((e) => e.adapter);
  }

  /**
   * Clears all adapters (primarily for testing resets).
   */
  public clear(): void {
    this.mEntries.clear();
  }
}
