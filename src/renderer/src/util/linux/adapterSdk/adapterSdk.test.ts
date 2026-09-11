import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { AdapterScaffolder } from "./adapterScaffolder";
import { runAdapterConformanceSuite } from "./conformanceTester";
import type { ISdkAdapterManifest } from "./contracts";
import { LOTREX_ADAPTER_SDK_VERSION } from "./contracts";
import { SampleNativeGameAdapter, SampleProtonGameAdapter } from "./sampleAdapters";
import { validateSdkManifest } from "./schemaValidator";

describe("Extension SDK and Validation (Phase 8)", () => {
  describe("Typed Manifest Schema Validation", () => {
    it("validates that sample Proton and Native manifests comply with SDK schema", () => {
      const protonAdapter = new SampleProtonGameAdapter();
      const nativeAdapter = new SampleNativeGameAdapter();

      const resProton = validateSdkManifest(protonAdapter.manifest);
      expect(resProton.valid).toBe(true);
      expect(resProton.errors).toHaveLength(0);

      const resNative = validateSdkManifest(nativeAdapter.manifest);
      expect(resNative.valid).toBe(true);
      expect(resNative.errors).toHaveLength(0);
    });

    it("rejects manifest missing mandatory capabilities", () => {
      const protonAdapter = new SampleProtonGameAdapter();
      const brokenManifest: ISdkAdapterManifest = {
        ...protonAdapter.manifest,
        capabilities: {
          ...protonAdapter.manifest.capabilities,
        },
      };

      delete (brokenManifest.capabilities as any)["mod-types"];

      const res = validateSdkManifest(brokenManifest);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("Missing mandatory capability declaration: 'mod-types'");
    });

    it("rejects unsupported capabilities without visible explanatory reasons", () => {
      const protonAdapter = new SampleProtonGameAdapter();
      const brokenManifest: ISdkAdapterManifest = {
        ...protonAdapter.manifest,
        capabilities: {
          ...protonAdapter.manifest.capabilities,
          migration: {
            kind: "migration",
            version: "1.0.0",
            supported: false,
            unsupportedReason: "", // Empty reason!
          },
        },
      };

      const res = validateSdkManifest(brokenManifest);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("must provide an explicit, visible 'unsupportedReason'");
    });

    it("rejects permission roots that attempt directory traversal outside game directory", () => {
      const protonAdapter = new SampleProtonGameAdapter();
      const brokenManifest: ISdkAdapterManifest = {
        ...protonAdapter.manifest,
        permissions: {
          allowedRoots: ["Data", "../../etc"],
          allowedTools: [],
          networkAccess: false,
        },
      };

      const res = validateSdkManifest(brokenManifest);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("cannot contain '..'");
    });
  });

  describe("Harness & Conformance Test Suite", () => {
    it("verifies that SampleProtonGameAdapter achieves 100% conformance score", () => {
      const adapter = new SampleProtonGameAdapter();
      const report = runAdapterConformanceSuite(adapter, adapter.manifest);

      expect(report.passed).toBe(true);
      expect(report.conformanceScore).toBe(100);
      expect(report.checks.every((c) => c.passed)).toBe(true);
    });

    it("verifies that SampleNativeGameAdapter achieves 100% conformance score", () => {
      const adapter = new SampleNativeGameAdapter();
      const report = runAdapterConformanceSuite(adapter, adapter.manifest);

      expect(report.passed).toBe(true);
      expect(report.conformanceScore).toBe(100);
      expect(report.checks.every((c) => c.passed)).toBe(true);
    });
  });

  describe("Adapter Scaffolder (Zero-Core-Modification Workflow)", () => {
    it("scaffolds a complete, self-contained adapter package with tests, documentation, and localization", () => {
      const scaffolder = new AdapterScaffolder();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lotrex-sdk-test-"));

      try {
        const result = scaffolder.scaffoldAdapter(tempDir, {
          gameId: "valheim-sim",
          gameName: "Valheim Simulator",
          editionId: "standard",
          platform: "linux-native",
          defaultExecutable: "valheim.x86_64",
          author: "Modder 101",
          storeAppIds: { steam: "892970" },
        });

        expect(fs.existsSync(result.adapterPath)).toBe(true);
        expect(result.filesCreated).toContain("manifest.json");
        expect(result.filesCreated).toContain("adapter.ts");
        expect(result.filesCreated).toContain("locales/en.json");
        expect(result.filesCreated).toContain("adapter.test.ts");
        expect(result.filesCreated).toContain("README.md");

        // Verify generated README documentation instructs contributor without touching core
        const readme = fs.readFileSync(path.join(result.adapterPath, "README.md"), "utf-8");
        expect(readme).toContain("How It Works Without Touching Core Code");
        expect(readme).toContain(LOTREX_ADAPTER_SDK_VERSION);

        // Verify scaffolded manifest passes SDK schema validation
        const schemaCheck = validateSdkManifest(result.manifest);
        expect(schemaCheck.valid).toBe(true);
        expect(schemaCheck.errors).toHaveLength(0);

        // Verify localization namespace was isolated
        expect(result.manifest.localization.namespace).toBe("game-valheim-sim");
        expect(result.manifest.localization.strings.game_name).toBe("Valheim Simulator");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
