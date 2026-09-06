import * as React from "react";
import {
  Alert,
  Button,
  ControlLabel,
  FormControl,
  FormGroup,
  HelpBlock,
  Panel,
} from "react-bootstrap";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import type * as Redux from "redux";
import type { ThunkDispatch } from "redux-thunk";

import { dismissNotification } from "../../../actions/notifications";
import { setOpenMainPage } from "../../../actions/session";
import type { IExtensionApi } from "../../../types/IExtensionContext";
import type { IState } from "../../../types/IState";
import { assessLinuxEnvironment } from "../../../util/linux/environmentAssessment";
import { checkHardlinkCompatibility } from "../../../util/linux/linuxMounts";
import ProtonPaths from "../../../util/linux/ProtonPaths";
import { discoverAvailableProtonRuntimes } from "../../../util/linux/protonRuntimes";
import {
  type IProtonRuntimePreference,
  resolveProtonRuntimePreference,
} from "../../../util/linux/protonRuntimeSelection";
import {
  discoverLinuxSteamLibraries,
  getLinuxSteamPaths,
  isValidSteamPath,
} from "../../../util/linux/steamPaths";
import opn from "../../../util/opn";
import * as selectors from "../../../util/selectors";
import { activeGameId } from "../../../util/selectors";
import { getSafe } from "../../../util/storeHelper";
import type { IDiscoveryResult } from "../../gamemode_management/types/IDiscoveryResult";
import type { IGameStored } from "../../gamemode_management/types/IGameStored";
import { suggestStagingPathPattern } from "../../gamemode_management/util/suggestStagingPath";
import { setLinuxSetupCompleted, setProtonRuntimePreference } from "../actions/settings";
import { modPathsForGame } from "../selectors";
import type { IDeploymentMethod } from "../types/IDeploymentMethod";
import { getSupportedActivators } from "../util/deploymentMethods";
import { rankAutomaticDeploymentMethods } from "../util/deploymentRecommendation";
import {
  configurationProblems,
  detectSteamInstallationType,
  runtimePreferenceValue,
} from "../util/linuxSetupModel";

interface IBaseProps {
  activators: IDeploymentMethod[];
  api: IExtensionApi;
}

interface IConnectedProps {
  currentActivator?: string;
  discovery?: IDiscoveryResult;
  game?: IGameStored;
  gameId?: string;
  linuxSetupCompleted: boolean;
  modPaths: string[];
  preference?: IProtonRuntimePreference;
  stagingPath?: string;
  stagingDirectoryName: string;
  supportedActivatorIds: string[];
}

interface IActionProps {
  onComplete: () => void;
  onOpenHealthCheck: () => void;
  onSetPreference: (gameId: string, preference: IProtonRuntimePreference) => void;
}

type IProps = IBaseProps & IConnectedProps & IActionProps;

function LinuxSetup(props: IProps): JSX.Element {
  const { t } = props as IProps & { t: (key: string, options?: any) => string };
  if (
    process.platform !== "linux" ||
    props.gameId === undefined ||
    props.discovery?.path === undefined
  ) {
    return null;
  }

  const proton = ProtonPaths.resolve({
    discovery: props.discovery,
    game: props.game as any,
    gameMode: props.gameId,
  });
  const runtimes = discoverAvailableProtonRuntimes(proton?.steamPath);
  const resolvedRuntime = resolveProtonRuntimePreference(
    props.preference,
    proton?.protonPath,
    runtimes,
  );
  const steamInstallations = getLinuxSteamPaths().filter(isValidSteamPath);
  const steamLibraries = Array.from(
    new Set(steamInstallations.flatMap(discoverLinuxSteamLibraries)),
  );
  const steamType = detectSteamInstallationType(proton?.steamPath);
  const supported = props.activators
    .filter((activator) => props.supportedActivatorIds.includes(activator.id))
    .map((activator) => ({ activator, errors: [], warnings: [] }));
  const recommendation = rankAutomaticDeploymentMethods(
    supported,
    "linux",
    props.game?.capabilities?.deployment,
  );
  const stagingIsCompatible =
    props.stagingPath !== undefined &&
    checkHardlinkCompatibility(props.stagingPath, props.discovery.path) === undefined;
  const recommendedStagingPath = stagingIsCompatible
    ? props.stagingPath
    : suggestStagingPathPattern("linux", false, props.discovery.path, props.stagingDirectoryName);

  const preferenceValue = runtimePreferenceValue(props.preference);
  const effectiveRuntimePath = resolvedRuntime.path ?? proton?.protonPath;

  const selectRuntime = (event: React.ChangeEvent<any>) => {
    const value = String(event.target.value);
    if (value.startsWith("runtime:")) {
      const runtime = runtimes.find(
        (candidate) => candidate.path === value.slice("runtime:".length),
      );
      if (runtime !== undefined) {
        props.onSetPreference(props.gameId, {
          approvedPath: runtime.type === "custom" ? runtime.path : undefined,
          path: runtime.path,
          type: runtime.type,
        });
      }
    } else {
      props.onSetPreference(props.gameId, { type: value as IProtonRuntimePreference["type"] });
    }
  };

  const browseRuntime = async () => {
    const selected = await props.api.selectDir({ defaultPath: props.preference?.path });
    if (selected) {
      props.onSetPreference(props.gameId, {
        approvedPath: selected,
        path: selected,
        type: "custom",
      });
    }
  };

  const checkConfiguration = async () => {
    const assessment = assessLinuxEnvironment({
      deploymentMethodId: props.currentActivator,
      deploymentPaths: props.modPaths,
      gamePath: props.discovery.path,
      platform: "linux",
      prefixPath: proton?.prefixPath,
      stagingPath: props.stagingPath,
      steamPath: proton?.steamPath,
    });
    const problems = configurationProblems(
      assessment.issues,
      proton?.prefixPath,
      resolvedRuntime.error,
    );
    const result = await props.api.showDialog(
      assessment.blocking || problems.some((problem) => problem.startsWith("ERROR"))
        ? "error"
        : "info",
      "Linux configuration assessment",
      { text: problems.length > 0 ? problems.join("\n") : "Configuration checks passed." },
      [{ label: "Open Health Check" }, { label: "Close" }],
    );
    if (result.action === "Open Health Check") props.onOpenHealthCheck();
  };

  return (
    <Panel id="linux-setup-assistant">
      <Panel.Body>
        <ControlLabel>{t("Linux setup assistant")}</ControlLabel>
        {!props.linuxSetupCompleted ? (
          <Alert bsStyle="info">
            {t("Review this configuration before your first deployment.")}
          </Alert>
        ) : null}
        <dl>
          <dt>{t("Steam installation")}</dt>
          <dd>{t(steamType)}</dd>
          <dt>{t("Discovered Steam libraries")}</dt>
          <dd>{steamLibraries.join(", ") || t("None")}</dd>
          <dt>{t("Staging path")}</dt>
          <dd>{props.stagingPath || t("Not configured")}</dd>
          <dt>{t("Recommended staging path")}</dt>
          <dd>{recommendedStagingPath}</dd>
          <dt>{t("Recommended deployment method")}</dt>
          <dd>
            {recommendation.activator ? t(recommendation.activator.name) : t("None")} —{" "}
            {t(recommendation.reason)}
          </dd>
          <dt>{t("Proton prefix")}</dt>
          <dd>{proton?.prefixPath || t("Not detected")}</dd>
        </dl>
        <FormGroup validationState={resolvedRuntime.error ? "error" : undefined}>
          <ControlLabel>{t("Proton runtime")}</ControlLabel>
          <FormControl componentClass="select" value={preferenceValue} onChange={selectRuntime}>
            <option value="auto">{t("Automatic")}</option>
            <option value="steam-selected">{t("Steam-selected")}</option>
            {runtimes.map((runtime) => (
              <option
                disabled={!runtime.isUsable}
                key={runtime.path}
                value={`runtime:${runtime.path}`}
              >
                {runtime.name} ({runtime.source})
                {runtime.isUsable ? "" : ` — ${t("Not executable")}`}
              </option>
            ))}
            {props.preference?.type === "custom" &&
            props.preference.path !== undefined &&
            !runtimes.some((runtime) => runtime.path === props.preference.path) ? (
              <option value={`runtime:${props.preference.path}`}>
                {t("Custom")}: {props.preference.path}
              </option>
            ) : null}
          </FormControl>
          {resolvedRuntime.error ? <HelpBlock>{t(resolvedRuntime.error)}</HelpBlock> : null}
          <Button onClick={browseRuntime}>{t("Choose custom runtime")}</Button>{" "}
          <Button
            disabled={effectiveRuntimePath === undefined}
            onClick={() => {
              if (effectiveRuntimePath !== undefined) {
                void opn(effectiveRuntimePath).catch((err) =>
                  props.api.showErrorNotification("Failed to open Proton runtime directory", err),
                );
              }
            }}
          >
            {t("Open runtime directory")}
          </Button>
        </FormGroup>
        <HelpBlock>
          {t(
            "Hardlinks are fastest and require staging and the game on the same filesystem. Symlinks can cross filesystems but may be restricted by the destination or sandbox.",
          )}
        </HelpBlock>
        <Button onClick={checkConfiguration}>{t("Check configuration")}</Button>{" "}
        {!props.linuxSetupCompleted ? (
          <Button onClick={props.onComplete}>{t("Mark setup complete")}</Button>
        ) : null}
      </Panel.Body>
    </Panel>
  );
}

function mapStateToProps(state: IState): IConnectedProps {
  const gameId = activeGameId(state);
  return {
    currentActivator: getSafe(state, ["settings", "mods", "activator", gameId], undefined),
    discovery: gameId ? selectors.discoveryByGame(state, gameId) : undefined,
    game: gameId ? selectors.gameById(state, gameId) : undefined,
    gameId,
    linuxSetupCompleted: state.settings.mods.linuxSetupCompleted,
    modPaths: gameId ? Object.values(modPathsForGame(state, gameId)).filter(Boolean) : [],
    preference: gameId ? state.settings.mods.protonRuntime?.[gameId] : undefined,
    stagingPath: gameId ? selectors.installPathForGame(state, gameId) : undefined,
    stagingDirectoryName: state.settings.mods.suggestInstallPathDirectory,
    supportedActivatorIds: getSupportedActivators(state).map((activator) => activator.id),
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onComplete: () => {
      dispatch(setLinuxSetupCompleted(true));
      dispatch(dismissNotification("linux-first-run-setup"));
    },
    onOpenHealthCheck: () => dispatch(setOpenMainPage("health", false)),
    onSetPreference: (gameId, preference) =>
      dispatch(setProtonRuntimePreference(gameId, preference)),
  };
}

export default withTranslation(["common", "health_check"])(
  connect(mapStateToProps, mapDispatchToProps)(LinuxSetup),
) as React.ComponentClass<IBaseProps>;
