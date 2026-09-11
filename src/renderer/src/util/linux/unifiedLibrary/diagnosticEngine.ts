import * as fs from "node:fs";
import * as path from "node:path";

import type { GameAdapterRegistry } from "../gameAdapters/adapterRegistry";
import type {
  AdapterCapabilityKind,
  ICapabilityDescriptor,
  IGameAdapter,
} from "../gameAdapters/contracts";
import type { IUnifiedGameInstallation } from "../gameIdentity/contracts";
import type {
  AdapterSupportTier,
  IDiagnosticCheckItem,
  ILibraryAdapterSupportSummary,
  ILibraryCompatibilityStatus,
  ILibraryDiagnosticReport,
  ILibraryLaunchAvailability,
  LibraryInstallState,
} from "./contracts";

/**
 * Filesystem inspection abstraction allowing dependency injection during testing.
 */
export interface IFilesystemInspector {
  existsSync(targetPath: string): boolean;
  isWritableSync(targetPath: string): boolean;
  isExecutableSync(targetPath: string): boolean;
}

/**
 * Default native Node.js filesystem inspector.
 */
export const defaultFsInspector: IFilesystemInspector = {
  existsSync(targetPath: string): boolean {
    try {
      return fs.existsSync(targetPath);
    } catch {
      return false;
    }
  },
  isWritableSync(targetPath: string): boolean {
    try {
      fs.accessSync(targetPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
  isExecutableSync(targetPath: string): boolean {
    try {
      fs.accessSync(targetPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Diagnostic and evaluation engine for unified library items.
 *
 * Implements Phase 4 acceptance criteria:
 * Clearly explains why a game cannot yet launch or accept mods,
 * adhering to strict safety rules (e.g. no mod support advertised without active adapter).
 */
export class DiagnosticEngine {
  constructor(private readonly fsInspector: IFilesystemInspector = defaultFsInspector) {}

  /**
   * Assesses filesystem install state.
   */
  public evaluateInstallState(installPath: string, executablePath: string): LibraryInstallState {
    const installDirExists = this.fsInspector.existsSync(installPath);
    if (!installDirExists) {
      return "uninstalled";
    }

    const execExists = this.fsInspector.existsSync(executablePath);
    if (!execExists) {
      return "missing-files";
    }

    return "installed";
  }

  /**
   * Evaluates launch availability and generates explainable diagnostic reasons if blocked.
   */
  public evaluateLaunchAvailability(
    installation: IUnifiedGameInstallation,
    effectiveExecutablePath?: string,
    effectivePrefixPath?: string,
    effectiveRuntime?: string,
  ): ILibraryLaunchAvailability {
    const blockingReasons: string[] = [];
    const execPath = effectiveExecutablePath ?? installation.executablePath;
    const prefixPath = effectivePrefixPath ?? installation.prefixPath;
    const runtime = effectiveRuntime ?? installation.runtime;
    const platform = installation.identity.platform;

    // 1. Verify executable exists on disk
    if (!this.fsInspector.existsSync(execPath)) {
      blockingReasons.push(
        `Primary executable does not exist at '${execPath}'. Please verify installation files or set a manual correction.`,
      );
    }

    // 2. Platform-specific runtime and prefix validations
    if (platform === "windows-proton" || platform === "windows-wine") {
      if (!prefixPath || prefixPath.trim() === "") {
        blockingReasons.push(
          `Wine/Proton prefix is missing. Windows games running on Linux require a configured prefix directory. Run once from Steam/Heroic or specify prefixPath in settings.`,
        );
      } else if (!this.fsInspector.existsSync(prefixPath)) {
        blockingReasons.push(
          `Configured prefix directory '${prefixPath}' does not exist on disk. Launch the game once from the store client to initialize the prefix.`,
        );
      }

      if (!runtime || runtime.trim() === "") {
        blockingReasons.push(
          `No runtime environment selected. A Proton version or Wine binary is required to execute Windows binaries.`,
        );
      }
    } else if (platform === "linux-native") {
      // Native Linux binary must be executable
      if (this.fsInspector.existsSync(execPath) && !this.fsInspector.isExecutableSync(execPath)) {
        blockingReasons.push(
          `File '${execPath}' is not marked as executable. Please check POSIX file permissions (chmod +x).`,
        );
      }
    }

    const canLaunch = blockingReasons.length === 0;
    const launchExplanation = canLaunch
      ? `Launch ready. Primary executable verified at '${execPath}' using ${platform} runtime.`
      : `Launch blocked by ${blockingReasons.length} issue(s): ${blockingReasons.join(" ")}`;

    return {
      canLaunch,
      blockingReasons,
      launchExplanation,
    };
  }

  /**
   * Evaluates adapter support level and whether the game can accept mods.
   *
   * STRICT SAFETY RULE:
   * "Never advertise a discovered game as mod-supported unless a compatible game adapter is active."
   * "Never treat launching successfully as proof that deployment, plugins, tools, saves, or rollback work."
   */
  public evaluateModAcceptance(
    installation: IUnifiedGameInstallation,
    adapterRegistry: GameAdapterRegistry,
    effectiveInstallPath?: string,
  ): ILibraryAdapterSupportSummary {
    const { gameId, editionId } = installation.identity;
    const installPath = effectiveInstallPath ?? installation.installPath;

    // Check 1: Is a game adapter registered for this gameId?
    const allAdapters = adapterRegistry.listAdapters();
    const adapter =
      adapterRegistry.getAdapter(gameId) ??
      allAdapters.find((a) => a.manifest.targetGameId === gameId);

    if (!adapter) {
      return {
        supportLevel: "unsupported",
        supportedCapabilities: [],
        unsupportedCapabilities: [],
        canAcceptMods: false,
        modRejectionReason: `No compatible game adapter is registered for game '${gameId}'. Lotrex requires a declared adapter before advertising mod support.`,
      };
    }

    // Check 2: Is the adapter enabled?
    if (!adapterRegistry.isAdapterEnabled(adapter.manifest.id)) {
      return {
        supportLevel: "unsupported",
        adapterId: adapter.manifest.id,
        adapterName: adapter.manifest.name,
        adapterVersion: adapter.manifest.version,
        supportedCapabilities: [],
        unsupportedCapabilities: [],
        canAcceptMods: false,
        modRejectionReason: `Game adapter '${adapter.manifest.name}' (${adapter.manifest.id}) is currently disabled in settings.`,
      };
    }

    // Check 3: Does the adapter target this specific game edition?
    const targetsEdition = adapter.manifest.targetEditions.includes(editionId);
    if (!targetsEdition) {
      return {
        supportLevel: "unsupported",
        adapterId: adapter.manifest.id,
        adapterName: adapter.manifest.name,
        adapterVersion: adapter.manifest.version,
        supportedCapabilities: [],
        unsupportedCapabilities: [],
        canAcceptMods: false,
        modRejectionReason: `Game adapter '${
          adapter.manifest.id
        }' supports editions [${adapter.manifest.targetEditions.join(
          ", ",
        )}], but this installation is edition '${editionId}'.`,
      };
    }

    // Collect capabilities
    const supportedCapabilities: AdapterCapabilityKind[] = [];
    const unsupportedCapabilities: Array<{
      kind: AdapterCapabilityKind;
      reason: string;
    }> = [];

    for (const [kind, rawDesc] of Object.entries(adapter.manifest.capabilities)) {
      const capKind = kind as AdapterCapabilityKind;
      const desc = rawDesc as ICapabilityDescriptor;
      if (desc.supported) {
        supportedCapabilities.push(capKind);
      } else {
        unsupportedCapabilities.push({
          kind: capKind,
          reason: desc.unsupportedReason ?? "Declared as unsupported by adapter.",
        });
      }
    }

    // Check 4: Mandatory mod management capabilities: 'mod-types' and 'deployment-targets'
    const modTypesDesc = adapter.getCapability("mod-types");
    if (!modTypesDesc.supported) {
      return {
        supportLevel: "unsupported",
        adapterId: adapter.manifest.id,
        adapterName: adapter.manifest.name,
        adapterVersion: adapter.manifest.version,
        supportedCapabilities,
        unsupportedCapabilities,
        canAcceptMods: false,
        modRejectionReason: `Adapter declared 'mod-types' capability as unsupported: ${
          modTypesDesc.unsupportedReason ?? "Reason not specified."
        }`,
      };
    }

    const deployDesc = adapter.getCapability("deployment-targets");
    if (!deployDesc.supported) {
      return {
        supportLevel: "unsupported",
        adapterId: adapter.manifest.id,
        adapterName: adapter.manifest.name,
        adapterVersion: adapter.manifest.version,
        supportedCapabilities,
        unsupportedCapabilities,
        canAcceptMods: false,
        modRejectionReason: `Adapter declared 'deployment-targets' capability as unsupported: ${
          deployDesc.unsupportedReason ?? "Reason not specified."
        }`,
      };
    }

    // Check 5: Filesystem write access to installation directory
    if (!this.fsInspector.existsSync(installPath)) {
      return {
        supportLevel: "unsupported",
        adapterId: adapter.manifest.id,
        adapterName: adapter.manifest.name,
        adapterVersion: adapter.manifest.version,
        supportedCapabilities,
        unsupportedCapabilities,
        canAcceptMods: false,
        modRejectionReason: `Install path '${installPath}' does not exist on disk. Cannot stage or deploy mods.`,
      };
    }

    if (!this.fsInspector.isWritableSync(installPath)) {
      return {
        supportLevel: "experimental",
        adapterId: adapter.manifest.id,
        adapterName: adapter.manifest.name,
        adapterVersion: adapter.manifest.version,
        supportedCapabilities,
        unsupportedCapabilities,
        canAcceptMods: false,
        modRejectionReason: `Game directory '${installPath}' is read-only. Mod deployment requires write permissions.`,
      };
    }

    // Determine tier based on supported capabilities count
    let supportLevel: AdapterSupportTier = "supported";
    if (unsupportedCapabilities.length > 3) {
      supportLevel = "experimental";
    } else if (unsupportedCapabilities.length > 0) {
      supportLevel = "community-tested";
    }

    return {
      supportLevel,
      adapterId: adapter.manifest.id,
      adapterName: adapter.manifest.name,
      adapterVersion: adapter.manifest.version,
      supportedCapabilities,
      unsupportedCapabilities,
      canAcceptMods: true,
      modRejectionReason: undefined,
    };
  }

  /**
   * Assesses overall compatibility status and remedies.
   */
  public evaluateCompatibilityStatus(
    installation: IUnifiedGameInstallation,
    launch: ILibraryLaunchAvailability,
  ): ILibraryCompatibilityStatus {
    if (!this.fsInspector.existsSync(installation.executablePath)) {
      return {
        status: "missing-executable",
        message: `Game executable missing at '${installation.executablePath}'.`,
        remedies: [
          "Verify game files via Steam / Heroic / Lutris.",
          "Check whether game was relocated to another disk.",
          "Set executable path override in manual corrections.",
        ],
      };
    }

    if (
      installation.identity.platform === "windows-proton" ||
      installation.identity.platform === "windows-wine"
    ) {
      if (!installation.prefixPath || !this.fsInspector.existsSync(installation.prefixPath)) {
        return {
          status: "needs-prefix",
          message: "Proton/Wine prefix directory is missing or uninitialized.",
          remedies: [
            "Launch the game once from the store client to generate the prefix.",
            "Configure a custom prefixPath under manual corrections.",
          ],
        };
      }

      if (!installation.runtime) {
        return {
          status: "needs-runtime",
          message: "No Proton runtime or Wine binary configured.",
          remedies: [
            "Select an installed Proton version in game settings.",
            "Install Proton Experimental or GE-Proton.",
          ],
        };
      }
    }

    if (!launch.canLaunch) {
      return {
        status: "degraded",
        message: launch.launchExplanation,
        remedies: launch.blockingReasons,
      };
    }

    return {
      status: "ready",
      message: "Ready for launch and mod management.",
      remedies: [],
    };
  }

  /**
   * Generates a comprehensive, explainable diagnostic report.
   */
  public generateDiagnosticReport(
    installation: IUnifiedGameInstallation,
    launch: ILibraryLaunchAvailability,
    modSupport: ILibraryAdapterSupportSummary,
  ): ILibraryDiagnosticReport {
    const checks: IDiagnosticCheckItem[] = [];

    // Executable check
    const execExists = this.fsInspector.existsSync(installation.executablePath);
    checks.push({
      domain: "filesystem",
      check: "Executable presence",
      passed: execExists,
      severity: execExists ? "info" : "error",
      message: execExists
        ? `Executable exists at '${installation.executablePath}'.`
        : `Executable not found at '${installation.executablePath}'.`,
      resolutionHint: execExists
        ? undefined
        : "Re-verify files with launcher or configure a manual override.",
    });

    // Prefix check
    if (
      installation.identity.platform === "windows-proton" ||
      installation.identity.platform === "windows-wine"
    ) {
      const prefixExists =
        installation.prefixPath !== undefined &&
        this.fsInspector.existsSync(installation.prefixPath);
      checks.push({
        domain: "runtime",
        check: "Prefix validity",
        passed: prefixExists,
        severity: prefixExists ? "info" : "error",
        message: prefixExists
          ? `Prefix verified at '${installation.prefixPath}'.`
          : `Prefix directory missing or invalid: '${installation.prefixPath ?? "none"}'.`,
        resolutionHint: prefixExists
          ? undefined
          : "Launch the game once through Steam or assign a valid prefix path.",
      });
    }

    // Mod adapter check
    checks.push({
      domain: "modding",
      check: "Game adapter availability",
      passed: modSupport.canAcceptMods,
      severity: modSupport.canAcceptMods ? "info" : "warning",
      message: modSupport.canAcceptMods
        ? `Active adapter '${modSupport.adapterName}' supports mod deployment.`
        : (modSupport.modRejectionReason ?? "Cannot accept mods."),
      resolutionHint: modSupport.canAcceptMods
        ? undefined
        : "Install or enable a game adapter declaring 'mod-types' and 'deployment-targets' capabilities.",
    });

    const summary = `Diagnostic summary: Launch=${launch.canLaunch ? "Ready" : "Blocked"}, Mods=${
      modSupport.canAcceptMods ? "Accepted" : "Blocked"
    }. (${checks.filter((c) => !c.passed).length} issue(s) detected)`;

    return {
      itemId: installation.installationId,
      gameId: installation.identity.gameId,
      editionId: installation.identity.editionId,
      timestamp: Date.now(),
      canLaunch: launch.canLaunch,
      canAcceptMods: modSupport.canAcceptMods,
      checks,
      summary,
    };
  }
}
