import { ALL_ADAPTER_CAPABILITY_KINDS } from "../gameAdapters/contracts";
import { type ISdkAdapterManifest, LOTREX_ADAPTER_SDK_VERSION } from "./contracts";

/**
 * Validates that a game adapter manifest complies with the Lotrex Adapter SDK schema.
 */
export function validateSdkManifest(manifest: ISdkAdapterManifest): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. SDK Version Compatibility
  if (!manifest.sdkVersion || typeof manifest.sdkVersion !== "string") {
    errors.push("Manifest missing required 'sdkVersion' string.");
  } else if (manifest.sdkVersion !== LOTREX_ADAPTER_SDK_VERSION) {
    warnings.push(
      `Manifest SDK version '${manifest.sdkVersion}' differs from current SDK version '${LOTREX_ADAPTER_SDK_VERSION}'. Compatibility mode applied.`,
    );
  }

  // 2. Identity and Target Metadata
  if (!manifest.id || !/^[a-z0-9-_]+$/i.test(manifest.id)) {
    errors.push(
      "Manifest 'id' must be a valid identifier containing only alphanumeric characters, dashes, or underscores.",
    );
  }

  if (!manifest.name || manifest.name.trim() === "") {
    errors.push("Manifest 'name' must be a non-empty human-readable string.");
  }

  if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push("Manifest 'version' must follow semantic versioning (e.g. '1.0.0').");
  }

  if (!manifest.targetGameId || manifest.targetGameId.trim() === "") {
    errors.push("Manifest 'targetGameId' must be a non-empty string.");
  }

  if (!Array.isArray(manifest.targetEditions) || manifest.targetEditions.length === 0) {
    errors.push("Manifest 'targetEditions' must declare at least one supported edition ID.");
  }

  // 3. Capabilities Completeness (All 10 must be declared explicitly)
  if (!manifest.capabilities || typeof manifest.capabilities !== "object") {
    errors.push("Manifest must define a 'capabilities' object.");
  } else {
    for (const kind of ALL_ADAPTER_CAPABILITY_KINDS) {
      const desc = manifest.capabilities[kind];
      if (!desc) {
        errors.push(`Missing mandatory capability declaration: '${kind}'`);
      } else {
        if (typeof desc.supported !== "boolean") {
          errors.push(`Capability '${kind}' must define boolean 'supported' property.`);
        }
        if (!desc.version) {
          errors.push(`Capability '${kind}' must specify a contract 'version'.`);
        }
        if (
          desc.supported === false &&
          (!desc.unsupportedReason || desc.unsupportedReason.trim() === "")
        ) {
          errors.push(
            `Unsupported capability '${kind}' must provide an explicit, visible 'unsupportedReason'.`,
          );
        }
      }
    }
  }

  // 4. Permissions and Least Privilege Boundary
  if (!manifest.permissions || typeof manifest.permissions !== "object") {
    errors.push("Manifest must declare a 'permissions' block.");
  } else {
    if (!Array.isArray(manifest.permissions.allowedRoots)) {
      errors.push("Permissions 'allowedRoots' must be an array of paths.");
    } else {
      for (const root of manifest.permissions.allowedRoots) {
        if (root.startsWith("/") || root.startsWith("\\") || root.includes("..")) {
          errors.push(
            `Permission root '${root}' is invalid: must be relative to game directory and cannot contain '..'`,
          );
        }
      }
    }

    if (typeof manifest.permissions.networkAccess !== "boolean") {
      errors.push("Permissions 'networkAccess' must be a boolean.");
    }
  }

  // 5. Localization Namespace (Isolates strings from core codebase)
  if (!manifest.localization || typeof manifest.localization !== "object") {
    errors.push("Manifest must declare a 'localization' namespace.");
  } else {
    if (!manifest.localization.namespace || manifest.localization.namespace.trim() === "") {
      errors.push("Localization 'namespace' must be a non-empty string identifier.");
    }
    if (!manifest.localization.strings || Object.keys(manifest.localization.strings).length === 0) {
      warnings.push("Localization namespace defines no initial English string translations.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
