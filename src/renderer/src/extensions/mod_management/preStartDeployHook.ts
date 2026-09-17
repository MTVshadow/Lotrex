import type { IExtensionApi, IRunParameters } from "../../types/IExtensionContext";
import type { IState } from "../../types/IState";
import { UserCanceled } from "../../util/CustomErrors";
import onceCB from "../../util/onceCB";
import { activeGameId } from "../../util/selectors";
import { installPathForGame, needToDeploy } from "./selectors";
import getText from "./texts";
import { withActivationLock } from "./util/activationStore";
import {
  buildDeploymentRecoveryPlan,
  completeDeploymentRecovery,
  inspectDeploymentJournal,
} from "./util/deploymentJournal";
import { showDeploymentRecoveryDetails, translateWithFallback } from "./util/deploymentRecoveryUI";
import { checkProtectedRestoreBeforeLaunch } from "./util/protectedBaselineRecoveryUI";

type DeployResult = "auto" | "yes" | "skip" | "cancel";

function queryDeploy(api: IExtensionApi): Promise<DeployResult> {
  const state: IState = api.store.getState();
  if (!needToDeploy(state)) {
    return Promise.resolve<DeployResult>("auto");
  } else {
    const t = api.translate;
    return Promise.resolve(
      api.showDialog(
        "question",
        t("Pending deployment"),
        {
          bbcode: t(
            "Mod deployment {{more}} is pending.[br][/br]" +
              "This means that changes made to mods such as updating, " +
              "enabling/disabling, as well as newly set mod rules need to be deployed to take effect.[br][/br]" +
              "You can skip this step, ignoring (but not reverting) newly made changes to mods and mod rules, " +
              "or deploy now to commit the changes.",
            {
              replace: {
                more: `[More id='more-deploy' name='${t("Deployment")}']${getText("deployment", t)}[/More]`,
              },
            },
          ),
        },
        [{ label: "Cancel" }, { label: "Skip" }, { label: "Deploy" }],
      ),
    ).then((result) => {
      switch (result.action) {
        case "Skip":
          return "skip" as DeployResult;
        case "Deploy":
          return "yes" as DeployResult;
        default:
          return "cancel" as DeployResult;
      }
    });
  }
}

function checkDeploy(api: IExtensionApi): Promise<void> {
  return queryDeploy(api).then((shouldDeploy) => {
    if (shouldDeploy === "yes") {
      return new Promise<void>((resolve, reject) => {
        api.events.emit(
          "deploy-mods",
          onceCB((err) => {
            if (err !== null) {
              reject(err);
            } else {
              resolve();
            }
          }),
        );
      });
    } else if (shouldDeploy === "auto") {
      return new Promise<void>((resolve, reject) => {
        api.events.emit("await-activation", (err: Error) => {
          if (err !== null) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } else if (shouldDeploy === "cancel") {
      return Promise.reject(new UserCanceled());
    } else {
      // skip
      return Promise.resolve();
    }
  });
}

export async function checkDeploymentRecoveryBeforeLaunch(api: IExtensionApi): Promise<void> {
  if (process.platform !== "linux") return;

  const state = api.store.getState();
  const gameId = activeGameId(state);
  if (gameId === undefined) return;

  await checkProtectedRestoreBeforeLaunch(api, gameId);

  const stagingPath = installPathForGame(state, gameId);
  if (stagingPath === undefined) return;

  const inspection = await inspectDeploymentJournal(stagingPath);
  if (inspection === undefined) return;

  const t = (key: string, options?: any) =>
    translateWithFallback(api.translate?.bind(api), key, options);
  const recoveryPlan =
    inspection.entry !== undefined
      ? buildDeploymentRecoveryPlan(inspection.entry, inspection.reconciliation)
      : undefined;
  const detailsLabel = t("mod_management:::deployment_recovery::action_details");
  const cancelLabel = t("mod_management:::deployment_recovery::btn_cancel");
  const recoveryLabel =
    recoveryPlan?.action === "rollback"
      ? t("mod_management:::deployment_recovery::action_rollback")
      : t("mod_management:::deployment_recovery::action_finish");
  const message =
    inspection.status === "invalid"
      ? t("mod_management:::deployment_recovery::launch_invalid_message")
      : t("mod_management:::deployment_recovery::launch_incomplete_message", {
          operation: inspection.entry?.operation,
          phase: inspection.entry?.phase,
          replace: {
            operation: inspection.entry?.operation,
            phase: inspection.entry?.phase,
          },
        });
  const actions = [
    { label: detailsLabel },
    ...(recoveryPlan?.safe === true && recoveryPlan.action !== undefined
      ? [{ label: recoveryLabel }]
      : []),
    { label: cancelLabel, default: true },
  ];

  const result = await api.showDialog(
    "error",
    t("mod_management:::deployment_recovery::launch_blocked_title"),
    {
      text: t("mod_management:::deployment_recovery::launch_blocked_text"),
      message,
    },
    actions,
  );

  if (result.action === detailsLabel || result.action === "Details") {
    await showDeploymentRecoveryDetails(api, gameId, inspection);
    throw new UserCanceled();
  }

  if (
    recoveryPlan?.safe === true &&
    recoveryPlan.action !== undefined &&
    inspection.entry !== undefined &&
    (result.action === recoveryLabel ||
      result.action === "Roll back" ||
      result.action === "Finish recovery")
  ) {
    await withActivationLock(() =>
      completeDeploymentRecovery(
        inspection.entry!,
        recoveryPlan.action!,
        inspection.reconciliation,
      ),
    );
    const remaining = await inspectDeploymentJournal(stagingPath);
    if (remaining === undefined) return;
  }

  throw new UserCanceled();
}

function preStartDeployHook(api: IExtensionApi, input: IRunParameters): Promise<IRunParameters> {
  return input.options.suggestDeploy === true
    ? checkDeploymentRecoveryBeforeLaunch(api)
        .then(() => checkDeploy(api))
        .then(() => input)
    : Promise.resolve(input);
}

export default preStartDeployHook;
