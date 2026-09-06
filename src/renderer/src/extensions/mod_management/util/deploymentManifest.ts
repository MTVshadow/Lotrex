import { createHash } from "node:crypto";

import type { IDeploymentManifest } from "../types/IDeploymentManifest";

export const CURRENT_DEPLOYMENT_MANIFEST_VERSION = 2;

function checksumPayload(input: IDeploymentManifest): string {
  const { integrity: _integrity, ...payload } = input;
  return JSON.stringify(payload);
}

export function addDeploymentManifestIntegrity(
  input: Omit<IDeploymentManifest, "integrity">,
): IDeploymentManifest {
  const manifest = input as IDeploymentManifest;
  return {
    ...manifest,
    integrity: {
      algorithm: "sha256",
      digest: createHash("sha256").update(checksumPayload(manifest)).digest("hex"),
    },
  };
}

export function verifyDeploymentManifestIntegrity(input: IDeploymentManifest): void {
  if ((input.version ?? 1) < CURRENT_DEPLOYMENT_MANIFEST_VERSION) {
    return;
  }
  if (input.integrity?.algorithm !== "sha256" || typeof input.integrity.digest !== "string") {
    throw new Error("Deployment manifest has no supported integrity checksum");
  }
  const actual = createHash("sha256").update(checksumPayload(input)).digest("hex");
  if (actual !== input.integrity.digest) {
    throw new Error("Deployment manifest failed its integrity check");
  }
}

export function migrateDeploymentManifest(input: IDeploymentManifest): IDeploymentManifest {
  if ((input.version ?? 1) > CURRENT_DEPLOYMENT_MANIFEST_VERSION) {
    throw new Error(`Unsupported deployment manifest version ${input.version}`);
  }
  if ((input.version ?? 1) >= CURRENT_DEPLOYMENT_MANIFEST_VERSION) {
    return input;
  }
  const { integrity: _integrity, ...legacy } = input;
  return addDeploymentManifestIntegrity({
    ...legacy,
    version: CURRENT_DEPLOYMENT_MANIFEST_VERSION,
  });
}
