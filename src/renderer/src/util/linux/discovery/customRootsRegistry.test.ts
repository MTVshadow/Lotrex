import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CustomRootsRegistry, validateCustomRootCandidate } from "./customRootsRegistry";

describe("Unified Linux Resource Discovery — Phase 8: User-Approved Custom Roots", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-roots-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("validateCustomRootCandidate", () => {
    it("rejects empty or relative paths", () => {
      expect(validateCustomRootCandidate("").isValid).toBe(false);
      expect(validateCustomRootCandidate("relative/games").isValid).toBe(false);
    });

    it("prevents unbounded disk crawling by rejecting root / and user home directly", () => {
      const rootRes = validateCustomRootCandidate("/");
      expect(rootRes.isValid).toBe(false);
      expect(rootRes.error).toContain("strictly prohibited");

      const homeRes = validateCustomRootCandidate(os.homedir());
      expect(homeRes.isValid).toBe(false);
      expect(homeRes.error).toContain("strictly prohibited");
    });

    it("rejects non-existent directory or files", async () => {
      const nonExistent = path.join(tempDir, "does_not_exist");
      expect(validateCustomRootCandidate(nonExistent).isValid).toBe(false);

      const filePath = path.join(tempDir, "file.txt");
      await fs.writeFile(filePath, "content");
      const fileRes = validateCustomRootCandidate(filePath);
      expect(fileRes.isValid).toBe(false);
      expect(fileRes.error).toContain("not a directory");
    });

    it("accepts valid directories and prevents duplicate additions", async () => {
      const validDir = path.join(tempDir, "CustomGames");
      await fs.mkdir(validDir, { recursive: true });

      const res = validateCustomRootCandidate(validDir);
      expect(res.isValid).toBe(true);
      expect(res.normalizedPath).toBe(path.resolve(validDir));

      // Test duplicate detection
      const existing = [
        {
          id: "custom-root:1",
          path: validDir,
          scope: "game" as const,
          createdAt: Date.now(),
          validated: true,
        },
      ];
      const dupRes = validateCustomRootCandidate(validDir, existing);
      expect(dupRes.isValid).toBe(false);
      expect(dupRes.error).toContain("already exists");
    });
  });

  describe("CustomRootsRegistry", () => {
    it("adds, lists, and removes user-approved roots preserving provenance", async () => {
      const customDir = path.join(tempDir, "SteamCustomLibrary");
      await fs.mkdir(customDir, { recursive: true });

      const registry = new CustomRootsRegistry();
      const added = registry.addRoot(customDir, "library", "My SSD Library");

      expect(added.id).toMatch(/^custom-root:[a-f0-9]+$/);
      expect(added.path).toBe(path.resolve(customDir));
      expect(added.scope).toBe("library");
      expect(added.label).toBe("My SSD Library");
      expect(added.validated).toBe(true);

      expect(registry.getRoots()).toHaveLength(1);

      // Verify bounded source conversion without silent rewriting
      const bounded = registry.toBoundedSources();
      expect(bounded).toHaveLength(1);
      expect(bounded[0].id).toBe(added.id);
      expect(bounded[0].category).toBe("user-approved-root");
      expect(bounded[0].provider).toBe("custom-root");
      expect(bounded[0].resolvedPath).toBe(path.resolve(customDir));

      // Remove root
      expect(registry.removeRoot(added.id)).toBe(true);
      expect(registry.getRoots()).toHaveLength(0);
    });

    it("resets all roots correctly", async () => {
      const dir1 = path.join(tempDir, "Dir1");
      const dir2 = path.join(tempDir, "Dir2");
      await fs.mkdir(dir1, { recursive: true });
      await fs.mkdir(dir2, { recursive: true });

      const registry = new CustomRootsRegistry();
      registry.addRoot(dir1);
      registry.addRoot(dir2);
      expect(registry.getRoots()).toHaveLength(2);

      registry.resetRoots();
      expect(registry.getRoots()).toHaveLength(0);
    });
  });
});
