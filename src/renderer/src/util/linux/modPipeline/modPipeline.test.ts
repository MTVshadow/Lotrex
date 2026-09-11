import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { ReferenceGameAdapter } from "../gameAdapters/referenceAdapter";
import { ModPipelineEngine } from "./modPipelineEngine";
import { NativeReferenceAdapter } from "./nativeReferenceAdapter";
import type { ITransactionalFs } from "./transactionalDeployer";

/**
 * In-memory simulated transactional filesystem for isolated, deterministic testing.
 */
class InMemoryTransactionalFs implements ITransactionalFs {
  public files = new Map<string, string>();
  public symlinks = new Map<string, string>();
  public directories = new Set<string>();
  public failOnWritePath: string | null = null;

  public existsSync(p: string): boolean {
    const norm = path.normalize(p);
    return this.files.has(norm) || this.symlinks.has(norm) || this.directories.has(norm);
  }

  public mkdirSync(p: string): void {
    let current = path.normalize(p);
    while (current !== "/" && current !== "." && current !== "") {
      this.directories.add(current);
      current = path.dirname(current);
    }
  }

  public symlinkSync(target: string, p: string): void {
    const norm = path.normalize(p);
    if (this.failOnWritePath && norm.includes(this.failOnWritePath)) {
      throw new Error(`Simulated I/O failure on path: ${p}`);
    }
    this.symlinks.set(norm, target);
  }

  public linkSync(existingPath: string, newPath: string): void {
    const norm = path.normalize(newPath);
    if (this.failOnWritePath && norm.includes(this.failOnWritePath)) {
      throw new Error(`Simulated hardlink failure on path: ${newPath}`);
    }
    const content = this.files.get(path.normalize(existingPath)) ?? "";
    this.files.set(norm, content);
  }

  public copyFileSync(src: string, dest: string): void {
    const normDest = path.normalize(dest);
    if (this.failOnWritePath && normDest.includes(this.failOnWritePath)) {
      throw new Error(`Simulated copy failure on path: ${dest}`);
    }
    const content =
      this.files.get(path.normalize(src)) ?? this.symlinks.get(path.normalize(src)) ?? "content";
    this.files.set(normDest, content);
  }

  public unlinkSync(p: string): void {
    const norm = path.normalize(p);
    this.files.delete(norm);
    this.symlinks.delete(norm);
  }

  public writeFileSync(p: string, data: string): void {
    const norm = path.normalize(p);
    if (this.failOnWritePath && norm.includes(this.failOnWritePath)) {
      throw new Error(`Simulated write failure on path: ${p}`);
    }
    this.files.set(norm, data);
  }

  public readFileSync(p: string): string {
    const norm = path.normalize(p);
    const content = this.files.get(norm);
    if (content === undefined) {
      throw new Error(`File not found: ${p}`);
    }
    return content;
  }

  public readdirSync(p: string): string[] {
    const norm = path.normalize(p);
    const results: string[] = [];
    for (const file of this.files.keys()) {
      if (path.dirname(file) === norm) {
        results.push(path.basename(file));
      }
    }
    return results;
  }
}

describe("Modular Mod Pipeline (Phase 5)", () => {
  describe("Archive Inspection & Security", () => {
    it("maps archive entries to destinations using declarative adapter rules without core branching", () => {
      const engine = new ModPipelineEngine();
      const bethesdaAdapter = new ReferenceGameAdapter();

      const rawEntries = [
        { path: "CoolWeapon.esp", sizeBytes: 1024 },
        { path: "CoolTexture.dds", sizeBytes: 2048 },
        { path: "skse64_plugin.dll", sizeBytes: 512 },
      ];

      const inspected = engine.inspectArchive("/downloads/weapon.zip", rawEntries, bethesdaAdapter);

      // Rule: **/*.{esp,esm,esl,bsa} -> Data
      const espEntry = inspected.entries.find((e) => e.path === "CoolWeapon.esp");
      expect(espEntry?.destinationRelPath).toBe("Data/CoolWeapon.esp");

      // Rule: skse64_*.dll -> root ("")
      const dllEntry = inspected.entries.find((e) => e.path === "skse64_plugin.dll");
      expect(dllEntry?.destinationRelPath).toBe("skse64_plugin.dll");

      // Fallback to default mod type targetPath ("Data")
      const ddsEntry = inspected.entries.find((e) => e.path === "CoolTexture.dds");
      expect(ddsEntry?.destinationRelPath).toBe("Data/CoolTexture.dds");
    });

    it("strictly rejects directory traversal attempts in archive entries", () => {
      const engine = new ModPipelineEngine();
      const adapter = new ReferenceGameAdapter();

      const maliciousEntries = [{ path: "../../etc/shadow", sizeBytes: 100 }];

      expect(() => engine.inspectArchive("/downloads/bad.zip", maliciousEntries, adapter)).toThrow(
        "Malicious archive entry detected with directory traversal",
      );
    });
  });

  describe("Conflict Resolution", () => {
    it("resolves collisions by priority and reports explainable conflict records", () => {
      const memFs = new InMemoryTransactionalFs();
      const engine = new ModPipelineEngine(memFs);

      const modA = {
        modId: "mod-a",
        name: "Texture Pack Low",
        version: "1.0",
        stagingPath: "/staging/mod-a",
        priority: 10,
        enabled: true,
        files: [
          {
            relativePath: "textures/grass.dds",
            destinationRelPath: "Data/textures/grass.dds",
            sizeBytes: 100,
            sha256: "hash-a",
          },
        ],
      };

      const modB = {
        modId: "mod-b",
        name: "Texture Pack High",
        version: "2.0",
        stagingPath: "/staging/mod-b",
        priority: 20, // Higher priority wins
        enabled: true,
        files: [
          {
            relativePath: "textures/grass.dds",
            destinationRelPath: "Data/textures/grass.dds",
            sizeBytes: 200,
            sha256: "hash-b",
          },
        ],
      };

      const { resolvedFiles, conflicts } = engine.resolveConflicts([modA, modB]);

      expect(resolvedFiles.size).toBe(1);
      const winningFile = resolvedFiles.get("data/textures/grass.dds");
      expect(winningFile?.owningModId).toBe("mod-b");
      expect(winningFile?.sha256).toBe("hash-b");

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].winningModId).toBe("mod-b");
      expect(conflicts[0].conflictingModIds).toEqual(["mod-a", "mod-b"]);
      expect(conflicts[0].reason).toContain("Mod 'mod-b' (priority 20) overwrites [mod-a]");
    });
  });

  describe("Transactional Deployment & Automatic Rollback", () => {
    it("successfully deploys mods and preserves vanilla files via backups", () => {
      const memFs = new InMemoryTransactionalFs();
      const gamePath = "/games/SkyrimSE";
      memFs.mkdirSync(gamePath);

      // Pre-existing vanilla file
      const vanillaFileAbs = path.join(gamePath, "Data/skyrim.ini");
      memFs.writeFileSync(vanillaFileAbs, "[General]\nVanilla=1");

      const engine = new ModPipelineEngine(memFs);
      const adapter = new ReferenceGameAdapter();

      const mod = {
        modId: "mod-ini",
        name: "Custom INI",
        version: "1.0",
        stagingPath: "/staging/mod-ini",
        priority: 10,
        enabled: true,
        files: [
          {
            relativePath: "skyrim.ini",
            destinationRelPath: "Data/skyrim.ini",
            sizeBytes: 50,
            sha256: "ini-mod-hash",
          },
        ],
      };

      const result = engine.deployProfile(
        gamePath,
        "skyrimse",
        "profile-1",
        [mod],
        adapter,
        "symlink",
      );

      expect(result.success).toBe(true);
      expect(result.journal?.status).toBe("committed");
      expect(result.data?.deployedFilesCount).toBe(1);

      // Verify deployed symlink
      expect(memFs.symlinks.get(path.normalize(vanillaFileAbs))).toBe(
        "/staging/mod-ini/skyrim.ini",
      );

      // Verify vanilla file was safely backed up
      const deployedRecord = result.journal?.deployedFiles[0];
      expect(deployedRecord?.previousState).toBe("vanilla-backed-up");
      expect(deployedRecord?.backupPath).toBeDefined();
      expect(memFs.existsSync(deployedRecord!.backupPath!)).toBe(true);
    });

    it("automatically rolls back deployment if a failure occurs midway, restoring vanilla files", () => {
      const memFs = new InMemoryTransactionalFs();
      const gamePath = "/games/SkyrimSE";
      memFs.mkdirSync(gamePath);

      // Existing vanilla file that will be overwritten
      const vanillaFileAbs = path.join(gamePath, "Data/file1.txt");
      memFs.writeFileSync(vanillaFileAbs, "Original Vanilla Content");

      const engine = new ModPipelineEngine(memFs);
      const adapter = new ReferenceGameAdapter();

      const mod = {
        modId: "bad-mod",
        name: "Broken Mod",
        version: "1.0",
        stagingPath: "/staging/bad-mod",
        priority: 10,
        enabled: true,
        files: [
          {
            relativePath: "file1.txt",
            destinationRelPath: "Data/file1.txt",
            sizeBytes: 10,
            sha256: "hash-1",
          },
          {
            relativePath: "file2.txt",
            destinationRelPath: "Data/file2_blocked.txt",
            sizeBytes: 10,
            sha256: "hash-2",
          },
        ],
      };

      // Simulate failure on the second file
      memFs.failOnWritePath = "file2_blocked.txt";

      const result = engine.deployProfile(
        gamePath,
        "skyrimse",
        "profile-1",
        [mod],
        adapter,
        "symlink",
      );

      // Transaction must fail and report rollback
      expect(result.success).toBe(false);
      expect(result.rollbackExecuted).toBe(true);
      expect(result.error).toContain("Simulated I/O failure");

      // Verify file1 symlink was cleaned up and original vanilla content was restored!
      expect(memFs.symlinks.has(path.normalize(vanillaFileAbs))).toBe(false);
      expect(memFs.readFileSync(vanillaFileAbs)).toBe("Original Vanilla Content");
    });
  });

  describe("Complete Lifecycle Serving Two Structurally Different Reference Games (Phase 5 Criteria)", () => {
    it("serves Reference Game 1 (Windows/Proton SkyrimSE: Data/ folder, plugins.txt, hardlinks/symlinks)", () => {
      const memFs = new InMemoryTransactionalFs();
      const gamePath = "/games/SkyrimSE";
      memFs.mkdirSync(gamePath);

      const engine = new ModPipelineEngine(memFs);
      const protonAdapter = new ReferenceGameAdapter();

      // 1. Inspect archive
      const inspected = engine.inspectArchive(
        "/downloads/great_sword.zip",
        [
          { path: "GreatSword.esp", sizeBytes: 1024 },
          { path: "meshes/sword.nif", sizeBytes: 4096 },
          { path: "skse64_sword.dll", sizeBytes: 2048 },
        ],
        protonAdapter,
      );

      expect(inspected.entries.find((e) => e.path === "GreatSword.esp")?.destinationRelPath).toBe(
        "Data/GreatSword.esp",
      );
      expect(inspected.entries.find((e) => e.path === "skse64_sword.dll")?.destinationRelPath).toBe(
        "skse64_sword.dll",
      );

      // 2. Stage mod
      const stagedMod = engine.stageMod(
        "mod-sword",
        "Great Sword Mod",
        "1.0.0",
        "/staging",
        inspected,
        10,
      );
      expect(stagedMod.files.length).toBe(3);

      // 3. Deploy profile
      const deployResult = engine.deployProfile(
        gamePath,
        "skyrimse",
        "profile-proton",
        [stagedMod],
        protonAdapter,
        "symlink",
      );
      expect(deployResult.success).toBe(true);
      expect(deployResult.data?.deployedFilesCount).toBe(3);

      // 4. Handle Bethesda plugins.txt load order
      const loadOrderPath = engine.writeLoadOrder(
        gamePath,
        [
          { id: "Skyrim.esm", enabled: true, priority: 1 },
          { id: "GreatSword.esp", enabled: true, priority: 10 },
          { id: "DisabledMod.esp", enabled: false, priority: 20 },
        ],
        protonAdapter,
      );

      expect(loadOrderPath).toBe(path.resolve(gamePath, "plugins.txt"));
      const pluginsContent = memFs.readFileSync(loadOrderPath!);
      expect(pluginsContent).toContain("*Skyrim.esm");
      expect(pluginsContent).toContain("*GreatSword.esp");
      expect(pluginsContent).toContain("DisabledMod.esp"); // Inactive: no asterisk

      // 5. Track generated file (e.g. BodySlide output)
      engine.trackGeneratedFile(deployResult.journal!, "Data/meshes/generated_sword.nif");
      memFs.writeFileSync(path.join(gamePath, "Data/meshes/generated_sword.nif"), "mesh data");

      // 6. Purge deployment
      const purgeResult = engine.purge(deployResult.journal!);
      expect(purgeResult.purgedFilesCount).toBe(4); // 3 deployed + 1 generated

      // Verify files removed
      expect(memFs.existsSync(path.join(gamePath, "Data/GreatSword.esp"))).toBe(false);
      expect(memFs.existsSync(path.join(gamePath, "Data/meshes/generated_sword.nif"))).toBe(false);
    });

    it("serves Reference Game 2 (Native Linux Engine: mods/ & config/ folders, mods.json, native saves)", () => {
      const memFs = new InMemoryTransactionalFs();
      const gamePath = "/games/NativeGame";
      memFs.mkdirSync(gamePath);

      const engine = new ModPipelineEngine(memFs);
      const nativeAdapter = new NativeReferenceAdapter();

      // 1. Inspect archive using native Linux rules
      const inspected = engine.inspectArchive(
        "/downloads/native_mod.zip",
        [
          { path: "plugin_core.so", sizeBytes: 10240 },
          { path: "settings.json", sizeBytes: 512 },
          { path: "world.asset", sizeBytes: 20480 },
        ],
        nativeAdapter,
      );

      // Verify destination mapping: **/*.so -> mods, **/*.json -> config, **/*.asset -> content/assets
      expect(inspected.entries.find((e) => e.path === "plugin_core.so")?.destinationRelPath).toBe(
        "mods/plugin_core.so",
      );
      expect(inspected.entries.find((e) => e.path === "settings.json")?.destinationRelPath).toBe(
        "config/settings.json",
      );
      expect(inspected.entries.find((e) => e.path === "world.asset")?.destinationRelPath).toBe(
        "content/assets/world.asset",
      );

      // 2. Stage mod
      const stagedMod = engine.stageMod(
        "mod-native-1",
        "Native Core Plugin",
        "2.0.0",
        "/staging",
        inspected,
        15,
      );
      expect(stagedMod.files.length).toBe(3);

      // 3. Deploy profile with symlink method
      const deployResult = engine.deployProfile(
        gamePath,
        "native-game",
        "profile-native",
        [stagedMod],
        nativeAdapter,
        "symlink",
      );
      expect(deployResult.success).toBe(true);
      expect(deployResult.data?.deployedFilesCount).toBe(3);

      // 4. Handle Native JSON load order ('config/mods.json')
      const loadOrderPath = engine.writeLoadOrder(
        gamePath,
        [
          { id: "mod-native-1", enabled: true, priority: 1 },
          { id: "optional-plugin", enabled: false, priority: 2 },
        ],
        nativeAdapter,
      );

      expect(loadOrderPath).toBe(path.resolve(gamePath, "config/mods.json"));
      const jsonContent = JSON.parse(memFs.readFileSync(loadOrderPath!));
      expect(Array.isArray(jsonContent)).toBe(true);
      expect(jsonContent[0]).toEqual({ name: "mod-native-1", enabled: true, order: 1 });
      expect(jsonContent[1]).toEqual({ name: "optional-plugin", enabled: false, order: 2 });

      // 5. Track generated configuration file
      engine.trackGeneratedFile(deployResult.journal!, "config/runtime_generated.cache");
      memFs.writeFileSync(path.join(gamePath, "config/runtime_generated.cache"), "cache data");

      // 6. Purge deployment
      const purgeResult = engine.purge(deployResult.journal!);
      expect(purgeResult.purgedFilesCount).toBe(4); // 3 deployed + 1 generated

      // Verify files removed
      expect(memFs.existsSync(path.join(gamePath, "mods/plugin_core.so"))).toBe(false);
      expect(memFs.existsSync(path.join(gamePath, "config/runtime_generated.cache"))).toBe(false);
    });
  });
});
