import type { ITransactionalFs } from "../modPipeline/transactionalDeployer";
import { GameSupportCatalog } from "../supportCatalog/supportCatalog";
import type { IPilotExecutionResult, IPilotScenario } from "./contracts";
import { NativeGamePilot } from "./nativePilot";
import { ProtonGamePilot } from "./protonPilot";

/**
 * Result of executing the complete reference pilot suite.
 */
export interface IReferencePilotSuiteResult {
  allPassed: boolean;
  nativeResult: IPilotExecutionResult;
  protonResult: IPilotExecutionResult;
  catalog: GameSupportCatalog;
  completedAt: string;
}

/**
 * Standard pilot scenario definitions for the two reference games.
 */
export const REFERENCE_PILOT_SCENARIOS: {
  native: IPilotScenario;
  proton: IPilotScenario;
} = {
  native: {
    name: "Native Linux Engine Reference Pilot",
    gameType: "native",
    gameId: "native-ref",
    editionId: "standard",
    storeId: "steam",
    platform: "linux-native",
    maintainer: "Lotrex Native Linux SIG",
    adapterVersion: "1.0.0",
    artifactBuildId: "synthetic-fixture:native-ref",
    deploymentMethod: "symlink",
  },
  proton: {
    name: "Bethesda Skyrim SE Windows/Proton Reference Pilot",
    gameType: "proton",
    gameId: "skyrimse",
    editionId: "special-edition",
    storeId: "steam",
    platform: "windows-proton",
    maintainer: "Lotrex Bethesda/Proton Team",
    adapterVersion: "1.0.0",
    artifactBuildId: "synthetic-fixture:skyrimse-proton",
    deploymentMethod: "hardlink",
  },
};

/**
 * Reference Game Pilot Coordinator (Phase 10).
 *
 * Implements:
 * 1. Small reference pilot across 1 native Linux game and 1 Windows/Proton game with materially different layouts.
 * 2. Complete verification across discovery, profile creation, mod install, conflicts, deployment,
 *    tools, launch, visible state, purge, recovery rollback, restart, and upgrade.
 * 3. Registers synthetic evidence as experimental; packaged evidence is required for promotion.
 */
export class ReferencePilotRunner {
  constructor(
    private readonly fsAdapter?: ITransactionalFs,
    private readonly catalog: GameSupportCatalog = new GameSupportCatalog(),
  ) {}

  /**
   * Executes both reference pilots, records reproducible evidence, and evaluates support tier.
   */
  public runFullPilotSuite(): IReferencePilotSuiteResult {
    const nativePilot = new NativeGamePilot(
      this.fsAdapter,
      "/games/pilot-native",
      "/staging/pilot-native",
    );
    const protonPilot = new ProtonGamePilot(
      this.fsAdapter,
      "/games/pilot-skyrim",
      "/games/pilot-skyrim-pfx",
      "/staging/pilot-skyrim",
    );

    const nativeResult = nativePilot.executeScenario(REFERENCE_PILOT_SCENARIOS.native);
    const protonResult = protonPilot.executeScenario(REFERENCE_PILOT_SCENARIOS.proton);

    // Register records in catalog
    this.catalog.registerRecord({
      id: "native-ref:standard:steam:linux-native",
      gameId: REFERENCE_PILOT_SCENARIOS.native.gameId,
      editionId: REFERENCE_PILOT_SCENARIOS.native.editionId,
      storeId: REFERENCE_PILOT_SCENARIOS.native.storeId,
      platform: REFERENCE_PILOT_SCENARIOS.native.platform,
      declaredTier: "experimental",
      maintainer: REFERENCE_PILOT_SCENARIOS.native.maintainer,
      adapterId: "native-reference-adapter",
      adapterVersion: REFERENCE_PILOT_SCENARIOS.native.adapterVersion,
      testedArtifact: REFERENCE_PILOT_SCENARIOS.native.artifactBuildId,
      distroMatrix: [{ distro: "arch", kernel: "6.12" }],
      deploymentMatrix: [REFERENCE_PILOT_SCENARIOS.native.deploymentMethod],
      knownLimitations: [
        {
          id: "synthetic-only",
          severity: "blocking",
          summary: "No packaged native-game lifecycle evidence is attached.",
        },
      ],
      lastVerificationDate: nativeResult.evidence.timestamp,
      staleAfterDays: 90,
      evidenceHistory: [nativeResult.evidence],
    });

    this.catalog.registerRecord({
      id: "skyrimse:special-edition:steam:windows-proton",
      gameId: REFERENCE_PILOT_SCENARIOS.proton.gameId,
      editionId: REFERENCE_PILOT_SCENARIOS.proton.editionId,
      storeId: REFERENCE_PILOT_SCENARIOS.proton.storeId,
      platform: REFERENCE_PILOT_SCENARIOS.proton.platform,
      declaredTier: "experimental",
      maintainer: REFERENCE_PILOT_SCENARIOS.proton.maintainer,
      adapterId: "skyrimse-proton-adapter",
      adapterVersion: REFERENCE_PILOT_SCENARIOS.proton.adapterVersion,
      testedArtifact: REFERENCE_PILOT_SCENARIOS.proton.artifactBuildId,
      distroMatrix: [{ distro: "arch", kernel: "6.12" }],
      deploymentMatrix: [REFERENCE_PILOT_SCENARIOS.proton.deploymentMethod],
      knownLimitations: [
        {
          id: "synthetic-only",
          severity: "blocking",
          summary: "No packaged Steam/Proton/in-game lifecycle evidence is attached.",
        },
      ],
      lastVerificationDate: protonResult.evidence.timestamp,
      staleAfterDays: 90,
      evidenceHistory: [protonResult.evidence],
    });

    const allPassed = nativeResult.success && protonResult.success;

    return {
      allPassed,
      nativeResult,
      protonResult,
      catalog: this.catalog,
      completedAt: new Date().toISOString(),
    };
  }
}
