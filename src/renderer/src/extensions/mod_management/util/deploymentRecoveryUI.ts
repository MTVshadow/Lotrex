import * as os from "node:os";
import * as path from "node:path";

import type { IExtensionApi } from "../../../types/IExtensionContext";
import { writeFileAtomic } from "../../../util/fsAtomic";
import { redactUserPaths } from "../../../util/linux/diagnosticReport";
import { truthy } from "../../../util/util";
import { installPathForGame } from "../selectors";
import { withActivationLock } from "./activationStore";
import {
  buildDeploymentRecoveryPlan,
  completeDeploymentRecovery,
  type DeploymentFileOperationState,
  type IDeploymentJournalInspection,
  inspectDeploymentJournal,
  rollbackApplyingDeployment,
} from "./deploymentJournal";

/**
 * Educational Comment:
 * Default English strings for deployment recovery keys. Used as a safe fallback
 * in unit tests or when the localization subsystem has not yet initialized.
 */
export const DEPLOYMENT_RECOVERY_DEFAULTS: Record<string, string> = {
  "mod_management:::deployment_recovery::action_details": "Details",
  "mod_management:::deployment_recovery::action_finish": "Finish recovery",
  "mod_management:::deployment_recovery::action_rollback": "Roll back",
  "mod_management:::deployment_recovery::btn_cancel": "Cancel",
  "mod_management:::deployment_recovery::btn_close": "Close",
  "mod_management:::deployment_recovery::btn_confirm_finish": "Finish recovery",
  "mod_management:::deployment_recovery::btn_confirm_rollback": "Roll back deployment",
  "mod_management:::deployment_recovery::btn_copy_report": "Copy Report",
  "mod_management:::deployment_recovery::btn_save_report": "Save Report",
  "mod_management:::deployment_recovery::category_ambiguous": "Ambiguous",
  "mod_management:::deployment_recovery::category_applied": "Applied",
  "mod_management:::deployment_recovery::category_backed_up": "Backed Up",
  "mod_management:::deployment_recovery::category_not_started": "Not Started",
  "mod_management:::deployment_recovery::category_rolled_back": "Rolled Back",
  "mod_management:::deployment_recovery::category_unsafe": "Unsafe",
  "mod_management:::deployment_recovery::confirm_finish_title": "Finish interrupted deployment?",
  "mod_management:::deployment_recovery::confirm_message":
    "Operation ID: {{operationId}}\nAffected paths: {{paths}}",
  "mod_management:::deployment_recovery::confirm_rollback_title":
    "Roll back interrupted deployment?",
  "mod_management:::deployment_recovery::dialog_title": "Deployment recovery required",
  "mod_management:::deployment_recovery::error_label": "Error: {{error}}",
  "mod_management:::deployment_recovery::error_save_report": "Failed to save recovery report",
  "mod_management:::deployment_recovery::files_summary":
    "Files: {{applied}} applied, {{backedUp}} backed up, {{notStarted}} not started, {{rolledBack}} rolled back, {{ambiguous}} ambiguous, {{unsafe}} unsafe",
  "mod_management:::deployment_recovery::game_label": "Game: {{gameId}}",
  "mod_management:::deployment_recovery::journal_invalid_text":
    "The deployment journal could not be validated. Vortex will not start another deployment or purge in this staging folder until the journal is repaired or reviewed.",
  "mod_management:::deployment_recovery::journal_validation_failed":
    "Deployment journal validation failed.",
  "mod_management:::deployment_recovery::method_label": "Deployment Method: {{method}}",
  "mod_management:::deployment_recovery::more_files_notice":
    "... and {{count}} more files (see exported report)",
  "mod_management:::deployment_recovery::no_entry_found": "No deployment journal entry found.",
  "mod_management:::deployment_recovery::noti_recovery_completed_title":
    "Deployment recovery completed",
  "mod_management:::deployment_recovery::noti_recovery_failed_title": "Deployment recovery failed",
  "mod_management:::deployment_recovery::noti_report_copied_message":
    "Deployment recovery report copied to clipboard.",
  "mod_management:::deployment_recovery::noti_report_copied_title": "Report copied",
  "mod_management:::deployment_recovery::noti_report_saved_message":
    "Deployment recovery report saved to {{path}}.",
  "mod_management:::deployment_recovery::noti_report_saved_title": "Report saved",
  "mod_management:::deployment_recovery::noti_resume_message":
    "The completed manifests were accepted and the operation was committed.",
  "mod_management:::deployment_recovery::noti_rollback_message":
    "The prepared operation was rolled back without changing managed files.",
  "mod_management:::deployment_recovery::operation_id_label": "Operation ID: {{operationId}}",
  "mod_management:::deployment_recovery::operation_incomplete_text":
    "Vortex found a deployment operation that did not reach its committed state. No automatic recovery has been attempted.",
  "mod_management:::deployment_recovery::operation_label": "Operation: {{operation}}",
  "mod_management:::deployment_recovery::phase_label": "Phase: {{phase}}",
  "mod_management:::deployment_recovery::save_dialog_title": "Save Deployment Recovery Report",
  "mod_management:::deployment_recovery::staging_label": "Staging: {{path}}",
  "mod_management:::deployment_recovery::staging_path_label": "Staging path: {{path}}",
  "mod_management:::deployment_recovery::startup_noti_damaged":
    "A deployment journal is damaged. Deployment and purge are blocked for this staging folder.",
  "mod_management:::deployment_recovery::startup_noti_interrupted":
    "An interrupted {{operation}} operation was found at phase {{phase}}.",
  "mod_management:::deployment_recovery::startup_noti_title": "Deployment recovery required",
  "mod_management:::deployment_recovery::targets_label": "Targets: {{targets}}",
};

/**
 * Educational Comment:
 * Resolves a translation for a key. If the provided translator returns the raw key or is not provided,
 * it uses DEPLOYMENT_RECOVERY_DEFAULTS with token interpolation.
 */
export function translateWithFallback(
  t: ((key: string, options?: any) => string) | undefined,
  key: string,
  options?: any,
): string {
  if (t) {
    const result = t(key, options);
    if (result && result !== key) {
      return result;
    }
  }
  const defaultTemplate = DEPLOYMENT_RECOVERY_DEFAULTS[key] ?? key;
  const replacements = options?.replace ?? options ?? {};
  return defaultTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token) =>
    String(replacements[token] ?? `{{${token}}}`),
  );
}

/**
 * Educational Comment:
 * Formats a file path for user presentation by converting it to a path relative to known
 * target or staging roots when possible. If the path does not lie inside any root or if
 * relative calculation fails, it falls back to privacy-safe path redaction (~/ or <user>).
 */
export function formatFilePathForDisplay(
  filePath: string,
  roots: string[],
  homeDir?: string,
  userName?: string,
): string {
  if (!filePath) {
    return "";
  }
  for (const root of roots) {
    if (
      root &&
      (filePath === root || filePath.startsWith(root + path.sep) || filePath.startsWith(root + "/"))
    ) {
      const rel = path.relative(root, filePath);
      if (rel && !rel.startsWith("..")) {
        return rel;
      }
    }
  }
  return redactUserPaths(filePath, homeDir, userName);
}

/**
 * Educational Comment:
 * Builds detailed, human-readable text for the deployment recovery modal dialog.
 * This includes operation metadata (kind, phase, IDs, roots) and a detailed drill-down
 * list of affected files grouped by reconciliation state (ambiguous, unsafe, backed-up,
 * applied, rolled-back, not-started). Ambiguous and unsafe files prominently display
 * their actionable reason to assist in manual troubleshooting.
 */
export function formatDeploymentRecoveryDetails(
  inspection: IDeploymentJournalInspection,
  options?: {
    t?: (key: string, options?: any) => string;
    maxFilesPerCategory?: number;
    homeDir?: string;
    userName?: string;
  },
): string {
  const t = (key: string, opt?: any) => translateWithFallback(options?.t, key, opt);
  const maxFiles = options?.maxFilesPerCategory ?? 50;
  const homeDir = options?.homeDir;
  const userName = options?.userName;
  const clean = (p?: string) => redactUserPaths(p, homeDir, userName);

  if (inspection.status === "invalid") {
    return [
      t("mod_management:::deployment_recovery::journal_validation_failed"),
      t("mod_management:::deployment_recovery::staging_path_label", {
        replace: { path: clean(inspection.stagingPath) },
        path: clean(inspection.stagingPath),
      }),
      t("mod_management:::deployment_recovery::error_label", {
        replace: { error: clean(inspection.error?.message ?? "Unknown error") },
        error: clean(inspection.error?.message ?? "Unknown error"),
      }),
    ].join("\n");
  }

  const entry = inspection.entry;
  if (!entry) {
    return t("mod_management:::deployment_recovery::no_entry_found");
  }

  const targetRoots = entry.targetPaths ?? [];
  const formatPath = (p: string) => formatFilePathForDisplay(p, targetRoots, homeDir, userName);

  const lines: string[] = [
    t("mod_management:::deployment_recovery::operation_label", {
      replace: { operation: entry.operation },
      operation: entry.operation,
    }),
    t("mod_management:::deployment_recovery::operation_id_label", {
      replace: { operationId: entry.operationId },
      operationId: entry.operationId,
    }),
    t("mod_management:::deployment_recovery::phase_label", {
      replace: { phase: entry.phase },
      phase: entry.phase,
    }),
    t("mod_management:::deployment_recovery::game_label", {
      replace: { gameId: entry.gameId },
      gameId: entry.gameId,
    }),
    t("mod_management:::deployment_recovery::method_label", {
      replace: { method: entry.deploymentMethod },
      method: entry.deploymentMethod,
    }),
    t("mod_management:::deployment_recovery::staging_label", {
      replace: { path: clean(inspection.stagingPath) },
      path: clean(inspection.stagingPath),
    }),
    t("mod_management:::deployment_recovery::targets_label", {
      replace: { targets: targetRoots.map(clean).join(", ") },
      targets: targetRoots.map(clean).join(", "),
    }),
  ];

  if (inspection.reconciliation) {
    const { counts, files } = inspection.reconciliation;
    lines.push(
      t("mod_management:::deployment_recovery::files_summary", {
        replace: {
          applied: counts.applied,
          backedUp: counts["backed-up"],
          notStarted: counts["not-started"],
          rolledBack: counts["rolled-back"],
          ambiguous: counts.ambiguous,
          unsafe: counts.unsafe,
        },
        applied: counts.applied,
        backedUp: counts["backed-up"],
        notStarted: counts["not-started"],
        rolledBack: counts["rolled-back"],
        ambiguous: counts.ambiguous,
        unsafe: counts.unsafe,
      }),
    );

    // Categories ordered by priority: files requiring attention first
    const categories: Array<{
      state: DeploymentFileOperationState;
      key: string;
      fallbackTitle: string;
    }> = [
      {
        state: "ambiguous",
        key: "mod_management:::deployment_recovery::category_ambiguous",
        fallbackTitle: "Ambiguous",
      },
      {
        state: "unsafe",
        key: "mod_management:::deployment_recovery::category_unsafe",
        fallbackTitle: "Unsafe",
      },
      {
        state: "backed-up",
        key: "mod_management:::deployment_recovery::category_backed_up",
        fallbackTitle: "Backed Up",
      },
      {
        state: "applied",
        key: "mod_management:::deployment_recovery::category_applied",
        fallbackTitle: "Applied",
      },
      {
        state: "rolled-back",
        key: "mod_management:::deployment_recovery::category_rolled_back",
        fallbackTitle: "Rolled Back",
      },
      {
        state: "not-started",
        key: "mod_management:::deployment_recovery::category_not_started",
        fallbackTitle: "Not Started",
      },
    ];

    for (const { state, key } of categories) {
      const matching = files.filter((f) => f.state === state);
      if (matching.length === 0) {
        continue;
      }
      const title = t(key);
      lines.push("");
      lines.push(`=== ${title.toUpperCase()} (${matching.length}) ===`);
      const displayed = matching.slice(0, maxFiles);
      for (const item of displayed) {
        const filePath = formatPath(item.operation.targetPath);
        const reasonPart = item.reason ? ` (${item.reason})` : "";
        lines.push(`  * ${filePath}${reasonPart}`);
      }
      if (matching.length > maxFiles) {
        const remaining = matching.length - maxFiles;
        lines.push(
          `  ${t("mod_management:::deployment_recovery::more_files_notice", {
            replace: { count: remaining },
            count: remaining,
          })}`,
        );
      }
    }
  }

  return lines.join("\n");
}

/**
 * Educational Comment:
 * Generates a full Markdown report of the deployment failure / recovery state.
 * All paths and potential secrets are masked through redactUserPaths and redactTokensAndSecrets,
 * ensuring that user privacy is protected when sharing diagnostic logs with mod authors or developers.
 */
export function generateRedactedDeploymentRecoveryReport(
  inspection: IDeploymentJournalInspection,
  options?: {
    homeDir?: string;
    userName?: string;
  },
): string {
  const homeDir = options?.homeDir ?? os.homedir();
  const userName = options?.userName ?? (os.userInfo?.()?.username || process.env.USER);
  const clean = (p?: string) => redactUserPaths(p, homeDir, userName);

  const timestamp = new Date().toISOString();
  const platform = `${process.platform} (${os.arch()}, ${os.release()})`;

  if (inspection.status === "invalid") {
    return [
      "# Vortex Deployment Recovery Report",
      `*Generated on: ${timestamp}*`,
      "",
      "## 1. System & Staging",
      `- **Platform:** ${platform}`,
      `- **Status:** Damaged Journal`,
      `- **Staging Root:** \`${clean(inspection.stagingPath)}\``,
      `- **Error:** \`${clean(inspection.error?.message ?? "Unknown error")}\``,
      "",
      "## 2. Details",
      "The deployment journal could not be validated. Automatic recovery cannot proceed until the journal file is examined or repaired.",
      "",
    ].join("\n");
  }

  const entry = inspection.entry;
  if (!entry) {
    return [
      "# Vortex Deployment Recovery Report",
      `*Generated on: ${timestamp}*`,
      "",
      "## 1. System & Staging",
      `- **Platform:** ${platform}`,
      `- **Status:** Missing Journal Entry`,
      `- **Staging Root:** \`${clean(inspection.stagingPath)}\``,
      "",
    ].join("\n");
  }

  const targetRoots = entry.targetPaths ?? [];
  const formatPath = (p: string) => formatFilePathForDisplay(p, targetRoots, homeDir, userName);

  const lines: string[] = [
    "# Vortex Deployment Recovery Report",
    `*Generated on: ${timestamp}*`,
    "",
    "## 1. Operation Summary",
    `- **Status:** Incomplete Operation`,
    `- **Operation:** \`${entry.operation}\``,
    `- **Operation ID:** \`${entry.operationId}\``,
    `- **Phase:** \`${entry.phase}\``,
    `- **Game ID:** \`${entry.gameId}\``,
    `- **Deployment Method:** \`${entry.deploymentMethod}\``,
    `- **Staging Root:** \`${clean(inspection.stagingPath)}\``,
    `- **Target Roots:** ${targetRoots.map((r) => `\`${clean(r)}\``).join(", ")}`,
    `- **Started At:** \`${entry.startedAt}\``,
    `- **Updated At:** \`${entry.updatedAt}\``,
    `- **Platform:** ${platform}`,
  ];

  if (inspection.reconciliation) {
    const { counts, files, safe } = inspection.reconciliation;
    lines.push("");
    lines.push("## 2. Reconciliation Overview");
    lines.push("");
    lines.push("| State | Count |");
    lines.push("| :--- | :--- |");
    lines.push(`| Ambiguous | ${counts.ambiguous} |`);
    lines.push(`| Unsafe | ${counts.unsafe} |`);
    lines.push(`| Applied | ${counts.applied} |`);
    lines.push(`| Backed Up | ${counts["backed-up"]} |`);
    lines.push(`| Rolled Back | ${counts["rolled-back"]} |`);
    lines.push(`| Not Started | ${counts["not-started"]} |`);
    lines.push("");
    lines.push(`- **Safe for Automatic Recovery:** ${safe ? "Yes" : "No"}`);

    const attentionCategories: Array<{ state: DeploymentFileOperationState; title: string }> = [
      { state: "ambiguous", title: "Ambiguous Files" },
      { state: "unsafe", title: "Unsafe Files" },
    ];

    lines.push("");
    lines.push("## 3. Attention Required (Blocking Recovery)");

    for (const { state, title } of attentionCategories) {
      const matching = files.filter((f) => f.state === state);
      lines.push("");
      lines.push(`### ${title} (${matching.length})`);
      if (matching.length === 0) {
        lines.push("*(None)*");
      } else {
        for (const item of matching) {
          lines.push(`- **Path:** \`${formatPath(item.operation.targetPath)}\``);
          lines.push(`  - Action: \`${item.operation.action}\``);
          lines.push(`  - Reason: ${clean(item.reason)}`);
          lines.push(`  - Target: \`${clean(item.operation.targetPath)}\``);
          if (item.operation.sourcePath) {
            lines.push(`  - Source: \`${clean(item.operation.sourcePath)}\``);
          }
          if (item.operation.backupPath) {
            lines.push(`  - Backup: \`${clean(item.operation.backupPath)}\``);
          }
        }
      }
    }

    const otherCategories: Array<{ state: DeploymentFileOperationState; title: string }> = [
      { state: "backed-up", title: "Backed Up" },
      { state: "applied", title: "Applied" },
      { state: "rolled-back", title: "Rolled Back" },
      { state: "not-started", title: "Not Started" },
    ];

    lines.push("");
    lines.push("## 4. Other Files");

    for (const { state, title } of otherCategories) {
      const matching = files.filter((f) => f.state === state);
      lines.push("");
      lines.push(`### ${title} (${matching.length})`);
      if (matching.length === 0) {
        lines.push("*(None)*");
      } else {
        for (const item of matching) {
          lines.push(`- \`${formatPath(item.operation.targetPath)}\``);
        }
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Educational Comment:
 * Copies text to the OS clipboard, using either the Electron contextBridge
 * (window.api.clipboard) or the direct Electron module with safe fallback.
 */
export function writeToClipboard(text: string): void {
  if (typeof window !== "undefined" && window.api?.clipboard?.writeText) {
    window.api.clipboard.writeText(text);
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clipboard } = require("electron");
    clipboard?.writeText(text);
  } catch {
    // Fallback in headless test environments
  }
}

/**
 * Educational Comment:
 * Displays the deployment recovery details dialog with full per-file drill-down
 * and action buttons to export a privacy-safe report via clipboard or file saving.
 */
export async function showDeploymentRecoveryDetails(
  api: IExtensionApi,
  gameId: string,
  inspection: IDeploymentJournalInspection,
  options?: {
    t?: (key: string, options?: any) => string;
    homeDir?: string;
    userName?: string;
    maxFilesPerCategory?: number;
  },
): Promise<void> {
  const t = (key: string, opt?: any) =>
    translateWithFallback(
      options?.t ?? (api?.translate ? api.translate.bind(api) : undefined),
      key,
      opt,
    );

  const entry = inspection.entry;
  const text =
    inspection.status === "invalid"
      ? t("mod_management:::deployment_recovery::journal_invalid_text")
      : t("mod_management:::deployment_recovery::operation_incomplete_text");

  const details = formatDeploymentRecoveryDetails(inspection, { ...options, t });

  const copyReportLabel = t("mod_management:::deployment_recovery::btn_copy_report");
  const saveReportLabel = t("mod_management:::deployment_recovery::btn_save_report");
  const closeLabel = t("mod_management:::deployment_recovery::btn_close");

  const actions = [
    { label: copyReportLabel },
    { label: saveReportLabel },
    { label: closeLabel, default: true },
  ];

  const result = await api.showDialog(
    "error",
    t("mod_management:::deployment_recovery::dialog_title"),
    { text, message: details, parameters: { gameId } },
    actions,
  );

  const operationId = entry?.operationId ?? gameId;

  if (result?.action === copyReportLabel || result?.action === "Copy Report") {
    const report = generateRedactedDeploymentRecoveryReport(inspection, options);
    writeToClipboard(report);
    api.sendNotification({
      id: `deployment-recovery-report-copied-${operationId}`,
      message: t("mod_management:::deployment_recovery::noti_report_copied_message"),
      title: t("mod_management:::deployment_recovery::noti_report_copied_title"),
      type: "info",
    });
  } else if (result?.action === saveReportLabel || result?.action === "Save Report") {
    const report = generateRedactedDeploymentRecoveryReport(inspection, options);
    const defaultName = `deployment-recovery-${operationId}.md`;
    try {
      const outputPath = await api.saveFile({
        defaultPath: defaultName,
        filters: [{ extensions: ["md"], name: "Markdown" }],
        title: t("mod_management:::deployment_recovery::save_dialog_title"),
      });
      if (truthy(outputPath)) {
        await writeFileAtomic(outputPath, report);
        api.sendNotification({
          id: `deployment-recovery-report-saved-${operationId}`,
          message: t("mod_management:::deployment_recovery::noti_report_saved_message", {
            replace: { path: outputPath },
            path: outputPath,
          }),
          title: t("mod_management:::deployment_recovery::noti_report_saved_title"),
          type: "success",
        });
      }
    } catch (err: unknown) {
      api.showErrorNotification?.(
        t("mod_management:::deployment_recovery::error_save_report"),
        err,
        { allowReport: false },
      );
    }
  }
}

/**
 * Educational Comment:
 * Inspects deployment journals across all configured games at Vortex startup.
 * If an incomplete or damaged journal is discovered:
 * 1. An alert notification is raised with a "Details" button.
 * 2. If the operation is safe to automatically recover (e.g. prepared phase or applying with unambiguous files),
 *    a safe "Roll back" or "Finish recovery" action is attached.
 * 3. Recovery actions require confirmation and execute strictly under the activation lock.
 */
export async function checkDeploymentJournalsAtStartup(
  api: IExtensionApi,
  options?: {
    t?: (key: string, options?: any) => string;
  },
): Promise<void> {
  const t = (key: string, opt?: any) =>
    translateWithFallback(
      options?.t ?? (api?.translate ? api.translate.bind(api) : undefined),
      key,
      opt,
    );

  const state = api.getState();
  const configuredGameIds = Object.keys(state.settings?.mods?.installPath ?? {});
  const stagingPaths = new Map<string, string>();
  for (const gameId of configuredGameIds) {
    const stagingPath = installPathForGame(state, gameId);
    if (truthy(stagingPath) && !stagingPaths.has(stagingPath)) {
      stagingPaths.set(stagingPath, gameId);
    }
  }

  const inspections = await Promise.all(
    Array.from(stagingPaths.entries()).map(async ([stagingPath, gameId]) => ({
      gameId,
      inspection: await inspectDeploymentJournal(stagingPath),
    })),
  );

  for (const { gameId, inspection } of inspections) {
    if (inspection === undefined) {
      continue;
    }
    const entry = inspection.entry;
    const recoveryPlan =
      entry !== undefined
        ? buildDeploymentRecoveryPlan(entry, inspection.reconciliation)
        : undefined;

    const rollbackActionLabel = t("mod_management:::deployment_recovery::action_rollback");
    const finishActionLabel = t("mod_management:::deployment_recovery::action_finish");
    const confirmRollbackLabel = t("mod_management:::deployment_recovery::btn_confirm_rollback");
    const confirmFinishLabel = t("mod_management:::deployment_recovery::btn_confirm_finish");
    const cancelLabel = t("mod_management:::deployment_recovery::btn_cancel");

    const recoveryActions =
      recoveryPlan?.safe === true && recoveryPlan.action !== undefined
        ? [
            {
              action: async (dismiss: () => void) => {
                try {
                  const isRollback = recoveryPlan.action === "rollback";
                  const questionTitle = isRollback
                    ? t("mod_management:::deployment_recovery::confirm_rollback_title")
                    : t("mod_management:::deployment_recovery::confirm_finish_title");
                  const confirmBtnLabel = isRollback ? confirmRollbackLabel : confirmFinishLabel;

                  const confirmMessage = t(
                    "mod_management:::deployment_recovery::confirm_message",
                    {
                      replace: {
                        operationId: recoveryPlan.operationId,
                        paths: recoveryPlan.affectedPaths.join(", "),
                      },
                      operationId: recoveryPlan.operationId,
                      paths: recoveryPlan.affectedPaths.join(", "),
                    },
                  );

                  const result = await api.showDialog(
                    "question",
                    questionTitle,
                    {
                      text: recoveryPlan.reason,
                      message: confirmMessage,
                    },
                    [{ label: cancelLabel, default: true }, { label: confirmBtnLabel }],
                  );

                  if (
                    result.action !== confirmBtnLabel &&
                    result.action !== "Roll back deployment" &&
                    result.action !== "Finish recovery"
                  ) {
                    return;
                  }

                  await withActivationLock(() =>
                    entry.phase === "applying"
                      ? rollbackApplyingDeployment(entry)
                      : completeDeploymentRecovery(entry, recoveryPlan.action),
                  );
                  dismiss();

                  const successMsg = isRollback
                    ? t("mod_management:::deployment_recovery::noti_rollback_message")
                    : t("mod_management:::deployment_recovery::noti_resume_message");

                  api.sendNotification({
                    id: `deployment-recovery-complete-${entry.operationId}`,
                    message: successMsg,
                    title: t("mod_management:::deployment_recovery::noti_recovery_completed_title"),
                    type: "success",
                  });
                } catch (err: unknown) {
                  api.showErrorNotification(
                    t("mod_management:::deployment_recovery::noti_recovery_failed_title"),
                    err,
                    { allowReport: false },
                  );
                }
              },
              title: recoveryPlan.action === "rollback" ? rollbackActionLabel : finishActionLabel,
            },
          ]
        : [];

    const startupNotiMsg =
      inspection.status === "invalid"
        ? t("mod_management:::deployment_recovery::startup_noti_damaged")
        : t("mod_management:::deployment_recovery::startup_noti_interrupted", {
            replace: { operation: entry.operation, phase: entry.phase },
            operation: entry.operation,
            phase: entry.phase,
          });

    api.sendNotification({
      actions: [
        ...recoveryActions,
        {
          action: () => {
            void showDeploymentRecoveryDetails(api, gameId, inspection, options);
          },
          title: t("mod_management:::deployment_recovery::action_details"),
        },
      ],
      id: `deployment-recovery-${entry?.operationId ?? gameId}`,
      message: startupNotiMsg,
      title: t("mod_management:::deployment_recovery::startup_noti_title"),
      type: "warning",
    });
  }
}
