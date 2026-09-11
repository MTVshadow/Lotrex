import { describe, expect, it } from "vitest";

import { GameAdapterRegistry } from "./adapterRegistry";
import { ALL_ADAPTER_CAPABILITY_KINDS, type IGameAdapterManifest } from "./contracts";
import { ReferenceGameAdapter } from "./referenceAdapter";

describe("Capability-based Game Adapter API (Phase 2)", () => {
  it("declares all 10 mandatory versioned capabilities in reference adapter", () => {
    const adapter = new ReferenceGameAdapter();
    const manifest = adapter.manifest;

    expect(manifest.id).toBe("skyrimse-linux-adapter");
    expect(manifest.targetGameId).toBe("skyrimse");
    expect(manifest.targetEditions).toEqual(["special-edition", "anniversary"]);

    for (const kind of ALL_ADAPTER_CAPABILITY_KINDS) {
      const cap = manifest.capabilities[kind];
      expect(cap).toBeDefined();
      expect(cap.kind).toBe(kind);
      expect(typeof cap.supported).toBe("boolean");
      expect(typeof cap.version).toBe("string");
    }
  });

  it("makes unsupported capabilities explicit and visible with clear diagnostics", async () => {
    const adapter = new ReferenceGameAdapter();

    // Migration capability is deliberately marked unsupported in the reference adapter
    const migrationCap = adapter.getCapability("migration");
    expect(migrationCap.supported).toBe(false);
    expect(migrationCap.unsupportedReason).toBe(
      "No profile migration is required for standard Skyrim Special Edition installations",
    );

    // Attempting to execute an unsupported capability fails gracefully with diagnostic
    const result = await adapter.executeCapability!("migration", { profileId: "prof_123" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("is unsupported");
    expect(result.error).toContain(migrationCap.unsupportedReason);
  });

  it("successfully executes supported capabilities returning structured envelopes", async () => {
    const adapter = new ReferenceGameAdapter();

    expect(adapter.hasCapability("discovery")).toBe(true);
    const result = await adapter.executeCapability!("discovery", { query: "steam" });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as any).executedKind).toBe("discovery");
  });

  it("validates adapter manifests and rejects incomplete declarations", () => {
    const registry = new GameAdapterRegistry();

    // Incomplete adapter missing "migration" and "tools"
    const incompleteAdapter = new ReferenceGameAdapter();
    delete (incompleteAdapter.manifest.capabilities as any)["migration"];
    delete (incompleteAdapter.manifest.capabilities as any)["tools"];

    const validation = registry.validateAdapter(incompleteAdapter);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Missing mandatory capability"))).toBe(true);

    expect(() => registry.registerAdapter(incompleteAdapter)).toThrow(
      /Missing mandatory capability/,
    );
  });

  it("rejects unsupported capabilities that omit an explicit unsupportedReason", () => {
    const registry = new GameAdapterRegistry();

    const badAdapter = new ReferenceGameAdapter();
    badAdapter.manifest.capabilities.migration.unsupportedReason = ""; // Empty reason

    const validation = registry.validateAdapter(badAdapter);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((e) => e.includes("must provide an explicit 'unsupportedReason'")),
    ).toBe(true);
  });

  it("supports installing, upgrading, disabling, and removing an adapter in registry", () => {
    const registry = new GameAdapterRegistry();
    const adapterV1 = new ReferenceGameAdapter({ version: "1.0.0" });

    // 1. Install / Register
    registry.registerAdapter(adapterV1);
    expect(registry.isAdapterEnabled(adapterV1.manifest.id)).toBe(true);
    expect(registry.getAdapter("skyrimse-linux-adapter")).toBe(adapterV1);
    expect(registry.getAdapterForGame("skyrimse", "special-edition")).toBe(adapterV1);

    // 2. Disable
    registry.disableAdapter(adapterV1.manifest.id);
    expect(registry.isAdapterEnabled(adapterV1.manifest.id)).toBe(false);
    // When disabled, resolving adapter for game returns undefined
    expect(registry.getAdapterForGame("skyrimse", "special-edition")).toBeUndefined();

    // 3. Re-enable
    registry.enableAdapter(adapterV1.manifest.id);
    expect(registry.isAdapterEnabled(adapterV1.manifest.id)).toBe(true);
    expect(registry.getAdapterForGame("skyrimse", "special-edition")).toBe(adapterV1);

    // 4. Upgrade to 1.1.0
    const adapterV2 = new ReferenceGameAdapter({ version: "1.1.0" });
    const upgradeResult = registry.upgradeAdapter(adapterV2);
    expect(upgradeResult.previousVersion).toBe("1.0.0");
    expect(upgradeResult.newVersion).toBe("1.1.0");
    expect(registry.getAdapter("skyrimse-linux-adapter")?.manifest.version).toBe("1.1.0");

    // 5. Unregister / Remove
    const removed = registry.unregisterAdapter(adapterV1.manifest.id);
    expect(removed).toBe(true);
    expect(registry.getAdapter("skyrimse-linux-adapter")).toBeUndefined();
  });

  it("demonstrates adapter upgrade and removal does not corrupt profile data", () => {
    const registry = new GameAdapterRegistry();
    const adapter = new ReferenceGameAdapter();
    registry.registerAdapter(adapter);

    // Mock an active profile binding
    const userProfile = {
      profileId: "profile_skyrimse_user1",
      gameId: "skyrimse",
      modList: ["mod_a", "mod_b"],
      enabled: true,
    };

    // Upgrade adapter
    const upgradedAdapter = new ReferenceGameAdapter({ version: "2.0.0" });
    registry.upgradeAdapter(upgradedAdapter);

    // Profile data remains completely intact
    expect(userProfile.profileId).toBe("profile_skyrimse_user1");
    expect(userProfile.modList).toEqual(["mod_a", "mod_b"]);

    // Disable adapter
    registry.disableAdapter(adapter.manifest.id);
    expect(userProfile.enabled).toBe(true);

    // Unregister adapter
    registry.unregisterAdapter(adapter.manifest.id);
    expect(userProfile.profileId).toBe("profile_skyrimse_user1");
  });
});
