import PromiseBB from "bluebird";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IExtensionApi } from "../../../types/IExtensionContext";
import {
  checkDeploymentJournalsAtStartup,
  formatDeploymentRecoveryDetails,
  formatFilePathForDisplay,
  generateRedactedDeploymentRecoveryReport,
  showDeploymentRecoveryDetails,
  writeToClipboard,
} from "./deploymentRecoveryUI";

vi.mock("../../../util/fsAtomic", () => ({
  writeFileAtomic: vi.fn(async () => undefined),
}));

import type * as DeploymentJournalModule from "./deploymentJournal";
import {
  completeDeploymentRecovery,
  type IDeploymentJournalEntry,
  type IDeploymentJournalInspection,
  inspectDeploymentJournal,
  rollbackApplyingDeployment,
} from "./deploymentJournal";

vi.mock("./activationStore", () => ({
  withActivationLock: vi.fn(async (cb: () => any) => cb()),
}));

vi.mock("./deploymentJournal", async (importOriginal) => {
  const actual = await importOriginal<typeof DeploymentJournalModule>();
  return {
    ...actual,
    inspectDeploymentJournal: vi.fn(),
    completeDeploymentRecovery: vi.fn(async () => undefined),
    rollbackApplyingDeployment: vi.fn(async () => undefined),
  };
});

import { writeFileAtomic } from "../../../util/fsAtomic";

describe("deploymentRecoveryUI", () => {
  const mockHome = "/home/testuser";
  const mockUser = "testuser";

  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).window = {
      api: {
        clipboard: {
          writeText: vi.fn(),
        },
      },
    };
  });

  afterEach(() => {
    delete (global as any).window;
  });

  describe("formatFilePathForDisplay", () => {
    it("returns empty string for empty input", () => {
      expect(formatFilePathForDisplay("", ["/games/root"])).toBe("");
    });

    it("formats relative path when file resides inside target roots", () => {
      const roots = ["/games/SkyrimSE", "/home/testuser/staging"];
      expect(
        formatFilePathForDisplay(
          "/games/SkyrimSE/Data/textures/test.dds",
          roots,
          mockHome,
          mockUser,
        ),
      ).toBe("Data/textures/test.dds");
    });

    it("redacts user home directory when file is outside target roots", () => {
      const roots = ["/games/SkyrimSE"];
      expect(
        formatFilePathForDisplay("/home/testuser/secret/custom.esp", roots, mockHome, mockUser),
      ).toBe("~/secret/custom.esp");
    });
  });

  describe("formatDeploymentRecoveryDetails", () => {
    it("formats invalid journal state with error and redacted path", () => {
      const inspection: IDeploymentJournalInspection = {
        stagingPath: "/home/testuser/Vortex Mods/skyrimse",
        status: "invalid",
        error: new Error("Corrupted checksum in journal"),
      };

      const formatted = formatDeploymentRecoveryDetails(inspection, {
        homeDir: mockHome,
        userName: mockUser,
      });

      expect(formatted).toContain("Deployment journal validation failed.");
      expect(formatted).toContain("Staging path: ~/Vortex Mods/skyrimse");
      expect(formatted).toContain("Error: Corrupted checksum in journal");
    });

    it("formats incomplete journal state with per-file categories and reasons", () => {
      const entry: IDeploymentJournalEntry = {
        deploymentMethod: "hardlink_activator",
        gameId: "skyrimse",
        instanceId: "inst-1",
        operation: "deploy",
        operationId: "op-12345",
        phase: "applying",
        stagingPath: "/home/testuser/Vortex Mods/skyrimse",
        targetPaths: ["/games/SkyrimSE"],
        startedAt: "2026-09-09T12:00:00.000Z",
        updatedAt: "2026-09-09T12:00:05.000Z",
        version: 1,
      };

      const inspection: IDeploymentJournalInspection = {
        stagingPath: entry.stagingPath,
        status: "incomplete",
        entry,
        reconciliation: {
          operationId: entry.operationId,
          safe: false,
          counts: {
            ambiguous: 1,
            unsafe: 1,
            applied: 2,
            "backed-up": 1,
            "rolled-back": 0,
            "not-started": 1,
          },
          files: [
            {
              state: "ambiguous",
              reason: "Target file exists but content does not match source",
              operation: {
                action: "deploy",
                backupPath: "/games/SkyrimSE/Data/ambig.dds.vortex_backup",
                id: "f1",
                replace: true,
                restoreBackup: true,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/mod/Data/ambig.dds",
                targetPath: "/games/SkyrimSE/Data/ambig.dds",
              },
            },
            {
              state: "unsafe",
              reason: "Target is a symlink pointing outside game folder",
              operation: {
                action: "deploy",
                backupPath: "",
                id: "f2",
                replace: false,
                restoreBackup: false,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/mod/Data/bad.dds",
                targetPath: "/games/SkyrimSE/Data/bad.dds",
              },
            },
            {
              state: "applied",
              reason: "Hardlink matches source",
              operation: {
                action: "deploy",
                backupPath: "",
                id: "f3",
                replace: false,
                restoreBackup: false,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/mod/Data/ok1.dds",
                targetPath: "/games/SkyrimSE/Data/ok1.dds",
              },
            },
            {
              state: "applied",
              reason: "Hardlink matches source",
              operation: {
                action: "deploy",
                backupPath: "",
                id: "f4",
                replace: false,
                restoreBackup: false,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/mod/Data/ok2.dds",
                targetPath: "/games/SkyrimSE/Data/ok2.dds",
              },
            },
            {
              state: "backed-up",
              reason: "Target is backed up safely",
              operation: {
                action: "deploy",
                backupPath: "/games/SkyrimSE/Data/backed.dds.vortex_backup",
                id: "f5",
                replace: true,
                restoreBackup: true,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/mod/Data/backed.dds",
                targetPath: "/games/SkyrimSE/Data/backed.dds",
              },
            },
            {
              state: "not-started",
              reason: "File not yet modified",
              operation: {
                action: "deploy",
                backupPath: "",
                id: "f6",
                replace: false,
                restoreBackup: false,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/mod/Data/pending.dds",
                targetPath: "/games/SkyrimSE/Data/pending.dds",
              },
            },
          ],
        },
      };

      const formatted = formatDeploymentRecoveryDetails(inspection, {
        homeDir: mockHome,
        userName: mockUser,
      });

      expect(formatted).toContain("Operation: deploy");
      expect(formatted).toContain("Operation ID: op-12345");
      expect(formatted).toContain("Phase: applying");
      expect(formatted).toContain("Staging: ~/Vortex Mods/skyrimse");
      expect(formatted).toContain("=== AMBIGUOUS (1) ===");
      expect(formatted).toContain(
        "Data/ambig.dds (Target file exists but content does not match source)",
      );
      expect(formatted).toContain("=== UNSAFE (1) ===");
      expect(formatted).toContain(
        "Data/bad.dds (Target is a symlink pointing outside game folder)",
      );
      expect(formatted).toContain("=== APPLIED (2) ===");
      expect(formatted).toContain("Data/ok1.dds");
      expect(formatted).toContain("Data/ok2.dds");
      expect(formatted).toContain("=== BACKED UP (1) ===");
      expect(formatted).toContain("=== NOT STARTED (1) ===");
    });

    it("truncates category entries beyond maxFilesPerCategory", () => {
      const entry: IDeploymentJournalEntry = {
        deploymentMethod: "hardlink_activator",
        gameId: "skyrimse",
        instanceId: "inst-1",
        operation: "deploy",
        operationId: "op-large",
        phase: "applying",
        stagingPath: "/staging",
        targetPaths: ["/target"],
        startedAt: "2026-09-09T12:00:00.000Z",
        updatedAt: "2026-09-09T12:00:05.000Z",
        version: 1,
      };

      const files = Array.from({ length: 5 }, (_, i) => ({
        state: "applied" as const,
        reason: "Applied",
        operation: {
          action: "deploy" as const,
          backupPath: "",
          id: `id-${i}`,
          replace: false,
          restoreBackup: false,
          sourcePath: `/staging/file${i}`,
          targetPath: `/target/file${i}`,
        },
      }));

      const inspection: IDeploymentJournalInspection = {
        stagingPath: "/staging",
        status: "incomplete",
        entry,
        reconciliation: {
          operationId: "op-large",
          safe: true,
          counts: {
            ambiguous: 0,
            unsafe: 0,
            applied: 5,
            "backed-up": 0,
            "rolled-back": 0,
            "not-started": 0,
          },
          files,
        },
      };

      const formatted = formatDeploymentRecoveryDetails(inspection, {
        maxFilesPerCategory: 2,
      });

      expect(formatted).toContain("=== APPLIED (5) ===");
      expect(formatted).toContain("file0");
      expect(formatted).toContain("file1");
      expect(formatted).toContain("... and 3 more files (see exported report)");
    });
  });

  describe("generateRedactedDeploymentRecoveryReport", () => {
    it("generates markdown report with redacted user paths and secret tokens", () => {
      const inspection: IDeploymentJournalInspection = {
        stagingPath: "/home/testuser/Vortex Mods/skyrimse",
        status: "invalid",
        error: new Error("Authentication failed for user token=super_secret_token_1234567890"),
      };

      const report = generateRedactedDeploymentRecoveryReport(inspection, {
        homeDir: mockHome,
        userName: mockUser,
      });

      expect(report).toContain("# Vortex Deployment Recovery Report");
      expect(report).toContain("Damaged Journal");
      expect(report).toContain("Staging Root:** `~/Vortex Mods/skyrimse`");
      expect(report).toContain("token=[REDACTED]");
      expect(report).not.toContain("/home/testuser");
    });

    it("generates markdown report with reconciliation table and file breakdown", () => {
      const entry: IDeploymentJournalEntry = {
        deploymentMethod: "hardlink_activator",
        gameId: "skyrimse",
        instanceId: "inst-1",
        operation: "deploy",
        operationId: "op-report-test",
        phase: "applying",
        stagingPath: "/home/testuser/Vortex Mods/skyrimse",
        targetPaths: ["/games/SkyrimSE"],
        startedAt: "2026-09-09T12:00:00.000Z",
        updatedAt: "2026-09-09T12:00:05.000Z",
        version: 1,
      };

      const inspection: IDeploymentJournalInspection = {
        stagingPath: entry.stagingPath,
        status: "incomplete",
        entry,
        reconciliation: {
          operationId: entry.operationId,
          safe: false,
          counts: {
            ambiguous: 1,
            unsafe: 0,
            applied: 1,
            "backed-up": 0,
            "rolled-back": 0,
            "not-started": 0,
          },
          files: [
            {
              state: "ambiguous",
              reason: "Hash mismatch",
              operation: {
                action: "deploy",
                backupPath: "",
                id: "f1",
                replace: false,
                restoreBackup: false,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/a.esp",
                targetPath: "/games/SkyrimSE/Data/a.esp",
              },
            },
            {
              state: "applied",
              reason: "Matches source",
              operation: {
                action: "deploy",
                backupPath: "",
                id: "f2",
                replace: false,
                restoreBackup: false,
                sourcePath: "/home/testuser/Vortex Mods/skyrimse/b.esp",
                targetPath: "/games/SkyrimSE/Data/b.esp",
              },
            },
          ],
        },
      };

      const report = generateRedactedDeploymentRecoveryReport(inspection, {
        homeDir: mockHome,
        userName: mockUser,
      });

      expect(report).toContain("# Vortex Deployment Recovery Report");
      expect(report).toContain("## 2. Reconciliation Overview");
      expect(report).toContain("| Ambiguous | 1 |");
      expect(report).toContain("| Applied | 1 |");
      expect(report).toContain("- **Safe for Automatic Recovery:** No");
      expect(report).toContain("### Ambiguous Files (1)");
      expect(report).toContain("Data/a.esp");
      expect(report).toContain("Reason: Hash mismatch");
      expect(report).toContain("### Applied (1)");
      expect(report).toContain("Data/b.esp");
      expect(report).not.toContain("/home/testuser");
    });
  });

  describe("writeToClipboard", () => {
    it("writes to window.api.clipboard when available", () => {
      writeToClipboard("hello clipboard");
      expect((global as any).window.api.clipboard.writeText).toHaveBeenCalledWith(
        "hello clipboard",
      );
    });
  });

  describe("showDeploymentRecoveryDetails", () => {
    const inspection: IDeploymentJournalInspection = {
      stagingPath: "/home/testuser/staging",
      status: "invalid",
      error: new Error("Damaged journal file"),
    };

    it("displays error dialog and handles Close action without side effects", async () => {
      const api: Partial<IExtensionApi> = {
        showDialog: vi.fn(() => PromiseBB.resolve({ action: "Close", input: {} })),
        sendNotification: vi.fn(),
      };

      await showDeploymentRecoveryDetails(api as IExtensionApi, "skyrimse", inspection);

      expect(api.showDialog).toHaveBeenCalledWith(
        "error",
        "Deployment recovery required",
        expect.objectContaining({
          parameters: { gameId: "skyrimse" },
        }),
        expect.arrayContaining([
          expect.objectContaining({ label: "Copy Report" }),
          expect.objectContaining({ label: "Save Report" }),
          expect.objectContaining({ label: "Close", default: true }),
        ]),
      );
      expect(api.sendNotification).not.toHaveBeenCalled();
    });

    it("copies redacted report to clipboard when user selects Copy Report", async () => {
      const api: Partial<IExtensionApi> = {
        showDialog: vi.fn(() => PromiseBB.resolve({ action: "Copy Report", input: {} })),
        sendNotification: vi.fn(),
      };

      await showDeploymentRecoveryDetails(api as IExtensionApi, "skyrimse", inspection);

      expect((global as any).window.api.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("# Vortex Deployment Recovery Report"),
      );
      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "info",
          title: "Report copied",
        }),
      );
    });

    it("saves redacted report to disk when user selects Save Report", async () => {
      const api: Partial<IExtensionApi> = {
        showDialog: vi.fn(() => PromiseBB.resolve({ action: "Save Report", input: {} })),
        saveFile: vi.fn(() => PromiseBB.resolve("/tmp/saved-report.md")),
        sendNotification: vi.fn(),
      };

      await showDeploymentRecoveryDetails(api as IExtensionApi, "skyrimse", inspection);

      expect(api.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: expect.stringContaining(".md"),
          title: "Save Deployment Recovery Report",
        }),
      );
      expect(writeFileAtomic).toHaveBeenCalledWith(
        "/tmp/saved-report.md",
        expect.stringContaining("# Vortex Deployment Recovery Report"),
      );
      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "success",
          title: "Report saved",
          message: expect.stringContaining("/tmp/saved-report.md"),
        }),
      );
    });
  });

  describe("checkDeploymentJournalsAtStartup", () => {
    it("does nothing when no journals exist or inspection returns undefined", async () => {
      const api: Partial<IExtensionApi> = {
        getState: vi.fn(() => ({
          settings: {
            mods: {
              installPath: {
                skyrimse: "/home/testuser/staging",
              },
            },
          },
        })) as any,
        sendNotification: vi.fn(),
      };

      vi.mocked(inspectDeploymentJournal).mockResolvedValueOnce(undefined);

      await checkDeploymentJournalsAtStartup(api as IExtensionApi);

      expect(api.sendNotification).not.toHaveBeenCalled();
    });

    it("raises warning notification for damaged/invalid journals with Details action only", async () => {
      const inspection: IDeploymentJournalInspection = {
        stagingPath: "/home/testuser/staging",
        status: "invalid",
        error: new Error("Damaged journal"),
      };

      const api: Partial<IExtensionApi> = {
        getState: vi.fn(() => ({
          settings: {
            mods: {
              installPath: {
                skyrimse: "/home/testuser/staging",
              },
            },
          },
        })) as any,
        sendNotification: vi.fn(),
        showDialog: vi.fn(() => PromiseBB.resolve({ action: "Close", input: {} })),
      };

      vi.mocked(inspectDeploymentJournal).mockResolvedValueOnce(inspection);

      await checkDeploymentJournalsAtStartup(api as IExtensionApi);

      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          title: "Deployment recovery required",
          message:
            "A deployment journal is damaged. Deployment and purge are blocked for this staging folder.",
          actions: [
            expect.objectContaining({
              title: "Details",
            }),
          ],
        }),
      );

      // Verify that triggering Details action calls showDeploymentRecoveryDetails
      const notiCall = vi.mocked(api.sendNotification)!.mock.calls[0][0];
      const detailsAction = notiCall.actions!.find((a: any) => a.title === "Details");
      expect(detailsAction).toBeDefined();

      await detailsAction!.action(vi.fn());
      expect(api.showDialog).toHaveBeenCalledWith(
        "error",
        "Deployment recovery required",
        expect.anything(),
        expect.anything(),
      );
    });

    it("offers automatic rollback action for safe applying recovery and executes on confirmation", async () => {
      const entry: IDeploymentJournalEntry = {
        deploymentMethod: "hardlink_activator",
        gameId: "skyrimse",
        instanceId: "inst-1",
        operation: "deploy",
        operationId: "op-safe-rollback",
        phase: "applying",
        stagingPath: "/home/testuser/staging",
        targetPaths: ["/games/SkyrimSE"],
        startedAt: "2026-09-09T12:00:00.000Z",
        updatedAt: "2026-09-09T12:00:05.000Z",
        version: 1,
        fileOperations: [
          {
            action: "deploy",
            backupPath: "",
            id: "f1",
            replace: false,
            restoreBackup: false,
            sourcePath: "/staging/mod/file1",
            targetPath: "/games/SkyrimSE/file1",
          },
        ],
      };

      const inspection: IDeploymentJournalInspection = {
        stagingPath: entry.stagingPath,
        status: "incomplete",
        entry,
        reconciliation: {
          operationId: entry.operationId,
          safe: true,
          counts: {
            ambiguous: 0,
            unsafe: 0,
            applied: 1,
            "backed-up": 0,
            "rolled-back": 0,
            "not-started": 0,
          },
          files: [
            {
              state: "applied",
              reason: "Applied",
              operation: entry.fileOperations![0],
            },
          ],
        },
      };

      const api: Partial<IExtensionApi> = {
        getState: vi.fn(() => ({
          settings: {
            mods: {
              installPath: {
                skyrimse: entry.stagingPath,
              },
            },
          },
        })) as any,
        sendNotification: vi.fn(),
        showDialog: vi.fn(() => PromiseBB.resolve({ action: "Roll back deployment", input: {} })),
      };

      vi.mocked(inspectDeploymentJournal).mockResolvedValueOnce(inspection);

      await checkDeploymentJournalsAtStartup(api as IExtensionApi);

      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          actions: expect.arrayContaining([
            expect.objectContaining({ title: "Roll back" }),
            expect.objectContaining({ title: "Details" }),
          ]),
        }),
      );

      // Execute Roll back action callback
      const notiCall = vi.mocked(api.sendNotification)!.mock.calls[0][0];
      const rollbackAction = notiCall.actions!.find((a: any) => a.title === "Roll back");
      const dismiss = vi.fn();
      await rollbackAction!.action(dismiss);

      expect(api.showDialog).toHaveBeenCalledWith(
        "question",
        "Roll back interrupted deployment?",
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ label: "Cancel" }),
          expect.objectContaining({ label: "Roll back deployment" }),
        ]),
      );
      expect(rollbackApplyingDeployment).toHaveBeenCalledWith(entry);
      expect(dismiss).toHaveBeenCalled();
      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "success",
          title: "Deployment recovery completed",
        }),
      );
    });

    it("offers only Details action when incomplete applying operation is unsafe / ambiguous", async () => {
      const entry: IDeploymentJournalEntry = {
        deploymentMethod: "hardlink_activator",
        gameId: "skyrimse",
        instanceId: "inst-1",
        operation: "deploy",
        operationId: "op-ambiguous",
        phase: "applying",
        stagingPath: "/home/testuser/staging",
        targetPaths: ["/games/SkyrimSE"],
        startedAt: "2026-09-09T12:00:00.000Z",
        updatedAt: "2026-09-09T12:00:05.000Z",
        version: 1,
        fileOperations: [],
      };

      const inspection: IDeploymentJournalInspection = {
        stagingPath: entry.stagingPath,
        status: "incomplete",
        entry,
        reconciliation: {
          operationId: entry.operationId,
          safe: false,
          counts: {
            ambiguous: 1,
            unsafe: 0,
            applied: 0,
            "backed-up": 0,
            "rolled-back": 0,
            "not-started": 0,
          },
          files: [],
        },
      };

      const api: Partial<IExtensionApi> = {
        getState: vi.fn(() => ({
          settings: {
            mods: {
              installPath: {
                skyrimse: entry.stagingPath,
              },
            },
          },
        })) as any,
        sendNotification: vi.fn(),
      };

      vi.mocked(inspectDeploymentJournal).mockResolvedValueOnce(inspection);

      await checkDeploymentJournalsAtStartup(api as IExtensionApi);

      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          actions: [
            expect.objectContaining({
              title: "Details",
            }),
          ],
        }),
      );
    });
  });

  describe("localization (Ukrainian & semantic keys)", () => {
    // Synthetic Ukrainian dictionary matching locales/uk/mod_management.json
    const ukDict: Record<string, string> = {
      "mod_management:::deployment_recovery::action_details": "Подробиці",
      "mod_management:::deployment_recovery::action_rollback": "Відкотити",
      "mod_management:::deployment_recovery::btn_confirm_rollback": "Відкотити розгортання",
      "mod_management:::deployment_recovery::btn_cancel": "Скасувати",
      "mod_management:::deployment_recovery::dialog_title": "Потрібне відновлення розгортання",
      "mod_management:::deployment_recovery::journal_invalid_text":
        "Не вдалося перевірити журнал розгортання. Vortex не запускатиме розгортання або очищення в цій папці підготовки, доки журнал не буде виправлено або перевірено.",
      "mod_management:::deployment_recovery::operation_incomplete_text":
        "Vortex виявив операцію розгортання, яка не досягла стану фіксації. Автоматичне відновлення не виконувалося.",
      "mod_management:::deployment_recovery::journal_validation_failed":
        "Помилка валідації журналу розгортання.",
      "mod_management:::deployment_recovery::staging_path_label": "Шлях підготовки: {{path}}",
      "mod_management:::deployment_recovery::error_label": "Помилка: {{error}}",
      "mod_management:::deployment_recovery::category_ambiguous": "Неоднозначні",
      "mod_management:::deployment_recovery::category_unsafe": "Небезпечні",
      "mod_management:::deployment_recovery::category_applied": "Застосовані",
      "mod_management:::deployment_recovery::category_backed_up": "Збережені в резерв",
      "mod_management:::deployment_recovery::category_rolled_back": "Відкочені",
      "mod_management:::deployment_recovery::category_not_started": "Не розпочаті",
      "mod_management:::deployment_recovery::startup_noti_damaged":
        "Журнал розгортання пошкоджено. Розгортання та очищення заблоковано для цієї папки підготовки.",
      "mod_management:::deployment_recovery::startup_noti_interrupted":
        "Виявлено перервану операцію «{{operation}}» на фазі «{{phase}}».",
      "mod_management:::deployment_recovery::startup_noti_title":
        "Потрібне відновлення розгортання",
      "mod_management:::deployment_recovery::noti_recovery_completed_title":
        "Відновлення розгортання завершено",
      "mod_management:::deployment_recovery::noti_rollback_message":
        "Підготовлену операцію відкочено без внесення змін до керованих файлів.",
      "mod_management:::deployment_recovery::btn_copy_report": "Копіювати звіт",
      "mod_management:::deployment_recovery::btn_save_report": "Зберегти звіт",
      "mod_management:::deployment_recovery::btn_close": "Закрити",
    };

    const mockUkTranslator = (key: string, options?: any) => {
      const template = ukDict[key];
      if (!template) return key;
      const replacements = options?.replace ?? options ?? {};
      return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token) =>
        String(replacements[token] ?? `{{${token}}}`),
      );
    };

    it("formats details in Ukrainian when Ukrainian translator is provided", () => {
      const inspection: IDeploymentJournalInspection = {
        stagingPath: "/staging",
        status: "invalid",
        error: new Error("Помилка контрольної суми"),
      };

      const formatted = formatDeploymentRecoveryDetails(inspection, {
        t: mockUkTranslator,
      });

      expect(formatted).toContain("Помилка валідації журналу розгортання.");
      expect(formatted).toContain("Помилка: Помилка контрольної суми");
    });

    it("renders dialog and notification in Ukrainian during startup and rollback", async () => {
      const entry: IDeploymentJournalEntry = {
        deploymentMethod: "hardlink_activator",
        gameId: "skyrimse",
        instanceId: "inst-1",
        operation: "deploy",
        operationId: "op-uk-test",
        phase: "applying",
        stagingPath: "/home/testuser/staging",
        targetPaths: ["/games/SkyrimSE"],
        startedAt: "2026-09-09T12:00:00.000Z",
        updatedAt: "2026-09-09T12:00:05.000Z",
        version: 1,
        fileOperations: [
          {
            action: "deploy",
            backupPath: "",
            id: "f1",
            replace: false,
            restoreBackup: false,
            sourcePath: "/staging/mod/file1",
            targetPath: "/games/SkyrimSE/file1",
          },
        ],
      };

      const inspection: IDeploymentJournalInspection = {
        stagingPath: entry.stagingPath,
        status: "incomplete",
        entry,
        reconciliation: {
          operationId: entry.operationId,
          safe: true,
          counts: {
            ambiguous: 0,
            unsafe: 0,
            applied: 1,
            "backed-up": 0,
            "rolled-back": 0,
            "not-started": 0,
          },
          files: [
            {
              state: "applied",
              reason: "Applied",
              operation: entry.fileOperations![0],
            },
          ],
        },
      };

      const api: Partial<IExtensionApi> = {
        getState: vi.fn(() => ({
          settings: {
            mods: {
              installPath: {
                skyrimse: entry.stagingPath,
              },
            },
          },
        })) as any,
        translate: mockUkTranslator as any,
        sendNotification: vi.fn(),
        showDialog: vi.fn(() => PromiseBB.resolve({ action: "Відкотити розгортання", input: {} })),
      };

      vi.mocked(inspectDeploymentJournal).mockResolvedValueOnce(inspection);

      await checkDeploymentJournalsAtStartup(api as IExtensionApi);

      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          title: "Потрібне відновлення розгортання",
          message: "Виявлено перервану операцію «deploy» на фазі «applying».",
          actions: expect.arrayContaining([
            expect.objectContaining({ title: "Відкотити" }),
            expect.objectContaining({ title: "Подробиці" }),
          ]),
        }),
      );

      // Trigger rollback
      const notiCall = vi.mocked(api.sendNotification)!.mock.calls[0][0];
      const rollbackAction = notiCall.actions!.find((a: any) => a.title === "Відкотити");
      const dismiss = vi.fn();
      await rollbackAction!.action(dismiss);

      expect(api.showDialog).toHaveBeenCalledWith(
        "question",
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ label: "Скасувати" }),
          expect.objectContaining({ label: "Відкотити розгортання" }),
        ]),
      );
      expect(dismiss).toHaveBeenCalled();
      expect(api.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "success",
          title: "Відновлення розгортання завершено",
          message: "Підготовлену операцію відкочено без внесення змін до керованих файлів.",
        }),
      );
    });
  });
});
