import { describe, expect, it } from "vitest";

import type { IDeploymentManifest } from "../types/IDeploymentManifest";
import {
  addDeploymentManifestIntegrity,
  CURRENT_DEPLOYMENT_MANIFEST_VERSION,
  migrateDeploymentManifest,
  verifyDeploymentManifestIntegrity,
} from "./deploymentManifest";

describe("deployment manifest integrity", () => {
  const manifest = (): Omit<IDeploymentManifest, "integrity"> => ({
    version: CURRENT_DEPLOYMENT_MANIFEST_VERSION,
    instance: "instance-1",
    gameId: "skyrimse",
    deploymentMethod: "hardlink_activator",
    files: [{ relPath: "textures/asset.dds", source: "mod-1", time: 123 }],
  });

  it("accepts an intact v2 manifest", () => {
    const signed = addDeploymentManifestIntegrity(manifest());
    expect(() => verifyDeploymentManifestIntegrity(signed)).not.toThrow();
  });

  it("rejects a modified v2 manifest", () => {
    const signed = addDeploymentManifestIntegrity(manifest());
    signed.files[0].source = "tampered";
    expect(() => verifyDeploymentManifestIntegrity(signed)).toThrow("integrity check");
  });

  it("migrates legacy v1 data in memory and rejects future schemas", () => {
    const legacy = { ...manifest(), version: 1 };
    const migrated = migrateDeploymentManifest(legacy);
    expect(migrated.version).toBe(CURRENT_DEPLOYMENT_MANIFEST_VERSION);
    expect(() => verifyDeploymentManifestIntegrity(migrated)).not.toThrow();
    expect(() => verifyDeploymentManifestIntegrity(legacy)).not.toThrow();
    expect(() =>
      migrateDeploymentManifest({ ...legacy, version: CURRENT_DEPLOYMENT_MANIFEST_VERSION + 1 }),
    ).toThrow("Unsupported deployment manifest version");
  });
});
