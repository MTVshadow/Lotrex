import type { IExtensionApi } from "../../../types/IExtensionContext";
import { UserCanceled } from "../../../util/CustomErrors";
import { discoveryByGame } from "../../../util/selectors";
import { truthy } from "../../../util/util";
import { getGame } from "../../gamemode_management/util/getGame";
import { installPathForGame } from "../selectors";
import { withActivationLock } from "./activationStore";
import {
  attestUnmanagedCriticalBaseline,
  inspectProtectedRestoreJournal,
  type IProtectedBaselineOptions,
  rollbackInterruptedProtectedRestore,
  restoreCriticalBaselineFiles,
} from "./protectedBaseline";

export async function offerProtectedBaselineRecovery(
  api: IExtensionApi,
  options: IProtectedBaselineOptions,
  managedRelativePaths: string[],
  files: string[],
): Promise<void> {
  const t = api.translate.bind(api);
  const restoreLabel = t("mod_management:::protected_baseline::restore_action");
  const cancelLabel = t("mod_management:::protected_baseline::keep_blocked_action");
  const result = await api.showDialog(
    "error",
    t("mod_management:::protected_baseline::recovery_title"),
    {
      text: t("mod_management:::protected_baseline::recovery_text"),
      message: t("mod_management:::protected_baseline::recovery_files", {
        files: files.join("\n"),
        replace: { files: files.join("\n") },
      }),
    },
    [{ label: cancelLabel, default: true }, { label: restoreLabel }],
  );
  if (result.action !== restoreLabel) throw new UserCanceled();

  await restoreCriticalBaselineFiles(options, files);
  await attestUnmanagedCriticalBaseline(options, managedRelativePaths);
}

function protectedRestoreOptionsForGame(
  api: IExtensionApi,
  gameId: string,
): IProtectedBaselineOptions[] {
  const state = api.store.getState();
  const discovery = discoveryByGame(state, gameId);
  const stagingPath = installPathForGame(state, gameId);
  if (!truthy(discovery?.path) || !truthy(stagingPath)) return [];
  try {
    const game = getGame(gameId);
    if (game?.getModPaths === undefined) return [];
    return [...new Set(Object.values(game.getModPaths(discovery.path)).filter(truthy))].map(
      (targetRoot) => ({
        gameId,
        relativePaths: [],
        stagingPath,
        targetRoot,
      }),
    );
  } catch {
    return [];
  }
}

export async function checkProtectedRestoreBeforeLaunch(
  api: IExtensionApi,
  gameId: string,
): Promise<void> {
  const t = api.translate.bind(api);
  for (const options of protectedRestoreOptionsForGame(api, gameId)) {
    const inspection = await inspectProtectedRestoreJournal(options);
    if (inspection === undefined) continue;
    const cancelLabel = t("mod_management:::protected_baseline::keep_blocked_action");
    const recoverLabel =
      inspection.phase === "committed"
        ? t("mod_management:::protected_baseline::finish_cleanup_action")
        : t("mod_management:::protected_baseline::rollback_interrupted_action");
    const result = await api.showDialog(
      "error",
      t("mod_management:::protected_baseline::interrupted_title"),
      {
        text:
          inspection.status === "invalid"
            ? t("mod_management:::protected_baseline::journal_invalid")
            : t("mod_management:::protected_baseline::interrupted_text", {
                phase: inspection.phase,
                replace: { phase: inspection.phase },
                transactionId: inspection.transactionId,
              }),
        message: inspection.files.join("\n"),
      },
      [
        { label: cancelLabel, default: true },
        ...(inspection.status === "incomplete" ? [{ label: recoverLabel }] : []),
      ],
    );
    if (result.action !== recoverLabel || inspection.status !== "incomplete") {
      throw new UserCanceled();
    }
    await withActivationLock(() => rollbackInterruptedProtectedRestore(options));
    if ((await inspectProtectedRestoreJournal(options)) !== undefined) throw new UserCanceled();
  }
  api.dismissNotification(`protected-restore-recovery-${gameId}`);
}

export async function checkProtectedRestoreJournalsAtStartup(api: IExtensionApi): Promise<void> {
  const state = api.store.getState();
  const gameIds = Object.keys(state.settings?.mods?.installPath ?? {});
  const t = api.translate.bind(api);
  for (const gameId of gameIds) {
    const hasInterruptedRestore = (
      await Promise.all(
        protectedRestoreOptionsForGame(api, gameId).map(inspectProtectedRestoreJournal),
      )
    ).some((inspection) => inspection !== undefined);
    if (!hasInterruptedRestore) continue;
    api.sendNotification({
      actions: [
        {
          action: () => {
            void checkProtectedRestoreBeforeLaunch(api, gameId).catch(() => undefined);
          },
          title: t("mod_management:::protected_baseline::review_recovery_action"),
        },
      ],
      id: `protected-restore-recovery-${gameId}`,
      message: t("mod_management:::protected_baseline::startup_message"),
      noDismiss: true,
      title: t("mod_management:::protected_baseline::interrupted_title"),
      type: "error",
    });
  }
}
