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
    maxFilesPerCategory?: number;
    homeDir?: string;
    userName?: string;
  },
): string {
  const maxFiles = options?.maxFilesPerCategory ?? 50;
  const homeDir = options?.homeDir;
  const userName = options?.userName;
  const clean = (p?: string) => redactUserPaths(p, homeDir, userName);

  if (inspection.status === "invalid") {
    return [
      "Deployment journal validation failed.",
      `Staging path: ${clean(inspection.stagingPath)}`,
      `Error: ${inspection.error?.message ?? "Unknown error"}`,
    ].join("\n");
  }

  const entry = inspection.entry;
  if (!entry) {
    return "No deployment journal entry found.";
  }

  const targetRoots = entry.targetPaths ?? [];
  const formatPath = (p: string) => formatFilePathForDisplay(p, targetRoots, homeDir, userName);

  const lines: string[] = [
    `Operation: ${entry.operation}`,
    `Operation ID: ${entry.operationId}`,
    `Phase: ${entry.phase}`,
    `Game: ${entry.gameId}`,
    `Deployment Method: ${entry.deploymentMethod}`,
    `Staging: ${clean(inspection.stagingPath)}`,
    `Targets: ${targetRoots.map(clean).join(", ")}`,
  ];

  if (inspection.reconciliation) {
    const { counts, files } = inspection.reconciliation;
    lines.push(
      `Files: ${counts.applied} applied, ${counts["backed-up"]} backed up, ${counts["not-started"]} not started, ${counts["rolled-back"]} rolled back, ${counts.ambiguous} ambiguous, ${counts.unsafe} unsafe`,
    );

    // Categories ordered by priority: files requiring attention first
    const categories: Array<{ state: DeploymentFileOperationState; title: string }> = [
      { state: "ambiguous", title: "Ambiguous" },
      { state: "unsafe", title: "Unsafe" },
      { state: "backed-up", title: "Backed Up" },
      { state: "applied", title: "Applied" },
      { state: "rolled-back", title: "Rolled Back" },
      { state: "not-started", title: "Not Started" },
    ];

    for (const { state, title } of categories) {
      const matching = files.filter((f) => f.state === state);
      if (matching.length === 0) {
        continue;
      }
      lines.push("");
      lines.push(`=== ${title.toUpperCase()} (${matching.length}) ===`);
      const displayed = matching.slice(0, maxFiles);
      for (const item of displayed) {
        const filePath = formatPath(item.operation.targetPath);
        const reasonPart = item.reason ? ` (${item.reason})` : "";
        lines.push(`  * ${filePath}${reasonPart}`);
      }
      if (matching.length > maxFiles) {
        lines.push(`  ... and ${matching.length - maxFiles} more files (see exported report)`);
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
    homeDir?: string;
    userName?: string;
    maxFilesPerCategory?: number;
  },
): Promise<void> {
  const entry = inspection.entry;
  const text =
    inspection.status === "invalid"
      ? "The deployment journal could not be validated. Vortex will not start another deployment " +
        "or purge in this staging folder until the journal is repaired or reviewed."
      : "Vortex found a deployment operation that did not reach its committed state. " +
        "No automatic recovery has been attempted.";

  const details = formatDeploymentRecoveryDetails(inspection, options);

  const actions = [
    { label: "Copy Report" },
    { label: "Save Report" },
    { label: "Close", default: true },
  ];

  const result = await api.showDialog(
    "error",
    "Deployment recovery required",
    { text, message: details, parameters: { gameId } },
    actions,
  );

  const operationId = entry?.operationId ?? gameId;

  if (result?.action === "Copy Report") {
    const report = generateRedactedDeploymentRecoveryReport(inspection, options);
    writeToClipboard(report);
    api.sendNotification({
      id: `deployment-recovery-report-copied-${operationId}`,
      message: "Deployment recovery report copied to clipboard.",
      title: "Report copied",
      type: "info",
    });
  } else if (result?.action === "Save Report") {
    const report = generateRedactedDeploymentRecoveryReport(inspection, options);
    const defaultName = `deployment-recovery-${operationId}.md`;
    try {
      const outputPath = await api.saveFile({
        defaultPath: defaultName,
        filters: [{ extensions: ["md"], name: "Markdown" }],
        title: "Save Deployment Recovery Report",
      });
      if (truthy(outputPath)) {
        await writeFileAtomic(outputPath, report);
        api.sendNotification({
          id: `deployment-recovery-report-saved-${operationId}`,
          message: `Deployment recovery report saved to ${outputPath}.`,
          title: "Report saved",
          type: "success",
        });
      }
    } catch (err: unknown) {
      api.showErrorNotification?.("Failed to save recovery report", err, { allowReport: false });
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
export async function checkDeploymentJournalsAtStartup(api: IExtensionApi): Promise<void> {
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
    const recoveryActions =
      recoveryPlan?.safe === true && recoveryPlan.action !== undefined
        ? [
            {
              action: async (dismiss: () => void) => {
                try {
                  const result = await api.showDialog(
                    "question",
                    recoveryPlan.action === "rollback"
                      ? "Roll back interrupted deployment?"
                      : "Finish interrupted deployment?",
                    {
                      text: recoveryPlan.reason,
                      message: `Operation ID: ${recoveryPlan.operationId}\nAffected paths: ${recoveryPlan.affectedPaths.join(", ")}`,
                    },
                    [
                      { label: "Cancel", default: true },
                      {
                        label:
                          recoveryPlan.action === "rollback"
                            ? "Roll back deployment"
                            : "Finish recovery",
                      },
                    ],
                  );

                  const confirmedAction =
                    recoveryPlan.action === "rollback" ? "Roll back deployment" : "Finish recovery";
                  if (result.action !== confirmedAction) {
                    return;
                  }

                  await withActivationLock(() =>
                    entry.phase === "applying"
                      ? rollbackApplyingDeployment(entry)
                      : completeDeploymentRecovery(entry, recoveryPlan.action),
                  );
                  dismiss();
                  api.sendNotification({
                    id: `deployment-recovery-complete-${entry.operationId}`,
                    message:
                      recoveryPlan.action === "rollback"
                        ? "The prepared operation was rolled back without changing managed files."
                        : "The completed manifests were accepted and the operation was committed.",
                    title: "Deployment recovery completed",
                    type: "success",
                  });
                } catch (err: unknown) {
                  api.showErrorNotification("Deployment recovery failed", err, {
                    allowReport: false,
                  });
                }
              },
              title: recoveryPlan.action === "rollback" ? "Roll back" : "Finish recovery",
            },
          ]
        : [];
    api.sendNotification({
      actions: [
        ...recoveryActions,
        {
          action: () => {
            void showDeploymentRecoveryDetails(api, gameId, inspection);
          },
          title: "Details",
        },
      ],
      id: `deployment-recovery-${entry?.operationId ?? gameId}`,
      message:
        inspection.status === "invalid"
          ? "A deployment journal is damaged. Deployment and purge are blocked for this staging folder."
          : `An interrupted ${entry.operation} operation was found at phase ${entry.phase}.`,
      title: "Deployment recovery required",
      type: "warning",
    });
  }
}
