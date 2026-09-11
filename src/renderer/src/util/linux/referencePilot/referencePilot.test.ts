import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { ITransactionalFs } from "../modPipeline/transactionalDeployer";
import { GameSupportCatalog } from "../supportCatalog/supportCatalog";
import { NativeGamePilot } from "./nativePilot";
import { REFERENCE_PILOT_SCENARIOS, ReferencePilotRunner } from "./pilotRunner";
import { ProtonGamePilot } from "./protonPilot";

/**
 * In-memory transactional filesystem for isolated, deterministic testing of pilot scenarios.
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
    if (this.symlinks.has(norm)) {
      const target = this.symlinks.get(norm)!;
      return this.readFileSync(target);
    }
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

describe("Phase 10: Reference-Game Pilot", () => {
  it("executes all 12 lifecycle stages cleanly on Native Linux reference game", () => {
    const memFs = new InMemoryTransactionalFs();
    const pilot = new NativeGamePilot(memFs, "/games/native-ref", "/staging/native-ref");

    const result = pilot.executeScenario(REFERENCE_PILOT_SCENARIOS.native);

    expect(result.success).toBe(true);
    expect(result.stages).toHaveLength(12);

    const stageNames = result.stages.map((s) => s.stage);
    expect(stageNames).toEqual([
      "discovery",
      "profileCreation",
      "modInstall",
      "conflictResolution",
      "deployment",
      "loadOrder",
      "toolsExecution",
      "launch",
      "inGameVerification",
      "purgeRestoration",
      "recoveryRollback",
      "restartAndUpgrade",
    ]);

    for (const stage of result.stages) {
      expect(stage.passed).toBe(true);
      expect(stage.error).toBeUndefined();
    }

    // Verify generated evidence
    expect(result.evidence.checklist.discovery).toBe(true);
    expect(result.evidence.checklist.profileCreation).toBe(true);
    expect(result.evidence.checklist.modInstall).toBe(true);
    expect(result.evidence.checklist.conflictResolution).toBe(true);
    expect(result.evidence.checklist.deployment).toBe(true);
    expect(result.evidence.checklist.loadOrder).toBe(true);
    expect(result.evidence.checklist.toolsExecution).toBe(true);
    expect(result.evidence.checklist.launchPreparation).toBe(true);
    expect(result.evidence.checklist.purgeRestoration).toBe(true);
    expect(result.evidence.checklist.atomicRollback).toBe(true);
  });

  it("executes all 12 lifecycle stages cleanly on Windows/Proton reference game (Skyrim SE)", () => {
    const memFs = new InMemoryTransactionalFs();
    const pilot = new ProtonGamePilot(
      memFs,
      "/games/steamapps/common/Skyrim Special Edition",
      "/games/steamapps/compatdata/489830/pfx",
      "/staging/skyrimse",
    );

    const result = pilot.executeScenario(REFERENCE_PILOT_SCENARIOS.proton);

    expect(result.success).toBe(true);
    expect(result.stages).toHaveLength(12);

    for (const stage of result.stages) {
      expect(stage.passed).toBe(true);
      expect(stage.error).toBeUndefined();
    }

    expect(result.evidence.checklist.atomicRollback).toBe(true);
    expect(result.evidence.checklist.purgeRestoration).toBe(true);
  });

  it("runs full reference pilot suite and qualifies both games for supported tier in catalog", () => {
    const memFs = new InMemoryTransactionalFs();
    const catalog = new GameSupportCatalog();
    const runner = new ReferencePilotRunner(memFs, catalog);

    const suiteResult = runner.runFullPilotSuite();

    expect(suiteResult.allPassed).toBe(true);
    expect(suiteResult.nativeResult.success).toBe(true);
    expect(suiteResult.protonResult.success).toBe(true);

    // Evaluate native record in catalog
    const nativeEval = catalog.evaluateRecord("native-ref:standard:steam:linux-native");
    expect(nativeEval).toBeDefined();
    expect(nativeEval?.declaredTier).toBe("supported");
    expect(nativeEval?.effectiveTier).toBe("supported");
    expect(nativeEval?.downgraded).toBe(false);
    expect(nativeEval?.isStale).toBe(false);
    expect(nativeEval?.blockingLimitations).toHaveLength(0);

    // Evaluate Proton Skyrim record in catalog
    const protonEval = catalog.evaluateRecord("skyrimse:special-edition:steam:windows-proton");
    expect(protonEval).toBeDefined();
    expect(protonEval?.declaredTier).toBe("supported");
    expect(protonEval?.effectiveTier).toBe("supported");
    expect(protonEval?.downgraded).toBe(false);
    expect(protonEval?.isStale).toBe(false);
    expect(protonEval?.blockingLimitations).toHaveLength(0);
  });

  it("captures errors gracefully when executable discovery fails", () => {
    const memFs = new InMemoryTransactionalFs();
    const pilot = new NativeGamePilot(memFs, "/games/empty-game", "/staging/empty");

    // Do not call setupVanillaGame, execute directly
    // Override setupVanillaGame to do nothing
    pilot.setupVanillaGame = () => {};

    const result = pilot.executeScenario(REFERENCE_PILOT_SCENARIOS.native);

    expect(result.success).toBe(false);
    expect(result.stages[0].stage).toBe("discovery");
    expect(result.stages[0].passed).toBe(false);
    expect(result.stages[0].error).toContain("Native executable not found");
    expect(result.evidence.checklist.discovery).toBe(false);
  });
});
