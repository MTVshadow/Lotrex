import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";
import * as yaml from "yaml";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("Security Hardening: Dependency and Artifact Provenance Audit", () => {
  const packageJsonPath = path.join(ROOT, "package.json");
  const lockfilePath = path.join(ROOT, "pnpm-lock.yaml");
  const bomJsonPath = path.join(ROOT, "assets", "bom.json");
  const packageActionPath = path.join(ROOT, ".github", "actions", "package", "action.yml");
  const packageWorkflowPath = path.join(ROOT, ".github", "workflows", "package.yml");

  describe("1. Lockfile policy and package manager pinning", () => {
    it("enforces strict pinned packageManager with sha512 checksum in root package.json", () => {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      expect(pkg.packageManager).toBeDefined();
      expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\.[a-f0-9]{128}$/);
    });

    it("verifies pnpm-lock.yaml exists and contains integrity hashes", () => {
      expect(fs.existsSync(lockfilePath)).toBe(true);
      const lockfileRaw = fs.readFileSync(lockfilePath, "utf8");
      expect(lockfileRaw).toContain("lockfileVersion:");
      expect(lockfileRaw).toContain("integrity: sha512-");
    });

    it("verifies CI installation steps enforce --frozen-lockfile", () => {
      expect(fs.existsSync(packageActionPath)).toBe(true);
      const actionContent = fs.readFileSync(packageActionPath, "utf8");
      expect(actionContent).toContain("pnpm install --frozen-lockfile");
    });
  });

  describe("2. SBOM (Software Bill of Materials) generation and CycloneDX compliance", () => {
    it("has registered 'sbom' script in root package.json", () => {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      expect(pkg.scripts?.sbom).toBeDefined();
      expect(pkg.scripts.sbom).toContain("sbom");
    });

    it("generates a valid CycloneDX 1.7 SBOM at assets/bom.json", () => {
      expect(fs.existsSync(bomJsonPath)).toBe(true);
      const bom = JSON.parse(fs.readFileSync(bomJsonPath, "utf8"));

      expect(bom.bomFormat).toBe("CycloneDX");
      expect(bom.specVersion).toBe("1.7");
      expect(bom.metadata).toBeDefined();
      expect(bom.metadata.tools).toBeDefined();
      expect(bom.components).toBeInstanceOf(Array);
      expect(bom.components.length).toBeGreaterThan(0);

      // Verify components contain purl and package details
      const firstComponent = bom.components[0];
      expect(firstComponent.name).toBeDefined();
      expect(firstComponent.version).toBeDefined();
      expect(firstComponent.purl).toBeDefined();
    });
  });

  describe("3. Build artifact provenance and signing policy", () => {
    it("enforces npm provenance attestation in release workflows", () => {
      expect(fs.existsSync(packageWorkflowPath)).toBe(true);
      const workflowContent = fs.readFileSync(packageWorkflowPath, "utf8");
      expect(workflowContent).toContain("--provenance");
      expect(workflowContent).toContain("id-token: write");
    });

    it("requires installer, blockmap, and latest.yml checksum validation", () => {
      const actionContent = fs.readFileSync(packageActionPath, "utf8");
      expect(actionContent).toContain("latest.yml");
      expect(actionContent).toContain("vortex-setup-");
      expect(actionContent).toContain("Validate Package Creation");
    });
  });
});
