import type { IUnifiedGameInstallation } from "../gameIdentity/contracts";
import type { IManualCorrectionAudit, IManualCorrectionRecord } from "./contracts";

/**
 * Manages user-applied manual corrections (overrides) for game installations.
 *
 * CRITICAL ARCHITECTURE CONSTRAINT (Phase 4):
 * "Include filters and manual correction without silently rewriting launcher data."
 *
 * This manager strictly isolates user corrections into a non-destructive overlay.
 * Discovered launcher manifests (VDF, SQLite, JSON) and provenance source records
 * are never altered, overwritten, or mutated.
 * Users can view side-by-side diff audits and cleanly revert overrides at any time.
 */
export class ManualCorrectionManager {
  private readonly corrections = new Map<string, IManualCorrectionRecord>();

  public replaceCorrections(records: Record<string, unknown>): void {
    this.corrections.clear();
    Object.entries(records).forEach(([installationId, value]) => {
      const record = validateCorrectionRecord(installationId, value);
      if (record !== undefined) {
        this.corrections.set(installationId, record);
      }
    });
  }

  /**
   * Applies or updates a manual correction overlay for a specific installation.
   * Discovered launcher data is preserved in originalData.
   */
  public applyCorrection(
    installation: IUnifiedGameInstallation,
    overrides: IManualCorrectionRecord["overrides"],
    reason?: string,
  ): IManualCorrectionRecord {
    // Retain pristine discovered data if not already recorded
    const existing = this.corrections.get(installation.installationId);
    const originalData = existing?.originalData ?? {
      executablePath: installation.executablePath,
      installPath: installation.installPath,
      prefixPath: installation.prefixPath,
      runtime: installation.runtime,
    };

    const record: IManualCorrectionRecord = {
      installationId: installation.installationId,
      correctedAt: Date.now(),
      reason,
      originalData,
      overrides: {
        ...existing?.overrides,
        ...overrides,
      },
    };

    this.corrections.set(installation.installationId, record);
    return record;
  }

  /**
   * Cleans and reverts all manual corrections for an installation,
   * restoring the original auto-discovered launcher values.
   */
  public revertCorrection(installationId: string): boolean {
    return this.corrections.delete(installationId);
  }

  /**
   * Retrieves the active manual correction record for an installation, if any.
   */
  public getCorrection(installationId: string): IManualCorrectionRecord | null {
    return this.corrections.get(installationId) ?? null;
  }

  /** Returns the serializable subset. Environment variables are intentionally session-only. */
  public getPersistableCorrection(installationId: string): IManualCorrectionRecord | null {
    const record = this.corrections.get(installationId);
    return record === undefined ? null : (validateCorrectionRecord(installationId, record) ?? null);
  }

  /**
   * Checks whether an installation has active user overrides.
   */
  public hasOverrides(installationId: string): boolean {
    const record = this.corrections.get(installationId);
    if (!record) return false;
    const { overrides } = record;
    return (
      overrides.executablePath !== undefined ||
      overrides.installPath !== undefined ||
      overrides.prefixPath !== undefined ||
      overrides.runtime !== undefined ||
      (overrides.customLaunchArgs !== undefined && overrides.customLaunchArgs.length > 0) ||
      (overrides.customEnvironment !== undefined &&
        Object.keys(overrides.customEnvironment).length > 0)
    );
  }

  /**
   * Produces an explainable side-by-side audit comparing auto-discovered launcher data
   * with user overrides, detecting if external launcher changes have diverged from the snapshot.
   */
  public getAudit(installation: IUnifiedGameInstallation): IManualCorrectionAudit {
    const record = this.corrections.get(installation.installationId);
    if (!record) {
      return {
        installationId: installation.installationId,
        hasOverrides: false,
        fields: [
          {
            fieldName: "executablePath",
            discoveredValue: installation.executablePath,
            correctedValue: undefined,
            isOverridden: false,
          },
          {
            fieldName: "installPath",
            discoveredValue: installation.installPath,
            correctedValue: undefined,
            isOverridden: false,
          },
          {
            fieldName: "prefixPath",
            discoveredValue: installation.prefixPath,
            correctedValue: undefined,
            isOverridden: false,
          },
          {
            fieldName: "runtime",
            discoveredValue: installation.runtime,
            correctedValue: undefined,
            isOverridden: false,
          },
        ],
        divergenceDetected: false,
      };
    }

    // Check if launcher data changed on disk since correction was applied
    const divergence =
      installation.installPath !== record.originalData.installPath ||
      installation.executablePath !== record.originalData.executablePath;

    const divergenceMessage = divergence
      ? `Launcher source data changed on disk (discovered install path: '${installation.installPath}', was: '${record.originalData.installPath}'). Please review your manual corrections.`
      : undefined;

    const fields: IManualCorrectionAudit["fields"] = [
      {
        fieldName: "executablePath",
        discoveredValue: installation.executablePath,
        correctedValue: record.overrides.executablePath,
        isOverridden: record.overrides.executablePath !== undefined,
      },
      {
        fieldName: "installPath",
        discoveredValue: installation.installPath,
        correctedValue: record.overrides.installPath,
        isOverridden: record.overrides.installPath !== undefined,
      },
      {
        fieldName: "prefixPath",
        discoveredValue: installation.prefixPath,
        correctedValue: record.overrides.prefixPath,
        isOverridden: record.overrides.prefixPath !== undefined,
      },
      {
        fieldName: "runtime",
        discoveredValue: installation.runtime,
        correctedValue: record.overrides.runtime,
        isOverridden: record.overrides.runtime !== undefined,
      },
    ];

    return {
      installationId: installation.installationId,
      hasOverrides: true,
      fields,
      customLaunchArgs: record.overrides.customLaunchArgs,
      customEnvironment: record.overrides.customEnvironment,
      divergenceDetected: divergence,
      divergenceMessage,
    };
  }

  /**
   * Applies active manual correction overrides to an installation clone
   * for execution and validation purposes, without mutating the original installation
   * or touching discovery source records.
   */
  public getEffectiveInstallation(
    installation: IUnifiedGameInstallation,
  ): IUnifiedGameInstallation {
    const record = this.corrections.get(installation.installationId);
    if (!record) {
      return { ...installation };
    }

    return {
      ...installation,
      executablePath: record.overrides.executablePath ?? installation.executablePath,
      installPath: record.overrides.installPath ?? installation.installPath,
      prefixPath: record.overrides.prefixPath ?? installation.prefixPath,
      runtime: record.overrides.runtime ?? installation.runtime,
      // INVARIANT: discoverySources must remain strictly untouched
      discoverySources: [...installation.discoverySources],
    };
  }
}

function validateCorrectionRecord(
  installationId: string,
  value: unknown,
): IManualCorrectionRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Partial<IManualCorrectionRecord>;
  if (
    record.installationId !== installationId ||
    typeof record.correctedAt !== "number" ||
    !Number.isFinite(record.correctedAt) ||
    typeof record.originalData !== "object" ||
    record.originalData === null ||
    typeof record.originalData.executablePath !== "string" ||
    typeof record.originalData.installPath !== "string" ||
    typeof record.overrides !== "object" ||
    record.overrides === null
  ) {
    return undefined;
  }

  const optionalStrings = [
    record.originalData.prefixPath,
    record.originalData.runtime,
    record.overrides.executablePath,
    record.overrides.installPath,
    record.overrides.prefixPath,
    record.overrides.runtime,
    record.reason,
  ];
  if (optionalStrings.some((entry) => entry !== undefined && typeof entry !== "string")) {
    return undefined;
  }
  if (
    record.overrides.customLaunchArgs !== undefined &&
    (!Array.isArray(record.overrides.customLaunchArgs) ||
      record.overrides.customLaunchArgs.some((entry) => typeof entry !== "string"))
  ) {
    return undefined;
  }

  return {
    correctedAt: record.correctedAt,
    installationId,
    overrides: {
      executablePath: record.overrides.executablePath,
      installPath: record.overrides.installPath,
      prefixPath: record.overrides.prefixPath,
      runtime: record.overrides.runtime,
      customLaunchArgs: record.overrides.customLaunchArgs?.slice(),
    },
    originalData: {
      executablePath: record.originalData.executablePath,
      installPath: record.originalData.installPath,
      prefixPath: record.originalData.prefixPath,
      runtime: record.originalData.runtime,
    },
    reason: record.reason,
  };
}
