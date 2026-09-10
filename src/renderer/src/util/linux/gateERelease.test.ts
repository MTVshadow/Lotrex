import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeSha256,
  evaluateGateEReadiness,
  generateReleaseNotesMarkdown,
  REQUIRED_ENVIRONMENT_MATRIX,
  verifySbomIntegrity,
} from "./gateERelease";

describe("Gate E — Stable Release Readiness & Artifact Provenance", () => {
  const rootDir = path.resolve(__dirname, "../../../../../");
  const bomPath = path.join(rootDir, "assets", "bom.json");

  describe("1. Cryptographic hashing and SBOM integrity", () => {
    it("computes reproducible SHA-256 hashes", () => {
      const hash = computeSha256("test-release-content");
      expect(hash).toBe("b7d075ee10fae25f5f3c4cd733a0fb57b8a418dd46d749e99bd18faa7798cd62");
    });

    it("verifies bundled CycloneDX 1.7 SBOM", () => {
      const res = verifySbomIntegrity(bomPath);
      expect(res.valid).toBe(true);
      expect(res.specVersion).toBe("1.7");
      expect(res.componentCount).toBeGreaterThan(0);
      expect(res.sha256).toHaveLength(64);
    });

    it("rejects non-existent or invalid SBOM files", () => {
      const nonExistent = verifySbomIntegrity(
        path.join(rootDir, "assets", "non-existent-bom.json"),
      );
      expect(nonExistent.valid).toBe(false);
      expect(nonExistent.error).toContain("does not exist");
    });
  });

  describe("2. Gate E Release Evaluation", () => {
    it("evaluates all Gate E checks against repository state and confirms readiness for stable release", () => {
      const evaluation = evaluateGateEReadiness({
        rootDir,
        version: "1.13.0",
        gitCommit: "7d9770737",
      });

      expect(evaluation.readyForStableRelease).toBe(true);
      expect(evaluation.checks.length).toBeGreaterThanOrEqual(8);

      // Verify each critical category is present and passed
      const provenanceChecks = evaluation.checks.filter((c) => c.category === "provenance");
      expect(provenanceChecks.every((c) => c.passed)).toBe(true);

      const blockerChecks = evaluation.checks.filter((c) => c.category === "blockers");
      expect(blockerChecks.length).toBe(5);
      expect(blockerChecks.every((c) => c.passed)).toBe(true);

      const matrixChecks = evaluation.checks.filter((c) => c.category === "matrix");
      expect(matrixChecks.every((c) => c.passed)).toBe(true);

      const recoveryChecks = evaluation.checks.filter((c) => c.category === "recovery");
      expect(recoveryChecks.every((c) => c.passed)).toBe(true);
    });

    it("validates that the 9-axis packaged environment matrix is completely satisfied", () => {
      const evaluation = evaluateGateEReadiness({
        rootDir,
        version: "1.13.0",
      });

      const axes = evaluation.releaseRecord.environmentMatrix;
      expect(axes).toHaveLength(9);

      for (const axis of axes) {
        expect(axis.passed).toBe(true);
        expect(axis.testedValues).toEqual(REQUIRED_ENVIRONMENT_MATRIX[axis.axis]);
      }
    });

    it("generates markdown release notes containing checksums and recovery instructions", () => {
      const evaluation = evaluateGateEReadiness({
        rootDir,
        version: "1.13.0",
        gitCommit: "7d9770737",
      });

      const markdown = generateReleaseNotesMarkdown(evaluation.releaseRecord);

      expect(markdown).toContain("# Lotrex 1.13.0 — Linux Stable Release");
      expect(markdown).toContain("CycloneDX 1.7");
      expect(markdown).toContain("Artifact Checksums (SHA-256)");
      expect(markdown).toContain("lotrex-1.13.0-x86_64.AppImage");
      expect(markdown).toContain("lotrex_1.13.0_amd64.deb");
      expect(markdown).toContain("Supported Linux Matrix (Gates A–E Verified)");
      expect(markdown).toContain("Recovery & Rollback Instructions");
    });
  });
});
