import { unknownToError } from "@vortex/shared";

import { ALL_ADAPTER_CAPABILITY_KINDS, type IGameAdapter } from "../gameAdapters/contracts";
import type {
  IAdapterConformanceReport,
  IConformanceCheckResult,
  ISdkAdapterManifest,
} from "./contracts";
import { validateSdkManifest } from "./schemaValidator";

/**
 * Conformance test harness for verifying game adapters against the SDK specification.
 *
 * Implements Phase 8 acceptance criteria:
 * Tests typed manifests, schema compatibility, capabilities, permissions, and localization namespaces.
 */
export function runAdapterConformanceSuite(
  adapter: IGameAdapter,
  manifest: ISdkAdapterManifest,
): IAdapterConformanceReport {
  const checks: IConformanceCheckResult[] = [];

  // 1. Schema Validation Check
  const schemaResult = validateSdkManifest(manifest);
  checks.push({
    capability: "manifest",
    check: "Schema validity & semver compliance",
    passed: schemaResult.valid,
    message: schemaResult.valid
      ? "Manifest conforms to Lotrex Adapter SDK schema."
      : `Schema errors: ${schemaResult.errors.join("; ")}`,
    severity: "error",
  });

  // 2. Capability Retrieval Consistency
  for (const kind of ALL_ADAPTER_CAPABILITY_KINDS) {
    try {
      const desc = adapter.getCapability(kind);
      const hasCap = adapter.hasCapability(kind);
      const isConsistent = hasCap === desc.supported;

      checks.push({
        capability: kind,
        check: `Capability '${kind}' consistency`,
        passed: isConsistent,
        message: isConsistent
          ? `Capability '${kind}' correctly exposed (supported: ${desc.supported}).`
          : `Capability inconsistency: hasCapability(${kind}) is ${hasCap}, but descriptor.supported is ${desc.supported}`,
        severity: "error",
      });
    } catch (err) {
      checks.push({
        capability: kind,
        check: `Capability '${kind}' retrieval`,
        passed: false,
        message: `Failed to retrieve capability '${kind}': ${unknownToError(err).message}`,
        severity: "error",
      });
    }
  }

  // 3. Discovery Capability Contract Check
  const discoveryDesc = adapter.getCapability<{ defaultExecutableName?: string }>("discovery");
  const hasValidDiscovery =
    discoveryDesc.supported &&
    typeof discoveryDesc.details?.defaultExecutableName === "string" &&
    discoveryDesc.details.defaultExecutableName.length > 0;

  checks.push({
    capability: "discovery",
    check: "Discovery executable specification",
    passed: Boolean(hasValidDiscovery),
    message: hasValidDiscovery
      ? `Default executable declared as '${discoveryDesc.details?.defaultExecutableName}'.`
      : "Discovery capability must specify a valid 'defaultExecutableName'.",
    severity: "error",
  });

  // 4. Permissions & Containment Check
  const permissions = manifest.permissions;
  const rootsAreSafe =
    permissions &&
    Array.isArray(permissions.allowedRoots) &&
    permissions.allowedRoots.every((r) => !r.startsWith("/") && !r.includes(".."));

  checks.push({
    capability: "permissions",
    check: "Least privilege containment bounds",
    passed: Boolean(rootsAreSafe),
    message: rootsAreSafe
      ? `Permissions confine deployment to declared roots: [${permissions.allowedRoots.join(", ")}].`
      : "Allowed roots must be relative directories without directory traversal ('..').",
    severity: "error",
  });

  // 5. Localization Namespace Check
  const localization = manifest.localization;
  const hasLocalization =
    localization &&
    typeof localization.namespace === "string" &&
    localization.namespace.length > 0 &&
    typeof localization.strings === "object";

  checks.push({
    capability: "localization",
    check: "Isolated localization namespace",
    passed: Boolean(hasLocalization),
    message: hasLocalization
      ? `Localization namespace '${localization.namespace}' defines isolated user strings.`
      : "Adapter must define an isolated localization namespace.",
    severity: "error",
  });

  const passedChecks = checks.filter((c) => c.passed).length;
  const totalChecks = checks.length;
  const conformanceScore = Math.round((passedChecks / totalChecks) * 100);
  const passed = checks.every((c) => c.severity !== "error" || c.passed);

  return {
    adapterId: manifest.id,
    sdkVersion: manifest.sdkVersion,
    passed,
    conformanceScore,
    checks,
    timestamp: Date.now(),
  };
}
